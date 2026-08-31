/**
 * Zod schemas for the multi-provider layer.
 *
 * These are the single validation source for user-configurable data
 * (provider instances) and for cache-round-tripped model/quota/health data.
 * Schemas are wrapped with `lazySchema` so they are not constructed at module
 * load unless actually needed (mirrors src/utils/model/modelCapabilities.ts).
 */
import { z } from 'zod/v4'
import { lazySchema } from '../utils/lazySchema.js'

const optionalUrl = z
  .string()
  .url()
  .optional()

const authConfigLiteral = z.union([
  z.object({ type: z.literal('apiKey'), apiKeyRef: z.string(), baseUrl: optionalUrl }),
  z.object({ type: z.literal('oauth'), clientIdRef: z.string().optional() }),
  z.object({ type: z.literal('env'), envVar: z.string(), baseUrl: optionalUrl }),
  z.object({ type: z.literal('none') }),
])

export const ProviderConfigSchema = lazySchema(() =>
  z.object({
    auth: authConfigLiteral,
    apiUrl: z.string().url().optional(),
    modelListPath: z.string().optional(),
    chatStyle: z.enum(['chat-completions', 'responses']).optional(),
    extraHeaders: z.record(z.string()).optional(),
    organizationId: z.string().optional(),
    projectId: z.string().optional(),
    manualModels: z.array(z.string()).optional(),
    fallback: z.array(z.string()).optional(),
  }),
)

export const ProviderInstanceSchema = lazySchema(() =>
  z
    .object({
      id: z.string(),
      providerId: z.string(),
      displayName: z.string(),
      enabled: z.boolean(),
      config: ProviderConfigSchema(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .strip(),
)

export const ModelDescriptorSchema = lazySchema(() =>
  z
    .object({
      providerId: z.string(),
      modelId: z.string(),
      displayName: z.string(),
      contextWindow: z.number().optional(),
      maxOutputTokens: z.number().optional(),
      capabilities: z.array(
        z.enum([
          'chat',
          'vision',
          'tools',
          'reasoning',
          'audio-input',
          'audio-output',
          'embeddings',
          'streaming',
        ]),
      ),
      metadata: z.record(z.unknown()).optional(),
    })
    .strip(),
)

export const QuotaWindowSchema = lazySchema(() =>
  z
    .object({
      type: z.enum([
        'credits',
        'spend',
        'requests',
        'tokens',
        'requests-per-minute',
        'tokens-per-minute',
        'custom',
      ]),
      used: z.number().optional(),
      remaining: z.number().optional(),
      limit: z.number().optional(),
      unit: z.string().optional(),
      resetAt: z.string().optional(),
      source: z.enum(['api', 'response-headers', 'local-estimate']),
    })
    .strip(),
)

export const QuotaSnapshotSchema = lazySchema(() =>
  z
    .object({
      status: z.enum(['available', 'partial', 'unsupported', 'error']),
      fetchedAt: z.string(),
      windows: z.array(QuotaWindowSchema()),
      message: z.string().optional(),
    })
    .strip(),
)

export const ProviderHealthSchema = lazySchema(() =>
  z
    .object({
      providerId: z.string(),
      status: z.enum(['ok', 'degraded', 'down', 'unknown']),
      latencyMs: z.number().optional(),
      lastCheckedAt: z.string(),
      message: z.string().optional(),
    })
    .strip(),
)

export const ScanCacheSchema = lazySchema(() =>
  z
    .object({
      ok: z.boolean(),
      error: z.string().optional(),
      modelCount: z.number(),
      scannedAt: z.string(),
    })
    .strip(),
)
