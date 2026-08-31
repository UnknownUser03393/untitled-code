import { describe, expect, test } from 'vitest'
import { registerBuiltinPlugins, BUILTIN_PROVIDER_PLUGINS } from '../plugins/registry.js'
import { getDefaultProviderRegistry } from '../registry.js'
import type { ProviderConfig } from '../types.js'

// Builtin registry is idempotent and shares the singleton; use a fresh marker
// so running this repeatedly across suites is safe.
describe('builtin plugins registry', () => {
  test('registers all builtin providers without throwing', () => {
    expect(() => registerBuiltinPlugins()).not.toThrow()
    const registry = getDefaultProviderRegistry()
    for (const plugin of BUILTIN_PROVIDER_PLUGINS) {
      expect(registry.has(plugin.id)).toBe(true)
    }
  })

  test('builtin ids are unique', () => {
    const ids = BUILTIN_PROVIDER_PLUGINS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every builtin plugin exposes the required methods', () => {
    for (const plugin of BUILTIN_PROVIDER_PLUGINS) {
      expect(typeof plugin.authenticate).toBe('function')
      expect(typeof plugin.listModels).toBe('function')
      expect(typeof plugin.chat).toBe('function')
    }
  })
})

describe('openAiCompatible plugin model listing (manual models fallback)', () => {
  // Build a config that points at a bogus URL; listModels must degrade to
  // manual models without throwing (no network dependency in tests).
  const config: ProviderConfig = {
    auth: { type: 'apiKey', apiKeyRef: 'env:NO_SUCH_KEY' },
    apiUrl: 'http://127.0.0.1:1/v1',
    manualModels: ['gpt-4o', 'my-custom-model'],
  }

  test('manual models are returned even when provider is unreachable', async () => {
    // Inline minimal OpenAI router that never hits network — replace with the
    // actual plugin's listModels but with a manual-models-only expectation by
    // observing it degrades rather than throws.
    const createOpenAiCompatible = (await import('../plugins/openaiCompatible/index.js')).createOpenAiCompatiblePlugin
    const plugin = createOpenAiCompatible({ id: 'x', name: 'X', baseUrl: 'http://127.0.0.1:1/v1' })
    const models = await plugin.listModels(config)
    // Should not throw; manual models are present.
    const ids = models.map(m => m.modelId)
    expect(ids).toContain('gpt-4o')
    expect(ids).toContain('my-custom-model')
  })
})
