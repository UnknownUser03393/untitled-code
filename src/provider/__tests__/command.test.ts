import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { call } from '../../commands/providers/providers.js'
import { upsertFlatProvider } from '../configStore.js'

let tmpDir: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'claude-provider-command-'))
  process.env.CLAUDE_CONFIG_DIR = tmpDir
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
  delete process.env.CLAUDE_CONFIG_DIR
})

// Capture onDone results without rendering Ink.
function capture(): { onDone: (r?: string, o?: { display?: string }) => void; messages: string[] } {
  const messages: string[] = []
  return {
    messages,
    onDone: (result?: string) => messages.push(result ?? ''),
  }
}

describe('/providers command', () => {
  test('help returns usage', async () => {
    const { onDone, messages } = capture()
    const ctx = {} as never
    await call(onDone, ctx, 'help')
    expect(messages[0]).toContain('Usage: /providers')
  })

  test('list with no providers returns a friendly message', async () => {
    const { onDone, messages } = capture()
    const ctx = {} as never
    // When no instances configured, command reports it through onDone without
    // throwing. Message subcommands return undefined (base LocalJSXCommandCall
    // pattern — see src/commands/model/model.tsx `return;` after onDone), so
    // the result surfaces entirely via onDone, not as rendered JSX.
    const result = await call(onDone, ctx, 'list')
    expect(result).toBeUndefined()
    expect(messages[0]).toContain('No providers configured')
  })

  test('invalid route ref reports error', async () => {
    const { onDone, messages } = capture()
    const ctx = {} as never
    await call(onDone, ctx, 'route not-a-ref-without-colons')
    expect(messages[0]).toContain('Invalid model ref')
  })

  test('route sets active selection', async () => {
    const { onDone, messages } = capture()
    const ctx = {} as never
    await call(onDone, ctx, 'route openai::gpt-4o')
    expect(messages[0]).toContain('openai/gpt-4o')
    const { getActiveModelSelection, setActiveModelSelection } = await import('../modelSeam.js')
    expect(getActiveModelSelection()?.providerId).toBe('openai')
    expect(getActiveModelSelection()?.modelId).toBe('gpt-4o')
    // Reset so other tests are unaffected.
    setActiveModelSelection(null)
  })

  test('edit <id> returns a wizard for an existing provider', async () => {
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'sk-1' })
    const { onDone } = capture()
    const ctx = {} as never
    const result = await call(onDone, ctx, 'edit DeepSeek')
    expect(result).toBeTruthy()
  })

  test('edit <id> on a missing provider reports not found', async () => {
    const { onDone, messages } = capture()
    const ctx = {} as never
    const result = await call(onDone, ctx, 'edit nope')
    expect(result).toBeUndefined()
    expect(messages[0]).toContain('No provider with id')
  })

  test('fallback <id> <refs> persists the chain and clears it', async () => {
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'sk-1' })
    const { onDone, messages } = capture()
    const ctx = {} as never
    await call(onDone, ctx, 'fallback DeepSeek deepseek/model-flash,openai/gpt-5')
    expect(messages[0]).toContain('deepseek/model-flash')
    const { getProviderInstance } = await import('../configStore.js')
    expect((await getProviderInstance('DeepSeek'))?.config.fallback).toEqual(['deepseek/model-flash', 'openai/gpt-5'])

    await call(onDone, ctx, 'fallback DeepSeek')
    expect((await getProviderInstance('DeepSeek'))?.config.fallback).toBeUndefined()
  })
})
