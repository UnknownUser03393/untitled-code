import { describe, expect, test } from 'vitest'
import { buildAnthropicModelsResponse } from '../gateway/transform.js'

const MODELS = [
  { id: 'claude-opus-4-6', created: 1000 },
  { id: 'gpt-4o', created: 2000 },
  { id: 'deepseek-chat', created: 3000 },
  { id: 'qwen2.5:14b', created: 4000 },
]

describe('buildAnthropicModelsResponse (gateway fetch models)', () => {
  test('returns the full upstream catalog with no allowlisting', () => {
    const res = buildAnthropicModelsResponse(MODELS, {})
    // every upstream model passes through — never a fixed haiku/sonnet/opus subset
    expect(res.data.map(d => d.id)).toEqual([
      'claude-opus-4-6',
      'gpt-4o',
      'deepseek-chat',
      'qwen2.5:14b',
    ])
    expect(res.has_more).toBe(false)
    expect(res.first_id).toBe('claude-opus-4-6')
    expect(res.last_id).toBe('qwen2.5:14b')
  })

  test('unlimited by default — no limit param returns everything in one page', () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: `m-${i}`, created: i }))
    const res = buildAnthropicModelsResponse(big, {})
    expect(res.data).toHaveLength(50)
    expect(res.has_more).toBe(false)
  })

  test('pagination walks the whole list across pages', () => {
    const page1 = buildAnthropicModelsResponse(MODELS, { limit: 2 })
    expect(page1.data.map(d => d.id)).toEqual(['claude-opus-4-6', 'gpt-4o'])
    expect(page1.has_more).toBe(true)
    expect(page1.last_id).toBe('gpt-4o')

    const page2 = buildAnthropicModelsResponse(MODELS, {
      limit: 2,
      afterId: page1.last_id,
    })
    expect(page2.data.map(d => d.id)).toEqual(['deepseek-chat', 'qwen2.5:14b'])
    expect(page2.has_more).toBe(false)
  })

  test('created timestamp is mapped to ISO created_at', () => {
    const res = buildAnthropicModelsResponse([{ id: 'gpt-4o', created: 0 }], {})
    expect(res.data[0]!.created_at).toBe('1970-01-01T00:00:00.000Z')
  })
})
