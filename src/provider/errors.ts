/**
 * Typed errors for the multi-provider layer.
 *
 * Every error carries a stable `code` (used by tests and callers) and a
 * human-readable `message`. Codes are never derived from provider input, so
 * they can be matched without leaking sensitive values.
 */

/** Base error with a stable machine-readable code. */
export class ProviderError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

/** A plugin id that was not registered. */
export class UnknownProviderError extends ProviderError {
  constructor(providerId: string) {
    super('UNKNOWN_PROVIDER', `Unknown provider: ${providerId}`)
    this.name = 'UnknownProviderError'
  }
}

/** Attempt to register a plugin whose id is already registered. */
export class ProviderAlreadyRegisteredError extends ProviderError {
  constructor(providerId: string) {
    super('PROVIDER_ALREADY_REGISTERED', `Provider already registered: ${providerId}`)
    this.name = 'ProviderAlreadyRegisteredError'
  }
}

/** A provider instance's config failed validation. */
export class ProviderConfigError extends ProviderError {
  constructor(message: string) {
    super('PROVIDER_CONFIG_ERROR', message)
    this.name = 'ProviderConfigError'
  }
}

/** Authentication failed (invalid key, bad token, missing scope). */
export class ProviderAuthError extends ProviderError {
  constructor(message: string, code = 'PROVIDER_AUTH_ERROR') {
    super(code, message)
    this.name = 'ProviderAuthError'
  }
}

/** The provider was unreachable, rate-limited, or temporarily unavailable. */
export class ProviderUnavailableError extends ProviderError {
  constructor(message: string, code = 'PROVIDER_UNAVAILABLE') {
    super(code, message)
    this.name = 'ProviderUnavailableError'
  }
}

/** A request timed out, or the provider did not respond in time. */
export class ProviderTimeoutError extends ProviderError {
  constructor(message: string) {
    super('PROVIDER_TIMEOUT', message)
    this.name = 'ProviderTimeoutError'
  }
}
