import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'

interface EncryptedCredential {
  v: 1
  alg: 'aes-256-gcm'
  iv: string
  tag: string
  ciphertext: string
}

const secretCache = new Map<string, string>()
const keyCache = new Map<string, Buffer>()

function credentialsDir(): string {
  return join(getClaudeConfigHomeDir(), 'providers', 'credentials')
}

function aesCredentialPath(id: string): string {
  return join(credentialsDir(), `${encodeURIComponent(id)}.aes.json`)
}

function legacyDpapiPath(id: string): string {
  return join(credentialsDir(), `${encodeURIComponent(id)}.dpapi`)
}

function masterKey(): Buffer {
  const configured = process.env.CLAUDE_PROVIDER_MASTER_KEY
  if (configured) {
    if (/^[a-f\d]{64}$/i.test(configured)) return Buffer.from(configured, 'hex')
    const decoded = Buffer.from(configured, 'base64')
    if (decoded.length === 32) return decoded
    return createHash('sha256').update(configured, 'utf8').digest()
  }

  const path = join(credentialsDir(), '.master-key')
  const cached = keyCache.get(path)
  if (cached) return cached
  mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 })
  if (!existsSync(path)) {
    try {
      writeFileSync(path, randomBytes(32), { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if (!existsSync(path)) throw error
    }
  }
  const key = readFileSync(path)
  if (key.length !== 32) throw new Error('Provider AES master key must be exactly 32 bytes')
  keyCache.set(path, key)
  return key
}

function decryptLegacyDpapi(id: string): string {
  if (process.platform !== 'win32') return ''
  const path = legacyDpapiPath(id)
  try {
    const script = [
      'Add-Type -AssemblyName System.Security',
      '$cipher=[IO.File]::ReadAllBytes($env:CLAUDE_PROVIDER_CREDENTIAL_PATH)',
      '$bytes=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Console]::Out.Write([Text.Encoding]::UTF8.GetString($bytes))',
    ].join(';')
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROVIDER_CREDENTIAL_PATH: path },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } catch {
    return ''
  }
}

export function isSecureCredentialRef(ref: string): boolean {
  return ref.startsWith('aes:') || ref.startsWith('secure:')
}

export function storeProviderCredential(id: string, input: string): string {
  if (!input) return ''
  if (input.startsWith('env:') || input.startsWith('aes:')) return input

  const wasLegacy = input.startsWith('secure:')
  const secret = wasLegacy ? decryptLegacyDpapi(input.slice('secure:'.length)) : input
  if (!secret) throw new Error(`Credential unavailable: ${input}`)

  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  const record: EncryptedCredential = {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
  mkdirSync(credentialsDir(), { recursive: true, mode: 0o700 })
  const path = aesCredentialPath(id)
  writeFileSync(path, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 })
  secretCache.set(path, secret)

  if (wasLegacy) {
    const oldPath = legacyDpapiPath(input.slice('secure:'.length))
    if (existsSync(oldPath)) unlinkSync(oldPath)
  }
  return `aes:${id}`
}

/**
 * Delete a stored credential by id (symmetric to {@link storeProviderCredential}).
 * Removes both the AES file and any legacy dpapi file, and purges the in-memory
 * secret cache entry. Idempotent and never throws — callers clean up best-effort.
 */
export function deleteProviderCredential(id: string): void {
  for (const path of [aesCredentialPath(id), legacyDpapiPath(id)]) {
    secretCache.delete(path)
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      /* best-effort: a missing/unreadable credential file is fine to leave */
    }
  }
}

export function resolveProviderCredential(ref: string): string {
  if (ref.startsWith('env:')) return process.env[ref.slice(4)] ?? ''
  if (ref.startsWith('secure:')) return decryptLegacyDpapi(ref.slice('secure:'.length))
  if (!ref.startsWith('aes:')) return ref

  const id = ref.slice('aes:'.length)
  const path = aesCredentialPath(id)
  const cached = secretCache.get(path)
  if (cached !== undefined) return cached
  try {
    const record = JSON.parse(readFileSync(path, 'utf8')) as EncryptedCredential
    if (record.v !== 1 || record.alg !== 'aes-256-gcm') return ''
    const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(record.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(record.tag, 'base64'))
    const value = Buffer.concat([
      decipher.update(Buffer.from(record.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
    secretCache.set(path, value)
    return value
  } catch {
    return ''
  }
}
