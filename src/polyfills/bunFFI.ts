/**
 * Stub for `bun:ffi` — only ever referenced inside `typeof Bun === 'undefined'`
 * guarded branches that never execute under Node. Resolving the import to this
 * stub lets the bundler pass; calling `dlopen` throws a clear error instead of
 * a confusing resolution failure.
 */

export type FFIType = string

export function dlopen(): never {
  throw new Error('bun:ffi is not available in Node.js — this code path is disabled')
}
