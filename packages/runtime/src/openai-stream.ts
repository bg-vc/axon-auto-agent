export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  name?: string
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

export interface ToolDefinition {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type StreamChunk =
  | { type: 'content'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool-calls'; calls: ToolCall[] }
  | { type: 'usage'; promptTokens: number; completionTokens: number }

export interface OpenAIStreamOptions {
  endpoint: string
  apiKey: string
  model: string
  messages: ChatMessage[]
  tools?: ToolDefinition[]
  signal?: AbortSignal
}

const MAX_ERROR_BODY_BYTES = 16_000
const MAX_SSE_LINE_CHARS = 1_000_000
const MAX_STREAM_PAYLOAD_CHARS = 5_000_000
const MAX_TOOL_CALLS = 64

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let result = ''
  while (result.length < MAX_ERROR_BODY_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
  }
  await reader.cancel().catch(() => undefined)
  return result.slice(0, MAX_ERROR_BODY_BYTES)
}

function chatCompletionsUrl(endpoint: string): string {
  const normalized = endpoint.replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

export async function* streamOpenAICompatible(options: OpenAIStreamOptions): AsyncGenerator<StreamChunk> {
  const response = await fetch(chatCompletionsUrl(options.endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.apiKey}` },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.tools?.length ? { tools: options.tools, tool_choice: 'auto' } : {}),
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    const detail = await readLimitedBody(response)
    throw new Error(`Model request failed (${response.status}): ${detail.slice(0, 500)}`)
  }
  if (!response.body) throw new Error('Model response did not include a stream body.')

  const decoder = new TextDecoder()
  let buffer = ''
  let payloadCharacters = 0
  const calls = new Map<number, ToolCall>()

  const accountPayload = (length: number): void => {
    payloadCharacters += length
    if (payloadCharacters > MAX_STREAM_PAYLOAD_CHARS) throw new Error('Model response exceeded the 5 MB stream limit.')
  }

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    if (buffer.length > MAX_SSE_LINE_CHARS) throw new Error('Model response contained an oversized stream event.')
    for (const rawLine of lines) {
      if (rawLine.length > MAX_SSE_LINE_CHARS) throw new Error('Model response contained an oversized stream event.')
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data || data === '[DONE]') continue
      const packet = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; type?: 'function'; function?: { name?: string; arguments?: string } }> } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      if (packet.usage) {
        yield { type: 'usage', promptTokens: packet.usage.prompt_tokens ?? 0, completionTokens: packet.usage.completion_tokens ?? 0 }
      }
      const delta = packet.choices?.[0]?.delta
      if (delta?.content) { accountPayload(delta.content.length); yield { type: 'content', text: delta.content } }
      if (delta?.reasoning_content) { accountPayload(delta.reasoning_content.length); yield { type: 'thinking', text: delta.reasoning_content } }
      for (const partial of delta?.tool_calls ?? []) {
        if (partial.index < 0 || partial.index >= MAX_TOOL_CALLS) throw new Error('Model response contained too many tool calls.')
        const current = calls.get(partial.index) ?? { id: partial.id ?? `tool-${partial.index}`, type: 'function' as const, function: { name: '', arguments: '' } }
        if (partial.id) current.id = partial.id
        if (partial.function?.name) { accountPayload(partial.function.name.length); current.function.name += partial.function.name }
        if (partial.function?.arguments) { accountPayload(partial.function.arguments.length); current.function.arguments += partial.function.arguments }
        calls.set(partial.index, current)
      }
    }
  }

  if (calls.size) yield { type: 'tool-calls', calls: [...calls.values()] }
}

export async function testOpenAICompatible(endpoint: string, apiKey: string, model: string, signal?: AbortSignal): Promise<string> {
  let content = ''
  for await (const chunk of streamOpenAICompatible({
    endpoint,
    apiKey,
    model,
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
    signal,
  })) {
    if (chunk.type === 'content') content += chunk.text
  }
  return content.trim()
}
