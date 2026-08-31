/**
 * Auto-managed built-in gateway.
 *
 * Starts the internal Anthropic-compatible gateway lazily when a non-Anthropic
 * provider-scoped model is first requested, wires `ANTHROPIC_BASE_URL` to it,
 * and stops it on process exit. Idempotent — only one server for the process.
 */
import { loadProviderInstances } from '../configStore.js'
import { startGateway, stopGateway, type GatewayConfig } from './server.js'
import type { ProviderInstance } from '../types.js'
import { providerNamespace } from '../types.js'
import { resolveProviderCredential } from '../credentials.js'

let activeServer: ReturnType<typeof startGateway> | null = null
let activePrefix: string | null = null
let transitionPromise: Promise<boolean> | null = null

function apiKeyFromInstance(inst: ProviderInstance): string {
  const auth = inst.config.auth
  if (auth.type === 'apiKey') {
    return resolveProviderCredential(auth.apiKeyRef)
  }
  if (auth.type === 'env') return resolveProviderCredential(`env:${auth.envVar}`)
  return ''
}

export interface NativeAnthropicClientConfig {
  apiKey: string
  baseURL: string
  defaultHeaders?: Record<string, string>
}

/** Resolve a provider-scoped Anthropic-compatible instance for direct SDK use. */
export async function getNativeAnthropicClientConfig(
  prefix: string,
): Promise<NativeAnthropicClientConfig | null> {
  const instances = await loadProviderInstances()
  const inst = instances.find(
    i => (providerNamespace(i.id) === providerNamespace(prefix) || providerNamespace(i.displayName) === providerNamespace(prefix)) && i.enabled,
  )
  if (!inst || inst.providerId !== 'anthropic') return null

  const authBaseUrl = inst.config.auth.type === 'apiKey'
    ? inst.config.auth.baseUrl
    : inst.config.auth.type === 'env'
      ? inst.config.auth.baseUrl
      : undefined
  const baseURL = inst.config.apiUrl || authBaseUrl
  if (!baseURL) return null

  return {
    apiKey: apiKeyFromInstance(inst),
    baseURL,
    defaultHeaders: inst.config.extraHeaders,
  }
}

function instanceToGatewayConfig(inst: ProviderInstance): GatewayConfig {
  return {
    apiKey: apiKeyFromInstance(inst),
    apiUrl: inst.config.apiUrl || 'https://api.openai.com/v1',
  }
}

/**
 * Ensure the gateway is running for the given provider *name* (the model ref
 * prefix, e.g. `DeepSeek`). Looks the instance up by id/name; Anthropic
 * instances are served natively (no gateway). Returns true when the internal
 * gateway is active (OpenAI-compatible protocol) — so the caller only rewrites
 * the base URL when it actually is. Safe to call on every request.
 */
export async function ensureGatewayStarted(prefix: string): Promise<boolean> {
  if (activeServer && activePrefix === prefix) return true
  if (transitionPromise) {
    await transitionPromise
    if (activeServer && activePrefix === prefix) return true
  }

  transitionPromise = (async () => {
    const instances = await loadProviderInstances()
    const inst = instances.find(
      i => (providerNamespace(i.id) === providerNamespace(prefix) || providerNamespace(i.displayName) === providerNamespace(prefix)) && i.enabled,
    )
    if (!inst) {
      return false
    }
    // Anthropic protocol → native path, no gateway.
    if (inst.providerId === 'anthropic') {
      return false
    }
    if (activeServer) {
      await stopGateway(activeServer)
      activeServer = null
      activePrefix = null
    }
    const cfg = instanceToGatewayConfig(inst)
    const port = cfg.port ?? 3456
    const server = startGateway(cfg)
    server.on('error', () => {
      if (activeServer === server) {
        activeServer = null
        activePrefix = null
      }
    })
    process.once('exit', () => {
      try {
        if (activeServer === server) void stopGateway(server)
      } catch {
        /* best-effort */
      }
    })
    activeServer = server
    activePrefix = prefix
    return true
  })()
  try {
    return await transitionPromise
  } catch {
    return false
  } finally {
    transitionPromise = null
  }
}
