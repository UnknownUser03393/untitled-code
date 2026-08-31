/**
 * Shared helpers for provider plugins.
 *
 * Contains the built-in model index shape (mirrors the `Record<providerId, string>`
 * pattern in src/utils/model/configs.ts) and small pure helpers plugins reuse.
 */
import type { ModelCapability, ModelDescriptor } from '../types.js'

/** A built-in model entry known to a provider, without a network round-trip. */
export interface BuiltinModel {
  /** Provider-specific model id, e.g. `gpt-4o` or `gemini-2.5-pro`. */
  id: string
  displayName: string
  contextWindow?: number
  maxOutputTokens?: number
  capabilities?: ModelCapability[]
}

/**
 * Build a {@link ModelDescriptor} from a built-in model entry. Source is
 * 'local-model-index' — these are locally-maintained metadata, not
 * provider-reported, so callers can distinguish them from scanned models.
 */
export function builtinToDescriptor(providerId: string, model: BuiltinModel): ModelDescriptor {
  return {
    providerId,
    modelId: model.id,
    displayName: model.displayName,
    contextWindow: model.contextWindow,
    maxOutputTokens: model.maxOutputTokens,
    capabilities: model.capabilities ?? ['chat', 'streaming'],
    metadata: { source: 'local-model-index' as const },
  }
}

/** Common capabilities for a text+chat model with tools + streaming. */
export const CHAT_TOOLS_CAPABILITIES: ModelCapability[] = [
  'chat',
  'tools',
  'streaming',
]

/** Capabilities for a vision-capable model. */
export const VISION_CAPABILITIES: ModelCapability[] = [
  'chat',
  'tools',
  'vision',
  'streaming',
]
