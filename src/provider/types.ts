/**
 * Core type definitions for the multi-provider model layer (Provider Hub).
 *
 * These are pure types — no I/O, no network, no fs imports. Everything that
 * reads/writes lives in the service modules that import these types.
 *
 * The design mirrors the existing Anthropic-specific model layer
 * (`src/utils/model/`) while adding a provider-agnostic dimension. Model names
 * from non-Anthropic providers are namespaced as `${organization}/${modelId}`
 * (e.g. `deepseek/deepseek-v4-pro`) so they never collide with Anthropic IDs (which
 * always start with `claude-` or `us.anthropic.`).
 */

/** Stable identifier of a registered provider plugin. */
export type ProviderPluginId = string

/** A model reference namespaced by provider organization: `${organization}/${modelId}`. */
export type ProviderModelRef = string

/**
 * Encode a provider-scoped model reference.
 *
 * @param providerId - provider instance id, e.g. `WorkOpenAI`, `LocalOllama`
 * @param modelId - provider-specific model id, e.g. `gpt-4o`
 */
export function encodeModelRef(providerId: string, modelId: string): ProviderModelRef {
  return `${providerNamespace(providerId)}/${modelId}`
}

/** Stable lowercase namespace used in model refs and per-instance cache keys. */
export function providerNamespace(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

/**
 * Decode a provider-scoped model reference, or return `null` if it does not
 * have the `${providerId}::${modelId}` shape. A reference without a `::`
 * separator is a plain (non-namespaced) model name and decodes to `null`.
 */
export function parseModelRef(ref: string): { providerId: string; modelId: string } | null {
  const legacy = ref.indexOf('::')
  if (legacy > 0 && legacy < ref.length - 2) {
    return { providerId: providerNamespace(ref.slice(0, legacy)), modelId: ref.slice(legacy + 2) }
  }
  const slash = ref.indexOf('/')
  if (slash <= 0 || slash === ref.length - 1) return null
  return { providerId: providerNamespace(ref.slice(0, slash)), modelId: ref.slice(slash + 1) }
}

/** Human-readable name of the provider (workflow engine derives plan/advisories from this). */
export interface ProviderPluginInfo {
  id: ProviderPluginId
  name: string
}

/** Authentication result returned by a plugin's `authenticate`. */
export interface ProviderAuthResult {
  ok: boolean
  /** Stable error code when `ok` is false; see src/provider/errors.ts for known codes. */
  code?: string
  message?: string
}

/** Capability descriptor for a discovered model. "Unknown" fields stay `undefined`. */
export type ModelCapability =
  | 'chat'
  | 'vision'
  | 'tools'
  | 'reasoning'
  | 'audio-input'
  | 'audio-output'
  | 'embeddings'
  | 'streaming'

/**
 * A discovered model from a provider. Every field the provider API did not
 * return must be left `undefined`, not fabricated. Local inference can add to
 * `metadata` but must stay distinguishable from provider-reported data.
 */
export interface ModelDescriptor {
  providerId: ProviderPluginId
  modelId: string
  displayName: string
  /** Provider-reported context window; `undefined` when unknown. */
  contextWindow?: number
  /** Provider-reported max output tokens; `undefined` when unknown. */
  maxOutputTokens?: number
  capabilities: ModelCapability[]
  metadata?: Record<string, unknown>
}

/** How a model's context window / capability was determined. */
export type CapabilitySource =
  /** Reported directly by the provider API. */
  | 'api'
  /** From the plugin's built-in, locally-maintained model metadata map. */
  | 'local-model-index'
  /** Unknown — not reported and not in any local index. */
  | 'unknown'

/** Authentication configuration for a user-added provider instance. */
export type ProviderAuthConfig =
  | { type: 'apiKey'; apiKeyRef: string; baseUrl?: string }
  | { type: 'oauth'; clientIdRef?: string }
  | { type: 'env'; envVar: string; baseUrl?: string }
  | { type: 'none' }

/**
 * A user-configured provider instance. Same plugin may be added multiple times
 * (e.g. two OpenAI accounts) — each is a distinct `id`.
 */
export interface ProviderInstance {
  /** Unique instance id, e.g. a uuid or `openai-2`. */
  id: string
  /** Id of the registered provider plugin this instance uses. */
  providerId: ProviderPluginId
  displayName: string
  enabled: boolean
  config: ProviderConfig
  createdAt: string
  updatedAt: string
}

/** Free-form provider config carried by an instance. Auth fields are *refs* (never raw keys). */
export interface ProviderConfig {
  auth: ProviderAuthConfig
  /** Optional per-instance overrides, e.g. custom `baseUrl`, extra headers, org/project id. */
  apiUrl?: string
  modelListPath?: string
  chatStyle?: 'chat-completions' | 'responses'
  extraHeaders?: Record<string, string>
  organizationId?: string
  projectId?: string
  /** For OpenAI-compatible endpoints without a working `/v1/models` — user-filled ids. */
  manualModels?: string[]
  /**
   * Ordered fallback chain of model refs to try when this instance's models
   * degrade. Entries may span providers or end in a bare native `claude-*` id.
   */
  fallback?: string[]
}

/** One window/slot of a quota snapshot. */
export interface QuotaWindow {
  type:
    | 'credits'
    | 'spend'
    | 'requests'
    | 'tokens'
    | 'requests-per-minute'
    | 'tokens-per-minute'
    | 'custom'
  used?: number
  remaining?: number
  limit?: number
  unit?: string
  resetAt?: string
  /** How this value was obtained — never pretend a local estimate is API-given. */
  source: 'api' | 'response-headers' | 'local-estimate'
}

/** Best-effort quota snapshot. Never fabricate — use status to signal unknowns. */
export interface QuotaSnapshot {
  status: 'available' | 'partial' | 'unsupported' | 'error'
  fetchedAt: string
  windows: QuotaWindow[]
  message?: string
}

/** Provider health snapshot. */
export interface ProviderHealth {
  providerId: ProviderPluginId
  status: 'ok' | 'degraded' | 'down' | 'unknown'
  latencyMs?: number
  lastCheckedAt: string
  message?: string
}

/** Persisted outcome of a model-list scan, so the UI can show the last error. */
export interface ScanCache {
  ok: boolean
  error?: string
  modelCount: number
  scannedAt: string
}

/** Unified request passed to a plugin's `chat`. */
export interface ProviderChatRequest {
  model: string
  messages: ProviderChatMessage[]
  maxTokens?: number
  temperature?: number
  tools?: unknown[]
  system?: string
}

/** Minimal chat message shape, intentionally provider-agnostic. */
export interface ProviderChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** Unified chat response (MVP — non-streaming). */
export interface ProviderChatResponse {
  content: string
  model: string
  usage?: { inputTokens?: number; outputTokens?: number }
}

/**
 * The plugin contract. Every provider integration implements this and is
 * registered via {@link ProviderRegistry}. Add a new provider by registering
 * another implementation — never by adding `if/else` branches elsewhere.
 */
export interface ProviderPlugin {
  readonly id: ProviderPluginId
  readonly name: string
  authenticate(config: ProviderConfig): Promise<ProviderAuthResult>
  listModels(config: ProviderConfig): Promise<ModelDescriptor[]>
  getQuota?(config: ProviderConfig): Promise<QuotaSnapshot>
  healthCheck?(config: ProviderConfig): Promise<ProviderHealth>
  chat(config: ProviderConfig, request: ProviderChatRequest): Promise<ProviderChatResponse>
}
