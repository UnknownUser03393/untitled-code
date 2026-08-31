/**
 * Google Gemini provider — native `generateContent` API.
 *
 * Gemini is not OpenAI-compatible; it uses `POST /v1beta/models/{model}:generateContent`
 * with `x-goog-api-key`. Model discovery is best-effort via models.list; a
 * built-in table covers known models.
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
import { ProviderConfigError } from '../../errors.js'
import { resolveProviderCredential } from '../../credentials.js'
import { builtinToDescriptor, type BuiltinModel, CHAT_TOOLS_CAPABILITIES } from '../common.js'

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

const BUILTIN: BuiltinModel[] = [
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 1048576, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', contextWindow: 1048576, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', contextWindow: 1048576, capabilities: CHAT_TOOLS_CAPABILITIES },
]

function apiKey(config: ProviderConfig): string {
  const auth = config.auth
  if (auth.type === 'apiKey') {
    const v = resolveProviderCredential(auth.apiKeyRef)
    if (v) return v
  }
  if (auth.type === 'env') {
    const v = resolveProviderCredential(`env:${auth.envVar}`)
    if (v) return v
  }
  throw new ProviderConfigError('Gemini requires an API key')
}

function baseUrl(config: ProviderConfig): string {
  return config.apiUrl || (config.auth.type === 'apiKey' && config.auth.baseUrl) || BASE_URL
}

function headersFor(config: ProviderConfig, key: string): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': key, ...(config.extraHeaders ?? {}) }
}

export const geminiProvider: ProviderPlugin = {
  id: 'gemini',
  name: 'Google Gemini',

  async authenticate(config): Promise<ProviderAuthResult> {
    try {
      const key = apiKey(config)
      await requestJson({ url: `${baseUrl(config)}/models`, headers: headersFor(config, key), timeoutMs: 8000 })
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'AUTH_ERROR', message: error instanceof Error ? error.message : 'unknown' }
    }
  },

  async listModels(config): Promise<ModelDescriptor[]> {
    const key = apiKey(config)
    const result = new Map<string, ModelDescriptor>()
    for (const m of BUILTIN) result.set(m.id, builtinToDescriptor('gemini', m))
    try {
      const res = await requestJson({ url: `${baseUrl(config)}/models`, headers: headersFor(config, key) })
      const data = (res.body as { models?: Array<{ name: string; displayName?: string }> }).models
      if (Array.isArray(data)) {
        for (const d of data) {
          // gemini model names look like `models/gemini-2.5-pro`
          const id = d.name?.replace(/^models\//, '')
          if (id && !result.has(id)) {
            result.set(id, builtinToDescriptor('gemini', { id, displayName: d.displayName || id }))
          }
        }
      }
    } catch {
      // best-effort; keep built-in table
    }
    return [...result.values()]
  },

  async getQuota(): Promise<QuotaSnapshot> {
    return {
      status: 'unsupported',
      fetchedAt: new Date().toISOString(),
      windows: [],
      message: 'Gemini does not expose a public quota API',
    }
  },

  async healthCheck(config): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      const key = apiKey(config)
      await requestJson({ url: `${baseUrl(config)}/models`, headers: headersFor(config, key), timeoutMs: 8000 })
      return { providerId: 'gemini', status: 'ok', latencyMs: Date.now() - started, lastCheckedAt: new Date().toISOString() }
    } catch (error) {
      return { providerId: 'gemini', status: 'down', lastCheckedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'unreachable' }
    }
  },

  async chat(config, request: ProviderChatRequest): Promise<ProviderChatResponse> {
    const key = apiKey(config)
    const url = `${baseUrl(config)}/models/${request.model}:generateContent`
    const res = await requestJson({
      url,
      method: 'POST',
      headers: headersFor(config, key),
      body: JSON.stringify({
        contents: request.messages.map(m => ({ role: m.role === 'assistant' ? 'model' : m.role, parts: [{ text: m.content }] })),
      }),
    })
    const data = res.body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    const content = data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? ''
    return { content, model: request.model }
  },
}
