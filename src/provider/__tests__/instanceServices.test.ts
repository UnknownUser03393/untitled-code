import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getDefaultProviderRegistry } from '../registry.js'
import { saveProviderInstances } from '../configStore.js'
import { getCachedHealth, refreshAllHealth } from '../healthService.js'
import { getCachedQuota, getQuota } from '../quotaService.js'
import type { ProviderInstance, ProviderPlugin } from '../types.js'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'provider-instance-services-'))
  process.env.CLAUDE_CONFIG_DIR = dir
})
afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
})

function instance(id: string): ProviderInstance {
  return {
    id,
    providerId: 'shared-services',
    displayName: id,
    enabled: true,
    config: { auth: { type: 'none' }, manualModels: [id] },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }
}

describe('instance-scoped health and quota', () => {
  test('same-plugin instances keep independent snapshots', async () => {
    const plugin: ProviderPlugin = {
      id: 'shared-services',
      name: 'Shared',
      authenticate: async () => ({ ok: true }),
      listModels: async () => [],
      healthCheck: async config => ({ providerId: 'shared-services', status: config.manualModels?.[0] === 'A' ? 'ok' : 'degraded', lastCheckedAt: '2026-01-01T00:00:00Z' }),
      getQuota: async config => ({ status: 'available', fetchedAt: '2026-01-01T00:00:00Z', windows: [{ type: 'requests', remaining: config.manualModels?.[0] === 'A' ? 10 : 20, source: 'api' }] }),
      chat: async (_config, request) => ({ content: 'ok', model: request.model }),
    }
    const registry = getDefaultProviderRegistry()
    if (registry.has(plugin.id)) registry.unregister(plugin.id)
    registry.register(plugin)
    await saveProviderInstances([instance('A'), instance('B')])

    await refreshAllHealth()
    await getQuota('A')
    await getQuota('B')
    expect(getCachedHealth('A')?.status).toBe('ok')
    expect(getCachedHealth('B')?.status).toBe('degraded')
    expect(getCachedQuota('A')?.windows[0]?.remaining).toBe(10)
    expect(getCachedQuota('B')?.windows[0]?.remaining).toBe(20)
  })
})
