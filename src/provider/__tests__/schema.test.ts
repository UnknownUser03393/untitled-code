import { describe, expect, test } from 'vitest'
import {
  ProviderInstanceSchema,
  ProviderConfigSchema,
  QuotaSnapshotSchema,
} from '../schema.js'
import type { ProviderInstance } from '../types.js'

function validInstance(): ProviderInstance {
  return {
    id: 'openai-1',
    providerId: 'openai',
    displayName: 'My OpenAI',
    enabled: true,
    config: { auth: { type: 'apiKey', apiKeyRef: 'env:OPENAI_KEY', baseUrl: 'https://api.openai.com/v1' } },
    createdAt: '2026-08-22T00:00:00Z',
    updatedAt: '2026-08-22T00:00:00Z',
  }
}

describe('ProviderConfigSchema', () => {
  test('accepts valid api-key config', () => {
    const r = ProviderConfigSchema().safeParse({
      auth: { type: 'apiKey', apiKeyRef: 'env:OPENAI_KEY' },
    })
    expect(r.success).toBe(true)
  })

  test('rejects invalid auth type', () => {
    const r = ProviderConfigSchema().safeParse({ auth: { type: 'bad' as never } })
    expect(r.success).toBe(false)
  })

  test('rejects invalid baseUrl (not a URL)', () => {
    const r = ProviderConfigSchema().safeParse({
      auth: { type: 'apiKey', apiKeyRef: 'env:FOO', baseUrl: 'not-a-url' },
    })
    expect(r.success).toBe(false)
  })
})

describe('ProviderInstanceSchema', () => {
  test('valid instance passes', () => {
    expect(ProviderInstanceSchema().safeParse(validInstance()).success).toBe(true)
  })

  test('missing providerId fails', () => {
    const bad = validInstance()
    delete (bad as { providerId?: string }).providerId
    expect(ProviderInstanceSchema().safeParse(bad).success).toBe(false)
  })

  test('missing enabled fails', () => {
    const bad = validInstance()
    delete (bad as { enabled?: boolean }).enabled
    expect(ProviderInstanceSchema().safeParse(bad).success).toBe(false)
  })
})

describe('QuotaSnapshotSchema', () => {
  test('unsupported status passes', () => {
    const r = QuotaSnapshotSchema().safeParse({
      status: 'unsupported',
      fetchedAt: '2026-08-22T00:00:00Z',
      windows: [],
      message: 'No quota API',
    })
    expect(r.success).toBe(true)
  })

  test('rejects unknown status', () => {
    const r = QuotaSnapshotSchema().safeParse({
      status: 'unlimited' as never,
      fetchedAt: '2026-08-22T00:00:00Z',
      windows: [],
    })
    expect(r.success).toBe(false)
  })
})
