import { randomUUID } from 'node:crypto'
import { exec as execCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AppSettings, ArtifactDescriptor, ConversationEvent, ConversationSnapshot,
  CreateSessionInput, DecisionRequest, PluginDescriptor, ProviderConfiguration,
  RuntimeHealth, RuntimePushEvent, RuntimeStatus, SendMessageInput, SessionSummary,
  WorkspaceRef,
} from '@axon-auto-agent/contracts'
import {
  AppendOnlyEventStore, inspectHarnessCompatibility, isPreviewableMediaType,
  mediaTypeForPath, PINNED_HARNESS_VERSION, resolveWorkspacePathSecure,
  streamOpenAICompatible, testOpenAICompatible, validateDevelopmentPlugin,
  type ChatMessage, type ToolCall, type ToolDefinition,
} from '@axon-auto-agent/runtime'

const exec = promisify(execCallback)
const isoNow = () => new Date().toISOString()

interface RuntimeProvider extends ProviderConfiguration { apiKey?: string }
interface RuntimeConfiguration { settings: AppSettings; providers: RuntimeProvider[]; workspaces: WorkspaceRef[] }
interface InternalCreateSessionInput extends CreateSessionInput { workspace?: WorkspaceRef; provider?: RuntimeProvider }
interface PendingDecision { request: DecisionRequest; resolve(approved: boolean): void }
interface StoredAttachment { name: string; path: string; size: number; mediaType: string }
type Push = (event: RuntimePushEvent) => void

class StreamingSecretRedactor {
  private buffer = ''
  private readonly secrets: string[]
  private readonly keepCharacters: number

  constructor(secrets: Array<string | undefined>) {
    this.secrets = [...new Set(secrets.filter((secret): secret is string => Boolean(secret)))].sort((left, right) => right.length - left.length)
    this.keepCharacters = Math.max(0, ...this.secrets.map((secret) => secret.length - 1))
  }

  push(text: string): string {
    this.buffer += text
    let output = ''
    while (this.buffer) {
      const matches = this.secrets
        .map((secret) => ({ secret, index: this.buffer.indexOf(secret) }))
        .filter((match) => match.index >= 0)
        .sort((left, right) => left.index - right.index || right.secret.length - left.secret.length)
      const match = matches[0]
      if (match) {
        output += `${this.buffer.slice(0, match.index)}[REDACTED]`
        this.buffer = this.buffer.slice(match.index + match.secret.length)
        continue
      }
      const releaseLength = this.buffer.length - this.keepCharacters
      if (releaseLength <= 0) break
      output += this.buffer.slice(0, releaseLength)
      this.buffer = this.buffer.slice(releaseLength)
      break
    }
    return output
  }

  flush(): string {
    const output = this.secrets.reduce((result, secret) => result.split(secret).join('[REDACTED]'), this.buffer)
    this.buffer = ''
    return output
  }
}

const MAX_ATTACHMENT_COUNT = 5
const MAX_ATTACHMENT_SIZE = 300_000
const MAX_MODEL_CALL_MS = 10 * 60_000

const BUILTIN_PLUGINS: PluginDescriptor[] = [
  { id: 'deepseek-harness', name: 'DeepSeek Harness Core', version: PINNED_HARNESS_VERSION, source: 'builtin', state: 'loaded', capabilities: ['sessions', 'agent-runtime', 'plugin-profile'] },
  { id: 'openai-compatible', name: 'OpenAI-compatible Models', version: '1.0.0', source: 'builtin', state: 'loaded', capabilities: ['model-provider', 'streaming'] },
  { id: 'workspace-tools', name: 'Workspace Tools', version: '1.0.0', source: 'builtin', state: 'loaded', capabilities: ['filesystem', 'command', 'artifacts'] },
]

const TOOLS: ToolDefinition[] = [
  {
    type: 'function', function: {
      name: 'list_workspace', description: 'List files and folders inside the selected workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative folder path. Use . for the root.' } }, additionalProperties: false },
    },
  },
  {
    type: 'function', function: {
      name: 'read_file', description: 'Read a UTF-8 text file inside the selected workspace.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'], additionalProperties: false },
    },
  },
  {
    type: 'function', function: {
      name: 'write_file', description: 'Create or replace a file inside the selected workspace. The user may be asked to approve it.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'], additionalProperties: false },
    },
  },
  {
    type: 'function', function: {
      name: 'run_command', description: 'Run a shell command in the selected workspace. Explicit user approval may be required.',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'], additionalProperties: false },
    },
  },
]

export class RuntimeService {
  private readonly events: AppendOnlyEventStore
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly runPromises = new Map<string, Promise<void>>()
  private readonly pendingDecisions = new Map<string, PendingDecision>()
  private readonly sequence = new Map<string, number>()
  private readonly plugins = new Map<string, PluginDescriptor>(BUILTIN_PLUGINS.map((plugin) => [plugin.id, plugin]))
  private configuration?: RuntimeConfiguration
  private status: RuntimeStatus
  private readonly harnessCompatible: boolean

  constructor(private readonly dataPath: string, private readonly push: Push) {
    this.events = new AppendOnlyEventStore(path.join(dataPath, 'sessions'))
    const harness = inspectHarnessCompatibility()
    this.harnessCompatible = harness.compatible
    this.status = {
      state: harness.compatible ? 'ready' : 'degraded',
      version: '0.1.0', harnessVersion: harness.actual,
      activeSessionIds: [], lastError: harness.compatible ? undefined : harness.error ?? `Harness ${harness.expected} expected, ${harness.actual} found.`,
      updatedAt: isoNow(),
    }
  }

  async initialize(): Promise<void> {
    await this.events.initialize()
    for (const sessionId of await this.events.listSessionIds()) {
      const sessionEvents = await this.events.read(sessionId)
      this.sequence.set(sessionId, sessionEvents.at(-1)?.seq ?? 0)
      const snapshot = await this.openSession(sessionId)
      for (const decision of snapshot.decisions.filter((item) => item.status === 'pending')) {
        await this.emit(sessionId, 'decision/resolved', {
          decisionId: decision.id, approved: false, reason: 'runtime-recovery',
        })
      }
      if (snapshot.session.state === 'running' || snapshot.session.state === 'waiting_for_decision') {
        await this.emit(sessionId, 'run/interrupted', {
          reason: 'runtime-recovery',
          message: 'The previous runtime exited before this task finished.',
        })
      }
    }
    this.pushStatus()
  }

  async handle(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'runtime.configure': this.configuration = params as RuntimeConfiguration; return this.status
      case 'runtime.health': return await this.health()
      case 'runtime.shutdown': await this.shutdown(); return true
      case 'runtime.exportDiagnostics': return await this.exportDiagnostics()
      case 'session.list': return await this.listSessions()
      case 'session.create': return await this.createSession(params as InternalCreateSessionInput)
      case 'session.open': return await this.openSession((params as { sessionId: string }).sessionId)
      case 'session.send': return await this.sendMessage(params as SendMessageInput)
      case 'session.stop': return await this.stopSession((params as { sessionId: string }).sessionId)
      case 'session.resume': return await this.resumeSession((params as { sessionId: string }).sessionId)
      case 'decision.resolve': return await this.resolveDecision(params as { decisionId: string; approved: boolean })
      case 'model.test': return await this.testProvider((params as { providerId: string }).providerId)
      case 'plugin.list': return [...this.plugins.values()]
      case 'plugin.load': return await this.loadPlugin((params as { path: string }).path)
      case 'plugin.reload': return await this.reloadPlugin((params as { pluginId: string }).pluginId)
      case 'artifact.resolve': return await this.resolveArtifact((params as { artifactId: string }).artifactId)
      default: throw new Error(`Unsupported runtime method: ${method}`)
    }
  }

  private async createSession(input: InternalCreateSessionInput): Promise<ConversationSnapshot> {
    if (!input.workspace) throw new Error('Choose a workspace before creating a session.')
    if (!input.provider) throw new Error('Configure a model provider before creating a session.')
    const id = randomUUID()
    const payload = {
      title: input.title?.trim() || '新任务', workspaceId: input.workspace.id,
      providerId: input.provider.id, modelId: input.modelId || input.provider.model,
      workspace: input.workspace,
    }
    await this.emit(id, 'session/created', payload)
    return await this.openSession(id)
  }

  private async sendMessage(input: SendMessageInput): Promise<void> {
    const controller = this.reserveRun(input.sessionId)
    try {
      await this.openSession(input.sessionId)
      const content = input.content.trim()
      if (!content) throw new Error('Message cannot be empty.')
      const attachments = await this.stageAttachments(input.sessionId, input.attachments ?? [])
      await this.emit(input.sessionId, 'user/message', { content, attachments })
      this.launchRun(input.sessionId, controller)
    } catch (error) {
      if (this.abortControllers.get(input.sessionId) === controller) this.abortControllers.delete(input.sessionId)
      this.pushStatus()
      throw error
    }
  }

  private reserveRun(sessionId: string): AbortController {
    if (this.abortControllers.has(sessionId)) throw new Error('This session is already running.')
    const controller = new AbortController()
    this.abortControllers.set(sessionId, controller)
    this.pushStatus()
    return controller
  }

  private launchRun(sessionId: string, controller: AbortController): void {
    const run = this.runAgent(sessionId, controller).catch((error) => {
      this.status = { ...this.status, lastError: error instanceof Error ? error.message : String(error), updatedAt: isoNow() }
      this.pushStatus()
    })
    this.runPromises.set(sessionId, run)
    void run.finally(() => {
      if (this.runPromises.get(sessionId) === run) this.runPromises.delete(sessionId)
    })
  }

  private async runAgent(sessionId: string, controller: AbortController): Promise<void> {
    try {
      await this.emit(sessionId, 'run/started', {})
      const snapshot = await this.openSession(sessionId)
      const created = snapshot.events.find((event) => event.type === 'session/created')
      const createdPayload = created?.payload as { workspace?: WorkspaceRef; providerId?: string; modelId?: string } | undefined
      const workspace = createdPayload?.workspace ?? this.configuration?.workspaces.find((item) => item.id === snapshot.session.workspaceId)
      const provider = this.configuration?.providers.find((item) => item.id === snapshot.session.providerId)
      if (!workspace) throw new Error('The session workspace is no longer available.')
      if (!provider?.apiKey) throw new Error('The selected provider has no API key. Configure it in Settings.')
      if (this.configuration?.settings.allowNetwork === false) throw new Error('Model network access is disabled in Settings.')

      const messages = await this.buildMessages(snapshot.events, workspace)
      const system: ChatMessage = {
        role: 'system',
        content: `You are Axon Auto Agent, a practical desktop agent. Your selected workspace is ${workspace.path}. Use the provided tools to inspect or change files. Never claim a file was created unless write_file succeeded. Stay inside the workspace. Ask for clarification when the desired outcome is ambiguous.`,
      }
      messages.unshift(system)

      for (let turn = 0; turn < 8; turn += 1) {
        let rawContent = ''
        let rawThinking = ''
        let toolCalls: ToolCall[] = []
        let usage = { promptTokens: 0, completionTokens: 0 }
        const secrets = this.configuration?.providers.map((item) => item.apiKey) ?? []
        const contentRedactor = new StreamingSecretRedactor(secrets)
        const thinkingRedactor = new StreamingSecretRedactor(secrets)
        const callSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(MAX_MODEL_CALL_MS)])
        for await (const chunk of streamOpenAICompatible({ endpoint: provider.endpoint, apiKey: provider.apiKey, model: snapshot.session.modelId, messages, tools: TOOLS, signal: callSignal })) {
          if (chunk.type === 'content') {
            rawContent += chunk.text
            const content = contentRedactor.push(chunk.text)
            if (content) this.push({ channel: 'conversation', payload: this.transientEvent(sessionId, 'assistant/delta', { content }) })
          } else if (chunk.type === 'thinking') {
            rawThinking += chunk.text
            const content = thinkingRedactor.push(chunk.text)
            if (content) this.push({ channel: 'conversation', payload: this.transientEvent(sessionId, 'assistant/thinking', { content }) })
          } else if (chunk.type === 'tool-calls') {
            toolCalls = chunk.calls.map((call) => ({
              ...call,
              id: this.redactSecrets(call.id, secrets),
              function: {
                name: this.redactSecrets(call.function.name, secrets),
                arguments: this.redactSecrets(call.function.arguments, secrets),
              },
            }))
          }
          else if (chunk.type === 'usage') usage = { promptTokens: chunk.promptTokens, completionTokens: chunk.completionTokens }
        }
        const finalContentDelta = contentRedactor.flush()
        if (finalContentDelta) this.push({ channel: 'conversation', payload: this.transientEvent(sessionId, 'assistant/delta', { content: finalContentDelta }) })
        const finalThinkingDelta = thinkingRedactor.flush()
        if (finalThinkingDelta) this.push({ channel: 'conversation', payload: this.transientEvent(sessionId, 'assistant/thinking', { content: finalThinkingDelta }) })
        const content = this.redactSecrets(rawContent, secrets)
        const thinking = this.redactSecrets(rawThinking, secrets)
        if (!content && !thinking && !toolCalls.length) throw new Error('The model returned an empty response.')
        if (thinking) await this.emit(sessionId, 'assistant/thinking', { content: thinking })
        await this.emit(sessionId, 'assistant/message', { content, toolCalls, usage })
        messages.push({ role: 'assistant', content: content || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
        if (!toolCalls.length) {
          await this.emit(sessionId, 'run/completed', {})
          return
        }
        for (const call of toolCalls) {
          const result = await this.executeTool(sessionId, workspace, call, controller.signal)
          messages.push({ role: 'tool', tool_call_id: call.id, content: result })
        }
      }
      throw new Error('Agent exceeded the eight-turn tool budget.')
    } catch (error) {
      if (controller.signal.aborted) await this.emit(sessionId, 'run/stopped', { reason: 'user' })
      else await this.emit(sessionId, 'run/failed', { message: this.redactProviderSecrets(error instanceof Error ? error.message : String(error)) })
    } finally {
      if (this.abortControllers.get(sessionId) === controller) this.abortControllers.delete(sessionId)
      this.pushStatus()
    }
  }

  private async executeTool(sessionId: string, workspace: WorkspaceRef, call: ToolCall, signal: AbortSignal): Promise<string> {
    await this.emit(sessionId, 'tool/requested', { toolCallId: call.id, name: call.function.name, arguments: call.function.arguments })
    await this.emit(sessionId, 'tool/started', { toolCallId: call.id, name: call.function.name })
    try {
      const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>
      let result: string
      if (call.function.name === 'list_workspace') result = await this.listWorkspace(workspace.path, String(args.path ?? '.'))
      else if (call.function.name === 'read_file') result = await this.readWorkspaceFile(workspace.path, String(args.path ?? ''))
      else if (call.function.name === 'write_file') result = await this.writeWorkspaceFile(sessionId, workspace.path, String(args.path ?? ''), String(args.content ?? ''))
      else if (call.function.name === 'run_command') result = await this.runCommand(sessionId, workspace.path, String(args.command ?? ''), signal)
      else throw new Error(`Unknown tool: ${call.function.name}`)
      await this.emit(sessionId, 'tool/completed', { toolCallId: call.id, name: call.function.name, result })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.emit(sessionId, 'tool/failed', { toolCallId: call.id, name: call.function.name, message })
      return `ERROR: ${message}`
    }
  }

  private async listWorkspace(root: string, relativePath: string): Promise<string> {
    const directory = await resolveWorkspacePathSecure(root, relativePath)
    const entries = await readdir(directory, { withFileTypes: true })
    return entries.slice(0, 300).map((entry) => `${entry.isDirectory() ? 'directory' : 'file'}\t${path.relative(root, path.join(directory, entry.name))}`).join('\n') || '(empty)'
  }

  private async readWorkspaceFile(root: string, relativePath: string): Promise<string> {
    const filePath = await resolveWorkspacePathSecure(root, relativePath)
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error('The requested path is not a file.')
    if (info.size > 300_000) throw new Error('The file is larger than the 300 KB text preview limit.')
    return await readFile(filePath, 'utf8')
  }

  private async writeWorkspaceFile(sessionId: string, root: string, relativePath: string, content: string): Promise<string> {
    const filePath = await resolveWorkspacePathSecure(root, relativePath, { allowMissing: true })
    if (this.configuration?.settings.confirmWorkspaceWrites !== false) {
      const approved = await this.requestDecision(sessionId, 'workspace_write', '写入工作区文件', `Agent 请求写入 ${relativePath}`, `Write ${content.length} characters to ${relativePath}`)
      if (!approved) throw new Error('The user denied the workspace write.')
    }
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, content, 'utf8')
    const info = await stat(filePath)
    const mediaType = mediaTypeForPath(filePath)
    const artifact: ArtifactDescriptor = {
      id: randomUUID(), sessionId, name: path.basename(filePath), path: filePath,
      mediaType, size: info.size, createdAt: isoNow(), previewable: isPreviewableMediaType(mediaType),
    }
    await this.emit(sessionId, 'artifact/created', artifact)
    return `Saved ${path.relative(root, filePath)} (${info.size} bytes).`
  }

  private async runCommand(sessionId: string, root: string, command: string, signal: AbortSignal): Promise<string> {
    if (!command.trim()) throw new Error('Command cannot be empty.')
    if (this.configuration?.settings.confirmCommands !== false) {
      const approved = await this.requestDecision(sessionId, 'command', '运行本地命令', 'Shell 命令可能访问工作区之外的系统资源。', command)
      if (!approved) throw new Error('The user denied the command.')
    }
    const { stdout, stderr } = await exec(command, {
      cwd: root, timeout: 120_000, maxBuffer: 1_000_000,
      shell: process.platform === 'win32' ? undefined : '/bin/zsh', signal,
    })
    return `${stdout}${stderr ? `\nSTDERR:\n${stderr}` : ''}`.slice(0, 80_000) || '(command completed without output)'
  }

  private async requestDecision(sessionId: string, risk: DecisionRequest['risk'], title: string, reason: string, proposedAction: string): Promise<boolean> {
    const request: DecisionRequest = { id: randomUUID(), sessionId, title, reason, risk, proposedAction, createdAt: isoNow(), status: 'pending' }
    await this.emit(sessionId, 'decision/requested', request)
    this.pushStatus()
    return await new Promise<boolean>((resolve) => this.pendingDecisions.set(request.id, { request, resolve }))
  }

  private async resolveDecision(input: { decisionId: string; approved: boolean }): Promise<void> {
    const pending = this.pendingDecisions.get(input.decisionId)
    if (!pending) throw new Error('This decision is no longer pending. Resume the task to request it again.')
    const approved = input.approved === true
    await this.emit(pending.request.sessionId, 'decision/resolved', { decisionId: input.decisionId, approved })
    this.pendingDecisions.delete(input.decisionId)
    pending.resolve(approved)
    this.pushStatus()
  }

  private async stageAttachments(sessionId: string, sourcePaths: string[]): Promise<StoredAttachment[]> {
    if (sourcePaths.length > MAX_ATTACHMENT_COUNT) throw new Error(`You can attach up to ${MAX_ATTACHMENT_COUNT} files per message.`)
    const candidates: StoredAttachment[] = []
    for (const sourcePath of sourcePaths) {
      const info = await stat(sourcePath)
      if (!info.isFile()) throw new Error(`${path.basename(sourcePath)} is not a file.`)
      if (info.size > MAX_ATTACHMENT_SIZE) throw new Error(`${path.basename(sourcePath)} exceeds the ${MAX_ATTACHMENT_SIZE / 1_000} KB attachment limit.`)
      const mediaType = mediaTypeForPath(sourcePath)
      if (!mediaType.startsWith('text/') && mediaType !== 'application/json') {
        throw new Error(`${path.basename(sourcePath)} is not a supported text attachment.`)
      }
      const attachmentPath = path.join(this.dataPath, 'attachments', sessionId, `${randomUUID()}${path.extname(sourcePath).slice(0, 20)}`)
      candidates.push({ name: path.basename(sourcePath), path: attachmentPath, size: info.size, mediaType })
    }
    for (const [index, attachment] of candidates.entries()) {
      await mkdir(path.dirname(attachment.path), { recursive: true })
      await copyFile(sourcePaths[index], attachment.path)
    }
    return candidates
  }

  private async buildMessages(events: ConversationEvent[], workspace: WorkspaceRef): Promise<ChatMessage[]> {
    const messages: ChatMessage[] = []
    for (const event of events) {
      const payload = event.payload as Record<string, unknown>
      if (event.type === 'user/message') {
        let content = String(payload.content ?? '')
        const attachments = Array.isArray(payload.attachments) ? payload.attachments.slice(0, MAX_ATTACHMENT_COUNT) : []
        for (const rawAttachment of attachments) {
          const attachment = typeof rawAttachment === 'string'
            ? { name: path.basename(rawAttachment), path: rawAttachment }
            : rawAttachment as Partial<StoredAttachment>
          const attachmentPath = attachment.path ?? ''
          try {
            const info = await stat(attachmentPath)
            if (!info.isFile() || info.size > MAX_ATTACHMENT_SIZE) throw new Error('unavailable')
            content += `\n\n--- Attached file: ${attachment.name ?? path.basename(attachmentPath)} ---\n${await readFile(attachmentPath, 'utf8')}`
          } catch { content += `\n\n[Attachment unavailable: ${attachment.name ?? path.basename(attachmentPath)}]` }
        }
        messages.push({ role: 'user', content })
      } else if (event.type === 'assistant/message') {
        const toolCalls = Array.isArray(payload.toolCalls) ? payload.toolCalls as ToolCall[] : []
        messages.push({ role: 'assistant', content: String(payload.content ?? '') || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) })
      } else if (event.type === 'tool/completed' || event.type === 'tool/failed') {
        messages.push({ role: 'tool', tool_call_id: String(payload.toolCallId ?? ''), content: String(payload.result ?? payload.message ?? '') })
      }
    }
    void workspace
    return this.sanitizeToolTranscript(messages)
  }

  private sanitizeToolTranscript(messages: ChatMessage[]): ChatMessage[] {
    const sanitized: ChatMessage[] = []
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index]
      if (message.role === 'tool') continue
      if (message.role !== 'assistant' || !message.tool_calls?.length) {
        sanitized.push(message)
        continue
      }
      const expected = new Set(message.tool_calls.map((call) => call.id))
      const results: ChatMessage[] = []
      let cursor = index + 1
      while (cursor < messages.length && messages[cursor].role === 'tool') {
        if (expected.has(messages[cursor].tool_call_id ?? '')) results.push(messages[cursor])
        cursor += 1
      }
      const completed = new Set(results.map((result) => result.tool_call_id))
      if ([...expected].every((id) => completed.has(id))) sanitized.push(message, ...results)
      index = cursor - 1
    }
    return sanitized
  }

  private async stopSession(sessionId: string): Promise<void> {
    const controller = this.abortControllers.get(sessionId)
    if (!controller) throw new Error('This session is not running.')
    controller.abort()
    for (const [id, pending] of this.pendingDecisions) {
      if (pending.request.sessionId === sessionId) {
        this.pendingDecisions.delete(id)
        try {
          await this.emit(sessionId, 'decision/resolved', { decisionId: id, approved: false, reason: 'user-stop' })
        } finally { pending.resolve(false) }
      }
    }
    await this.runPromises.get(sessionId)
  }

  private async resumeSession(sessionId: string): Promise<void> {
    const controller = this.reserveRun(sessionId)
    try {
      const snapshot = await this.openSession(sessionId)
      if (snapshot.session.state !== 'stopped' && snapshot.session.state !== 'failed') {
        throw new Error('Only stopped or failed tasks can be resumed.')
      }
      for (const decision of snapshot.decisions.filter((item) => item.status === 'pending')) {
        await this.emit(sessionId, 'decision/resolved', { decisionId: decision.id, approved: false, reason: 'runtime-recovery' })
      }
      this.launchRun(sessionId, controller)
    } catch (error) {
      if (this.abortControllers.get(sessionId) === controller) this.abortControllers.delete(sessionId)
      this.pushStatus()
      throw error
    }
  }

  private async listSessions(): Promise<SessionSummary[]> {
    const summaries = await Promise.all((await this.events.listSessionIds()).map(async (id) => (await this.openSession(id)).session))
    return summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  private async openSession(sessionId: string): Promise<ConversationSnapshot> {
    const events = await this.events.read(sessionId)
    if (!events.length) throw new Error('Session not found.')
    const created = events.find((event) => event.type === 'session/created')
    const payload = created?.payload as { title?: string; workspaceId?: string; providerId?: string; modelId?: string } | undefined
    const decisions = new Map<string, DecisionRequest>()
    const artifacts: ArtifactDescriptor[] = []
    let state: SessionSummary['state'] = 'idle'
    let lastMessage = ''
    let inputTokens = 0
    let outputTokens = 0
    for (const event of events) {
      const item = event.payload as Record<string, unknown>
      if (event.type === 'user/message' || event.type === 'assistant/message') lastMessage = String(item.content ?? '')
      if (event.type === 'assistant/message' && item.usage && typeof item.usage === 'object') {
        const usage = item.usage as { promptTokens?: number; completionTokens?: number }
        inputTokens += usage.promptTokens ?? 0
        outputTokens += usage.completionTokens ?? 0
      }
      if (event.type === 'decision/requested') decisions.set((event.payload as DecisionRequest).id, event.payload as DecisionRequest)
      if (event.type === 'decision/resolved') {
        const current = decisions.get(String(item.decisionId))
        if (current) current.status = item.approved ? 'approved' : 'denied'
      }
      if (event.type === 'artifact/created') artifacts.push(event.payload as ArtifactDescriptor)
      if (event.type === 'run/started') state = 'running'
      if (event.type === 'decision/requested') state = 'waiting_for_decision'
      if (event.type === 'decision/resolved') state = 'running'
      if (event.type === 'run/completed') state = 'idle'
      if (event.type === 'run/stopped' || event.type === 'run/interrupted') state = 'stopped'
      if (event.type === 'run/failed') state = 'failed'
    }
    if (this.abortControllers.has(sessionId) && [...decisions.values()].some((decision) => decision.status === 'pending')) state = 'waiting_for_decision'
    const updatedAt = events.at(-1)?.timestamp ?? created?.timestamp ?? isoNow()
    return {
      session: {
        id: sessionId, title: payload?.title ?? '新任务', workspaceId: payload?.workspaceId,
        state, modelId: payload?.modelId ?? '', providerId: payload?.providerId ?? '',
        createdAt: created?.timestamp ?? updatedAt, updatedAt, lastMessage, eventCount: events.length, inputTokens, outputTokens,
      },
      events, decisions: [...decisions.values()], artifacts,
    }
  }

  private async emit(sessionId: string, type: ConversationEvent['type'], payload: unknown): Promise<ConversationEvent> {
    const seq = (this.sequence.get(sessionId) ?? 0) + 1
    this.sequence.set(sessionId, seq)
    const event: ConversationEvent = { id: randomUUID(), sessionId, seq, timestamp: isoNow(), type, payload }
    await this.events.append(event)
    this.push({ channel: 'conversation', payload: event })
    return event
  }

  private transientEvent(sessionId: string, type: ConversationEvent['type'], payload: unknown): ConversationEvent {
    return { id: randomUUID(), sessionId, seq: (this.sequence.get(sessionId) ?? 0) + 1, timestamp: isoNow(), type, payload, transient: true }
  }

  private async testProvider(providerId: string): Promise<{ ok: boolean; message: string }> {
    const provider = this.configuration?.providers.find((item) => item.id === providerId)
    if (!provider?.apiKey) return { ok: false, message: '请先保存 API Key。' }
    try {
      const result = await testOpenAICompatible(provider.endpoint, provider.apiKey, provider.model, AbortSignal.timeout(30_000))
      return { ok: true, message: result || '连接成功。' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message: this.redactSecrets(message, [provider.apiKey]) }
    }
  }

  private async loadPlugin(pluginPath: string): Promise<PluginDescriptor> {
    const plugin = await validateDevelopmentPlugin(pluginPath, true)
    this.plugins.set(plugin.id, plugin)
    return plugin
  }

  private async reloadPlugin(pluginId: string): Promise<PluginDescriptor> {
    const existing = this.plugins.get(pluginId)
    if (!existing?.path) throw new Error('Only development plugins can be reloaded.')
    return await this.loadPlugin(existing.path)
  }

  private async resolveArtifact(artifactId: string): Promise<string | null> {
    for (const sessionId of await this.events.listSessionIds()) {
      const snapshot = await this.openSession(sessionId)
      const artifact = snapshot.artifacts.find((item) => item.id === artifactId)
      if (artifact) {
        const created = snapshot.events.find((event) => event.type === 'session/created')
        const workspace = (created?.payload as { workspace?: WorkspaceRef } | undefined)?.workspace
        if (!workspace) return null
        return await resolveWorkspacePathSecure(workspace.path, path.relative(workspace.path, artifact.path))
      }
    }
    return null
  }

  private async health(): Promise<RuntimeHealth> {
    return { status: this.status, persistencePath: this.events.path, pluginCount: this.plugins.size, sessionCount: (await this.events.listSessionIds()).length }
  }

  private async exportDiagnostics(): Promise<{ path: string; createdAt: string }> {
    const createdAt = isoNow()
    const diagnosticsPath = path.join(this.dataPath, 'diagnostics', `diagnostics-${createdAt.replace(/[:.]/g, '-')}.json`)
    await mkdir(path.dirname(diagnosticsPath), { recursive: true })
    const sanitized = {
      createdAt, status: this.status, sessions: await this.listSessions(), plugins: [...this.plugins.values()],
      configuration: this.configuration ? {
        settings: this.configuration.settings,
        providers: this.configuration.providers.map(({ apiKey: _apiKey, ...provider }) => provider),
        workspaces: this.configuration.workspaces,
      } : undefined,
    }
    await writeFile(diagnosticsPath, `${JSON.stringify(sanitized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    return { path: diagnosticsPath, createdAt }
  }

  private async shutdown(): Promise<void> {
    for (const controller of this.abortControllers.values()) controller.abort()
    for (const [id, pending] of this.pendingDecisions) {
      this.pendingDecisions.delete(id)
      try {
        await this.emit(pending.request.sessionId, 'decision/resolved', { decisionId: id, approved: false, reason: 'runtime-shutdown' })
      } finally { pending.resolve(false) }
    }
    await Promise.race([
      Promise.allSettled([...this.runPromises.values()]),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ])
    this.status = { ...this.status, state: 'stopped', activeSessionIds: [], updatedAt: isoNow() }
    this.pushStatus()
  }

  private redactProviderSecrets(message: string): string {
    return this.redactSecrets(message, this.configuration?.providers.map((provider) => provider.apiKey) ?? [])
  }

  private redactSecrets(message: string, secrets: Array<string | undefined>): string {
    return secrets.reduce<string>((result, secret) => secret ? result.split(secret).join('[REDACTED]') : result, message)
  }

  private pushStatus(): void {
    const waitingIds = [...this.pendingDecisions.values()].map((pending) => pending.request.sessionId)
    const activeSessionIds = [...new Set([...this.abortControllers.keys(), ...waitingIds])]
    this.status = {
      ...this.status,
      state: activeSessionIds.length ? 'busy' : this.harnessCompatible ? 'ready' : 'degraded',
      activeSessionIds,
      updatedAt: isoNow(),
    }
    this.push({ channel: 'status', payload: this.status })
  }
}
