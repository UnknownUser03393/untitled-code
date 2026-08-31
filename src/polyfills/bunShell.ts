/**
 * Stub for Bun's `$` shell helper (`import { $ } from 'bun'`).
 * Only used by the macOS-only @ant/computer-use-input package, which guards
 * every call behind an `isSupported` platform check that never runs here.
 */

export function $(): never {
  throw new Error("Bun's shell helper ($) is not available in Node.js")
}
