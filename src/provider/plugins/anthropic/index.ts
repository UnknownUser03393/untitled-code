/**
 * Anthropic provider plugin.
 *
 * Uses the `@anthropic-ai/sdk` directly with a per-instance client. Model
 * discovery goes through `models.list()`. This plugin is independent from the
 * base's bespoke `claude.ts` streaming pipeline (which is Anthropic-format
 * specific); this is a provider-agnostic plugin that can be routed/listed.
 */
import Anthropic from '@anthropic-ai/sdk'
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
import { ProviderConfigError } from '../../errors.js'
import { resolveProviderCredential } from '../../credentials.js'
import {
  builtinToDescriptor,
  type BuiltinModel,
  CHAT_TOOLS_CAPABILITIES,
  VISION_CAPABILITIES,
} from '../common.js'

const BUILTIN: BuiltinModel[] = [
  { id: 'claude-opus-4-6', displayName: 'Claude Opus 4.6', contextWindow: 200000, maxOutputTokens: 32000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', contextWindow: 200000, maxOutputTokens: 64000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'claude-sonnet-4-5', displayName: 'Claude Sonnet 4.5', contextWindow: 200000, maxOutputTokens: 64000, capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', contextWindow: 200000, maxOutputTokens: 32000, capabilities: CHAT_TOOLS_CAPABILITIES },
]

const DEEPSEEK_BUILTIN: BuiltinModel[] = [
  { id: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', capabilities: CHAT_TOOLS_CAPABILITIES },
  { id: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', capabilities: CHAT_TOOLS_CAPABILITIES },
  {
    id: 'deepseek-v4-flash-vision-exp',
    displayName: 'DeepSeek V4 Flash Vision Exp',
    capabilities: VISION_CAPABILITIES,
  },
]

function apiKey(config: ProviderConfig): string {
  const auth = config.auth
  if (auth.type === 'apiKey') {
    const value = resolveProviderCredential(auth.apiKeyRef)
    if (value) return value
    throw new ProviderConfigError(`Credential unavailable: ${auth.apiKeyRef}`)
  }
  if (auth.type === 'env') {
    const v = resolveProviderCredential(`env:${auth.envVar}`)
    if (v) return v
    throw new ProviderConfigError(`Environment not set: ${auth.envVar}`)
  }
  // Fall back to ambient env so a plugin instance with 'none' still works in dev.
  const ambient = process.env.ANTHROPIC_API_KEY
  if (ambient) return ambient
  throw new ProviderConfigError('Anthropic requires an API key')
}

function baseUrl(config: ProviderConfig): string {
  const authBaseUrl = config.auth.type === 'apiKey' ? config.auth.baseUrl : undefined
  return config.apiUrl || authBaseUrl || undefined
}

function builtinCatalog(config: ProviderConfig): BuiltinModel[] {
  const url = baseUrl(config)
  if (!url) return BUILTIN
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    if (hostname === 'api.anthropic.com') return BUILTIN
    if (hostname === 'api.deepseek.com' || hostname.endsWith('.api.deepseek.com')) {
      return DEEPSEEK_BUILTIN
    }
  } catch {
    // An invalid/custom URL has no safe local catalog; rely on its API/manual ids.
  }
  return []
}

function makeClient(config: ProviderConfig): Anthropic {
  const apiKeyValue = apiKey(config)
  const baseURL = baseUrl(config)
  const clientConfig: ConstructorParameters<typeof Anthropic>[0] = { apiKey: apiKeyValue }
  if (baseURL) clientConfig.baseURL = baseURL
  return new Anthropic(clientConfig)
}

export const anthropicProvider: ProviderPlugin = {
  id: 'anthropic',
  name: 'Anthropic',

  async authenticate(config): Promise<ProviderAuthResult> {
    try {
      const client = makeClient(config)
      await client.models.list({ limit: 1 })
      return { ok: true }
    } catch (error) {
      return { ok: false, code: 'AUTH_ERROR', message: error instanceof Error ? error.message : 'unknown' }
    }
  },

  async listModels(config): Promise<ModelDescriptor[]> {
    const client = makeClient(config)
    const result = new Map<string, ModelDescriptor>()
    const localCatalog = builtinCatalog(config)
    for (const m of localCatalog) result.set(m.id, builtinToDescriptor('anthropic', m))
    // Manually-added ids always win, so providers whose endpoint doesn't expose
    // a working model-list are still fully usable — no fixed claude-* ceiling.
    for (const manual of config.manualModels ?? []) {
      result.set(manual, builtinToDescriptor('anthropic', { id: manual, displayName: manual }))
    }
    try {
      for await (const entry of client.models.list()) {
        const id = entry.id
        if (id && !result.has(id)) {
          const known = localCatalog.find(b => b.id === id)
          result.set(
            id,
            builtinToDescriptor('anthropic', {
              id,
              displayName: known?.displayName ?? id,
              contextWindow: known?.contextWindow ?? entry.max_output_tokens,
              maxOutputTokens: entry.max_tokens,
              capabilities: known?.capabilities ?? CHAT_TOOLS_CAPABILITIES,
            }),
          )
        }
      }
    } catch {
      // best-effort discovery; keep the built-in table + manual ids
    }
    return [...result.values()]
  },

  async getQuota(): Promise<QuotaSnapshot> {
    // Anthropic exposes rate limits via response headers on real requests, not a
    // balance API. Report unsupported rather than fabricating a value.
    return {
      status: 'unsupported',
      fetchedAt: new Date().toISOString(),
      windows: [],
      message: 'Anthropic does not expose a public quota API',
    }
  },

  async healthCheck(config): Promise<ProviderHealth> {
    const started = Date.now()
    try {
      const client = makeClient(config)
      await client.models.list({ limit: 1 })
      return { providerId: 'anthropic', status: 'ok', latencyMs: Date.now() - started, lastCheckedAt: new Date().toISOString() }
    } catch (error) {
      return { providerId: 'anthropic', status: 'down', lastCheckedAt: new Date().toISOString(), message: error instanceof Error ? error.message : 'unreachable' }
    }
  },

  async chat(config, request: ProviderChatRequest): Promise<ProviderChatResponse> {
    const client = makeClient(config)
    const system = request.system ? request.system : undefined
    const res = await client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      system,
      messages: request.messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    })
    const content = res.content.map(b => (b.type === 'text' ? b.text : '')).join('')
    return {
      content,
      model: request.model,
      usage: { inputTokens: res.usage?.input_tokens, outputTokens: res.usage?.output_tokens },
    }
  },
}
