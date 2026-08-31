/**
 * Quota service (best-effort).
 *
 * Many providers have no public balance API; quota must never be fabricated.
 * A plugin that cannot report quota returns status `unsupported` (displayed as
 * "Unsupported", never "Unlimited"). Rate-limit values that only surface on
 * response headers are updated from real model requests rather than fake queries.
 */
import { getEnabledProviders } from './defaults.js'
import { loadQuotaCache, writeQuotaCache } from './cache.js'
import type { QuotaSnapshot } from './types.js'
import { providerNamespace } from './types.js'

/** Fetch a provider's quota, falling back to cache on failure. */
export async function getQuota(instanceId: string): Promise<QuotaSnapshot | null> {
  const providers = await getEnabledProviders()
  const target = providers.find(p => providerNamespace(p.instance.id) === providerNamespace(instanceId))
  if (!target) return null
  if (!target.plugin.getQuota) {
    return {
      status: 'unsupported',
      fetchedAt: new Date().toISOString(),
      windows: [],
      message: 'This provider does not expose quota',
    }
  }
  const snapshot = await target.plugin.getQuota(target.instance.config)
  await writeQuotaCache(providerNamespace(target.instance.id), snapshot)
  return snapshot
}

/** Read a provider's latest cached quota snapshot (no network). */
export function getCachedQuota(instanceId: string): QuotaSnapshot | null {
  return loadQuotaCache(providerNamespace(instanceId))
}
