import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  flatToInstance,
  upsertFlatProvider,
  upsertProviderInstance,
  removeProviderInstance,
  loadProviderInstances,
  ProviderNamespaceCollisionError,
} from '../configStore.js'
import { writeModelsCache } from '../cache.js'

describe('flatToInstance (hand-written 4-field provider)', () => {
  test('maps OpenAI protocol + baseURL + apiKey to a full instance', () => {
    const inst = flatToInstance({
      name: 'DeepSeek',
      protocol: 'OpenAI',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-abc',
    })
    expect(inst).not.toBeNull()
    expect(inst!.id).toBe('DeepSeek')
    expect(inst!.providerId).toBe('openai')
    expect(inst!.displayName).toBe('DeepSeek')
    expect(inst!.enabled).toBe(true)
    expect(inst!.config.apiUrl).toBe('https://api.deepseek.com')
    expect(inst!.config.auth).toEqual({ type: 'apiKey', apiKeyRef: 'sk-abc', baseUrl: 'https://api.deepseek.com' })
  })

  test('maps Anthropic protocol (key optional -> none)', () => {
    const inst = flatToInstance({ name: 'Anthropic', protocol: 'Anthropic' })
    expect(inst!.providerId).toBe('anthropic')
    expect(inst!.config.auth).toEqual({ type: 'none' })
  })

  test('name doubles as the id', () => {
    const inst = flatToInstance({ name: 'foo', protocol: 'openai' })
    expect(inst!.id).toBe('foo')
  })

  test('unknown protocol is rejected', () => {
    expect(flatToInstance({ name: 'x', protocol: 'gemini' })).toBeNull()
  })

  test('non-flat (full) entries are rejected so the loader can fall through', () => {
    expect(flatToInstance({ providerId: 'openai', config: {} })).toBeNull()
  })
})

describe('upsertFlatProvider (wizard persistence)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-providers-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function stored(): unknown {
    return JSON.parse(readFileSync(join(dir, 'providers', 'providers.json'), 'utf8'))
  }

  test('appends a flat entry that loads back by name', async () => {
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'sk-1' })
    expect(stored()).toEqual([
      { name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'aes:DeepSeek' },
    ])
    const instances = await loadProviderInstances()
    expect(instances.map(i => i.id)).toEqual(['DeepSeek'])
    expect(instances[0]!.providerId).toBe('openai')
  })

  test('replaces by name and preserves unrelated entries (flat + full shape)', async () => {
    mkdirSync(join(dir, 'providers'), { recursive: true })
    writeFileSync(
      join(dir, 'providers', 'providers.json'),
      JSON.stringify([
        { name: 'Kimi', protocol: 'OpenAI', baseURL: 'https://api.moonshot.cn/v1', apiKey: 'k-1' },
        {
          id: 'local',
          providerId: 'anthropic',
          displayName: 'Local',
          enabled: true,
          config: { auth: { type: 'none' } },
          createdAt: 't',
          updatedAt: 't',
        },
      ]),
    )
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'sk-2' })
    await upsertFlatProvider({ name: 'Kimi', protocol: 'OpenAI', apiKey: 'k-2' })
    const raw = stored() as Array<Record<string, unknown>>
    expect(raw).toHaveLength(3)
    expect(raw[0]).toEqual({ name: 'Kimi', protocol: 'OpenAI', apiKey: 'aes:Kimi' })
    expect((raw[1] as Record<string, unknown>)['id']).toBe('local')
    expect(raw[2]).toEqual({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'aes:DeepSeek' })
  })

  test('replaces a full-shape instance whose id matches the name', async () => {
    mkdirSync(join(dir, 'providers'), { recursive: true })
    writeFileSync(
      join(dir, 'providers', 'providers.json'),
      JSON.stringify([
        {
          id: 'DeepSeek',
          providerId: 'openai',
          displayName: 'DeepSeek',
          enabled: true,
          config: { auth: { type: 'none' } },
          createdAt: 't',
          updatedAt: 't',
        },
      ]),
    )
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', apiKey: 'sk-3' })
    expect(stored()).toEqual([{ name: 'DeepSeek', protocol: 'OpenAI', apiKey: 'aes:DeepSeek' }])
  })

  test('empty optional fields are omitted from the stored entry', async () => {
    await upsertFlatProvider({ name: 'Local', protocol: 'Anthropic' })
    expect(stored()).toEqual([{ name: 'Local', protocol: 'Anthropic' }])
  })

  test('blank apiKey on edit preserves the existing stored credential ref', async () => {
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'sk-1' })
    expect(stored()).toEqual([
      { name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'aes:DeepSeek' },
    ])
    // Edit with a blank key: the existing aes ref is carried forward, not dropped.
    await upsertFlatProvider({ name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com' })
    expect(stored()).toEqual([
      { name: 'DeepSeek', protocol: 'OpenAI', baseURL: 'https://api.deepseek.com', apiKey: 'aes:DeepSeek' },
    ])
  })
})

describe('namespace collision validation', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-providers-collision-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  test('upsertFlatProvider rejects a name that slug-normalizes to an existing one', async () => {
    await upsertFlatProvider({ name: 'Deep Seek', protocol: 'OpenAI' })
    await expect(upsertFlatProvider({ name: 'deep-seek', protocol: 'OpenAI' })).rejects.toThrow(
      ProviderNamespaceCollisionError,
    )
  })

  test('upsertFlatProvider accepts a distinct namespace', async () => {
    await upsertFlatProvider({ name: 'Deep Seek', protocol: 'OpenAI' })
    await expect(upsertFlatProvider({ name: 'OpenAI', protocol: 'OpenAI' })).resolves.toBeUndefined()
  })

  test('upsertProviderInstance rejects a colliding id but allows same-id re-save', async () => {
    const inst = flatToInstance({ name: 'Deep Seek', protocol: 'OpenAI' })!
    await upsertProviderInstance(inst)
    // same id, updated — never self-collides
    await expect(upsertProviderInstance({ ...inst, enabled: false })).resolves.toBeDefined()
    // different id, same namespace — rejected
    const collider = flatToInstance({ name: 'deep-seek', protocol: 'OpenAI' })!
    await expect(upsertProviderInstance(collider)).rejects.toThrow(ProviderNamespaceCollisionError)
  })
})

describe('removeProviderInstance cleanup', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cc-providers-remove-'))
    process.env.CLAUDE_CONFIG_DIR = dir
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    delete process.env.CLAUDE_CONFIG_DIR
  })

  test('removes the instance, its AES credential, and its cache files', async () => {
    await upsertFlatProvider({
      name: 'DeepSeek',
      protocol: 'OpenAI',
      baseURL: 'https://api.deepseek.com',
      apiKey: 'sk-1',
    })
    await writeModelsCache('deepseek', [
      { providerId: 'deepseek', modelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['chat'] },
    ])
    expect(existsSync(join(dir, 'providers', 'credentials', 'DeepSeek.aes.json'))).toBe(true)

    const removed = await removeProviderInstance('DeepSeek')
    expect(removed).toBe(true)
    expect(existsSync(join(dir, 'providers', 'credentials', 'DeepSeek.aes.json'))).toBe(false)
    expect(existsSync(join(dir, 'cache', 'provider-deepseek-models.json'))).toBe(false)
    expect((await loadProviderInstances()).map(i => i.id)).toEqual([])
  })

  test('returns false when the id is not present', async () => {
    expect(await removeProviderInstance('nope')).toBe(false)
  })
})
