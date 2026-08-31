import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDefaultProviderRegistry } from '../registry.js'
import { saveProviderInstances } from '../configStore.js'
import {
  refreshAllModels,
  refreshProviderModels,
  getModelScanState,
  getUnifiedModelTable,
  getAutomaticProviderFallbackModel,
  getFallbackChain,
} from '../modelService.js'
import { parseModelRef } from '../types.js'
import type { ProviderConfig, ProviderPlugin, ProviderInstance } from '../types.js'

// Isolate config + cache via temp CLAUDE_CONFIG_DIR.
let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claude-provider-svc-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
})

function mockPlugin(id: string, { fail = false } = {}): ProviderPlugin {
  return {
    id,
    name: id,
    authenticate: async () => ({ ok: !fail }),
    listModels: async () => {
      if (fail) throw new Error(`${id} blew up`)
      return [
        { providerId: id, modelId: `model-${id}`, displayName: `Model ${id}`, capabilities: ['chat'] },
      ]
    },
    chat: async (_c, req) => ({ content: 'ok', model: req.model }),
  }
}

function instance(providerId: string, id = `${providerId}-inst`, modelId?: string): ProviderInstance {
  return {
    id,
    providerId,
    displayName: providerId,
    enabled: true,
    config: { auth: { type: 'none' }, ...(modelId ? { manualModels: [modelId] } : {}) },
    createdAt: '2026-08-22T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
  }
}

describe('refreshAllModels partial failure tolerance', () => {
  test('one failing provider does not block others and returns per-provider results', async () => {
    const registry = getDefaultProviderRegistry()
    // Use unique plugin ids so repeated runs do not collide.
    if (registry.has('svc-ok')) registry.unregister('svc-ok')
    if (registry.has('svc-fail')) registry.unregister('svc-fail')
    registry.register(mockPlugin('svc-ok'))
    registry.register(mockPlugin('svc-fail', { fail: true }))

    await saveProviderInstances([instance('svc-ok'), instance('svc-fail')])

    const results = await refreshAllModels()
    const okResult = results.find(r => r.instanceId === 'svc-ok-inst')
    const failResult = results.find(r => r.instanceId === 'svc-fail-inst')

    expect(okResult?.ok).toBe(true)
    expect(okResult?.modelCount).toBe(1)
    expect(failResult?.ok).toBe(false)
    expect(typeof failResult?.error).toBe('string')

    const state = await getModelScanState()
    const okState = state.find(s => s.instanceId === 'svc-ok-inst')
    expect(okState?.modelCount).toBe(1)
    expect(okState?.cached).toBe(true)
    // The failing provider's error is persisted for the status panel.
    const failState = state.find(s => s.instanceId === 'svc-fail-inst')
    expect(failState?.modelCount).toBe(0)
    expect(failState?.error).toBe('svc-fail blew up')
    expect(failState?.lastScanAt).toBeTruthy()
  })

  test('isolates model caches for multiple instances using the same plugin', async () => {
    const registry = getDefaultProviderRegistry()
    const plugin: ProviderPlugin = {
      ...mockPlugin('svc-shared'),
      listModels: async config => [{
        providerId: 'svc-shared',
        modelId: config.manualModels?.[0] ?? 'unknown',
        displayName: config.manualModels?.[0] ?? 'unknown',
        capabilities: ['chat'],
      }],
    }
    if (registry.has('svc-shared')) registry.unregister('svc-shared')
    registry.register(plugin)

    await saveProviderInstances([
      instance('svc-shared', 'account-a', 'model-a'),
      instance('svc-shared', 'account-b', 'model-b'),
    ])

    const results = await refreshAllModels()
    expect(results.map(r => r.instanceId)).toEqual(['account-a', 'account-b'])

    const table = await getUnifiedModelTable()
    expect(table.map(m => `${m.providerId}/${m.modelId}`)).toEqual([
      'account-a/model-a',
      'account-b/model-b',
    ])

    const one = await refreshProviderModels('account-b')
    expect(one.instanceId).toBe('account-b')
    expect(one.modelCount).toBe(1)
  })

  test('selects a non-vision flash model as an automatic same-instance fallback', async () => {
    const registry = getDefaultProviderRegistry()
    const plugin: ProviderPlugin = {
      ...mockPlugin('svc-fallback'),
      listModels: async () => [
        { providerId: 'svc-fallback', modelId: 'model-pro', displayName: 'Pro', capabilities: ['chat'] },
        { providerId: 'svc-fallback', modelId: 'model-flash', displayName: 'Flash', capabilities: ['chat'] },
        { providerId: 'svc-fallback', modelId: 'model-flash-vision', displayName: 'Vision', capabilities: ['chat', 'vision'] },
      ],
    }
    if (registry.has('svc-fallback')) registry.unregister('svc-fallback')
    registry.register(plugin)
    await saveProviderInstances([instance('svc-fallback', 'FallbackAccount')])
    await refreshAllModels()
    expect(getAutomaticProviderFallbackModel('fallbackaccount/model-pro')).toBe('fallbackaccount/model-flash')
  })
})

describe('getFallbackChain (cross-provider)', () => {
  test('non-provider ref returns an empty chain', async () => {
    expect(await getFallbackChain('claude-sonnet-4-6')).toEqual([])
  })

  test('explicit config.fallback wins verbatim', async () => {
    const registry = getDefaultProviderRegistry()
    if (registry.has('chain-ok')) registry.unregister('chain-ok')
    registry.register(mockPlugin('chain-ok'))
    await saveProviderInstances([{
      ...instance('chain-ok', 'ChainAccount'),
      config: { auth: { type: 'none' }, fallback: ['chainaccount/model-flash', 'openai/gpt-5', 'claude-sonnet-4-6'] },
    }])
    const chain = await getFallbackChain('chainaccount/model-pro')
    expect(chain).toEqual(['chainaccount/model-flash', 'openai/gpt-5', 'claude-sonnet-4-6'])
  })

  test('auto chain: same-instance flash, then other enabled instance, then a native default', async () => {
    const registry = getDefaultProviderRegistry()
    const primary: ProviderPlugin = {
      ...mockPlugin('chain-primary'),
      listModels: async () => [
        { providerId: 'chain-primary', modelId: 'model-pro', displayName: 'Pro', capabilities: ['chat'] },
        { providerId: 'chain-primary', modelId: 'model-flash', displayName: 'Flash', capabilities: ['chat'] },
      ],
    }
    if (registry.has('chain-primary')) registry.unregister('chain-primary')
    registry.register(primary)
    if (registry.has('chain-other')) registry.unregister('chain-other')
    registry.register(mockPlugin('chain-other'))

    await saveProviderInstances([instance('chain-primary', 'Primary'), instance('chain-other', 'Other')])
    await refreshAllModels()

    const chain = await getFallbackChain('primary/model-pro')
    expect(chain[0]).toBe('primary/model-flash')
    expect(chain).toContain('other/model-chain-other')
    // terminal entry is a bare native ref (parseModelRef → null)
    expect(parseModelRef(chain[chain.length - 1]!)).toBeNull()
    // the current model is never its own fallback
    expect(chain).not.toContain('primary/model-pro')
  })
})
