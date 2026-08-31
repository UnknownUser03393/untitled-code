/**
 * Model discovery and unified table service.
 *
 * `refreshAllModels` scans every enabled provider and merges results. It is
 * partial-failure tolerant: one provider failing never throws the whole scan —
 * each provider reports ok/error, and successful scans write their cache.
 */
import { getActiveProviders, getEnabledProviders } from './defaults.js'
import { loadModelsCache, writeModelsCache, invalidateCache, loadScanCache, writeScanCache } from './cache.js'
import { logError } from '../utils/log.js'
import { getDefaultSonnetModel } from '../utils/model/model.js'
import type { ModelDescriptor } from './types.js'
import { encodeModelRef, parseModelRef, providerNamespace } from './types.js'

export interface ProviderScanResult {
  instanceId: string
  providerId: string
  ok: boolean
  error?: string
  modelCount: number
}

/**
 * Scan all enabled providers for models. Existing cache is preserved for any
 * provider whose scan fails (so a transient failure does not wipe the list).
 */
export async function refreshAllModels(): Promise<ProviderScanResult[]> {
  const providers = await getEnabledProviders()
  return Promise.all(
    providers.map(async ({ instance, plugin }): Promise<ProviderScanResult> => {
      const namespace = providerNamespace(instance.id)
      try {
        const models = await plugin.listModels(instance.config)
        await writeModelsCache(namespace, models)
        // The cache reader is memoized on the file path — invalidate so the next
        // read (e.g. getUnifiedModelTable) picks up the fresh list.
        invalidateCache(namespace)
        await writeScanCache(namespace, { ok: true, modelCount: models.length, scannedAt: new Date().toISOString() })
        return { instanceId: instance.id, providerId: instance.providerId, ok: true, modelCount: models.length }
      } catch (error) {
        logError(error as Error)
        const message = error instanceof Error ? error.message : 'unknown'
        await writeScanCache(namespace, { ok: false, error: message, modelCount: 0, scannedAt: new Date().toISOString() })
        return {
          instanceId: instance.id,
          providerId: instance.providerId,
          ok: false,
          error: message,
          modelCount: 0,
        }
      }
    }),
  )
}

/**
 * Scan a single enabled provider for models and refresh its cache. Partial for
 * per-provider refresh from the model management UI (vs. the all-provider scan).
 */
export async function refreshProviderModels(instanceId: string): Promise<ProviderScanResult> {
  const providers = await getActiveProviders()
  const active = providers.find(p => providerNamespace(p.instance.id) === providerNamespace(instanceId))
  if (!active) {
    return { instanceId, providerId: '', ok: false, error: `no provider instance '${instanceId}'`, modelCount: 0 }
  }
  const namespace = providerNamespace(active.instance.id)
  try {
    const models = await active.plugin.listModels(active.instance.config)
    await writeModelsCache(namespace, models)
    invalidateCache(namespace)
    await writeScanCache(namespace, { ok: true, modelCount: models.length, scannedAt: new Date().toISOString() })
    return { instanceId, providerId: active.instance.providerId, ok: true, modelCount: models.length }
  } catch (error) {
    logError(error as Error)
    const message = error instanceof Error ? error.message : 'unknown'
    await writeScanCache(namespace, { ok: false, error: message, modelCount: 0, scannedAt: new Date().toISOString() })
    return {
      instanceId,
      providerId: active.instance.providerId,
      ok: false,
      error: message,
      modelCount: 0,
    }
  }
}

/**
 * Return the current unified model table: cache-backed (last successful scan)
 * across all enabled providers. Models from a provider with no cache yet are
 * simply absent — callers should surface the last-scan state separately.
 */
export async function getUnifiedModelTable(): Promise<ModelDescriptor[]> {
  const providers = await getEnabledProviders()
  const all: ModelDescriptor[] = []
  for (const { instance } of providers) {
    const namespace = providerNamespace(instance.id)
    const cached = loadModelsCache(namespace)
    if (cached) {
      all.push(...cached.map(model => ({ ...model, providerId: namespace })))
    }
  }
  return all
}

/** Per-provider last-scan info (count + whether a known cache exists + last error). */
export async function getModelScanState(): Promise<
  Array<{
    instanceId: string
    providerId: string
    modelCount: number
    cached: boolean
    error?: string
    lastScanAt?: string
  }>
> {
  const providers = await getEnabledProviders()
  return providers.map(({ instance }) => {
    const namespace = providerNamespace(instance.id)
    const cached = loadModelsCache(namespace)
    const scan = loadScanCache(namespace)
    const base = {
      instanceId: instance.id,
      providerId: instance.providerId,
      modelCount: scan?.modelCount ?? cached?.length ?? 0,
      cached: cached !== null,
    }
    if (!scan) return base
    return scan.ok
      ? { ...base, lastScanAt: scan.scannedAt }
      : { ...base, error: scan.error, lastScanAt: scan.scannedAt }
  })
}

/** Pick a conservative same-instance fallback from the last successful scan. */
export function getAutomaticProviderFallbackModel(ref: string): string | undefined {
  const parsed = parseModelRef(ref)
  if (!parsed) return undefined
  const models = loadModelsCache(parsed.providerId) ?? []
  const candidates = models.filter(model => model.modelId !== parsed.modelId)
  const preferred = candidates.find(model =>
    model.modelId.toLowerCase().includes('flash') &&
    !model.modelId.toLowerCase().includes('vision'),
  ) ?? candidates.find(model => model.capabilities.includes('chat') && !model.capabilities.includes('vision'))
    ?? candidates[0]
  return preferred ? encodeModelRef(parsed.providerId, preferred.modelId) : undefined
}

/**
 * Ordered fallback chain for a provider-scoped model ref — the list of model
 * refs the query loop degrades through, which may span providers.
 *
 * An explicit per-instance `config.fallback` wins verbatim. Otherwise the auto
 * chain is: same-instance alternatives (flash preferred), then each other
 * enabled instance's best cached chat model, then the base Anthropic default
 * (a bare `claude-*` id, so routing goes native first-party). Native
 * (non-provider) refs return `[]` — base behavior unchanged.
 */
export async function getFallbackChain(
  ref: string,
  opts: { includeBaseDefault?: boolean } = {},
): Promise<string[]> {
  const parsed = parseModelRef(ref)
  const namespace = parsed?.providerId
  if (!namespace) return []

  const providers = await getEnabledProviders()

  // Explicit per-instance chain wins verbatim.
  const owning = providers.find(p => providerNamespace(p.instance.id) === namespace)
  const explicit = owning?.instance.config.fallback
  if (explicit && explicit.length > 0) {
    return [...new Set(explicit.filter(candidate => candidate.length > 0))]
  }

  const chain: string[] = []
  const push = (candidate: string | undefined): void => {
    if (candidate && candidate !== ref && !chain.includes(candidate)) chain.push(candidate)
  }

  // 1. Same-instance alternatives first.
  push(getAutomaticProviderFallbackModel(ref))

  // 2. Each other enabled instance's best cached chat model.
  for (const { instance } of providers) {
    const ns = providerNamespace(instance.id)
    if (ns === namespace) continue
    const models = loadModelsCache(ns) ?? []
    const best =
      models.find(m => m.capabilities.includes('chat') && !m.capabilities.includes('vision')) ??
      models.find(m => m.capabilities.includes('chat')) ??
      models[0]
    if (best) push(encodeModelRef(instance.id, best.modelId))
  }

  // 3. Optional terminal native default.
  if (opts.includeBaseDefault ?? true) {
    push(getDefaultSonnetModel())
  }

  return chain.slice(0, 5)
}

const ORGANIZATION_NAMES: Record<string, string> = {
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  ollama: 'Ollama',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
}

export function getProviderModelPresentation(ref: string): { organization: string; model: string } | null {
  const parsed = parseModelRef(ref)
  if (!parsed) return null
  const organization = ORGANIZATION_NAMES[parsed.providerId]
    ?? parsed.providerId.split(/[-_.]/).filter(Boolean).map(part => part[0]?.toUpperCase() + part.slice(1)).join(' ')
  const descriptor = (loadModelsCache(parsed.providerId) ?? []).find(model => model.modelId === parsed.modelId)
  return { organization, model: descriptor?.displayName || parsed.modelId }
}
