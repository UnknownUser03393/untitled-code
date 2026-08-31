/**
 * Generic OpenAI-compatible provider plugin.
 *
 * Most third-party gateways (DeepSeek, Groq, Together, Azure OpenAI, and the
 * user's own compatible endpoint) speak the OpenAI chat-completions wire
 * format. Rather than duplicating logic per vendor, this factory yields a
 * full plugin configured with a base URL + optional built-in model table.
 *
 * @see openaiCompatibleOptions for the shared config shape.
 */
import type {
  ModelDescriptor,
  ProviderAuthResult,
  ProviderChatRequest,
  ProviderChatResponse,
  ProviderConfig,
  ProviderHealth,
  ProviderPlugin,
  QuotaSnapshot,
} from '../../types.js'
import { requestJson } from '../../http.js'
import { ProviderConfigError, ProviderAuthError } from '../../errors.js'
import { resolveProviderCredential } from '../../credentials.js'
import { builtinToDescriptor, type BuiltinModel } from '../common.js'

export interface OpenAiCompatibleOptions {
  /** Plugin id, e.g. `deepseek`, `groq`, `together`, `azure-openai`. */
  id: string
  name: string
  /** Default base URL used when the instance does not override it. */
  baseUrl: string
  /** Optional known models (context/caps) for nicer display without a key. */
  builtin?: BuiltinModel[]
  /** Default chat style; overridable per instance. */
  chatStyle?: 'chat-completions' | 'responses'
  /** Set true for keyless endpoints (e.g. local Ollama); skips auth entirely. */
  noAuth?: boolean
}

export function createOpenAiCompatiblePlugin(opts: OpenAiCompatibleOptions): ProviderPlugin {
  function apiKey(config: ProviderConfig): string {
    if (opts.noAuth) return ''
    const auth = config.auth
    if (auth.type === 'none') throw new ProviderConfigError(`${opts.name} requires an API key`)
    if (auth.type === 'env') {
      const v = resolveProviderCredential(`env:${auth.envVar}`)
      if (v) return v
      throw new ProviderAuthError(`Environment variable ${auth.envVar} not set`)
    }
    if (auth.type === 'apiKey') {
      const v = resolveProviderCredential(auth.apiKeyRef)
      if (v) return v
      throw new ProviderAuthError(`Credential unavailable: ${auth.apiKeyRef}`)
    }
    throw new ProviderConfigError('Unsupported auth type')
  }

  function baseUrl(config: ProviderConfig): string {
    const authBaseUrl = config.auth.type === 'apiKey' ? config.auth.baseUrl : undefined
    return config.apiUrl || authBaseUrl || opts.baseUrl
  }

  function headersFor(config: ProviderConfig, _key: string): Record<string, string> {
    if (opts.noAuth) return { 'Content-Type': 'application/json', ...(config.extraHeaders ?? {}) }
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${_key}`,
      ...(config.extraHeaders ?? {}),
    }
  }

  function modelListPath(config: ProviderConfig): string {
    return config.modelListPath || '/models'
  }

  // Azure OpenAI uses an api-version query param on the deployment path.
  function chatEndpoint(config: ProviderConfig): string {
    return `${baseUrl(config)}/chat/completions`
  }

  return {
    id: opts.id,
    name: opts.name,

    async authenticate(config): Promise<ProviderAuthResult> {
      try {
        const key = apiKey(config)
        await requestJson({
          url: `${baseUrl(config)}${modelListPath(config)}`,
          headers: headersFor(config, key),
          timeoutMs: 8000,
        })
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          code: 'AUTH_ERROR',
          message: error instanceof Error ? error.message : 'unknown',
        }
      }
    },

    async listModels(config): Promise<ModelDescriptor[]> {
      let key: string
      try {
        key = apiKey(config)
      } catch (error) {
        const fallback = [...(opts.builtin ?? []), ...(config.manualModels ?? []).map(id => ({ id, displayName: id }))]
        if (fallback.length > 0) return fallback.map(model => builtinToDescriptor(opts.id, model))
        throw error
      }
      let providerReported: ModelDescriptor[] = []
      try {
        const res = await requestJson({
          url: `${baseUrl(config)}${modelListPath(config)}`,
          headers: headersFor(config, key),
        })
        const data = (res.body as { data?: Array<{ id: string }> }).data
        if (Array.isArray(data)) {
          providerReported = data
            .filter(d => typeof d.id === 'string')
            .map(d => builtinToDescriptor(opts.id, { id: d.id, displayName: d.id }))
        }
      } catch {
        // Provider may not implement /v1/models — if the user supplied manual
        // models, fall back to them; otherwise degrade to built-in table.
        providerReported = []
      }

      const result = new Map<string, ModelDescriptor>()
      for (const m of opts.builtin ?? []) result.set(m.id, builtinToDescriptor(opts.id, m))
      for (const d of providerReported) if (!result.has(d.modelId)) result.set(d.modelId, d)
      for (const manual of config.manualModels ?? []) {
        if (!result.has(manual)) {
          result.set(manual, builtinToDescriptor(opts.id, { id: manual, displayName: manual }))
        }
      }
      return [...result.values()]
    },

    async getQuota(config): Promise<QuotaSnapshot> {
      // Best-effort: read rate-limit headers only on real requests. No public
      // balance API for these gateways, so report unsupported (never "unlimited").
      return {
        status: 'unsupported',
        fetchedAt: new Date().toISOString(),
        windows: [],
        message: `${opts.name} does not expose a public quota API`,
      }
    },

    async healthCheck(config): Promise<ProviderHealth> {
      const started = Date.now()
      try {
        const key = apiKey(config)
        await requestJson({
          url: `${baseUrl(config)}${modelListPath(config)}`,
          headers: headersFor(config, key),
          timeoutMs: 8000,
        })
        return {
          providerId: opts.id,
          status: 'ok',
          latencyMs: Date.now() - started,
          lastCheckedAt: new Date().toISOString(),
        }
      } catch (error) {
        return {
          providerId: opts.id,
          status: 'down',
          lastCheckedAt: new Date().toISOString(),
          message: error instanceof Error ? error.message : 'unreachable',
        }
      }
    },

    async chat(config, request: ProviderChatRequest): Promise<ProviderChatResponse> {
      const key = apiKey(config)
      const res = await requestJson({
        url: chatEndpoint(config),
        method: 'POST',
        headers: headersFor(config, key),
        body: JSON.stringify({
          model: request.model,
          messages: request.messages.map(m => ({ role: m.role, content: m.content })),
          max_tokens: request.maxTokens,
          temperature: request.temperature,
        }),
      })
      const data = res.body as {
        choices?: Array<{ message?: { content?: string } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        model: request.model,
        usage: {
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
        },
      }
    },
  }
}
