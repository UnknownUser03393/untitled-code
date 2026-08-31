/**
 * `/providers add` / `edit` wizard.
 *
 * Collects the flat provider format — Name → Protocol → BaseURL → APIKey — and
 * persists it as a flat entry in `providers.json` via `upsertFlatProvider`, the
 * same shape as a hand-written file. `name` doubles as the instance id and the
 * `<name>::<model>` model-ref prefix, so wizard-added and hand-written
 * providers are indistinguishable. Uses the base `Select` with `type:'input'`
 * options for text entry: the option-level `onChange` fires per keystroke
 * (capturing the text), while the Select-level `onChange` fires on Enter
 * (advancing the step).
 *
 * With an `initial` entry the wizard runs in edit mode: the name step is skipped
 * (name = instance id = model-ref prefix, so it is read-only) and a blank API
 * key means "keep the existing stored key".
 */
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { Pane } from '../design-system/Pane.js'
import { Select } from '../CustomSelect/index.js'
import { upsertFlatProvider, type FlatProviderEntry } from '../../provider/configStore.js'
import { refreshProviderModels } from '../../provider/modelService.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const PROTOCOLS = ['Anthropic', 'OpenAI'] as const
type Protocol = (typeof PROTOCOLS)[number]

const DEFAULT_BASE_URL: Record<Protocol, string> = {
  Anthropic: 'https://api.anthropic.com',
  OpenAI: 'https://api.openai.com/v1',
}

export function AddProviderWizard({
  onDone,
  onClose,
  initial,
}: {
  onDone: LocalJSXCommandOnDone
  onClose?: () => void
  /** When set, runs in edit mode — name is read-only, blank key keeps the old one. */
  initial?: FlatProviderEntry
}): React.ReactNode {
  const editing = initial !== undefined
  const [name, setName] = React.useState(initial?.name ?? '')
  const [nameDone, setNameDone] = React.useState(editing)
  const [protocol, setProtocol] = React.useState<Protocol | undefined>(initial?.protocol)
  const [baseUrl, setBaseUrl] = React.useState(initial?.baseURL ?? '')
  const [baseUrlDone, setBaseUrlDone] = React.useState(false)
  const [apiKey, setApiKey] = React.useState(initial?.apiKey ?? '')
  const [saving, setSaving] = React.useState(false)

  const action = editing ? 'Edit' : 'Add'

  function close(): void {
    if (onClose) onClose()
    else onDone(`Canceled ${editing ? 'editing' : 'adding'} a provider.`, { display: 'system' })
  }

  // Step 0: Name — becomes the instance id and model-ref prefix. Skipped in
  // edit mode (name is the identity; renaming it would orphan existing refs).
  if (!nameDone) {
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>Add a provider</Text>
          <Text dimColor>Organization name (e.g. DeepSeek → deepseek/deepseek-v4-pro).</Text>
          <Box marginTop={1} flexDirection="column">
            <Select
              options={[{ value: 'name', type: 'input', label: 'Name', placeholder: 'e.g. DeepSeek', onChange: v => setName(v) }]}
              onChange={() => setNameDone(true)}
              onCancel={close}
              visibleOptionCount={3}
            />
          </Box>
        </Box>
      </Pane>
    )
  }

  // Step 1: Protocol — Anthropic goes native; OpenAI goes through the
  // built-in protocol gateway.
  if (!protocol) {
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>{action} {name.trim()}</Text>
          <Box marginTop={1} flexDirection="column">
            <Select
              options={PROTOCOLS.map(p => ({
                value: p,
                label: p,
                description:
                  p === 'OpenAI'
                    ? 'OpenAI-compatible endpoint (DeepSeek, vLLM, …) — served via the built-in gateway'
                    : 'Anthropic Messages API — direct connection',
              }))}
              onChange={p => setProtocol(p as Protocol)}
              onCancel={() => { if (editing) close(); else setNameDone(false) }}
              visibleOptionCount={3}
            />
          </Box>
        </Box>
      </Pane>
    )
  }

  // Step 2: Base URL — prefilled with the current value or the protocol default
  // (Enter accepts, Tab edits). Empty submit falls back to the default at save.
  if (!baseUrlDone) {
    const def = baseUrl.trim() || DEFAULT_BASE_URL[protocol]
    return (
      <Pane color="permission">
        <Box flexDirection="column">
          <Text color="remember" bold>{action} {name.trim()}</Text>
          <Text dimColor>Base URL — Enter accepts the default, Tab edits it, Esc goes back.</Text>
          <Box marginTop={1} flexDirection="column">
            <Select
              options={[{ value: 'baseurl', type: 'input', label: 'Base URL', initialValue: def, placeholder: def, onChange: v => setBaseUrl(v.trim()), allowEmptySubmitToCancel: true }]}
              onChange={() => setBaseUrlDone(true)}
              onCancel={() => setProtocol(undefined)}
              visibleOptionCount={3}
            />
          </Box>
        </Box>
      </Pane>
    )
  }

  // Step 3: API key — optional (blank = anonymous, e.g. local endpoints).
  // Last step: Enter saves the flat entry and fetches models.
  return (
    <Pane color="permission">
      <Box flexDirection="column">
        <Text color="remember" bold>{action} {name.trim()}</Text>
        <Text dimColor>
          API key (optional — {editing ? 'leave blank to keep the existing key' : 'blank = none for local/anonymous endpoints'}). Enter saves.
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Select
            options={[{ value: 'apikey', type: 'input', label: 'API key', placeholder: 'sk-…', onChange: v => setApiKey(v.trim()), allowEmptySubmitToCancel: true }]}
            onChange={() => void finalize()}
            onCancel={() => setBaseUrlDone(false)}
            visibleOptionCount={3}
          />
        </Box>
        {saving && <Box marginTop={1}><Text dimColor>Saving & fetching models…</Text></Box>}
      </Box>
    </Pane>
  )

  async function finalize(): Promise<void> {
    if (saving) return
    setSaving(true)
    try {
      await upsertFlatProvider({
        name: name.trim(),
        protocol: protocol!,
        baseURL: baseUrl.trim() || DEFAULT_BASE_URL[protocol!],
        apiKey: apiKey.trim() || undefined,
      })
      await refreshProviderModels(name.trim())
      onDone(`${action}ed ${name.trim()} (${protocol}). Pick a model with /model.`)
    } catch (error) {
      setSaving(false)
      onDone(`Failed to ${editing ? 'update' : 'add'} ${name.trim()}: ${error instanceof Error ? error.message : 'unknown'}`, { display: 'system' })
    }
  }
}
