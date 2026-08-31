/**
 * OpenAI provider plugin.
 *
 * Implements the full ProviderPlugin contract for OpenAI's API. Model list is
 * fetched from the provider's `/v1/models` endpoint; a built-in table covers
 * well-known models so the UI can render names/context without a live key.
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
import { ProviderAuthError, ProviderConfigError } from '../../errors.js'
import { resolveProviderCredential } from '../../credentials.js'
import {
  builtinToDescriptor,
  type BuiltinModel,
  CHAT_TOOLS_CAPABILITIES,
  VISION_CAPABILITIES,
} from '../common.js'

const BASE_URL = 'https://api.openai.com/v1'

const BUILTIN_MODELS: BuiltinModel[] = [
  { id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, maxOutputTokens: 16384, capabilities: VISION_CAPABILITIES },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', contextWindow: 128000, maxOutputTokens: 16384, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'gpt-4.1', displayName: 'GPT-4.1', contextWindow: 128000, maxOutputTokens: 32768, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'o1', displayName: 'o1', contextWindow: 200000, maxOutputTokens: 100000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'o3-mini', displayName: 'o3-mini', contextWindow: 200000, maxOutputTokens: 100000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'gpt-3.5-turbo', displayName: 'GPT-3.5 Turbo', contextWindow: 16385, maxOutputTokens: 4096, capabilities: CHAT_TOOLS_CAPABILITIES },
]

function apiKey(config: ProviderConfig): string {
  const auth = config.auth
  if (auth.type === 'none') return ''
  if (auth.type === 'env') {
    const v = resolveProviderCredential(`env:${auth.envVar}`)
    if (v) return v
    throw new ProviderAuthError(`Environment variable ${auth.envVar} not set`)
  }
  if (auth.type === 'apiKey') {
    // apiKeyRef is a ref like `env:OPENAI_KEY`; resolve simple env refs, otherwise
    // treat as literal (callers are responsible for never storing raw keys).
    const v = resolveProviderCredential(auth.apiKeyRef)
    if (v) return v
    throw new ProviderAuthError(`Credential unavailable: ${auth.apiKeyRef}`)
  }
  if (auth.type === 'oauth') throw new ProviderAuthError('OpenAI OAuth not supported')
  throw new ProviderConfigError('Unsupported auth type for OpenAI')
}

function baseUrl(config: ProviderConfig): string {
  const authBaseUrl = config.auth.type === 'apiKey' ? config.auth.baseUrl : undefined
  return config.apiUrl || authBaseUrl || BASE_URL
}

function headersFor(config: ProviderConfig, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (key) headers.Authorization = `Bearer ${key}`
  if (config.organizationId) headers['OpenAI-Organization'] = config.organizationId
  if (config.projectId) headers['OpenAI-Project'] = config.projectId
  return { ...headers, ...(config.extraHeaders ?? {}) }
}

function usesOpenAICatalog(config: ProviderConfig): boolean {
  try {
    return new URL(baseUrl(config)).hostname.toLowerCase() === 'api.openai.com'
  } catch {
    return baseUrl(config) === BASE_URL
  }
}

function modelsEndpoint(config: ProviderConfig): string {
  return `${baseUrl(config).replace(/\/$/, '')}/models`
}

export const openAIProvider: ProviderPlugin = {
  id: 'openai',
  name: 'OpenAI',

  async authenticate(config): Promise<ProviderAuthResult> {
    try {
      const key = apiKey(config)
      await requestJson({
        url: modelsEndpoint(config),
        headers: headersFor(config, key),
        timeoutMs: 8000,
      })
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      return { ok: false, code: 'AUTH_ERROR', message }
    }
  },

  async listModels(config): Promise<ModelDescriptor[]> {
    const key = apiKey(config)
    // Built-in table first (for known models), then provider-reported ids merged
    // in. Manually-added ids win, so endpoints without a working /models are
    // still usable — no fixed ceiling.
    const result = new Map<string, ModelDescriptor>()
    if (usesOpenAICatalog(config)) {
      for (const m of BUILTIN_MODELS) result.set(m.id, builtinToDescriptor('openai', m))
    }
    for (const manual of config.manualModels ?? []) {
      result.set(manual, builtinToDescriptor('openai', { id: manual, displayName: manual }))
    }
    try {
      const res = await requestJson({
        url: modelsEndpoint(config),
        headers: headersFor(config, key),
      })
      const data = (res.body as { data?: Array<{ id: string; object?: string }> }).data
      if (Array.isArray(data)) {
        for (const d of data) {
          if (typeof d.id === 'string' && !result.has(d.id)) {
            result.set(d.id, builtinToDescriptor('openai', { id: d.id, displayName: d.id }))
          }
        }
      }
    } catch (error) {
      if (result.size === 0) throw error
    }
    return [...result.values()]
  },

  async getQuota(config): Promise<QuotaSnapshot> {
    // OpenAI has no public balance API for usage-based keys; report unsupported
    // rather than fabricating a value.
    return {
      status: 'unsupported',
      fetchedAt: new Date().toISOString(),
      windows: [],
      message: 'OpenAI does not expose a public quota API',
    }
  },

  async healthCheck(config): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      const key = apiKey(config)
      await requestJson({
        url: modelsEndpoint(config),
        headers: headersFor(config, key),
        timeoutMs: 8000,
      })
      return {
        providerId: 'openai',
        status: 'ok',
        latencyMs: Date.now() - started,
        lastCheckedAt: new Date().toISOString(),
      }
    } catch (error) {
      return {
        providerId: 'openai',
        status: 'down',
        lastCheckedAt: new Date().toISOString(),
        message: error instanceof Error ? error.message : 'unreachable',
      }
    }
  },

  async chat(config, request: ProviderChatRequest): Promise<ProviderChatResponse> {
    const key = apiKey(config)
    const res = await requestJson({
      url: `${baseUrl(config)}/chat/completions`,
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
    const content = data.choices?.[0]?.message?.content ?? ''
    return {
      content,
      model: request.model,
      usage: {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    }
  },
}
