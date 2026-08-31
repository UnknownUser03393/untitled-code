import { describe, expect, test } from 'vitest'
import { anthropicRequestToOpenAI, AnthropicStreamEncoder, sseEvent } from '../gateway/transform.js'

describe('anthropicRequestToOpenAI', () => {
  test('system + messages map to OpenAI messages', () => {
    const body = anthropicRequestToOpenAI({
      model: 'openai/gpt-4o',
      system: 'You are a helper.',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 100,
    })
    expect(body.model).toBe('gpt-4o') // provider prefix stripped
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'hi' },
    ])
    expect(body.max_tokens).toBe(100)
    expect(body.stream).toBe(true)
  })

  test('assistant tool_use blocks become tool_calls', () => {
    const body = anthropicRequestToOpenAI({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: '/a' } },
          ],
        },
      ],
    })
    const last = body.messages![1] as Record<string, any>
    expect(last.role).toBe('assistant')
    expect(last.content).toBe('Let me check.')
    expect(last.tool_calls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/a"}' } },
    ])
  })

  test('user tool_result blocks become role:tool messages', () => {
    const body = anthropicRequestToOpenAI({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'result:' },
            { type: 'tool_result', tool_use_id: 'call_1', content: 'file contents' },
          ],
        },
      ],
    })
    expect(body.messages).toEqual([
      { role: 'user', content: 'result:' },
      { role: 'tool', tool_call_id: 'call_1', content: 'file contents' },
    ])
  })

  test('tools map input_schema to parameters', () => {
    const body = anthropicRequestToOpenAI({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'x' }],
      tools: [{ name: 'read', description: 'd', input_schema: { type: 'object', properties: { p: { type: 'string' } } } }],
    })
    expect(body.tools).toEqual([
      { type: 'function', function: { name: 'read', description: 'd', parameters: { type: 'object', properties: { p: { type: 'string' } } } } },
    ])
  })
})

describe('AnthropicStreamEncoder', () => {
  test('emits the text block event sequence', () => {
    const events: Array<{ type: string; data: any }> = []
    const enc = new AnthropicStreamEncoder((type, data) => events.push({ type, data }), 'gpt-4o', 'msg_1', 5)
    enc.feed({ choices: [{ delta: { content: 'Hel' }, finish_reason: null }] })
    enc.feed({ choices: [{ delta: { content: 'lo' }, finish_reason: null }] })
    enc.feed({ choices: [{ delta: {}, finish_reason: 'stop' }] })
    enc.finish()

    const types = events.map(e => e.type)
    expect(types).toContain('content_block_start')
    expect(types).toContain('content_block_delta')
    expect(types).toContain('content_block_stop')
    expect(types).toContain('message_delta')
    expect(types).toContain('message_stop')

    const textDelta = events.find(e => e.type === 'content_block_delta')?.data
    expect(textDelta.delta).toEqual({ type: 'text_delta', text: 'Hel' })
    const stopDelta = events.find(e => e.type === 'message_delta')?.data
    expect(stopDelta.delta.stop_reason).toBe('end_turn')
  })

  test('emits a tool_use block for streamed tool_calls', () => {
    const events: Array<{ type: string; data: any }> = []
    const enc = new AnthropicStreamEncoder((type, data) => events.push({ type, data }), 'gpt-4o', 'msg_2')
    enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'read_file', arguments: '' } }] }, finish_reason: null }] })
    enc.feed({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":"/a"}' } }] }, finish_reason: null }] })
    enc.feed({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
    enc.finish()

    const toolStart = events.find(e => e.type === 'content_block_start')?.data
    expect(toolStart.content_block.type).toBe('tool_use')
    expect(toolStart.content_block.id).toBe('call_1')
    expect(toolStart.content_block.name).toBe('read_file')

    const jsonDelta = events.find(e => e.type === 'content_block_delta')?.data
    expect(jsonDelta.delta.type).toBe('input_json_delta')

    const stopDelta = events.find(e => e.type === 'message_delta')?.data
    expect(stopDelta.delta.stop_reason).toBe('tool_use')
  })
})

describe('sseEvent', () => {
  test('renders event + data lines', () => {
    const out = sseEvent('message_stop', { type: 'message_stop' })
    expect(out).toBe('event: message_stop\ndata: {"type":"message_stop"}\n\n')
  })
})
