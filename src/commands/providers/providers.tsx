/**
 * `/providers` command implementation.
 *
 * Subcommands:
 *   /providers            — show the provider hub overview (Ink page)
 *   /providers list       — text summary via onDone
 *   /providers add        — interactive wizard to add a provider instance
 *   /providers scan|fetch — refresh all provider model scans
 *   /providers route <ref>|config [ref] — set + persist the active routing model
 *   /providers help       — usage
 */
import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { ManageProvidersPage } from '../../components/providers/ManageProvidersPage.js'
import { AddProviderWizard } from '../../components/providers/AddProviderWizard.js'
import { ProviderModelsPage } from '../../components/providers/ProviderModelsPage.js'
import { loadProviderInstances, upsertProviderInstance, removeProviderInstance, getProviderInstance, type FlatProviderEntry } from '../../provider/configStore.js'
import { refreshAllModels } from '../../provider/modelService.js'
import { setActiveModelSelection, getActiveModelSelection } from '../../provider/modelSeam.js'
import { parseModelRef, encodeModelRef } from '../../provider/types.js'
import { resolveProviderCredential } from '../../provider/credentials.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { setMainLoopModelOverride } from '../../bootstrap/state.js'
import { doctorProvider } from '../../provider/doctor.js'

const HELP = `Usage: /providers [subcommand]
  list              List configured providers and models
  models <id>       Manage one provider's models (view/add/remove/fetch/set active)
  add               Add a provider (name, protocol, base URL, API key)
  edit <id>         Edit a provider's protocol, base URL, or API key
  scan / fetch      Refresh model scans for all providers
  doctor <id>       Validate config, credential, models, routing, and a minimal request
  fallback <id> [ref1,ref2]  Set the cross-provider fallback chain (no refs = clear)
  enable <id>       Enable a provider instance
  disable <id>      Disable a provider instance (kept, not scanned/routed)
  remove <id>       Delete a provider instance permanently
  route <org>/<model> Set the active model for a provider (in-session)
  config <org>/<model> Set AND persist the active model (survives restart)
  help              Show this help`

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode> {
  const trimmed = args?.trim() || ''

  if (trimmed === 'help' || trimmed === '-h' || trimmed === '--help') {
    onDone(HELP, { display: 'system' })
    return
  }

  if (trimmed === 'list') {
    const instances = await loadProviderInstances()
    if (instances.length === 0) {
      onDone('No providers configured. Add one with /providers add.', {
        display: 'system',
      })
      return
    }
    const lines = instances.map(p => `- ${p.displayName} [${p.id}] (${p.enabled ? 'enabled' : 'disabled'})`)
    const out = `Configured providers:\n${lines.join('\n')}\n\nManage with /providers enable|disable|remove <id>.`
    onDone(out, { display: 'system' })
    return
  }

  if (trimmed === 'add') {
    return <AddProviderWizard onDone={onDone} />
  }

  if (trimmed === 'models' || trimmed.startsWith('models ')) {
    const id = subcommandArg(trimmed)
    if (!id) return usage(onDone, 'models <providerId>')
    const instance = await getProviderInstance(id)
    if (!instance) return notFound(onDone, id)
    return <ProviderModelsPage instance={instance} onDone={onDone} />
  }

  if (trimmed === 'edit' || trimmed.startsWith('edit ')) {
    const id = subcommandArg(trimmed)
    if (!id) return usage(onDone, 'edit <id>')
    const instance = await getProviderInstance(id)
    if (!instance) return notFound(onDone, id)
    return <AddProviderWizard initial={toFlatProviderEntry(instance)} onDone={onDone} />
  }

  if (trimmed === 'enable' || trimmed.startsWith('enable ')) {
    const id = subcommandArg(trimmed)
    if (!id) return usage(onDone, 'enable <id>')
    const instance = await getProviderInstance(id)
    if (!instance) return notFound(onDone, id)
    await upsertProviderInstance({ ...instance, enabled: true, updatedAt: new Date().toISOString() })
    onDone(`Enabled ${instance.displayName}.`, { display: 'system' })
    return
  }

  if (trimmed === 'disable' || trimmed.startsWith('disable ')) {
    const id = subcommandArg(trimmed)
    if (!id) return usage(onDone, 'disable <id>')
    const instance = await getProviderInstance(id)
    if (!instance) return notFound(onDone, id)
    await upsertProviderInstance({ ...instance, enabled: false, updatedAt: new Date().toISOString() })
    onDone(`Disabled ${instance.displayName}.`, { display: 'system' })
    return
  }

  if (trimmed === 'remove' || trimmed.startsWith('remove ')) {
    const id = subcommandArg(trimmed)
    if (!id) return usage(onDone, 'remove <id>')
    const ok = await removeProviderInstance(id)
    onDone(ok ? `Removed provider ${id}.` : `No provider with id ${id}.`, { display: 'system' })
    return
  }

  if (trimmed === 'scan' || trimmed === 'fetch') {
    const results = await refreshAllModels()
    const ok = results.filter(r => r.ok).length
    const fail = results.filter(r => !r.ok)
    const details = results.map(r => `- ${r.instanceId}: ${r.ok ? `${r.modelCount} models` : `ERROR ${r.error}`}`).join('\n')
    const out = `Scan complete: ${ok} ok, ${fail.length} failed.\n${details}`
    onDone(out, { display: 'system' })
    return
  }

  if (trimmed === 'doctor' || trimmed.startsWith('doctor ')) {
    const id = subcommandArg(trimmed)
    if (!id) return usage(onDone, 'doctor <id>')
    const result = await doctorProvider(id)
    const details = result.checks.map(check => `${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`).join('\n')
    onDone(`Provider doctor: ${id} — ${result.ok ? 'healthy' : 'issues found'}\n${details}`, { display: 'system' })
    return
  }

  if (trimmed === 'fallback' || trimmed.startsWith('fallback ')) {
    const rest = trimmed.slice(trimmed.indexOf(' ') + 1).trim()
    const spaceIdx = rest.indexOf(' ')
    const id = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).trim()
    if (!id) return usage(onDone, 'fallback <id> [ref1,ref2,…]')
    const instance = await getProviderInstance(id)
    if (!instance) return notFound(onDone, id)
    const refs = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim()
    const chain = refs ? refs.split(',').map(r => r.trim()).filter(Boolean) : []
    await upsertProviderInstance({
      ...instance,
      config: { ...instance.config, ...(chain.length > 0 ? { fallback: chain } : { fallback: undefined }) },
      updatedAt: new Date().toISOString(),
    })
    onDone(
      chain.length > 0
        ? `Fallback chain for ${instance.displayName} set to: ${chain.join(' → ')}`
        : `Fallback chain for ${instance.displayName} cleared.`,
      { display: 'system' },
    )
    return
  }

  if (trimmed === 'config' || trimmed === 'route' || trimmed.startsWith('config ') || trimmed.startsWith('route ')) {
    const rest = trimmed.includes(' ') ? trimmed.slice(trimmed.indexOf(' ') + 1).trim() : ''
    if (rest === '') {
      const active = getActiveModelSelection()
      const cur = active ? encodeModelRef(active.providerId, active.modelId) : '(none — using base Anthropic)'
      onDone(`Active model: ${cur}\nSet one with /providers config <organization>/<modelId>, or /model.`, { display: 'system' })
      return
    }
    const parsed = parseModelRef(rest)
    if (!parsed) {
      onDone(`Invalid model ref. Expected "<organization>/<model>", e.g. "deepseek/deepseek-v4-pro".`, { display: 'system' })
      return
    }
    const ref = encodeModelRef(parsed.providerId, parsed.modelId)
    setActiveModelSelection({ providerId: parsed.providerId, modelId: parsed.modelId, displayName: modelIdLabel(parsed.modelId) })
    if (trimmed === 'config' || trimmed.startsWith('config ')) {
      // Persist so it survives restart (base reads settings.model / override).
      updateSettingsForSource('userSettings', { model: ref })
      setMainLoopModelOverride(ref)
      onDone(`Config set to ${ref} (persisted).`, { display: 'system' })
    } else {
      onDone(`Active model set to ${ref} (session only).`, { display: 'system' })
    }
    return
  }

  // Bare `/providers` — interactive manage page.
  return <ManageProvidersPage onDone={onDone} />
}

function modelIdLabel(modelId: string): string {
  return modelId
}

/** Convert a stored instance back into the flat edit-wizard shape. */
function toFlatProviderEntry(instance: Awaited<ReturnType<typeof getProviderInstance>>): FlatProviderEntry | undefined {
  if (!instance) return undefined
  return {
    name: instance.id,
    protocol: instance.providerId === 'anthropic' ? 'Anthropic' : 'OpenAI',
    baseURL: instance.config.apiUrl,
    apiKey:
      instance.config.auth.type === 'apiKey'
        ? resolveProviderCredential(instance.config.auth.apiKeyRef)
        : undefined,
  }
}

function subcommandArg(trimmed: string): string {
  const i = trimmed.indexOf(' ')
  return i === -1 ? '' : trimmed.slice(i + 1).trim()
}

function usage(onDone: LocalJSXCommandOnDone, cmd: string): undefined {
  onDone(`Usage: /providers ${cmd}`, { display: 'system' })
  return undefined
}

function notFound(onDone: LocalJSXCommandOnDone, id: string): undefined {
  onDone(`No provider with id ${id}. Run /providers list to see ids.`, { display: 'system' })
  return undefined
}
