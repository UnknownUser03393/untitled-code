import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  loadModelsCache,
  writeModelsCache,
  invalidateCache,
  loadHealthCache,
  writeHealthCache,
  deleteProviderCache,
  loadScanCache,
  writeScanCache,
} from '../cache.js'
import type { ModelDescriptor, ProviderHealth } from '../types.js'

// Isolate cache by pointing config home at a temp dir for the duration of this
// suite. The cache module memoizes on the resolved path, so a fresh dir yields
// fresh reads.
let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claude-provider-cache-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
})

const model: ModelDescriptor = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  displayName: 'GPT-4o',
  contextWindow: 128000,
  capabilities: ['chat', 'tools', 'vision'],
}

describe('models cache', () => {
  test('write then load returns same model', async () => {
    await writeModelsCache('openai', [model])
    const loaded = loadModelsCache('openai')
    expect(loaded).toEqual([model])
  })

  test('missing provider returns null (not throw)', () => {
    expect(loadModelsCache('nope')).toBeNull()
  })

  test('an empty successful model scan remains distinguishable from no cache', async () => {
    await writeModelsCache('empty-instance', [])
    invalidateCache('empty-instance')
    expect(loadModelsCache('empty-instance')).toEqual([])
  })

  test('invalidate clears memoized cache', async () => {
    await writeModelsCache('gemini', [model])
    expect(loadModelsCache('gemini')).toEqual([model])
    invalidateCache('gemini')
    // force re-read from disk (still present, so non-null)
    const after = loadModelsCache('gemini')
    expect(after).toEqual([model])
  })
})

const health: ProviderHealth = {
  providerId: 'openai',
  status: 'ok',
  latencyMs: 120,
  lastCheckedAt: '2026-08-22T00:00:00Z',
}

describe('health cache', () => {
  test('write then load roundtrip', async () => {
    await writeHealthCache('openai', health)
    const loaded = loadHealthCache('openai')
    expect(loaded).toEqual(health)
  })

  test('missing health returns null', () => {
    expect(loadHealthCache('absent')).toBeNull()
  })
})

describe('scan cache', () => {
  test('write then load roundtrip, including error', async () => {
    await writeScanCache('openai', { ok: false, error: 'upstream 401', modelCount: 0, scannedAt: '2026-08-31T00:00:00Z' })
    expect(loadScanCache('openai')).toEqual({ ok: false, error: 'upstream 401', modelCount: 0, scannedAt: '2026-08-31T00:00:00Z' })
  })

  test('missing scan returns null', () => {
    expect(loadScanCache('absent')).toBeNull()
  })
})

describe('deleteProviderCache', () => {
  test('removes disk files and memo entries (read returns null after delete)', async () => {
    await writeModelsCache('openai', [model])
    await writeHealthCache('openai', health)
    expect(loadModelsCache('openai')).toEqual([model])
    deleteProviderCache('openai')
    // memo purged + file gone → re-read returns null
    expect(loadModelsCache('openai')).toBeNull()
    expect(loadHealthCache('openai')).toBeNull()
  })

  test('idempotent on a namespace with no files', () => {
    expect(() => deleteProviderCache('never-written')).not.toThrow()
  })
})
