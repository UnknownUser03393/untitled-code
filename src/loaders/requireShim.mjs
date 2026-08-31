/**
 * Per-module `require` shim for dev mode (`pnpm dev`).
 *
 * Bun gives every ESM module a `require` that resolves relative specifiers
 * against the calling file, and this codebase leans on it: 85+ files do lazy
 * `require('./tools/...')`-style calls (circular-dependency breaking /
 * conditional loading). Node ESM has no `require` at all, so register.mjs
 * exposes a global one — but a single global can't know its caller, so every
 * relative call resolved against the project root instead of `src/` and the
 * interactive TUI hung silently on the first one
 * (`require('./tools/SendMessageTool/SendMessageTool.js')` from src/tools.ts).
 *
 * This load hook injects `const require = createRequire(import.meta.url)`
 * into each first-party src file, restoring Bun's per-module semantics. tsx's
 * CJS hook then remaps the `.js` specifiers to the real `.ts`/`.tsx` files,
 * and `--conditions=import` (see package.json `dev`) lets the CJS requires
 * resolve ESM-only packages, which Node 22+ then loads natively (require(esm)).
 *
 * Not used by dist builds (esbuild inlines requires while bundling) or vitest
 * (vite pipeline). Must be registered before tsx on the command line
 * (`--import ./src/loaders/register.mjs --import tsx`) so tsx's transpile
 * wraps our injected code.
 */
const SHIM =
  "import { createRequire as __patchCreateRequire } from 'node:module';" +
  'const require = __patchCreateRequire(import.meta.url);'

export async function load(url, context, next) {
  if (
    url.startsWith('file://') &&
    url.includes('/src/') &&
    !url.includes('/node_modules/') &&
    !url.includes('.d.ts') &&
    /\.(ts|tsx|js|jsx)(\?|$)/.test(url)
  ) {
    const result = await next(url, context)
    if (result?.source != null) {
      // Node's default loader may hand the source back as a string or as a
      // TypedArray/Buffer — normalize before splicing in the shim.
      const raw =
        typeof result.source === 'string'
          ? result.source
          : Buffer.from(result.source).toString('utf8')
      // Keep a leading shebang on line 1 (`#!/usr/bin/env node` in cli.tsx) —
      // it is only valid as the first line of the file.
      let shebang = ''
      let body = raw
      if (body.startsWith('#!')) {
        const i = body.indexOf('\n')
        shebang = body.slice(0, i + 1)
        body = body.slice(i + 1)
      }
      return { ...result, source: shebang + SHIM + body }
    }
    return result
  }
  return next(url, context)
}
