/**
 * Active provider composition.
 *
 * Ties together the code-registered plugins (registry) and the user-configured
 * instances (configStore). An "active provider" is an instance paired with its
 * plugin, ready to be queried. This is the normal way services read providers.
 */
import { getDefaultProviderRegistry } from './registry.js'
import { loadProviderInstances } from './configStore.js'
import type { ProviderInstance, ProviderPlugin } from './types.js'

export interface ActiveProvider {
  instance: ProviderInstance
  plugin: ProviderPlugin
}

/** Resolve the plugin for an instance; returns `null` if the plugin is unregistered. */
export function resolvePlugin(instance: ProviderInstance): ProviderPlugin | null {
  return getDefaultProviderRegistry().tryGet(instance.providerId) ?? null
}

// The built-in plugins are only registered on demand (the registry is inert
// otherwise). Guards every provider read so a configured instance always has a
// resolvable plugin. Idempotent — registerBuiltinPlugins() skips known ids.
let pluginsRegistered: Promise<void> | null = null
function ensurePluginsRegistered(): Promise<void> {
  if (!pluginsRegistered) {
    pluginsRegistered = import('./plugins/registry.js').then(m => m.registerBuiltinPlugins())
  }
  return pluginsRegistered
}

/** Compose all user instances with their plugin, dropping unregistered/idless ones. */
export async function getActiveProviders(): Promise<ActiveProvider[]> {
  await ensurePluginsRegistered()
  const instances = await loadProviderInstances()
  const active: ActiveProvider[] = []
  for (const instance of instances) {
    const plugin = resolvePlugin(instance)
    if (plugin) {
      active.push({ instance, plugin })
    }
  }
  return active
}

/** Compose only enabled instances. */
export async function getEnabledProviders(): Promise<ActiveProvider[]> {
  const active = await getActiveProviders()
  return active.filter(p => p.instance.enabled)
}
