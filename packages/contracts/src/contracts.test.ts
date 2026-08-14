import { describe, expect, it } from 'vitest'
import type { ConversationEvent, RuntimeRequest } from './index.js'

describe('desktop contracts', () => {
  it('keeps runtime requests transport neutral', () => {
    const request: RuntimeRequest = { id: 'request-1', method: 'session.list' }
    expect(request).toEqual({ id: 'request-1', method: 'session.list' })
  })

  it('represents replay order explicitly', () => {
    const event: ConversationEvent = {
      id: 'event-2',
      sessionId: 'session-1',
      seq: 2,
      timestamp: new Date(0).toISOString(),
      type: 'assistant/message',
      payload: { content: 'done' },
    }
    expect(event.seq).toBe(2)
  })
})
