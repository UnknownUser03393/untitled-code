import { describe, expect, test } from 'vitest'
import {
  maskSecret,
  redactCredential,
  redactAuthConfig,
  redactSensitiveText,
} from '../redact.js'

describe('redact', () => {
  test('maskSecret shows last 4 chars', () => {
    expect(maskSecret('sk-1234567890abcd')).toBe('••••abcd')
  })

  test('maskSecret fully masks short values', () => {
    expect(maskSecret('ab')).toBe('••••')
  })

  test('redactCredential keeps env ref name, hides value', () => {
    expect(redactCredential('env:OPENAI_KEY')).toBe('env:OPENAI_KEY')
  })

  test('redactCredential masks raw key', () => {
    const out = redactCredential('sk-abc123def456ghi')
    expect(out).not.toContain('sk-abc123def456ghi')
    expect(out).toContain('••••')
  })

  test('redactCredential returns empty for undefined', () => {
    expect(redactCredential(undefined)).toBe('')
  })

  test('redactAuthConfig masks secret-bearing fields, keeps ref w/o value', () => {
    const out = redactAuthConfig({
      auth: { type: 'apiKey', apiKeyRef: 'sk-verysecretkey12345' },
    })
    expect(out.apiKeyRef).not.toContain('sk-verysecretkey12345')
  })

  test('redactSensitiveText strips sk- and Bearer tokens', () => {
    const out = redactSensitiveText('key sk-abcdefghij123456 failed; Header: Bearer xyz123456789abcdef')
    expect(out).not.toContain('sk-abcdefghij123456')
    expect(out).not.toContain('xyz123456789abcdef')
    expect(out).toContain('Bearer ••••')
  })

  test('redactSensitiveText leaves normal text alone', () => {
    expect(redactSensitiveText('Connection failed: timeout')).toBe('Connection failed: timeout')
  })
})
