import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings, ConversationSnapshot, RuntimePushEvent, WorkspaceRef } from '@axon-auto-agent/contracts'
import { AppendOnlyEventStore } from '@axon-auto-agent/runtime'
import { RuntimeService } from './service.js'

const resources: Array<() => Promise<void>> = []
afterEach(async () => { while (resources.length) await resources.pop()?.() })

async function mockModel(responses: object[][]): Promise<string> {
  let requestIndex = 0
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const packet of responses[Math.min(requestIndex, responses.length - 1)]) response.write(`data: ${JSON.stringify(packet)}\n\n`)
    response.end('data: [DONE]\n\n')
    requestIndex += 1
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  resources.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind.')
  return `http://127.0.0.1:${address.port}/v1`
}

async function fixture(endpoint: string, confirmWorkspaceWrites = false, confirmCommands = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'axon-runtime-test-'))
  resources.push(async () => { await rm(root, { recursive: true, force: true }) })
  const workspace: WorkspaceRef = { id: 'workspace-1', name: 'fixture', path: root, selectedAt: new Date().toISOString(), writable: true }
  const settings: AppSettings = {
    language: 'zh-CN', theme: 'dark', launchAtLogin: false, closeToTray: true,
    defaultWorkspaceId: workspace.id, activeProviderId: 'test', developerMode: false,
    allowNetwork: true, confirmWorkspaceWrites, confirmCommands,
  }
  const pushes: RuntimePushEvent[] = []
  const service = new RuntimeService(path.join(root, '.data'), (event) => pushes.push(event))
  await service.initialize()
  await service.handle('runtime.configure', {
    settings, workspaces: [workspace], providers: [{ id: 'test', kind: 'openai-compatible', name: 'Test', endpoint, model: 'test-model', hasCredential: true, enabled: true, updatedAt: new Date().toISOString(), apiKey: 'secret-test-key' }],
  })
  const snapshot = await service.handle('session.create', { title: 'Test task', workspaceId: workspace.id, providerId: 'test', modelId: 'test-model', workspace, provider: { id: 'test', kind: 'openai-compatible', name: 'Test', endpoint, model: 'test-model', hasCredential: true, enabled: true, updatedAt: new Date().toISOString(), apiKey: 'secret-test-key' } }) as ConversationSnapshot
  return { root, workspace, pushes, service, snapshot }
}

async function waitFor(pushes: RuntimePushEvent[], type: string): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    if (pushes.some((event) => event.channel === 'conversation' && (event.payload as { type?: string }).type === type)) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Timed out waiting for ${type}`)
}

describe('desktop runtime vertical slice', () => {
  it('streams a response and replays it from durable events', async () => {
    const endpoint = await mockModel([[{ choices: [{ delta: { content: 'Hello from Agent' } }] }]])
    const { pushes, service, snapshot } = await fixture(endpoint)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Hello' })
    await waitFor(pushes, 'run/completed')
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(replay.events.some((event) => event.type === 'assistant/message' && (event.payload as { content: string }).content === 'Hello from Agent')).toBe(true)
    expect(JSON.stringify(replay)).not.toContain('secret-test-key')
  })

  it('executes a model-requested workspace write and registers an artifact', async () => {
    const endpoint = await mockModel([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'write_file', arguments: '{"path":"report.md","content":"# Verified report"}' } }] } }] }],
      [{ choices: [{ delta: { content: 'The report is ready.' } }] }],
    ])
    const { root, pushes, service, snapshot } = await fixture(endpoint)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Create a report' })
    await waitFor(pushes, 'run/completed')
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(await readFile(path.join(root, 'report.md'), 'utf8')).toBe('# Verified report')
    expect(replay.artifacts).toHaveLength(1)
    expect(replay.artifacts[0].name).toBe('report.md')
  })

  it('does not write until the user approves the decision request', async () => {
    const endpoint = await mockModel([
      [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-approved', type: 'function', function: { name: 'write_file', arguments: '{"path":"approved.md","content":"approved output"}' } }] } }] }],
      [{ choices: [{ delta: { content: 'Approved output is ready.' } }] }],
    ])
    const { root, pushes, service, snapshot } = await fixture(endpoint, true)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Create an approved file' })
    await waitFor(pushes, 'decision/requested')

    await expect(readFile(path.join(root, 'approved.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const decisionEvent = pushes.find((event) => event.channel === 'conversation' && (event.payload as { type?: string }).type === 'decision/requested')
    const decisionId = ((decisionEvent?.payload as { payload?: { id?: string } })?.payload?.id)
    expect(decisionId).toBeTruthy()
    await service.handle('decision.resolve', { decisionId, approved: true })
    await waitFor(pushes, 'run/completed')

    expect(await readFile(path.join(root, 'approved.md'), 'utf8')).toBe('approved output')
  })

  it('reconciles an interrupted run and stale approval after a runtime restart', async () => {
    const endpoint = await mockModel([[{ choices: [{ delta: { content: 'Initial response' } }] }]])
    const { root, service, snapshot } = await fixture(endpoint)
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    const store = new AppendOnlyEventStore(path.join(root, '.data', 'sessions'))
    let seq = replay.events.at(-1)?.seq ?? 0
    await store.append({ id: randomUUID(), sessionId: snapshot.session.id, seq: ++seq, timestamp: new Date().toISOString(), type: 'run/started', payload: {} })
    const decisionId = randomUUID()
    await store.append({
      id: randomUUID(), sessionId: snapshot.session.id, seq: ++seq, timestamp: new Date().toISOString(), type: 'decision/requested',
      payload: { id: decisionId, sessionId: snapshot.session.id, title: 'Stale', reason: 'Old runtime', risk: 'command', proposedAction: 'sleep', createdAt: new Date().toISOString(), status: 'pending' },
    })

    const recovered = new RuntimeService(path.join(root, '.data'), () => undefined)
    await recovered.initialize()
    const recoveredSnapshot = await recovered.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(recoveredSnapshot.session.state).toBe('stopped')
    expect(recoveredSnapshot.decisions.find((decision) => decision.id === decisionId)?.status).toBe('denied')
    expect(recoveredSnapshot.events.at(-1)?.type).toBe('run/interrupted')
  })

  it('snapshots text attachments and rejects unsupported binary input before starting', async () => {
    const endpoint = await mockModel([[{ choices: [{ delta: { content: 'Attachment received' } }] }]])
    const { root, pushes, service, snapshot } = await fixture(endpoint)
    const sourcePath = path.join(root, 'source.md')
    await writeFile(sourcePath, 'original attachment')
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Read this', attachments: [sourcePath] })
    await waitFor(pushes, 'run/completed')
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    const message = replay.events.find((event) => event.type === 'user/message')
    const stored = (message?.payload as { attachments: Array<{ path: string; name: string }> }).attachments[0]
    expect(stored.name).toBe('source.md')
    expect(stored.path).not.toBe(sourcePath)
    expect(await readFile(stored.path, 'utf8')).toBe('original attachment')

    const second = await service.handle('session.create', {
      title: 'Binary', workspaceId: snapshot.session.workspaceId, providerId: 'test', modelId: 'test-model',
      workspace: { id: 'workspace-1', name: 'fixture', path: root, selectedAt: new Date().toISOString(), writable: true },
      provider: { id: 'test', kind: 'openai-compatible', name: 'Test', endpoint, model: 'test-model', hasCredential: true, enabled: true, updatedAt: new Date().toISOString(), apiKey: 'secret-test-key' },
    }) as ConversationSnapshot
    const binaryPath = path.join(root, 'image.png')
    await writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await expect(service.handle('session.send', { sessionId: second.session.id, content: 'Read image', attachments: [binaryPath] })).rejects.toThrow(/supported text attachment/)
    const binaryReplay = await service.handle('session.open', { sessionId: second.session.id }) as ConversationSnapshot
    expect(binaryReplay.events.some((event) => event.type === 'user/message')).toBe(false)
  })

  it('fails an empty model response instead of reporting false success', async () => {
    const endpoint = await mockModel([[]])
    const { pushes, service, snapshot } = await fixture(endpoint)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Do something' })
    await waitFor(pushes, 'run/failed')
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(replay.session.state).toBe('failed')
    expect(replay.events.some((event) => event.type === 'run/completed')).toBe(false)
    expect(replay.events.some((event) => event.type === 'assistant/message')).toBe(false)
  })

  it('redacts a provider key echoed by an untrusted endpoint', async () => {
    const server: Server = createServer((_request, response) => {
      response.writeHead(401, { 'content-type': 'text/plain' })
      response.end('Rejected secret-test-key')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    resources.push(async () => { await new Promise<void>((resolve) => server.close(() => resolve())) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Mock server did not bind.')
    const { pushes, service, snapshot } = await fixture(`http://127.0.0.1:${address.port}/v1`)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Hello' })
    await waitFor(pushes, 'run/failed')
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(JSON.stringify(replay)).not.toContain('secret-test-key')
    expect(JSON.stringify(replay)).toContain('[REDACTED]')
  })

  it('does not leak a provider key split across streamed model chunks', async () => {
    const endpoint = await mockModel([[
      { choices: [{ delta: { content: 'The credential is secret-' } }] },
      { choices: [{ delta: { content: 'test-key and must stay private.' } }] },
    ]])
    const { pushes, service, snapshot } = await fixture(endpoint)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Hello' })
    await waitFor(pushes, 'run/completed')
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(JSON.stringify(pushes)).not.toContain('secret-test-key')
    expect(JSON.stringify(replay)).not.toContain('secret-test-key')
    expect(JSON.stringify(replay)).toContain('[REDACTED]')
  })

  it('stops an active shell command before it can produce a delayed side effect', async () => {
    const endpoint = await mockModel([[
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'slow-command', type: 'function', function: { name: 'run_command', arguments: '{"command":"sleep 2; printf should-not-exist > delayed.txt"}' } }] } }] },
    ]])
    const { root, pushes, service, snapshot } = await fixture(endpoint, false, false)
    await service.handle('session.send', { sessionId: snapshot.session.id, content: 'Run the delayed command' })
    await waitFor(pushes, 'tool/started')
    await service.handle('session.stop', { sessionId: snapshot.session.id })
    await new Promise((resolve) => setTimeout(resolve, 2_200))
    await expect(readFile(path.join(root, 'delayed.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const replay = await service.handle('session.open', { sessionId: snapshot.session.id }) as ConversationSnapshot
    expect(replay.session.state).toBe('stopped')
  })
})
