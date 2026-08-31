/**
 * Disk cache for provider-derived data (model lists, health, quota).
 *
 * Generalizes the cache pattern in src/utils/model/modelCapabilities.ts:
 * memoized reads, zod validation, content-based skip-write, private file mode.
 * Files live under `~/.claude/cache/` and are isolated per-provider. Tests can
 * point `CLAUDE_CONFIG_DIR` at a temp dir — the memoize key is the file path,
 * so a different dir yields a fresh cache.
 */
import { readFileSync, existsSync, unlinkSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import isEqual from 'lodash-es/isEqual.js'
import memoize from 'lodash-es/memoize.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { safeParseJSON } from '../utils/json.js'
import { logError } from '../utils/log.js'
import {
  ModelDescriptorSchema,
  ProviderHealthSchema,
  QuotaSnapshotSchema,
  ScanCacheSchema,
} from './schema.js'
import type { ModelDescriptor, ProviderHealth, QuotaSnapshot, ScanCache } from './types.js'

function cacheDir(): string {
  return join(getClaudeConfigHomeDir(), 'cache')
}

function modelsCachePath(instanceId: string): string {
  return join(cacheDir(), `provider-${encodeURIComponent(instanceId)}-models.json`)
}

function healthCachePath(providerId: string): string {
  return join(cacheDir(), `provider-${encodeURIComponent(providerId)}-health.json`)
}

function quotaCachePath(providerId: string): string {
  return join(cacheDir(), `provider-${encodeURIComponent(providerId)}-quota.json`)
}

function scanCachePath(providerId: string): string {
  return join(cacheDir(), `provider-${encodeURIComponent(providerId)}-scan.json`)
}

const loadModels = memoize((path: string): ModelDescriptor[] | null => {
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = safeParseJSON(raw)
    if (!Array.isArray(parsed)) return null
    const models: ModelDescriptor[] = []
    for (const entry of parsed) {
      const result = ModelDescriptorSchema().safeParse(entry)
      if (result.success) models.push(result.data)
    }
    return parsed.length === 0 || models.length > 0 ? models : null
  } catch {
    return null
  }
}, (path: string) => path)

interface SchemaShape {
  safeParse(value: unknown): { success: boolean; data?: unknown }
}

const loadSingle = memoize((path: string, schema: SchemaShape): unknown | null => {
  try {
    if (!existsSync(path)) return null
    const raw = readFileSync(path, 'utf-8')
    const parsed = safeParseJSON(raw)
    if (!parsed) return null
    const result = schema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}, (path: string) => path)

async function writeIfChanged<T>(path: string, value: T): Promise<void> {
  const existing = existsSync(path) ? safeParseJSON(readFileSync(path, 'utf-8')) : null
  if (isEqual(existing, value)) return
  try {
    await mkdir(cacheDir(), { recursive: true })
    await writeFile(path, JSON.stringify(value), { encoding: 'utf-8', mode: 0o600 })
  } catch (error) {
    logError(error as Error)
  }
}

export function loadModelsCache(instanceId: string): ModelDescriptor[] | null {
  return loadModels(modelsCachePath(instanceId))
}

export async function writeModelsCache(instanceId: string, models: ModelDescriptor[]): Promise<void> {
  await writeIfChanged(modelsCachePath(instanceId), models)
}

export function loadHealthCache(providerId: string): ProviderHealth | null {
  return loadSingle(healthCachePath(providerId), ProviderHealthSchema()) as ProviderHealth | null
}

export async function writeHealthCache(providerId: string, health: ProviderHealth): Promise<void> {
  await writeIfChanged(healthCachePath(providerId), health)
}

export function loadQuotaCache(providerId: string): QuotaSnapshot | null {
  return loadSingle(quotaCachePath(providerId), QuotaSnapshotSchema()) as QuotaSnapshot | null
}

export async function writeQuotaCache(providerId: string, quota: QuotaSnapshot): Promise<void> {
  await writeIfChanged(quotaCachePath(providerId), quota)
}

export function loadScanCache(providerId: string): ScanCache | null {
  return loadSingle(scanCachePath(providerId), ScanCacheSchema()) as ScanCache | null
}

export async function writeScanCache(providerId: string, scan: ScanCache): Promise<void> {
  await writeIfChanged(scanCachePath(providerId), scan)
}

/** Invalidate memoized cache for a provider (used by tests and manual refresh). */
export function invalidateCache(providerId: string): void {
  loadModels.cache.delete(modelsCachePath(providerId))
  loadSingle.cache.delete(healthCachePath(providerId))
  loadSingle.cache.delete(quotaCachePath(providerId))
  loadSingle.cache.delete(scanCachePath(providerId))
}

/**
 * Delete every disk cache file for a provider namespace and purge the matching
 * memoized entries. Idempotent and never throws — callers clean up best-effort
 * when a provider instance is removed.
 */
export function deleteProviderCache(namespace: string): void {
  const paths = [
    modelsCachePath(namespace),
    healthCachePath(namespace),
    quotaCachePath(namespace),
    scanCachePath(namespace),
  ]
  for (const path of paths) {
    loadModels.cache.delete(path)
    loadSingle.cache.delete(path)
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      /* best-effort: a missing cache file is fine to leave */
    }
  }
}
