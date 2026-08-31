import { describe, expect, test } from 'vitest'
import {
  buildRequiredFilters,
  isCandidateAvailable,
  routeToCandidate,
  sortCandidates,
  tryRouteWithFallback,
} from '../routing/index.js'
import { COST_FIRST_PROFILE, DEFAULT_PROFILE } from '../routing/profile.js'
import type { RoutingCandidate } from '../routing/types.js'

function candidate(partial: Partial<RoutingCandidate>): RoutingCandidate {
  return {
    providerId: 'openai',
    modelId: 'gpt-4o',
    ref: 'openai::gpt-4o',
    displayName: 'GPT-4o',
    capabilities: ['chat', 'tools'],
    ...partial,
  }
}

describe('availability & filters', () => {
  test('down/unknown health are unavailable', () => {
    expect(isCandidateAvailable(candidate({ health: 'down' }))).toBe(false)
    expect(isCandidateAvailable(candidate({ health: 'unknown' }))).toBe(false)
    expect(isCandidateAvailable(candidate({ health: 'ok' }))).toBe(true)
    expect(isCandidateAvailable(candidate({}))).toBe(true)
  })

  test('capability filter drops models missing a required capability', () => {
    const filters = buildRequiredFilters({ requiredCapabilities: ['vision'] })
    const noVision = candidate({ capabilities: ['chat'] })
    const withVision = candidate({ capabilities: ['chat', 'vision'] })
    expect(filters.every(f => f(noVision))).toBe(false)
    expect(filters.every(f => f(withVision))).toBe(true)
  })

  test('providerIds filter restricts to listed providers', () => {
    const filters = buildRequiredFilters({ providerIds: ['gemini'] })
    expect(filters.every(f => f(candidate({ providerId: 'openai' })))).toBe(false)
    expect(filters.every(f => f(candidate({ providerId: 'gemini' })))).toBe(true)
  })
})

describe('sort & select', () => {
  test('priority sorts ascending (lower preferred)', () => {
    const a = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x', priority: 2 })
    const b = candidate({ providerId: 'b', modelId: 'y', ref: 'b::y', priority: 1 })
    expect(sortCandidates([a, b]).map(c => c.ref)).toEqual(['b::y', 'a::x'])
  })

  test('routeToCandidate picks the best-priority available candidate', () => {
    const c1 = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x', priority: 2, health: 'ok' })
    const c2 = candidate({ providerId: 'b', modelId: 'y', ref: 'b::y', priority: 1, health: 'ok' })
    const chosen = routeToCandidate([c1, c2], DEFAULT_PROFILE)
    expect(chosen?.ref).toBe('b::y')
  })

  test('routeToCandidate excludes down health even with best priority', () => {
    const c1 = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x', priority: 1, health: 'down' })
    const c2 = candidate({ providerId: 'b', modelId: 'y', ref: 'b::y', priority: 2, health: 'ok' })
    const chosen = routeToCandidate([c1, c2], DEFAULT_PROFILE)
    expect(chosen?.ref).toBe('b::y')
  })

  test('cost-first profile excludes candidates without a cost hint', () => {
    const noHint = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x' })
    const cheap = candidate({ providerId: 'b', modelId: 'y', ref: 'b::y', costHint: 1 })
    const chosen = routeToCandidate([noHint, cheap], COST_FIRST_PROFILE)
    expect(chosen?.ref).toBe('b::y')
  })
})

describe('fallback order', () => {
  test('tries in priority order and returns first success with attempt log', async () => {
    const c1 = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x', priority: 1 })
    const c2 = candidate({ providerId: 'b', modelId: 'y', ref: 'b::y', priority: 2 })
    let attempt = 0
    const decision = await tryRouteWithFallback(
      [c1, c2],
      {},
      async () => {
        attempt++
        // first candidate fails, second succeeds
        return attempt >= 2
      },
    )
    expect(decision.ok).toBe(true)
    expect(decision.ref).toBe('b::y')
    expect(decision.attempts.map(a => a.ref)).toEqual(['a::x', 'b::y'])
  })

  test('returns readable failure when all candidates fail', async () => {
    const c1 = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x', priority: 1 })
    const decision = await tryRouteWithFallback([c1], {}, async () => false)
    expect(decision.ok).toBe(false)
    expect(decision.reason).toBe('All candidate attempts failed')
  })

  test('reports no-candidate when filters reject everything', async () => {
    const c1 = candidate({ providerId: 'a', modelId: 'x', ref: 'a::x', priority: 1 })
    const decision = await tryRouteWithFallback(
      [c1],
      { providerIds: ['gemini'] },
      async () => true,
    )
    expect(decision.ok).toBe(false)
    expect(decision.reason).toContain('No candidate')
  })
})
