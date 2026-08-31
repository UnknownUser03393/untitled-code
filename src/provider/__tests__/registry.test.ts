import { describe, expect, test } from 'vitest'
import { ProviderRegistry } from '../registry.js'
import {
  ProviderAlreadyRegisteredError,
  UnknownProviderError,
} from '../errors.js'
import type { ProviderPlugin, ProviderConfig } from '../types.js'

function makePlugin(id: string): ProviderPlugin {
  return {
    id,
    name: id,
    authenticate: async (_c: ProviderConfig) => ({ ok: true }),
    listModels: async () => [],
    chat: async (_c, req) => ({ content: 'ok', model: req.model }),
  }
}

describe('ProviderRegistry', () => {
  test('register + get roundtrip', () => {
    const r = new ProviderRegistry()
    r.register(makePlugin('openai'))
    const p = r.get('openai')
    expect(p.id).toBe('openai')
    expect(r.has('openai')).toBe(true)
  })

  test('register same id throws ProviderAlreadyRegisteredError', () => {
    const r = new ProviderRegistry()
    r.register(makePlugin('openai'))
    expect(() => r.register(makePlugin('openai'))).toThrow(ProviderAlreadyRegisteredError)
  })

  test('get unknown id throws UnknownProviderError', () => {
    const r = new ProviderRegistry()
    r.register(makePlugin('openai'))
    expect(() => r.get('gemini')).toThrow(UnknownProviderError)
  })

  test('unregister unknown id throws UnknownProviderError', () => {
    const r = new ProviderRegistry()
    expect(() => r.unregister('nope')).toThrow(UnknownProviderError)
  })

  test('unregister removes plugin', () => {
    const r = new ProviderRegistry()
    r.register(makePlugin('openai'))
    r.unregister('openai')
    expect(r.has('openai')).toBe(false)
    expect(() => r.get('openai')).toThrow(UnknownProviderError)
  })

  test('tryGet returns undefined for unknown id', () => {
    const r = new ProviderRegistry()
    r.register(makePlugin('openai'))
    expect(r.tryGet('missing')).toBeUndefined()
    expect(r.tryGet('openai')?.id).toBe('openai')
  })

  test('enumerate returns registered plugins in order', () => {
    const r = new ProviderRegistry()
    r.register(makePlugin('openai'))
    r.register(makePlugin('gemini'))
    expect(r.enumerate().map(p => p.id)).toEqual(['openai', 'gemini'])
    expect(r.ids()).toEqual(['openai', 'gemini'])
  })
})
