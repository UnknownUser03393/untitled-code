/**
 * Deterministic routing.
 *
 * No AI here — just a reproducible, testable filter pipeline. Candidates are
 * ordered by user priority, then scored. Fallback tries the next candidate in
 * order until one succeeds (caller supplies the attempt function, which in MVP
 * is a mock).
 */
import type {
  RoutingCandidate,
  RoutingDecision,
  RoutingFilter,
  RoutingOptions,
  RoutingProfile,
} from './types.js'

/** True if a candidate should be considered at all (pre-profile base filter). */
export function isCandidateAvailable(candidate: RoutingCandidate): boolean {
  if (candidate.health === 'down' || candidate.health === 'unknown') return false
  return true
}

/** Build the default filter set from RoutingOptions. */
export function buildRequiredFilters(opts: RoutingOptions): RoutingFilter[] {
  const filters: RoutingFilter[] = []

  if (opts.providerIds && opts.providerIds.length > 0) {
    filters.push(c => opts.providerIds!.includes(c.providerId))
  }

  if (opts.requireHealthy !== false) {
    filters.push(isCandidateAvailable)
  }

  if (opts.requiredCapabilities && opts.requiredCapabilities.length > 0) {
    filters.push(c =>
      opts.requiredCapabilities!.every(cap => c.capabilities.includes(cap)),
    )
  }

  if (opts.minContextWindow !== undefined) {
    filters.push(c =>
      c.contextWindow === undefined || c.contextWindow >= opts.minContextWindow!,
    )
  }

  return filters
}

/** Sort candidates: priority first (lower = preferred), then name for stability. */
export function sortCandidates(candidates: RoutingCandidate[]): RoutingCandidate[] {
  return [...candidates].sort((a, b) => {
    const pa = a.priority ?? 0
    const pb = b.priority ?? 0
    if (pa !== pb) return pa - pb
    return a.ref.localeCompare(b.ref)
  })
}

/**
 * Deterministically select a candidate that satisfies profile + options.
 * Returns `undefined` when none qualify.
 */
export function routeToCandidate(
  candidates: RoutingCandidate[],
  profile: RoutingProfile,
  opts: RoutingOptions = {},
): RoutingCandidate | undefined {
  const filters = [...buildRequiredFilters(opts), ...profile.filters]
  let pool = candidates.filter(c => filters.every(f => f(c)))
  if (profile.sort) {
    pool = [...pool].sort(profile.sort)
  }
  return pool[0]
}

/**
 * Try candidates in priority order, invoking `onAttempt` for each until one
 * succeeds. Records every attempt and returns a readable decision.
 */
export async function tryRouteWithFallback(
  candidates: RoutingCandidate[],
  opts: RoutingOptions,
  onAttempt: (candidate: RoutingCandidate) => Promise<boolean>,
): Promise<RoutingDecision> {
  const ordered = sortCandidates(candidates)
  const pool = ordered.filter(c => buildRequiredFilters(opts).every(f => f(c)))

  const attempts: RoutingCandidate[] = []
  if (pool.length === 0) {
    return {
      ref: '',
      providerId: '',
      modelId: '',
      displayName: '',
      attempts: [],
      reason: 'No candidate satisfied the route filters',
      ok: false,
    }
  }

  for (const candidate of pool) {
    attempts.push(candidate)
    // eslint-disable-next-line no-await-in-loop
    const ok = await onAttempt(candidate)
    if (ok) {
      return {
        ref: candidate.ref,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        displayName: candidate.displayName,
        attempts,
        reason: `Selected ${candidate.displayName}`,
        ok: true,
      }
    }
  }

  return {
    ref: '',
    providerId: '',
    modelId: '',
    displayName: '',
    attempts,
    reason: 'All candidate attempts failed',
    ok: false,
  }
}
