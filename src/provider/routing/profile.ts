/**
 * Built-in routing profiles.
 *
 * Each profile is a named set of deterministic filters + a sort. These are
 * always based on known metadata, never on fabricated quota values.
 */
import type { RoutingProfile } from './types.js'

/** Default: prioritize declared user priority, then lower cost, then name. */
export const DEFAULT_PROFILE: RoutingProfile = {
  name: 'priority',
  filters: [],
  sort: (a, b) => {
    const pa = a.priority ?? 0
    const pb = b.priority ?? 0
    if (pa !== pb) return pa - pb
    const ca = a.costHint ?? 0
    const cb = b.costHint ?? 0
    if (ca !== cb) return ca - cb
    return a.ref.localeCompare(b.ref)
  },
}

/** Cost-first: only candidates with a known cost hint, cheapest first. */
export const COST_FIRST_PROFILE: RoutingProfile = {
  name: 'cost-first',
  filters: [c => typeof c.costHint === 'number'],
  sort: (a, b) => (a.costHint ?? Infinity) - (b.costHint ?? Infinity),
}

/** Best-capability-first: more capabilities and larger context win, ties on name. */
export const BEST_CAPABILITY_PROFILE: RoutingProfile = {
  name: 'best-capability',
  filters: [],
  sort: (a, b) => {
    const caps = b.capabilities.length - a.capabilities.length
    if (caps !== 0) return caps
    const ctx = (b.contextWindow ?? 0) - (a.contextWindow ?? 0)
    if (ctx !== 0) return ctx
    return a.ref.localeCompare(b.ref)
  },
}

/** Fastest: only healthy candidates, lowest latency hint first. */
export const FASTEST_PROFILE: RoutingProfile = {
  name: 'fastest',
  filters: [c => c.health === 'ok'],
  sort: (a, b) => (a.latencyHint ?? Infinity) - (b.latencyHint ?? Infinity),
}

export const ROUTING_PROFILES: Record<string, RoutingProfile> = {
  priority: DEFAULT_PROFILE,
  'cost-first': COST_FIRST_PROFILE,
  'best-capability': BEST_CAPABILITY_PROFILE,
  fastest: FASTEST_PROFILE,
}
