import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { APIError, APIConnectionError, type Anthropic } from '@anthropic-ai/sdk'
import { CannotRetryError, FallbackTriggeredError, withRetry } from '../withRetry.js'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claude-withretry-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
})

function httpError(status: number): APIError {
  return new APIError(status, undefined, 'boom', undefined, undefined)
}

const thinkingConfig = {}

/** Drain the withRetry generator; returns the error it throws, or 'no-error'.
 * maxRetries: 0 forces every error to hit the retry-exhausted branch on the
 * first attempt (no backoff sleeps, fast tests). */
async function run(error: unknown, options: Record<string, unknown>): Promise<unknown> {
  const gen = withRetry(
    async () => null as unknown as Anthropic,
    async () => {
      throw error
    },
    { model: 'openai/gpt-5', thinkingConfig, maxRetries: 0, ...options } as never,
  )
  try {
    for await (const _ of gen) {
      /* drain yields */
    }
    return 'no-error'
  } catch (e) {
    return e
  }
}

describe('hard provider failure fallback (provider-scoped models)', () => {
  test('401 on a provider-scoped model with a chain candidate falls through', async () => {
    const err = await run(httpError(401), { fallbackModel: 'openai/gpt-4o' })
    expect(err).toBeInstanceOf(FallbackTriggeredError)
    const fb = err as FallbackTriggeredError
    expect(fb.originalModel).toBe('openai/gpt-5')
    expect(fb.fallbackModel).toBe('openai/gpt-4o')
    expect(fb.reason).toBe('provider-failure')
  })

  test('connection failure on a provider-scoped model falls through', async () => {
    const conn = new APIConnectionError({ message: 'connection refused' })
    const err = await run(conn, { fallbackModel: 'openai/gpt-4o' })
    expect(err).toBeInstanceOf(FallbackTriggeredError)
    expect((err as FallbackTriggeredError).reason).toBe('provider-failure')
  })

  test('native (non-provider) model does not fall through on 401', async () => {
    const err = await run(httpError(401), { fallbackModel: 'claude-sonnet-4-6', model: 'claude-opus-4-6' })
    expect(err).toBeInstanceOf(CannotRetryError)
  })

  test('provider-scoped model with no next candidate surfaces CannotRetryError', async () => {
    const err = await run(httpError(401), {})
    expect(err).toBeInstanceOf(CannotRetryError)
  })
})

describe('529 overload fallback (unchanged)', () => {
  test('529 exhaustion on a provider-scoped model throws an overload fallback', async () => {
    const err = await run(httpError(529), { fallbackModel: 'openai/gpt-4o', initialConsecutive529Errors: 2 })
    expect(err).toBeInstanceOf(FallbackTriggeredError)
    expect((err as FallbackTriggeredError).reason).toBe('overload')
  })
})
