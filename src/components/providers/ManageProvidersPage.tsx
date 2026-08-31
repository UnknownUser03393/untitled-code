/**
 * Interactive provider manager — the bare `/providers` view.
 *
 * Lists configured instances; Enter on one opens an action menu
 * (enable/disable/remove); a leading entry launches the add wizard.
 * Read-only detail snapshots (health/quota) live in ProviderManagerPage.
 */
import * as React from 'react'
import { Box, Text, useInput } from '../../ink.js'
import { Pane } from '../design-system/Pane.js'
import { Select } from '../CustomSelect/index.js'
import { AddProviderWizard } from './AddProviderWizard.js'
import { ProviderModelsPage } from './ProviderModelsPage.js'
import {
  loadProviderInstances,
  upsertProviderInstance,
  removeProviderInstance,
  type FlatProviderEntry,
} from '../../provider/configStore.js'
import { refreshAllModels, getModelScanState } from '../../provider/modelService.js'
import { doctorProvider } from '../../provider/doctor.js'
import { resolveProviderCredential } from '../../provider/credentials.js'
import { getCachedHealth } from '../../provider/healthService.js'
import { getCachedQuota } from '../../provider/quotaService.js'
import { loadScanCache } from '../../provider/cache.js'
import { getActiveModelSelection } from '../../provider/modelSeam.js'
import { encodeModelRef, providerNamespace } from '../../provider/types.js'
import type { ProviderInstance } from '../../provider/types.js'
import type { ProviderDoctorResult } from '../../provider/doctor.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const ADD = '__ADD__'
const FETCH = '__FETCH__'

export function ManageProvidersPage({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const [instances, setInstances] = React.useState<ProviderInstance[]>([])
  const [scanState, setScanState] = React.useState<Awaited<ReturnType<typeof getModelScanState>>>([])
  const [loaded, setLoaded] = React.useState(false)
  const [view, setView] = React.useState<'list' | 'actions' | 'wizard' | 'models' | 'doctor' | 'status' | 'fetching'>('list')
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined)
  const [editing, setEditing] = React.useState<ProviderInstance | undefined>(undefined)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)

  const reload = React.useCallback(async () => {
    setInstances(await loadProviderInstances())
    setScanState(await getModelScanState())
    setLoaded(true)
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const doFetch = React.useCallback(async () => {
    if (view === 'fetching') return
    setView('fetching')
    setNotice(undefined)
    const results = await refreshAllModels()
    const ok = results.filter(r => r.ok).length
    const fail = results.filter(r => !r.ok).length
    setNotice(`Fetched: ${ok} provider(s) ok${fail ? `, ${fail} failed` : ''}.`)
    setView('list')
    void reload()
  }, [view, reload])

  // Esc: actions → list; wizard/model management/doctor/status/fetching handle their own; list → close.
  useInput((_input, key) => {
    if (!key.escape) return
    if (view === 'wizard' || view === 'models' || view === 'doctor' || view === 'status' || view === 'fetching') return
    if (view === 'actions') {
      setView('list')
      setSelectedId(undefined)
    } else {
      onDone('Closed provider manager.', { display: 'system' })
    }
  })

  if (view === 'wizard') {
    return (
      <AddProviderWizard
        initial={editing ? toFlatProviderEntry(editing) : undefined}
        onDone={msg => {
          setView('list')
          setEditing(undefined)
          void reload()
          // Surface the result as a system note alongside the refreshed list.
          onDone(msg, { display: 'system' })
        }}
        onClose={() => {
          setView('list')
          setEditing(undefined)
          void reload()
        }}
      />
    )
  }

  if (view === 'doctor') {
    const target = instances.find(i => i.id === selectedId)
    if (target) {
      return (
        <ProviderDoctorView
          instanceId={target.id}
          onBack={() => {
            setView('actions')
          }}
        />
      )
    }
    // Selected provider went away — fall through to the list.
  }

  if (view === 'status') {
    const target = instances.find(i => i.id === selectedId)
    if (target) {
      return (
        <ProviderStatusView
          instance={target}
          onBack={() => {
            setView('actions')
          }}
        />
      )
    }
    // Selected provider went away — fall through to the list.
  }

  if (view === 'models') {
    const target = instances.find(i => i.id === selectedId)
    if (target) {
      return (
        <ProviderModelsPage
          instance={target}
          onDone={onDone}
          onClose={() => {
            setView('list')
            setSelectedId(undefined)
            void reload()
          }}
        />
      )
    }
    // Selected provider went away — fall through to the list.
  }

  if (view === 'fetching') {
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>Providers</Text>
          <Text dimColor>Fetching models…</Text>
        </Box>
      </Pane>
    )
  }

  const selected = instances.find(i => i.id === selectedId)

  if (view === 'actions' && selected) {
    const actions = [
      { value: 'toggle', label: selected.enabled ? 'Disable' : 'Enable', description: selected.enabled ? 'Stop scanning/routing this provider (kept).' : 'Resume scanning/routing this provider.' },
      { value: 'models', label: 'Models', description: 'View and manage this provider’s models (add, remove, fetch, set active).' },
      { value: 'doctor', label: 'Test connection', description: 'Run config, credential, model-scan, and minimal-request checks.' },
      { value: 'status', label: 'Status', description: 'Health, model count, quota, and last scan result.' },
      { value: 'edit', label: 'Edit', description: 'Change protocol, base URL, or API key.' },
      { value: 'remove', label: 'Remove', description: 'Delete this provider instance permanently.' },
      { value: 'back', label: 'Back', description: 'Return to the provider list.' },
    ]
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>{selected.displayName}</Text>
          <Text dimColor>{selected.providerId} · {selected.enabled ? 'enabled' : 'disabled'}</Text>
          <Box marginTop={1}>
            <Select
              options={actions}
              onChange={async v => {
                if (v === 'toggle') {
                  await upsertProviderInstance({ ...selected, enabled: !selected.enabled, updatedAt: new Date().toISOString() })
                  setView('list')
                  void reload()
                } else if (v === 'models') {
                  setView('models')
                } else if (v === 'doctor') {
                  setView('doctor')
                } else if (v === 'status') {
                  setView('status')
                } else if (v === 'edit') {
                  setEditing(selected)
                  setView('wizard')
                } else if (v === 'remove') {
                  await removeProviderInstance(selected.id)
                  setView('list')
                  void reload()
                } else {
                  setView('list')
                }
              }}
              visibleOptionCount={10}
            />
          </Box>
        </Box>
      </Pane>
    )
  }

  const options = [
    ...instances.map(i => ({
      value: i.id,
      label: i.displayName,
      description: describeInstance(i, scanState.find(s => s.instanceId === i.id)),
    })),
    { value: ADD, label: '＋ Add provider', description: 'Configure a new provider (Anthropic or OpenAI).' },
    { value: FETCH, label: 'Fetch models', description: 'Refresh model scans for all providers.' },
  ]

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Text color="remember" bold>Providers</Text>
        <Text dimColor>Enter to manage · Esc to close</Text>
        <Box marginTop={1}>
          <Select
            options={options}
            onChange={v => {
              if (v === ADD) {
                setEditing(undefined)
                setView('wizard')
              } else if (v === FETCH) {
                void doFetch()
              } else {
                setSelectedId(v)
                setView('actions')
              }
            }}
            visibleOptionCount={10}
          />
        </Box>
        {notice && (
          <Box marginTop={1}>
            <Text dimColor>{notice}</Text>
          </Box>
        )}
        {loaded && instances.length === 0 && (
          <Box marginTop={1}>
            <Text dimColor>No providers configured yet — add one above.</Text>
          </Box>
        )}
      </Box>
    </Pane>
  )
}

function formatHealth(status?: string): string {
  if (!status) return 'Not checked'
  if (status === 'ok') return 'Connected'
  if (status === 'degraded') return 'Degraded'
  if (status === 'down') return 'Down'
  return 'Unknown'
}

function formatQuotaStatus(status?: string): string {
  if (!status) return 'Not queried'
  if (status === 'unsupported') return 'Unsupported by provider API'
  if (status === 'available') return 'Available'
  if (status === 'partial') return 'Partial'
  if (status === 'error') return 'Error'
  return status
}

function describeInstance(instance: ProviderInstance, scan?: Awaited<ReturnType<typeof getModelScanState>>[number]): string {
  const base = `${instance.providerId} · ${instance.enabled ? 'enabled' : 'disabled'}`
  if (scan?.error) return `${base} · scan failed: ${scan.error}`
  return base
}

/** Convert a stored instance back into the flat edit-wizard shape. */
function toFlatProviderEntry(instance: ProviderInstance): FlatProviderEntry {
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

/** Live status snapshot: cached health, model count + last scan, quota, active model. */
function ProviderStatusView({ instance, onBack }: { instance: ProviderInstance; onBack: () => void }): React.ReactNode {
  const namespace = providerNamespace(instance.id)
  const health = getCachedHealth(instance.id)
  const quota = getCachedQuota(instance.id)
  const scan = loadScanCache(namespace)
  const active = getActiveModelSelection()
  const activeModel =
    active && providerNamespace(active.providerId) === namespace
      ? encodeModelRef(active.providerId, active.modelId)
      : undefined

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Text color="remember" bold>Status — {instance.displayName}</Text>
        <Text>Health: {formatHealth(health?.status)}{health?.message ? ` (${health.message})` : ''}</Text>
        <Text>
          Models: {scan?.modelCount ?? 0}{scan?.ok === false && scan.error ? ` — scan failed: ${scan.error}` : ''}
        </Text>
        <Text>Quota: {formatQuotaStatus(quota?.status)}</Text>
        <Text>Active model: {activeModel ?? '(none)'}</Text>
        <Box marginTop={1}>
          <Select
            options={[{ value: 'back', label: 'Back', description: 'Return to provider actions.' }]}
            onChange={() => onBack()}
            visibleOptionCount={3}
          />
        </Box>
      </Box>
    </Pane>
  )
}

/** Live "test connection" view — runs the same checks as `/providers doctor`. */
function ProviderDoctorView({ instanceId, onBack }: { instanceId: string; onBack: () => void }): React.ReactNode {
  const [running, setRunning] = React.useState(true)
  const [result, setResult] = React.useState<ProviderDoctorResult | null>(null)

  React.useEffect(() => {
    void doctorProvider(instanceId).then(res => {
      setResult(res)
      setRunning(false)
    })
  }, [instanceId])

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Text color="remember" bold>Test connection — {instanceId}</Text>
        {running && <Text dimColor>Running checks…</Text>}
        {result && (
          <Box flexDirection="column" marginTop={1}>
            {result.checks.map(check => (
              <Text key={check.name}>{check.ok ? '✓' : '✗'} {check.name}: {check.detail}</Text>
            ))}
          </Box>
        )}
        <Box marginTop={1}>
          <Select
            options={[{ value: 'back', label: 'Back', description: 'Return to provider actions.' }]}
            onChange={() => onBack()}
            visibleOptionCount={3}
          />
        </Box>
      </Box>
    </Pane>
  )
}
