/**
 * Per-provider model management — opened from a provider's action menu.
 *
 * Shows that provider's discovered models (scan cache) plus any manually added
 * ids (config.manualModels), and lets the user manage them: add a model id,
 * remove a manual one, re-fetch, or set the active model. Manual ids persist to
 * the instance config, so providers whose upstream doesn't expose a working
 * model-list endpoint are still fully usable — no fixed claude-* ceiling.
 *
 * Views: model list + actions → add (input) / manual-model actions. Esc backs
 * up a level; Esc on the list closes via onClose.
 */
import * as React from 'react'
import { Box, Text, useInput } from '../../ink.js'
import { Pane } from '../design-system/Pane.js'
import { Select } from '../CustomSelect/index.js'
import {
  getProviderInstance,
  upsertProviderInstance,
} from '../../provider/configStore.js'
import { loadModelsCache, invalidateCache } from '../../provider/cache.js'
import { refreshProviderModels } from '../../provider/modelService.js'
import { setActiveModelSelection } from '../../provider/modelSeam.js'
import type { ProviderInstance } from '../../provider/types.js'
import { encodeModelRef, providerNamespace } from '../../provider/types.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const ADD = '__ADD__'
const FETCH = '__FETCH__'
const BACK = '__BACK__'
const SET_ACTIVE = '__SET_ACTIVE__'
const REMOVE = '__REMOVE__'

interface DisplayModel {
  modelId: string
  displayName: string
  contextWindow?: number
  maxOutputTokens?: number
  manual: boolean
}

export function ProviderModelsPage({
  instance,
  onDone,
  onClose,
}: {
  instance: ProviderInstance
  onDone: LocalJSXCommandOnDone
  onClose?: () => void
}): React.ReactNode {
  const [inst, setInst] = React.useState<ProviderInstance>(instance)
  const [models, setModels] = React.useState<DisplayModel[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [fetching, setFetching] = React.useState(false)
  const [notice, setNotice] = React.useState<string | undefined>(undefined)
  const [view, setView] = React.useState<'list' | 'add' | 'manual'>('list')
  const [manualId, setManualId] = React.useState<string | undefined>(undefined)
  const [newModelId, setNewModelId] = React.useState('')

  const reload = React.useCallback(async () => {
    const fresh = (await getProviderInstance(instance.id)) ?? instance
    setInst(fresh)
    const manualIds = new Set(fresh.config.manualModels ?? [])
    const cached = loadModelsCache(providerNamespace(fresh.id)) ?? []
    const merged = new Map<string, DisplayModel>()
    for (const m of cached) {
      merged.set(m.modelId, {
        modelId: m.modelId,
        displayName: m.displayName || m.modelId,
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        manual: manualIds.has(m.modelId),
      })
    }
    for (const id of manualIds) {
      if (!merged.has(id)) {
        merged.set(id, { modelId: id, displayName: id, manual: true })
      }
    }
    setModels([...merged.values()])
    setLoaded(true)
  }, [instance])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const doFetch = React.useCallback(async () => {
    if (fetching) return
    setFetching(true)
    setNotice(undefined)
    const res = await refreshProviderModels(inst.id)
    await reload()
    setFetching(false)
    setNotice(
      res.ok ? `Fetched ${res.modelCount} models.` : `Fetch failed: ${res.error ?? 'unknown'}`,
    )
  }, [fetching, inst.id, reload])

  const addModel = React.useCallback(async () => {
    const id = newModelId
    if (!id) {
      setView('list')
      return
    }
    const manual = [...(inst.config.manualModels ?? [])]
    if (!manual.includes(id)) manual.push(id)
    await upsertProviderInstance({
      ...inst,
      config: { ...inst.config, manualModels: manual },
      updatedAt: new Date().toISOString(),
    })
    setNewModelId('')
    await reload()
    setView('list')
    setNotice(`Added ${id}.`)
  }, [inst, newModelId, reload])

  const removeManual = React.useCallback(async () => {
    if (!manualId) return
    const manual = (inst.config.manualModels ?? []).filter(m => m !== manualId)
    await upsertProviderInstance({
      ...inst,
      config: { ...inst.config, manualModels: manual },
      updatedAt: new Date().toISOString(),
    })
    const removed = manualId
    setManualId(undefined)
    await reload()
    setView('list')
    setNotice(`Removed ${removed}.`)
  }, [inst, manualId, reload])

  // Esc: list → close; add/manual → back to list. (The add view's Select also
  // wires onCancel; both paths end at 'list', so double-firing is harmless.)
  useInput((_input, key) => {
    if (!key.escape) return
    if (view === 'list') {
      if (onClose) onClose()
      else onDone('Closed model management.', { display: 'system' })
    } else {
      setView('list')
    }
  })

  // Manual-model actions: set active or remove.
  if (view === 'manual' && manualId) {
    const model = models.find(m => m.modelId === manualId)
    const options = [
      { value: SET_ACTIVE, label: 'Set active', description: 'Route this session to this model.' },
      { value: REMOVE, label: 'Remove', description: 'Delete this manually-added model.' },
      { value: BACK, label: 'Back', description: 'Return to the model list.' },
    ]
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>{model?.displayName ?? manualId}</Text>
          <Text dimColor>manual model · Esc back</Text>
          <Box marginTop={1}>
            <Select
              options={options}
              onChange={v => {
                if (v === SET_ACTIVE) {
                  setActiveModelSelection({
                    providerId: inst.id,
                    modelId: manualId,
                    displayName: model?.displayName ?? manualId,
                  })
                  onDone(`Active model set to ${encodeModelRef(inst.id, manualId)}`)
                } else if (v === REMOVE) {
                  void removeManual()
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

  // Add model: collect a model id and persist it to config.manualModels.
  if (view === 'add') {
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>Add model to {inst.displayName}</Text>
          <Text dimColor>Type the model id — Enter saves (persists even if the provider's list API doesn't expose it).</Text>
          <Box marginTop={1} flexDirection="column">
            <Select
              options={[
                {
                  value: 'newmodel',
                  type: 'input',
                  label: 'Model id',
                  placeholder: 'e.g. deepseek-r1',
                  onChange: v => setNewModelId(v.trim()),
                },
              ]}
              onChange={() => void addModel()}
              onCancel={() => setView('list')}
              visibleOptionCount={3}
            />
          </Box>
        </Box>
      </Pane>
    )
  }

  // Model list + actions.
  const options = [
    ...models.map(m => ({
      value: m.manual ? `manual:${m.modelId}` : `set:${m.modelId}`,
      label: m.displayName || m.modelId,
      description:
        [
          m.contextWindow ? `${m.contextWindow.toLocaleString()} ctx` : '',
          m.maxOutputTokens ? `max ${m.maxOutputTokens.toLocaleString()} out` : '',
          m.manual ? 'manual' : '',
        ]
          .filter(Boolean)
          .join(' · ') || undefined,
    })),
    { value: ADD, label: '＋ Add model', description: 'Manually add a model id for this provider.' },
    { value: FETCH, label: 'Fetch models', description: "Refresh this provider's model scan." },
    { value: BACK, label: 'Back', description: 'Return to the provider menu.' },
  ]

  function close(): void {
    if (onClose) onClose()
    else onDone('Closed model management.', { display: 'system' })
  }

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Text color="remember" bold>{inst.displayName} models</Text>
        <Text dimColor>Enter to set active · Esc back</Text>
        <Box marginTop={1}>
          <Select
            options={options}
            onChange={v => {
              if (v === ADD) {
                setNewModelId('')
                setView('add')
              } else if (v === FETCH) {
                void doFetch()
              } else if (v === BACK) {
                close()
              } else if (v.startsWith('manual:')) {
                setManualId(v.slice('manual:'.length))
                setView('manual')
              } else if (v.startsWith('set:')) {
                const modelId = v.slice('set:'.length)
                const model = models.find(m => m.modelId === modelId)
                setActiveModelSelection({
                  providerId: inst.id,
                  modelId,
                  displayName: model?.displayName ?? modelId,
                })
                onDone(`Active model set to ${encodeModelRef(inst.id, modelId)}`)
              }
            }}
            visibleOptionCount={10}
          />
        </Box>
        {fetching && (
          <Box marginTop={1}>
            <Text dimColor>Fetching models…</Text>
          </Box>
        )}
        {notice && !fetching && (
          <Box marginTop={1}>
            <Text dimColor>{notice}</Text>
          </Box>
        )}
        {loaded && models.length === 0 && !fetching && (
          <Box marginTop={1}>
            <Text dimColor>No models yet — Add model or Fetch.</Text>
          </Box>
        )}
      </Box>
    </Pane>
  )
}
