import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppSettings, ConversationSnapshot, RuntimePushEvent, WorkspaceRef } from '@axon-auto-agent/contracts'
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

async function fixture(endpoint: string, confirmWorkspaceWrites = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'axon-runtime-test-'))
  resources.push(async () => { await rm(root, { recursive: true, force: true }) })
  const workspace: WorkspaceRef = { id: 'workspace-1', name: 'fixture', path: root, selectedAt: new Date().toISOString(), writable: true }
  const settings: AppSettings = {
    language: 'zh-CN', theme: 'dark', launchAtLogin: false, closeToTray: true,
    defaultWorkspaceId: workspace.id, activeProviderId: 'test', developerMode: false,
    allowNetwork: true, confirmWorkspaceWrites, confirmCommands: true,
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
})
