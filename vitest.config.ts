import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      'src/': root + '/src/',
      'bun:bundle': root + '/src/polyfills/bunBundle.ts',
      'bun:ffi': root + '/src/polyfills/bunFFI.ts',
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'packages/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 10000,
  },
})
