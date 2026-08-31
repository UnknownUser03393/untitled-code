/**
 * Persistence for user-configured provider *instances*.
 *
 * This is distinct from the registry: {@link import('./registry.js').ProviderRegistry}
 * holds the code-registered plugins; this store holds the user-addable
 * configurations (which plugin, enabled/disabled, credentials refs). Instances
 * live at `~/.claude/providers/providers.json`, and reads fall back to an empty
 * list when the file is missing or malformed — never throwing.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { safeParseJSON } from '../utils/json.js'
import { ProviderInstanceSchema } from './schema.js'
import type { ProviderInstance } from './types.js'
import { parseModelRef, providerNamespace } from './types.js'
import { storeProviderCredential, deleteProviderCredential } from './credentials.js'
import { deleteProviderCache } from './cache.js'
import { getActiveModelSelection, setActiveModelSelection } from './modelSeam.js'
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import { getMainLoopModelOverride, setMainLoopModelOverride } from '../bootstrap/state.js'

function providersDir(): string {
  return `${getClaudeConfigHomeDir()}/providers`
}

/**
 * Flat, hand-writable provider shape: `{ name, protocol, baseURL, apiKey }`.
 * `protocol` is `"Anthropic" | "OpenAI"` (OpenAI covers any OpenAI-compatible
 * endpoint, e.g. DeepSeek). Maps to a full {@link ProviderInstance} so the rest
 * of the hub — routing, gateway, picker — works unchanged.
 *
 * `name` doubles as the instance id, so `/providers enable <name>` etc. read
 * naturally. Returns `null` for entries that are not in this flat shape (the
 * loader then falls back to the full schema).
 */
export function flatToInstance(entry: unknown): ProviderInstance | null {
  if (typeof entry !== 'object' || entry === null) return null
  const e = entry as Record<string, unknown>
  if (typeof e.protocol !== 'string') return null

  const protocol = e.protocol.toLowerCase()
  const providerId = protocol === 'anthropic' ? 'anthropic' : protocol === 'openai' ? 'openai' : null
  if (!providerId) return null

  const name = typeof e.name === 'string' && e.name ? e.name : providerId
  const baseURL = typeof e.baseURL === 'string' && e.baseURL ? e.baseURL : undefined
  const apiKey = typeof e.apiKey === 'string' ? e.apiKey : ''
  const now = new Date().toISOString()

  return {
    id: name,
    providerId,
    displayName: name,
    enabled: true,
    config: {
      auth: apiKey
        ? { type: 'apiKey', apiKeyRef: apiKey, ...(baseURL ? { baseUrl: baseURL } : {}) }
        : { type: 'none' },
      ...(baseURL ? { apiUrl: baseURL } : {}),
    },
    createdAt: now,
    updatedAt: now,
  }
}

function providersPath(): string {
  return `${providersDir()}/providers.json`
}

/**
 * Thrown when creating/updating an instance whose normalized namespace collides
 * with a different existing instance. Model-ref prefixes, cache keys and
 * instance lookups all match by `providerNamespace`, so "Deep Seek" and
 * "deep-seek" cannot coexist — they would share the same prefix and cache file.
 */
export class ProviderNamespaceCollisionError extends Error {
  readonly namespace: string
  readonly existingId: string

  constructor(namespace: string, existingId: string, attemptedName: string) {
    super(
      `Provider name "${attemptedName}" collides with existing provider "${existingId}": ` +
        `both normalize to namespace "${namespace}". Names must be unique after ` +
        'lowercasing and slug-normalization (e.g. "Deep Seek" vs "deep-seek").',
    )
    this.name = 'ProviderNamespaceCollisionError'
    this.namespace = namespace
    this.existingId = existingId
  }
}

/** Assert no *other* existing entry normalizes to the candidate's namespace. */
function assertNoNamespaceCollision(
  existing: ReadonlyArray<{ id: string; displayName: string }>,
  candidateId: string,
): void {
  const ns = providerNamespace(candidateId)
  for (const entry of existing) {
    if (entry.id === candidateId) continue
    const otherNames = [entry.id, entry.displayName]
    if (otherNames.some(name => providerNamespace(name) === ns)) {
      throw new ProviderNamespaceCollisionError(ns, entry.id, candidateId)
    }
  }
}

/**
 * Load all stored provider instances. Returns `[]` if the file is missing,
 * malformed, or validation fails — callers should treat "no providers" and
 * "providers failed to load" the same (both are non-fatal).
 */
export async function loadProviderInstances(): Promise<ProviderInstance[]> {
  try {
    const raw = await readFile(providersPath(), 'utf-8')
    const parsed = safeParseJSON(raw)
    if (!Array.isArray(parsed)) return []
    const instances: ProviderInstance[] = []
    let credentialsMigrated = false
    for (const entry of parsed) {
      if (typeof entry === 'object' && entry !== null) {
        const rec = entry as Record<string, unknown>
        if (typeof rec.name === 'string' && typeof rec.apiKey === 'string' && rec.apiKey && !rec.apiKey.startsWith('env:') && !rec.apiKey.startsWith('aes:')) {
          try {
            rec.apiKey = storeProviderCredential(rec.name, rec.apiKey)
            credentialsMigrated = true
          } catch (error) {
            logError(error as Error)
          }
        }
      }
      // Accept the flat hand-written shape first, then the full schema.
      const flat = flatToInstance(entry)
      if (flat) {
        instances.push(flat)
        continue
      }
      const result = ProviderInstanceSchema().safeParse(entry)
      if (result.success) {
        instances.push(result.data)
      } else {
        logForDebugging(`[provider] skipping invalid stored instance: ${result.error.message}`)
      }
    }
    if (credentialsMigrated) {
      await mkdir(providersDir(), { recursive: true })
      await writeFile(providersPath(), JSON.stringify(parsed, null, 2), { encoding: 'utf-8', mode: 0o600 })
    }
    return instances
  } catch {
    return []
  }
}

/** Persist the full list of provider instances. */
export async function saveProviderInstances(instances: ProviderInstance[]): Promise<void> {
  try {
    const dir = providersDir()
    await mkdir(dir, { recursive: true })
    await writeFile(providersPath(), JSON.stringify(instances, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    })
  } catch (error) {
    logError(error as Error)
  }
}

/**
 * Add or replace an instance by id. Returns the new/updated instance, or `null`
 * if the id already exists (callers that want to update should use upsert).
 */
export async function upsertProviderInstance(
  instance: ProviderInstance,
): Promise<ProviderInstance> {
  const instances = await loadProviderInstances()
  assertNoNamespaceCollision(instances, instance.id)
  const idx = instances.findIndex(i => i.id === instance.id)
  if (idx >= 0) {
    instances[idx] = instance
  } else {
    instances.push(instance)
  }
  await saveProviderInstances(instances)
  return instance
}

export async function removeProviderInstance(id: string): Promise<boolean> {
  const instances = await loadProviderInstances()
  const victim = instances.find(i => i.id === id)
  const next = instances.filter(i => i.id !== id)
  if (!victim || next.length === instances.length) return false
  await saveProviderInstances(next)
  cleanupProviderRemoval(victim)
  return true
}

/**
 * Best-effort cleanup after a provider instance is removed: delete its AES
 * credential, its model/health/quota/scan caches, and drop any active or
 * persisted model selection that routes through it — otherwise a dangling
 * provider-scoped ref would be sent to the base Anthropic endpoint with a bare
 * (non-claude) model id and fail.
 */
function cleanupProviderRemoval(victim: ProviderInstance): void {
  try {
    deleteProviderCredential(victim.id)
    if (
      victim.config.auth.type === 'apiKey' &&
      victim.config.auth.apiKeyRef.startsWith('aes:')
    ) {
      deleteProviderCredential(victim.config.auth.apiKeyRef.slice('aes:'.length))
    }
  } catch (error) {
    logError(error as Error)
  }
  try {
    deleteProviderCache(providerNamespace(victim.id))
  } catch (error) {
    logError(error as Error)
  }

  const ns = providerNamespace(victim.id)
  const active = getActiveModelSelection()
  if (active && providerNamespace(active.providerId) === ns) {
    setActiveModelSelection(null)
  }
  const persistedModel = getSettingsForSource('userSettings')?.model
  if (typeof persistedModel === 'string' && providerNamespaceOfRef(persistedModel) === ns) {
    updateSettingsForSource('userSettings', { model: undefined })
  }
  const override = getMainLoopModelOverride()
  if (typeof override === 'string' && providerNamespaceOfRef(override) === ns) {
    setMainLoopModelOverride(undefined)
  }
}

function providerNamespaceOfRef(ref: string): string | null {
  return parseModelRef(ref)?.providerId ?? null
}

export async function getProviderInstance(id: string): Promise<ProviderInstance | undefined> {
  const instances = await loadProviderInstances()
  return instances.find(i => providerNamespace(i.id) === providerNamespace(id))
}

/** The hand-writable 4-field shape the wizard also persists. */
export interface FlatProviderEntry {
  name: string
  protocol: 'Anthropic' | 'OpenAI'
  baseURL?: string
  apiKey?: string
}

/**
 * Add or replace a provider in the flat shape, keeping `providers.json`
 * hand-writable: the entry is stored exactly as `{ name, protocol, baseURL?,
 * apiKey? }`, and unrelated entries are preserved byte-for-byte (whatever
 * their shape — the loader accepts both per entry). Matches by flat `name`,
 * or by full-instance `id` so a wizard re-add of a previously full-shape
 * instance replaces it.
 */
export async function upsertFlatProvider(entry: FlatProviderEntry): Promise<void> {
  // Read the current list and assert no namespace collision *before* the write
  // try/catch — a collision must surface to the caller (wizard shows the error),
  // not be swallowed as a generic failure.
  let list: unknown[] = []
  try {
    const parsed = safeParseJSON(await readFile(providersPath(), 'utf-8'))
    if (Array.isArray(parsed)) list = parsed
  } catch {
    /* missing/unreadable file → start a fresh list */
  }
  assertFlatNoNamespaceCollision(list, entry)

  try {
    const idx = list.findIndex(e => {
      if (typeof e !== 'object' || e === null) return false
      const rec = e as Record<string, unknown>
      if (typeof rec.name === 'string') return rec.name === entry.name
      if (typeof rec.id === 'string') return rec.id === entry.name
      return false
    })
    const flat: Record<string, string> = { name: entry.name, protocol: entry.protocol }
    if (entry.baseURL) flat.baseURL = entry.baseURL
    if (entry.apiKey) {
      flat.apiKey = storeProviderCredential(entry.name, entry.apiKey)
    } else if (idx >= 0) {
      // Editing with a blank key means "keep the existing credential" — carry
      // the stored ref forward instead of dropping it.
      const previousRef = apiKeyRefOf(list[idx])
      if (previousRef) flat.apiKey = previousRef
    }
    if (idx >= 0) list[idx] = flat
    else list.push(flat)
    await mkdir(providersDir(), { recursive: true })
    await writeFile(providersPath(), JSON.stringify(list, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    })
  } catch (error) {
    logError(error as Error)
  }
}

/** Extract the stored credential ref from a flat entry (`apiKey`) or a full-shape
 * instance (`config.auth.apiKeyRef`). */
function apiKeyRefOf(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const rec = entry as Record<string, unknown>
  if (typeof rec.apiKey === 'string' && rec.apiKey) return rec.apiKey
  const auth = (rec.config as Record<string, unknown> | undefined)?.auth as
    | Record<string, unknown>
    | undefined
  if (auth && typeof auth.apiKeyRef === 'string' && auth.apiKeyRef) return auth.apiKeyRef
  return undefined
}

function assertFlatNoNamespaceCollision(list: unknown[], entry: FlatProviderEntry): void {
  const ns = providerNamespace(entry.name)
  for (const e of list) {
    if (typeof e !== 'object' || e === null) continue
    const rec = e as Record<string, unknown>
    const otherNames = [rec.name, rec.id].filter((x): x is string => typeof x === 'string')
    if (otherNames.length === 0) continue
    if (otherNames.some(name => name === entry.name)) continue // same entry — never self-collides
    if (otherNames.some(name => providerNamespace(name) === ns)) {
      throw new ProviderNamespaceCollisionError(ns, otherNames[0], entry.name)
    }
  }
}
