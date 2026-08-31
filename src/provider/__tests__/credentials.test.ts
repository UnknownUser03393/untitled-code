import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  deleteProviderCredential,
  resolveProviderCredential,
  storeProviderCredential,
} from '../credentials.js'

describe('provider credential storage', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'provider-credentials-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  test('stores an AES-256-GCM reference and resolves it', () => {
    const ref = storeProviderCredential('Account', 'top-secret')
    expect(ref).toBe('aes:Account')
    expect(resolveProviderCredential(ref)).toBe('top-secret')
  })

  test('deleteProviderCredential removes the file and no longer resolves', () => {
    const ref = storeProviderCredential('Account', 'top-secret')
    expect(existsSync(join(dir, 'providers', 'credentials', 'Account.aes.json'))).toBe(true)
    deleteProviderCredential('Account')
    expect(existsSync(join(dir, 'providers', 'credentials', 'Account.aes.json'))).toBe(false)
    // memo is purged; a re-read falls back to the (now missing) file → empty
    expect(resolveProviderCredential(ref)).toBe('')
  })

  test('deleteProviderCredential is idempotent on a missing id', () => {
    expect(() => deleteProviderCredential('never-stored')).not.toThrow()
  })
})
