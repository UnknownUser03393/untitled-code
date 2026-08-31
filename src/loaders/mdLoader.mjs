/**
 * Node loader hook for importing `.md` bundled skill documents as text.
 * Bun handled `.md` natively; Node needs a hook. This transforms the file into
 * a module that default-exports its raw string. Used only in dev mode (tsx);
 * the esbuild build embeds `.md` via a `text` loader instead.
 */
import { readFile } from 'node:fs/promises'

export async function load(url, context, nextLoad) {
  if (url.endsWith('.md')) {
    const source = await readFile(new URL(url), 'utf8')
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(source)};\n`,
    }
  }
  return nextLoad(url, context)
}
