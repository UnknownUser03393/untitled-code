/**
 * Azure OpenAI provider.
 *
 * Azure exposes a "deployment" rather than a "model": the endpoint is
 * `<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=...`.
 * The model id in a request is the **deployment name**, and the resource/api-version
 * come from config. This plugin extends the OpenAI-compatible shape with an
 * Azure-specific chat endpoint builder and model list best-effort.
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

const DEFAULT_API_VERSION = '2024-06-01'

const BUILTIN: BuiltinModel[] = [
  { id: 'gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'gpt-4o-mini', displayName: 'GPT-4o mini', contextWindow: 128000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'gpt-4', displayName: 'GPT-4', contextWindow: 8192, capabilities: CHAT_TOOLS_CAPABILITIES },
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
  throw new ProviderConfigError('Azure OpenAI requires an API key')
}

function resourceUrl(config: ProviderConfig): string {
  const authBaseUrl = config.auth.type === 'apiKey' ? config.auth.baseUrl : undefined
  return config.apiUrl || authBaseUrl || ''
}

function apiVersion(config: ProviderConfig): string {
  // Azure requires api-version; allow override but default.
  return config.extraHeaders?.['api-version'] || DEFAULT_API_VERSION
}

function headersFor(config: ProviderConfig, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-key': key,
  }
  return { ...headers, ...(config.extraHeaders ?? {}) }
}

export const azureOpenAIProvider: ProviderPlugin = {
  id: 'azure-openai',
  name: 'Azure OpenAI',

  async authenticate(config): Promise<ProviderAuthResult> {
    try {
      const key = apiKey(config)
      await requestJson({ url: `${resourceUrl(config)}/models`, headers: headersFor(config, key), timeoutMs: 8000 })
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'AUTH_ERROR', message: error instanceof Error ? error.message : 'unknown' }
    }
  },

  async listModels(config): Promise<ModelDescriptor[]> {
    // Azure does not expose a per-resource model list over the standard path
    // without a deployment; degrade to the built-in table + manual models.
    const result = new Map<string, ModelDescriptor>()
    for (const m of BUILTIN) result.set(m.id, builtinToDescriptor('azure-openai', m))
    for (const manual of config.manualModels ?? []) {
      result.set(manual, builtinToDescriptor('azure-openai', { id: manual, displayName: manual }))
    }
    return [...result.values()]
  },

  async getQuota(): Promise<QuotaSnapshot> {
    return {
      status: 'unsupported',
      fetchedAt: new Date().toISOString(),
      windows: [],
      message: 'Azure OpenAI does not expose a public quota API',
    }
  },

  async healthCheck(config): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      const key = apiKey(config)
      await requestJson({ url: `${resourceUrl(config)}/models`, headers: headersFor(config, key), timeoutMs: 8000 })
      return { providerId: 'azure-openai', status: 'ok', latencyMs: Date.now() - started, lastCheckedAt: new Date().toISOString() }
    } catch (error) {
      return { providerId: 'azure-openai', status: 'down', lastCheckedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'unreachable' }
    }
  },

  async chat(config, request: ProviderChatRequest): Promise<ProviderChatResponse> {
    const key = apiKey(config)
    const url = `${resourceUrl(config)}/openai/deployments/${request.model}/chat/completions?api-version=${apiVersion(config)}`
    const res = await requestJson({
      url,
      method: 'POST',
      headers: headersFor(config, key),
      body: JSON.stringify({
        messages: request.messages.map(m => ({ role: m.role, content: m.content })),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      }),
    })
    const data = res.body as { choices?: Array<{ message?: { content?: string } }> }
    return { content: data.choices?.[0]?.message?.content ?? '', model: request.model }
  },
}
