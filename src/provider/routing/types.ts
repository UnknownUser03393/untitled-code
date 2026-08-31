/**
 * Routing types and model-ref primitives.
 */
import type {
  ModelCapability,
  ProviderHealth,
  ProviderModelRef,
  QuotaSnapshot,
} from '../types.js'

/** A single candidate for routing, derived from a discovered model + health/quota. */
export interface RoutingCandidate {
  providerId: string
  modelId: string
  ref: ProviderModelRef
  displayName: string
  /** Explicitly-unknown fields stay undefined — never fabricated. */
  contextWindow?: number
  maxOutputTokens?: number
  capabilities: ModelCapability[]
  /** Health status of the provider; used to drop unavailable candidates. */
  health?: ProviderHealth['status']
  quota?: QuotaSnapshot
  /** User-configured priority; lower is preferred. */
  priority?: number
  /** Cost hints (per million tokens), if known — never invented. */
  costHint?: number
  latencyHint?: number
}

/** A deterministic predicate that keeps or drops a candidate. */
export type RoutingFilter = (candidate: RoutingCandidate) => boolean

/** A named set of filters + a tie-break sort. */
export interface RoutingProfile {
  name: string
  filters: RoutingFilter[]
  sort?: (a: RoutingCandidate, b: RoutingCandidate) => number
}

/** Result of a routing decision. */
export interface RoutingDecision {
  ref: ProviderModelRef
  providerId: string
  modelId: string
  displayName: string
  /** Ordered list of fallback attempts that were tried (including the first). */
  attempts: RoutingCandidate[]
  /** Reason for selecting (or why none were selected). */
  reason: string
  ok: boolean
}

export interface RoutingOptions {
  /** ModelId the caller needs, in user-facing terms (e.g. for message routing). */
  requiredCapabilities?: ModelCapability[]
  /** Minimum context window required for the task. */
  minContextWindow?: number
  /** Provider ids to restrict to; empty = all. */
  providerIds?: string[]
  /** Require the provider to be healthy (ok/degraded count as available). */
  requireHealthy?: boolean
}

export type { RoutingCandidate as Candidate }
