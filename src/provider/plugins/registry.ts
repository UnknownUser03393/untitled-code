/**
 * Built-in provider plugin registration.
 *
 * This is the single place that declares the built-in provider set. Each plugin
 * is registered through the same Registry path as any future third-party
 * plugin — no `if/else` or `switch` anywhere else in the codebase decides which
 * providers exist. Adding a provider = adding an entry here + a plugin module.
 */
import { getDefaultProviderRegistry } from '../registry.js'
import { anthropicProvider } from './anthropic/index.js'
import { openAIProvider } from './openai/index.js'

// Only Anthropic + OpenAI are built in. OpenAI is exposed through an
// OpenAI→Anthropic-protocol adapter so both speak the unified hub shape. Other
// provider plugins stay on disk but are NOT registered / enumerated here.
export const BUILTIN_PROVIDER_PLUGINS = [
  anthropicProvider,
  openAIProvider,
] as const

/**
 * Register all built-in plugins into the default registry. Idempotent — ids
 * already registered are skipped so a double-init (e.g. during tests) does not
 * throw.
 */
export function registerBuiltinPlugins(): void {
  const registry = getDefaultProviderRegistry()
  for (const plugin of BUILTIN_PROVIDER_PLUGINS) {
    if (!registry.has(plugin.id)) {
      registry.register(plugin)
    }
  }
}
