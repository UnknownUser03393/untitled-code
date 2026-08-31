import { describe, expect, test, vi } from 'vitest'
import type { ProviderConfig } from '../types.js'

// Mock the Anthropic SDK so listModels never touches the network: the upstream
// model-list always fails, so the test exercises the manual-models fallback —
// the "no claude-* ceiling" guarantee.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    models = {
      async *list(): AsyncGenerator<never> {
        throw new Error('upstream list failed')
      },
    }
  },
}))

import { anthropicProvider } from '../plugins/anthropic/index.js'

describe('anthropic plugin manual models', () => {
  test('manual models survive an upstream list failure', async () => {
    const config: ProviderConfig = {
      auth: { type: 'apiKey', apiKeyRef: 'sk-test' },
      manualModels: ['deepseek-r1', 'my-custom-model'],
    }
    const models = await anthropicProvider.listModels(config)
    const ids = models.map(m => m.modelId)
    expect(ids).toContain('deepseek-r1')
    expect(ids).toContain('my-custom-model')
    // Built-in table is still present alongside the manual ids.
    expect(ids).toContain('claude-opus-4-6')
  })

  test('DeepSeek Anthropic-compatible endpoint uses only the DeepSeek fallback catalog', async () => {
    const config: ProviderConfig = {
      auth: { type: 'apiKey', apiKeyRef: 'test-key' },
      apiUrl: 'https://api.deepseek.com/anthropic',
    }
    const models = await anthropicProvider.listModels(config)
    expect(models.map(model => model.modelId)).toEqual([
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v4-flash-vision-exp',
    ])
    expect(models.some(model => model.modelId.startsWith('claude-'))).toBe(false)
  })
})
