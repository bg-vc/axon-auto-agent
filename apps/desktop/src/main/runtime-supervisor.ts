import { EventEmitter } from 'node:events'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { ConversationEvent, RuntimePushEvent, RuntimeRequest, RuntimeResponse, RuntimeStatus } from '@axon-auto-agent/contracts'

interface PendingRequest {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

export class RuntimeSupervisor extends EventEmitter {
  private child?: UtilityProcess
  private pending = new Map<string, PendingRequest>()
  private stopping = false
  private restarting = false
  private currentStatus: RuntimeStatus = {
    state: 'stopped', version: '0.1.0', harnessVersion: '0.1.0-rc.6', activeSessionIds: [], updatedAt: new Date().toISOString(),
  }

  constructor(private readonly dataPath: string, private readonly runtimeEntry = path.join(__dirname, 'runtime.js')) { super() }

  get status(): RuntimeStatus { return structuredClone(this.currentStatus) }

  async start(): Promise<void> {
    if (this.child) return
    this.stopping = false
    this.setStatus({ ...this.currentStatus, state: 'starting', updatedAt: new Date().toISOString(), lastError: undefined })
    const child = utilityProcess.fork(this.runtimeEntry, ['--data-path', this.dataPath], {
      serviceName: 'Axon Auto Agent Runtime', stdio: 'pipe',
      env: { ...process.env, AXON_AUTO_AGENT_RUNTIME: '1' },
    })
    this.child = child
    child.stdout?.on('data', (chunk) => this.emit('log', String(chunk)))
    child.stderr?.on('data', (chunk) => this.emit('log', String(chunk)))
    child.on('message', (message) => this.onMessage(message as RuntimeResponse | RuntimePushEvent))
    child.on('exit', (_code) => this.onExit())
    await this.waitForReady()
  }

  async stop(): Promise<void> {
    this.stopping = true
    try { if (this.child) await this.request('runtime.shutdown', {}, 8_000) } catch { /* process may already be gone */ }
    this.child?.kill()
    this.child = undefined
    this.rejectPending(new Error('Runtime stopped.'))
    this.setStatus({ ...this.currentStatus, state: 'stopped', activeSessionIds: [], updatedAt: new Date().toISOString() })
  }

  async restart(): Promise<RuntimeStatus> {
    this.restarting = true
    await this.stop()
    this.stopping = false
    await this.start()
    this.restarting = false
    return this.status
  }

  async request<TResult = unknown>(method: string, params?: unknown, timeoutMs = 60_000): Promise<TResult> {
    if (!this.child) throw new Error('Runtime is not running.')
    const id = randomUUID()
    const request: RuntimeRequest = { id, method, params }
    return await new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Runtime request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as TResult), reject, timer })
      this.child?.postMessage(request)
    })
  }

  private onMessage(message: RuntimeResponse | RuntimePushEvent): void {
    if ('channel' in message) {
      if (message.channel === 'status') this.setStatus(message.payload as RuntimeStatus)
      else this.emit('conversation', message.payload as ConversationEvent)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(message.error?.message ?? 'Runtime request failed.'))
  }

  private onExit(): void {
    this.child = undefined
    this.rejectPending(new Error('Runtime process exited.'))
    if (this.stopping || this.restarting) return
    this.setStatus({ ...this.currentStatus, state: 'crashed', lastError: 'Runtime process exited unexpectedly.', updatedAt: new Date().toISOString() })
    setTimeout(() => { void this.start().catch((error) => this.setStatus({ ...this.currentStatus, state: 'crashed', lastError: String(error), updatedAt: new Date().toISOString() })) }, 1_000)
  }

  private setStatus(status: RuntimeStatus): void {
    this.currentStatus = status
    this.emit('status', this.status)
  }

  private rejectPending(error: Error): void {
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error) }
    this.pending.clear()
  }

  private async waitForReady(): Promise<void> {
    if (this.currentStatus.state === 'ready' || this.currentStatus.state === 'degraded') return
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { cleanup(); reject(new Error('Runtime did not become ready.')) }, 20_000)
      const listener = (status: RuntimeStatus) => {
        if (status.state === 'ready' || status.state === 'degraded') { cleanup(); resolve() }
        if (status.state === 'crashed') { cleanup(); reject(new Error(status.lastError ?? 'Runtime crashed.')) }
      }
      const cleanup = () => { clearTimeout(timeout); this.off('status', listener) }
      this.on('status', listener)
    })
  }
}
