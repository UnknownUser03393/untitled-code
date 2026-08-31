import { rm, readFile } from 'fs/promises'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'esbuild'
import path from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))
const outdir = 'dist'

const EXT_LOADER = {
  '.ts': 'ts' as const,
  '.tsx': 'tsx' as const,
  '.js': 'js' as const,
  '.jsx': 'jsx' as const,
  '.mjs': 'js' as const,
  '.json': 'json' as const,
}
const loaderFor = (p: string) => EXT_LOADER[path.extname(p) as keyof typeof EXT_LOADER]

// Bun's build-time `feature('FLAG')` macro expands to `false` and dead-code
// eliminates the branch. esbuild does not know `feature` is constant, so a
// `require('./commands/proactive.js')` behind `feature('PROACTIVE')` would try
// to resolve a genuinely-absent file. This plugin rewrites string-literal
// `feature('...')` calls to `false`, letting esbuild's constant folding / DCE
// drop the dead imports exactly like Bun did.
const featureMacro: Plugin = {
  name: 'feature-macro',
  setup(plugin) {
    plugin.onLoad({ filter: /\.[jt]sx?$/ }, async args => {
      if (args.path.includes('node_modules')) return undefined
      const content = await readFile(args.path, 'utf8')
      if (!content.includes('feature(')) return undefined
      const out = content.replace(/\bfeature\(\s*(['"])([^'"]*)\1\s*\)/g, 'false')
      return { contents: out, loader: loaderFor(args.path) }
    })
  },
}

// Step 1: Clean output directory
await rm(outdir, { recursive: true, force: true })

// Step 2: Bundle with esbuild.
// - tsconfig `paths` resolve `src/*` and let esbuild's resolver apply
//   `.js`→`.ts` extension substitution (which a custom onResolve short-circuits).
// - `featureMacro` turns Bun's build-time macro into compile-time `false`.
// - `bun` / `bun:*` resolve to runtime shims (never executed under Node).
const result = await build({
  entryPoints: [path.join(root, 'src/entrypoints/cli.tsx')],
  outdir,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  splitting: false,
  sourcemap: false,
  logLevel: 'info',
  jsx: 'automatic',
  tsconfig: 'tsconfig.json',
  loader: { '.md': 'text' },
  banner: {
    // Provide a real global `require` for the CJS modules bundled into this ESM
    // output. esbuild's interop shim checks `typeof require !== "undefined"`
    // and, seeing one, uses it instead of throwing "Dynamic require of ... is
    // not supported". Set on globalThis (not a local const) to avoid shadowing
    // and to escape the TDZ for esbuild's own `typeof require` check; the
    // createRequire binding is renamed to dodge one esbuild already declares.
    js: "import { createRequire as __ccr } from 'node:module'; if (!globalThis.require) globalThis.require = __ccr(import.meta.url);",
  },
  write: true,
  plugins: [featureMacro],
  alias: {
    bun: path.join(root, 'src/polyfills/bunShell.ts'),
    'bun:bundle': path.join(root, 'src/polyfills/bunBundle.ts'),
    'bun:ffi': path.join(root, 'src/polyfills/bunFFI.ts'),
    'bun:sqlite': path.join(root, 'src/polyfills/bunFFI.ts'),
    'bun:main': path.join(root, 'src/polyfills/bunFFI.ts'),
  },
})

if (result.errors.length > 0) {
  console.error('Build failed:')
  for (const e of result.errors) console.error(e)
  process.exit(1)
}

console.log(`Bundled entrypoints to ${path.join(outdir, 'cli.js')}`)
