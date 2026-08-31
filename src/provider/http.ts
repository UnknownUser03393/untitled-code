/**
 * Minimal, provider-layer HTTP helper.
 *
 * Wraps `fetch` with a timeout and maps network/HTTP failures onto the typed
 * {@link ProviderError} hierarchy. Kept deliberately small — plugins for
 * OpenAI-compatible providers share this instead of each carrying their own
 * fetch/error logic. Anthropic-specific plugin uses the base SDK, not this.
 */
import {
  ProviderAuthError,
  ProviderTimeoutError,
  ProviderUnavailableError,
} from './errors.js'

export interface ProviderHttpRequest {
  url: string
  method?: 'GET' | 'POST'
  headers: Record<string, string>
  body?: string
  timeoutMs?: number
}

export interface ProviderHttpResponse {
  status: number
  body: unknown
  headers: Headers
}

/** Normalize an unknown error into a ProviderError with a stable code. */
export function normalizeProviderError(error: unknown, fallbackMessage: string): Error {
  if (error instanceof Error) return error
  return new ProviderUnavailableError(fallbackMessage)
}

/**
 * Perform a JSON HTTP request with a timeout. Throws a typed ProviderError on
 * failure: auth error for 401/403, unavailability for 5xx/network, timeout for
 * the timeout path. Does not raise credentials — callers should pass only
 * non-secret context in messages.
 */
export async function requestJson(req: ProviderHttpRequest): Promise<ProviderHttpResponse> {
  const {
    url,
    method = 'GET',
    headers,
    body,
    timeoutMs = 10_000,
  } = req

  const { signal, cleanup } = createAbortSignal(timeoutMs)
  try {
    const res = await fetch(url, {
      method,
      headers,
      body,
      signal,
      redirect: 'follow',
    })

    const text = await res.text()
    let parsed: unknown = null
    if (text) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }

    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthError(`Authentication failed (HTTP ${res.status})`)
    }
    if (res.status >= 500) {
      throw new ProviderUnavailableError(`Provider unavailable (HTTP ${res.status})`)
    }

    return { status: res.status, body: parsed, headers: res.headers }
  } catch (error) {
    if (isTimeoutError(error)) {
      throw new ProviderTimeoutError(`Request timed out after ${timeoutMs}ms`)
    }
    throw normalizeProviderError(error, `Request failed: ${url}`)
  } finally {
    cleanup()
  }
}

function createAbortSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Do not keep the event loop alive purely for the timeout.
  timer.unref?.()
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) }
}

function isTimeoutError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  )
}

/** Read an optional numeric response header (e.g. x-rate-limit-remaining). */
export function readNumericHeader(headers: Headers, name: string): number | undefined {
  const value = headers.get(name)
  if (value === null) return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}
