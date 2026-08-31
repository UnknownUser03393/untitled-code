/**
 * Credential redaction utilities.
 *
 * API keys must never appear in logs, error messages, or frontend state. These
 * helpers mask secret-looking values while preserving non-secret context. In
 * this layer credentials are stored as *refs* (e.g. `env:OPENAI_KEY`) rather
 * than raw keys, but the redaction functions also protect against a raw value
 * accidentally flowing through a message.
 */

/** Show the last 4 chars of a value prefixed by its mask; short values become fully masked. */
export function maskSecret(value: string | undefined): string {
  if (!value) return ''
  if (value.length <= 4) return '••••'
  return `••••${value.slice(-4)}`
}

/**
 * Redact a credential value. If the value looks like an env/key ref
 * (`env:VAR`), keep the var name and mask the rest. Otherwise mask as a
 * secret. Never returns the raw value.
 */
export function redactCredential(value: string | undefined): string {
  if (!value) return ''
  const envMatch = value.match(/^(env|keychain|file):(.+)$/)
  if (envMatch) {
    return `${envMatch[1]}:${envMatch[2]}`
  }
  // sk-, sk-ant-, AIza(google), ghp_(github), Bearer — mask the payload
  return maskSecret(value)
}

/**
 * Normalize an auth config for display — replace any secret-bearing field with
 * a masked placeholder so logs and the UI never see raw credentials.
 */
export function redactAuthConfig(config: {
  auth: Record<string, unknown>
}): Record<string, unknown> {
  const auth = { ...config.auth }
  for (const key of ['apiKeyRef', 'key', 'token', 'secret', 'password', 'apiKey']) {
    if (typeof auth[key] === 'string') {
      auth[key] = redactCredential(auth[key] as string)
    }
  }
  if (typeof auth.apiKeyRef === 'string') {
    auth.apiKeyRef = redactCredential(auth.apiKeyRef)
  }
  if (typeof auth.clientIdRef === 'string') {
    auth.clientIdRef = redactCredential(auth.clientIdRef)
  }
  return auth
}

/** Redact any secret-looking token from a free-form error/status string. */
export function redactSensitiveText(text: string): string {
  if (!text) return text
  // Replace common long bearer-like tokens: sk-..., AIza..., ghp_...
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-••••')
    .replace(/\bAIza[A-Za-z0-9_-]{16,}\b/g, 'AIza••••')
    .replace(/\b(ghp|gho|github_pat)_[A-Za-z0-9_.-]{16,}\b/g, '$1_••••')
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/g, 'Bearer ••••')
}
