/**
 * Dev-mode preload (run with `node --import ./src/loaders/register.mjs`):
 *  1. Registers the `.md` text loader so bundled skill docs import as strings.
 *  2. Registers the per-module `require` shim (see requireShim.mjs) so the
 *     codebase's lazy relative `require('./x.js')` calls resolve like Bun's.
 *  3. Defines a global `require` so the CJS `require('semver')` /
 *     `require('yaml')` / builtin `require('node:*')` calls resolve under Node
 *     ESM (Bun provided this globally; Node does not). Bare specifiers only —
 *     relative ones are handled per-module by the shim.
 *  4. Registers CJS text loaders for `.txt` / `.md` assets (Bun's loaders did
 *     this; esbuild's text loader replicates it in dist).
 *
 * Anchored at the project root so ESM `require()` of npm packages resolves from
 * the workspace's node_modules.
 */
import { register, createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

register(new URL('./mdLoader.mjs', import.meta.url))
register(new URL('./requireShim.mjs', import.meta.url))

// Plain-text assets via CJS require: `module.exports = "..."` matches the
// shape esbuild's text loader bakes into dist. Must be registered in the MAIN
// thread — a module passed to register() runs in its own dedicated thread, so
// patching Module._extensions there would never reach the requiring code.
const textLoader = (mod, filename) => {
  mod.exports = readFileSync(filename, 'utf8')
}
Module._extensions['.txt'] = textLoader
Module._extensions['.md'] = textLoader

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
if (!globalThis.require) {
  globalThis.require = createRequire(new URL('../../package.json', import.meta.url))
}
