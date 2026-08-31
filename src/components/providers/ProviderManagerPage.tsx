/**
 * Provider management page — rendered by the `/providers` command.
 *
 * Composes the Provider Hub services (registry + configStore + health + scan)
 * into a terminal view. It is intentionally a lightweight Ink screen: it reads
 * current state on render and reports results through `onDone`, avoiding deep
 * coupling to the base's store/reconciler internals for the MVP.
 */
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { getEnabledProviders } from '../../provider/defaults.js'
import { getModelScanState } from '../../provider/modelService.js'
import { getCachedHealth } from '../../provider/healthService.js'
import { getCachedQuota } from '../../provider/quotaService.js'
import { redactCredential } from '../../provider/redact.js'
import { getActiveModelSelection } from '../../provider/modelSeam.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { encodeModelRef } from '../../provider/types.js'

interface Row {
  label: string
  value: string
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

/**
 * Renders a plain-text provider overview. Returns a React node that the
 * terminal displays; use `onDone` for `--print`/non-interactive results.
 */
export default function ProviderManagerPage({ onDone }: { onDone: LocalJSXCommandOnDone }): React.ReactNode {
  const [rows, setRows] = React.useState<Row[]>([])
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    void (async () => {
      try {
        const providers = await getEnabledProviders()
        const scanState = await getModelScanState()
        const active = getActiveModelSelection()
        const r: Row[] = [
          { label: 'Providers', value: String(providers.length) },
          { label: 'Active model', value: active ? encodeModelRef(active.providerId, active.modelId) : '(none)' },
          ...providers.flatMap(p => {
            const health = getCachedHealth(p.instance.id)
            const quota = getCachedQuota(p.instance.id)
            const scan = scanState.find(s => s.instanceId === p.instance.id)
            const authDisplay = redactCredential(
              p.instance.config.auth.type === 'apiKey'
                ? p.instance.config.auth.apiKeyRef
                : p.instance.config.auth.type,
            )
            return [
              { label: `• ${p.plugin.name}`, value: `${p.instance.displayName} (${p.instance.enabled ? 'enabled' : 'disabled'})` },
              { label: '  Status', value: formatHealth(health?.status) },
              { label: '  Models', value: `${scan?.modelCount ?? 0}${scan?.cached ? '' : ' (not scanned)'} — ${authDisplay}` },
              { label: '  Quota', value: formatQuotaStatus(quota?.status) },
            ] as Row[]
          }),
        ]
        setRows(r)
        // Snapshot page: report the result through onDone once data is ready
        // (surfaces under `--print`, and closes the command in the REPL).
        onDone(`${r.map(row => `${row.label}: ${row.value}`).join('\n')}\n\nRun /providers scan to refresh models.`)
      } finally {
        setLoaded(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!loaded) {
    return <Text>Loading providers…</Text>
  }
  return (
    <Box flexDirection="column" paddingX={1} paddingTop={0} borderStyle="round" borderColor="gray">
      <Text bold>Provider Hub</Text>
      {rows.map((row, i) => (
        <Text key={i}>{row.label}: {row.value}</Text>
      ))}
    </Box>
  )
}
