/**
 * Provider health service.
 */
import { getEnabledProviders } from './defaults.js'
import { loadHealthCache, writeHealthCache } from './cache.js'
import type { ProviderHealth } from './types.js'
import { providerNamespace } from './types.js'

/** Health-check a single provider, writing to cache. Throws only on programmer error. */
export async function healthCheck(instanceId: string): Promise<ProviderHealth | null> {
  const providers = await getEnabledProviders()
  const target = providers.find(p => providerNamespace(p.instance.id) === providerNamespace(instanceId))
  if (!target) return null
  const health = await target.plugin.healthCheck(target.instance.config)
  const namespace = providerNamespace(target.instance.id)
  const scoped = { ...health, providerId: namespace }
  await writeHealthCache(namespace, scoped)
  return scoped
}

/** Health-check all enabled providers, tolerating partial failure. */
export async function refreshAllHealth(): Promise<ProviderHealth[]> {
  const providers = await getEnabledProviders()
  const results: ProviderHealth[] = []
  await Promise.allSettled(
    providers.map(async ({ instance, plugin }) => {
      try {
        const health = await plugin.healthCheck(instance.config)
        const namespace = providerNamespace(instance.id)
        const scoped = { ...health, providerId: namespace }
        await writeHealthCache(namespace, scoped)
        results.push(scoped)
      } catch {
        // provider down / unreachable — record a down snapshot so UI reflects it
        const down: ProviderHealth = {
          providerId: providerNamespace(instance.id),
          status: 'down',
          lastCheckedAt: new Date().toISOString(),
          message: 'unreachable',
        }
        await writeHealthCache(providerNamespace(instance.id), down)
        results.push(down)
      }
    }),
  )
  return results
}

/** Read a provider's latest cached health (no network). */
export function getCachedHealth(instanceId: string): ProviderHealth | null {
  return loadHealthCache(providerNamespace(instanceId))
}
