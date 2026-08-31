/**
 * Anthropic Messages API ↔ OpenAI Chat Completions translation.
 *
 * Mirrors claude-code-router's transformers, inlined so this CLI is
 * self-contained (no external gateway process). The gateway serves Anthropic
 * `/v1/messages` and forwards to OpenAI, converting both directions (including
 * streaming tool_use).
 */
import { parseModelRef } from '../types.js'

export interface AnthropicTextBlock { type: 'text'; text?: string }
export interface AnthropicToolUseBlock { type: 'tool_use'; id: string; name: string; input?: Record<string, unknown> }
export interface AnthropicToolResultBlock { type: 'tool_result'; tool_use_id: string; content?: string | Array<{ type: 'text'; text: string }>; is_error?: boolean }
export type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | AnthropicToolResultBlock

export interface AnthropicRequest {
  model: string
  messages: Array<{ role: string; content: string | AnthropicContentBlock[] }>
  system?: string | Array<{ type: 'text'; text: string }>
  tools?: Array<{ name: string; description?: string; input_schema?: Record<string, unknown> }>
  max_tokens?: number
  temperature?: number
  stream?: boolean
  stop_sequences?: string[]
}

function stripRef(model: string): string {
  return parseModelRef(model)?.modelId ?? model
}

/** Anthropic `/v1/messages` request → OpenAI chat/completions request body. */
export function anthropicRequestToOpenAI(req: AnthropicRequest): Record<string, unknown> {
  const messages: Record<string, unknown>[] = []

  const sys = req.system
  if (typeof sys === 'string' && sys) {
    messages.push({ role: 'system', content: sys })
  } else if (Array.isArray(sys)) {
    const text = sys.map(b => (typeof b === 'string' ? b : b.text ?? '')).join('')
    if (text) messages.push({ role: 'system', content: text })
  }

  for (const m of req.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content })
      continue
    }
    if (!Array.isArray(m.content)) {
      messages.push({ role: m.role, content: '' })
      continue
    }

    if (m.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = []
      for (const block of m.content) {
        if (block.type === 'text') textParts.push((block as AnthropicTextBlock).text ?? '')
        else if (block.type === 'tool_use') {
          const tb = block as AnthropicToolUseBlock
          toolCalls.push({ id: tb.id, type: 'function', function: { name: tb.name, arguments: JSON.stringify(tb.input ?? {}) } })
        }
      }
      const msg: Record<string, unknown> = { role: 'assistant', content: textParts.join('') }
      if (toolCalls.length) msg.tool_calls = toolCalls
      messages.push(msg)
    } else {
      const textParts: string[] = []
      const toolMessages: Record<string, unknown>[] = []
      for (const block of m.content) {
        if (block.type === 'text') textParts.push((block as AnthropicTextBlock).text ?? '')
        else if (block.type === 'tool_result') {
          const tr = block as AnthropicToolResultBlock
          const content = Array.isArray(tr.content)
            ? tr.content.map(b => (typeof b === 'string' ? b : b.text ?? '')).join('')
            : (tr.content ?? '')
          toolMessages.push({ role: 'tool', tool_call_id: tr.tool_use_id, content })
        }
      }
      if (textParts.join('')) messages.push({ role: 'user', content: textParts.join('') })
      messages.push(...toolMessages)
    }
  }

  const tools = req.tools?.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description ?? '', parameters: t.input_schema ?? { type: 'object', properties: {} } },
  }))

  const body: Record<string, unknown> = {
    model: stripRef(req.model),
    messages,
    stream: true,
    ...(tools?.length ? { tools, tool_choice: 'auto' } : {}),
  }
  if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens
  if (req.temperature !== undefined) body.temperature = req.temperature
  return body
}

/**
 * Stateful Anthropic SSE emitter fed by OpenAI streamed chunks. Keeps a
 * content-block index that is contiguous over the response, per the Messages
 * API spec, so the Anthropic SDK never crashes on a mismatched block.
 */
export class AnthropicStreamEncoder {
  private index = 0
  private openTextIndex = -1
  private openToolIndex = -1
  private toolAnthropicByOpenai = new Map<number, number>()
  private stopReason: string | null = null
  private inputTokens: number | undefined
  private outputTokens: number | undefined
  private readonly model: string

  constructor(private readonly emit: (type: string, data: Record<string, any>) => void, model: string, id: string, inputTokens?: number) {
    this.model = model
    this.inputTokens = inputTokens
    emit('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: inputTokens ?? 0, output_tokens: 0 },
      },
    })
  }

  private closeBlock(index: number): void {
    if (index === this.openTextIndex) {
      this.emit('content_block_stop', { type: 'content_block_stop', index })
      this.openTextIndex = -1
    } else if (index === this.openToolIndex) {
      this.emit('content_block_stop', { type: 'content_block_stop', index })
      this.openToolIndex = -1
    }
  }

  private closeOpen(): void {
    if (this.openTextIndex !== -1) this.closeBlock(this.openTextIndex)
    if (this.openToolIndex !== -1) this.closeBlock(this.openToolIndex)
  }

  /** Feed one parsed OpenAI SSE chunk. */
  feed(chunk: Record<string, any>): void {
    if (chunk.usage) {
      this.inputTokens = chunk.usage.prompt_tokens ?? this.inputTokens
      this.outputTokens = chunk.usage.completion_tokens ?? this.outputTokens
    }
    const choices = chunk.choices
    if (!Array.isArray(choices) || choices.length === 0) return
    const choice = choices[0]
    const delta = choice.delta ?? {}
    const finish = choice.finish_reason
    if (finish) this.stopReason = finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : finish === 'stop' ? 'end_turn' : finish

    // text delta
    if (typeof delta.content === 'string' && delta.content) {
      if (this.openTextIndex === -1) {
        this.closeOpen()
        this.openTextIndex = this.index++
        this.emit('content_block_start', { type: 'content_block_start', index: this.openTextIndex, content_block: { type: 'text', text: '' } })
      }
      this.emit('content_block_delta', { type: 'content_block_delta', index: this.openTextIndex, delta: { type: 'text_delta', text: delta.content } })
    }

    // tool calls delta
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const openaiIdx = tc.index ?? 0
        let anthropicIdx = this.toolAnthropicByOpenai.get(openaiIdx)
        if (anthropicIdx === undefined) {
          this.closeOpen()
          anthropicIdx = this.index++
          this.toolAnthropicByOpenai.set(openaiIdx, anthropicIdx)
          const fn = tc.function ?? {}
          this.openToolIndex = anthropicIdx
          this.emit('content_block_start', {
            type: 'content_block_start',
            index: anthropicIdx,
            content_block: { type: 'tool_use', id: tc.id ?? `call_${openaiIdx}`, name: fn.name ?? '', input: {} },
          })
        }
        const args = tc.function?.arguments
        if (typeof args === 'string' && args) {
          this.emit('content_block_delta', { type: 'content_block_delta', index: anthropicIdx, delta: { type: 'input_json_delta', partial_json: args } })
        }
      }
    }
  }

  /** End of stream: close open blocks and emit terminal events. */
  finish(): void {
    this.closeOpen()
    this.emit('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: this.outputTokens ?? 0 },
    })
    this.emit('message_stop', { type: 'message_stop' })
  }
}

/** Render an Anthropic event as an SSE wire line. */
export function sseEvent(type: string, data: Record<string, any>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
}

/** A model row from an OpenAI-compatible `/v1/models` response. */
export interface OpenAIModelEntry {
  id: string
  created?: number
}

/** Query params of an Anthropic `GET /v1/models` request. */
export interface ListModelsParams {
  limit?: number
  afterId?: string | null
  beforeId?: string | null
}

/**
 * Convert an upstream (OpenAI-compatible) model list into the Anthropic
 * `GET /v1/models` list shape, applying the standard pagination params.
 *
 * No allowlisting: every model the upstream reports is passed through, so
 * callers see the full catalog — never a fixed claude-* / haiku-sonnet-opus
 * subset. `limit` only bounds the page; has_more + after_id let the SDK walk
 * the rest, so nothing is dropped.
 */
export function buildAnthropicModelsResponse(
  models: OpenAIModelEntry[],
  params: ListModelsParams,
): {
  data: Array<Record<string, unknown>>
  has_more: boolean
  first_id: string | null
  last_id: string | null
} {
  const limit = Math.max(1, Math.min(params.limit ?? 1000, 1000))
  // Anthropic lists oldest-first (ascending created_at); matches upstream `created`.
  const sorted = [...models].sort((a, b) => (a.created ?? 0) - (b.created ?? 0))
  const index = new Map(sorted.map((m, i) => [m.id, i]))

  let page = sorted
  if (params.afterId && index.has(params.afterId)) {
    page = page.slice(index.get(params.afterId)! + 1)
  } else if (params.beforeId && index.has(params.beforeId)) {
    page = page.slice(0, index.get(params.beforeId)!)
  }

  const hasMore = page.length > limit
  const slice = page.slice(0, limit)
  const data = slice.map(m => ({
    type: 'model',
    id: m.id,
    display_name: m.id,
    ...(typeof m.created === 'number'
      ? { created_at: new Date(m.created * 1000).toISOString() }
      : {}),
  }))
  return {
    data,
    has_more: hasMore,
    first_id: slice[0]?.id ?? null,
    last_id: slice[slice.length - 1]?.id ?? null,
  }
}
