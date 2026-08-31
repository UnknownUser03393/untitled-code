import { describe, expect, test } from 'vitest'
import { encodeModelRef, parseModelRef, providerNamespace } from '../types.js'

describe('model ref encoding', () => {
  test('roundtrip encode/parse', () => {
    const ref = encodeModelRef('openai', 'gpt-4o')
    expect(ref).toBe('openai/gpt-4o')
    expect(parseModelRef(ref)).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
  })

  test('model ids may contain colons (ollama tags like qwen2.5:14b)', () => {
    const ref = encodeModelRef('ollama', 'qwen2.5:14b')
    // first slash splits provider from model; the model's own ':' must be preserved
    expect(parseModelRef(ref)).toEqual({ providerId: 'ollama', modelId: 'qwen2.5:14b' })
  })

  test('plain Anthropic model name returns null (not namespaced)', () => {
    expect(parseModelRef('claude-opus-4-6')).toBeNull()
    expect(parseModelRef('us.anthropic.claude-opus-4-6-v1:0')).toBeNull()
  })

  test('parseModelRef returns null on missing separator', () => {
    expect(parseModelRef('gpt-4o')).toBeNull()
    expect(parseModelRef('')).toBeNull()
  })

  test('legacy double-colon refs remain readable and normalize the organization', () => {
    expect(parseModelRef('DeepSeek::deepseek-v4-pro')).toEqual({ providerId: 'deepseek', modelId: 'deepseek-v4-pro' })
  })

  test('model ids may contain additional slashes', () => {
    expect(parseModelRef('openrouter/anthropic/claude-sonnet')).toEqual({ providerId: 'openrouter', modelId: 'anthropic/claude-sonnet' })
  })
})

describe('providerNamespace collision', () => {
  test('names that differ only by case/space/slug collide', () => {
    expect(providerNamespace('Deep Seek')).toBe('deep-seek')
    expect(providerNamespace('deep-seek')).toBe('deep-seek')
  })

  test('distinct namespaces stay distinct', () => {
    expect(providerNamespace('DeepSeek')).toBe('deepseek')
    expect(providerNamespace('OpenAI')).toBe('openai')
    expect(providerNamespace('DeepSeek')).not.toBe(providerNamespace('OpenAI'))
  })
})
