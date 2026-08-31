/**
 * Provider plugin registry.
 *
 * Providers are loaded through this registry — never through `if/else` or
 * `switch` in business logic. Register a plugin once, then retrieve it by id.
 */
import type { ProviderPlugin } from './types.js'
import {
  ProviderAlreadyRegisteredError,
  UnknownProviderError,
} from './errors.js'

/**
 * A registry keyed by plugin id. Each provider plugin is registered once
 * (usually the built-in ones, once at startup). A plugin with the same id can
 * be used by many {@link ProviderInstance}s — the instances live in configStore,
 * not here.
 */
export class ProviderRegistry {
  private readonly plugins = new Map<string, ProviderPlugin>()

  register(plugin: ProviderPlugin): void {
    if (this.plugins.has(plugin.id)) {
      throw new ProviderAlreadyRegisteredError(plugin.id)
    }
    this.plugins.set(plugin.id, plugin)
  }

  unregister(providerId: string): void {
    if (!this.plugins.delete(providerId)) {
      throw new UnknownProviderError(providerId)
    }
  }

  /** Retrieve a plugin; throws {@link UnknownProviderError} if not registered. */
  get(providerId: string): ProviderPlugin {
    const plugin = this.plugins.get(providerId)
    if (!plugin) {
      throw new UnknownProviderError(providerId)
    }
    return plugin
  }

  /** Retrieve a plugin, or `undefined` if unregistered (non-throwing). */
  tryGet(providerId: string): ProviderPlugin | undefined {
    return this.plugins.get(providerId)
  }

  has(providerId: string): boolean {
    return this.plugins.has(providerId)
  }

  /** Enumerate all registered plugins (insertion order). */
  enumerate(): ProviderPlugin[] {
    return [...this.plugins.values()]
  }

  /** Plugin ids only — useful for enumerating capabilities without instance config. */
  ids(): string[] {
    return [...this.plugins.keys()]
  }
}

let defaultRegistry: ProviderRegistry | undefined

/**
 * Shared module-level registry. Tests can construct their own `ProviderRegistry`
 * instance for isolation and only touch this when they need the global one.
 */
export function getDefaultProviderRegistry(): ProviderRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ProviderRegistry()
  }
  return defaultRegistry
}
