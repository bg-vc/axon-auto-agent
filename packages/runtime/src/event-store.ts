import { mkdir, readFile, appendFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { ConversationEvent } from '@axon-auto-agent/contracts'

export class AppendOnlyEventStore {
  constructor(private readonly rootPath: string) {}

  get path(): string {
    return this.rootPath
  }

  private sessionPath(sessionId: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(sessionId)) throw new Error('Invalid session identifier.')
    return path.join(this.rootPath, `${sessionId}.jsonl`)
  }

  async initialize(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
  }

  async append(event: ConversationEvent): Promise<void> {
    await this.initialize()
    await appendFile(this.sessionPath(event.sessionId), `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 })
  }

  async read(sessionId: string): Promise<ConversationEvent[]> {
    try {
      const content = await readFile(this.sessionPath(sessionId), 'utf8')
      return content
        .split('\n')
        .filter(Boolean)
        .map((line, index) => {
          try {
            return JSON.parse(line) as ConversationEvent
          } catch {
            throw new Error(`Invalid event at line ${index + 1} in session ${sessionId}.`)
          }
        })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async listSessionIds(): Promise<string[]> {
    await this.initialize()
    const entries = await readdir(this.rootPath, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => entry.name.slice(0, -'.jsonl'.length))
  }
}
