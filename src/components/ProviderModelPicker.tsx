/**
 * Provider-aware model picker for `/model`.
 *
 * Redesign of the base ModelPicker: instead of one flat Anthropic-only list,
 * it shows a **Providers tab row** (left/right) and, per provider, a
 * **Models list** (up/down + enter), plus an **Effort row** ([ / ] adjust)
 * for models that support it. Selecting a provider-scoped model also routes
 * through the Provider Hub (`setActiveModelSelection`), so the chosen ref is
 * what `getMainLoopModel()` yields.
 *
 * Reuses the base design-system primitives (`Tabs`, `Select`) and the base
 * model/effort helpers rather than re-implementing them. Written as a normal
 * (non-memoized) component on purpose — the base ModelPicker is React
 * Compiler output (`_c(N)`) and unsafe to hand-edit.
 */
import * as React from 'react'
import { Box, Text, useInput } from '../ink.js'
import { Pane } from './design-system/Pane.js'
import { Tab, Tabs, useTabHeaderFocus } from './design-system/Tabs.js'
import { Select } from './CustomSelect/index.js'
import { effortLevelToSymbol } from './EffortIndicator.js'
import { getEnabledProviders } from '../provider/defaults.js'
import { getUnifiedModelTable } from '../provider/modelService.js'
import { setActiveModelSelection, getActiveModelSelection } from '../provider/modelSeam.js'
import { parseModelRef, encodeModelRef, providerNamespace } from '../provider/types.js'
import { getModelOptions } from '../utils/model/modelOptions.js'
import { getDefaultMainLoopModel, parseUserSpecifiedModel } from '../utils/model/model.js'
import {
  convertEffortValueToLevel,
  type EffortLevel,
  modelSupportsEffort,
  modelSupportsMaxEffort,
  resolvePickerEffortPersistence,
  toPersistableEffort,
} from '../utils/effort.js'
import { useSetAppState } from '../state/AppState.js'
import { getSettingsForSource, updateSettingsForSource } from '../utils/settings/settings.js'
import type { LocalJSXCommandOnDone } from '../types/command.js'

const NO_PREFERENCE = '__NO_PREFERENCE__'

interface ModelEntry {
  value: string
  label: string
  description?: string
}

interface ProviderGroup {
  id: string
  name: string
  isHub: boolean
  models: ModelEntry[]
}

function buildAnthropicModels(): ModelEntry[] {
  // Base curated list (Default + tier options). Carries access gating
  // (1M, allowlists, premium). The Provider Hub provides the other tabs.
  return getModelOptions().map(opt => ({
    value: opt.value === null ? NO_PREFERENCE : opt.value,
    label: opt.label,
    description: opt.descriptionForModel ?? opt.description,
  }))
}

/** Resolve an entry to the real model id (aliases, default sentinel). */
function resolveEntryModel(entry: ModelEntry | undefined): string | undefined {
  if (!entry) return undefined
  if (entry.value === NO_PREFERENCE) return getDefaultMainLoopModel()
  return parseUserSpecifiedModel(entry.value)
}

export function ProviderModelPicker({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const setAppState = useSetAppState()

  const [groups, setGroups] = React.useState<ProviderGroup[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [activeProvider, setActiveProvider] = React.useState<string | undefined>(undefined)
  const [focusedValue, setFocusedValue] = React.useState<string>(NO_PREFERENCE)
  const [effort, setEffort] = React.useState<EffortLevel>('medium')
  const [hasToggledEffort, setHasToggledEffort] = React.useState(false)

  // Load provider groups once.
  React.useEffect(() => {
    void (async () => {
      let all: ProviderGroup[]
      try {
        const enabled = await getEnabledProviders()
        const table = await getUnifiedModelTable()
        const hubGroups: ProviderGroup[] = enabled.map(p => ({
          // Model refs use the provider's *name* (its id) as the prefix, not the
          // internal protocol id — so `DeepSeek::deepseek-chat`, not `openai::…`.
          id: providerNamespace(p.instance.id),
          name: p.instance.displayName || p.instance.id,
          isHub: true,
          models: table
            .filter(d => d.providerId === providerNamespace(p.instance.id))
            .map(d => ({
              value: encodeModelRef(p.instance.id, d.modelId),
              label: d.displayName || d.modelId,
              description: d.contextWindow
                ? `${d.modelId} · ${d.contextWindow.toLocaleString()} ctx`
                : d.modelId,
            })),
        }))
        all = [
          { id: 'anthropic', name: 'Anthropic', isHub: false, models: buildAnthropicModels() },
          ...hubGroups,
        ]
      } catch {
        all = [{ id: 'anthropic', name: 'Anthropic', isHub: false, models: buildAnthropicModels() }]
      }
      setGroups(all)
      const active = getActiveModelSelection()
      setActiveProvider(active ? providerNamespace(active.providerId) : 'anthropic')
      if (active) setFocusedValue(encodeModelRef(active.providerId, active.modelId))
      setLoaded(true)
    })()
  }, [])

  // Esc closes the picker. Handled at the top level (not on the Select) because
  // the Select is disabled while the Provider header is focused — Esc must work
  // from either focus state. The Select's own input never consumes escape, so
  // there is no double-handling.
  const handleEscape = React.useCallback(() => {
    onDone('Kept current model.', { display: 'system' })
  }, [onDone])
  useInput((_input, key) => {
    if (key.escape) handleEscape()
  })

  const currentGroup = groups.find(g => g.id === activeProvider) ?? groups[0] ?? undefined

  function handleSelectOption(value: string): void {
    const group = currentGroup
    const entry = group?.models.find(m => m.value === value)
    const picked = resolveEntryModel(entry)
    const pickedSupportsEffort = picked ? modelSupportsEffort(picked) : false

    // Provider Hub routing: a `providerId::modelId` ref becomes the source of
    // truth; picking a base Anthropic model clears any hub selection.
    const parsed = group?.isHub ? parseModelRef(value) : null
    if (parsed) {
      setActiveModelSelection({ providerId: parsed.providerId, modelId: parsed.modelId, displayName: entry?.label ?? parsed.modelId })
    } else if (group?.id === 'anthropic') {
      setActiveModelSelection(null)
    }

    const defaultEffort: EffortLevel = storedEffortLevel() ?? 'medium'
    const effortLevel = resolvePickerEffortPersistence(
      effort,
      defaultEffort,
      getSettingsForSource('userSettings')?.effortLevel,
      hasToggledEffort,
    )
    const persistable = toPersistableEffort(effortLevel)
    if (persistable !== undefined) {
      updateSettingsForSource('userSettings', { effortLevel: persistable })
    }
    setAppState(prev => ({
      ...prev,
      mainLoopModel: value === NO_PREFERENCE ? null : value,
      mainLoopModelForSession: null,
      ...(pickedSupportsEffort && effortLevel ? { effortValue: effortLevel } : {}),
    }))

    const shown =
      value === NO_PREFERENCE
        ? 'Default'
        : entry?.label ?? value
    const suffix = pickedSupportsEffort && effortLevel ? ` with ${effortLevel} effort` : ''
    onDone(`Set model to ${shown}${suffix}`)
  }

  if (!loaded) {
    return <Box flexDirection="column" paddingX={1}><Text dimColor>Loading models…</Text></Box>
  }
  if (!currentGroup) {
    return <Box flexDirection="column" paddingX={1}><Text>No models available.</Text></Box>
  }

  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Box marginBottom={1} flexDirection="column">
          <Text color="remember" bold>Select model</Text>
          <Text dimColor>Switch between providers and models — applies to this session and future sessions.</Text>
        </Box>
        <Box flexDirection="column" marginBottom={1}>
          <Tabs
            title="Providers:"
            color="claude"
            selectedTab={activeProvider}
            onTabChange={tab => setActiveProvider(tab)}
          >
            {groups.map(g => (
              <Tab key={g.id} title={g.name}>
                <ProviderModelsPanel
                  key={g.id}
                  group={g}
                  focusedValue={focusedValue}
                  onFocusValue={setFocusedValue}
                  effort={effort}
                  onEffortKey={(dir, includeMax) => {
                    setEffort(prev => cycleEffort(prev, dir, includeMax))
                    setHasToggledEffort(true)
                  }}
                  onSelectValue={handleSelectOption}
                />
              </Tab>
            ))}
          </Tabs>
        </Box>
        <Text dimColor italic>
          ← → provider (top) · in list: ← → effort · ↑ ↓ model · Enter confirm · Esc close
        </Text>
      </Box>
    </Pane>
  )
}

function storedEffortLevel(): EffortLevel | undefined {
  const lvl = getSettingsForSource('userSettings')?.effortLevel
  return lvl && (lvl === 'low' || lvl === 'medium' || lvl === 'high' || lvl === 'max') ? lvl : undefined
}

function cycleEffort(current: EffortLevel, dir: -1 | 1, includeMax: boolean): EffortLevel {
  const levels: EffortLevel[] = includeMax ? ['low', 'medium', 'high', 'max'] : ['low', 'medium', 'high']
  const i = levels.indexOf(current)
  return levels[(i + dir + levels.length) % levels.length]!
}

interface PanelProps {
  group: ProviderGroup
  focusedValue: string
  onFocusValue: (v: string) => void
  effort: EffortLevel
  onEffortKey: (dir: -1 | 1, includeMax: boolean) => void
  onSelectValue: (v: string) => void
}

function ProviderModelsPanel({
  group,
  focusedValue,
  onFocusValue,
  effort,
  onEffortKey,
  onSelectValue,
}: PanelProps): React.ReactNode {
  const { headerFocused, focusHeader } = useTabHeaderFocus()
  const focusedModel = resolveEntryModel(group.models.find(m => m.value === focusedValue))
  const supportsEffort = focusedModel ? modelSupportsEffort(focusedModel) : false
  const includeMax = focusedModel ? modelSupportsMaxEffort(focusedModel) : false

  // Left/right adjusts effort ONLY while the model list is focused (headerFocused
  // false). When the Provider header is focused, Tabs owns left/right. This
  // matches the base picker's ← →-to-adjust-effort muscle memory, and lets the
  // header use ← → for provider switching without a key conflict.
  useInput(
    (_input, key) => {
      if (headerFocused || !supportsEffort) return
      if (key.leftArrow) onEffortKey(-1, includeMax)
      else if (key.rightArrow) onEffortKey(1, includeMax)
    },
    { isActive: !headerFocused },
  )

  if (group.models.length === 0) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>No models discovered for {group.name}. Run /providers scan to refresh.</Text>
      </Box>
    )
  }

  const levels: EffortLevel[] = includeMax
    ? ['low', 'medium', 'high', 'max']
    : ['low', 'medium', 'high']

  return (
    <Box flexDirection="column">
      <Select
        key={group.id}
        options={group.models}
        defaultFocusValue={focusedValue === NO_PREFERENCE ? undefined : focusedValue}
        onFocus={onFocusValue}
        onChange={onSelectValue}
        onUpFromFirstItem={focusHeader}
        isDisabled={headerFocused}
        visibleOptionCount={8}
      />
      <Box flexDirection="row" gap={1} marginTop={1}>
        <Text bold color="subtle">Effort:</Text>
        {supportsEffort ? (
          <>
            {levels.map(lv => {
              const activeLv = lv === effort
              return (
                <Text key={lv} dimColor={!activeLv} inverse={activeLv} color={activeLv ? 'claude' : undefined}>
                  {effortLevelToSymbol(lv)} {lv}
                </Text>
              )
            })}
            <Text color="subtle" dimColor>← → adjust</Text>
          </>
        ) : (
          <Text dimColor>not supported for this model</Text>
        )}
      </Box>
    </Box>
  )
}
