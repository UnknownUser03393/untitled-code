/**
 * Runtime shim for `bun:bundle` — the build-time macro module.
 *
 * Under Node (via tsx/esbuild), `import { feature } from 'bun:bundle'` cannot
 * resolve to a real module. This shim mirrors what the original Bun entrypoint
 * polyfilled: `feature()` always returns `false` (every feature flag off), and
 * `MACRO<T>(fn)` evaluates the body directly.
 */

export function feature(_name: string): boolean {
  return false
}

export function MACRO<T>(fn: () => T): T {
  return fn()
}
