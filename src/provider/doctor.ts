import { getActiveProviders } from './defaults.js'
import { refreshProviderModels } from './modelService.js'
import { loadModelsCache } from './cache.js'
import { resolveProviderCredential } from './credentials.js'
import { encodeModelRef, providerNamespace } from './types.js'

export interface DoctorCheck { name: string; ok: boolean; detail: string }
export interface ProviderDoctorResult { instanceId: string; ok: boolean; checks: DoctorCheck[] }

export async function doctorProvider(instanceId: string): Promise<ProviderDoctorResult> {
  const target = (await getActiveProviders()).find(provider => providerNamespace(provider.instance.id) === providerNamespace(instanceId))
  if (!target) return { instanceId, ok: false, checks: [{ name: 'configuration', ok: false, detail: 'provider instance not found' }] }

  const { instance, plugin } = target
  const checks: DoctorCheck[] = []
  const endpoint = instance.config.apiUrl ||
    (instance.config.auth.type === 'apiKey' || instance.config.auth.type === 'env' ? instance.config.auth.baseUrl : undefined)
  checks.push({ name: 'configuration', ok: Boolean(endpoint), detail: endpoint ? `${instance.providerId} · ${endpoint}` : 'missing base URL' })

  const credential = instance.config.auth.type === 'apiKey'
    ? resolveProviderCredential(instance.config.auth.apiKeyRef)
    : instance.config.auth.type === 'env'
      ? resolveProviderCredential(`env:${instance.config.auth.envVar}`)
      : instance.config.auth.type === 'none' ? '(keyless)' : ''
  checks.push({ name: 'credential', ok: Boolean(credential), detail: credential ? (credential === '(keyless)' ? 'keyless endpoint' : 'credential resolved') : 'credential unavailable' })

  const scan = await refreshProviderModels(instance.id)
  checks.push({ name: 'models', ok: scan.ok && scan.modelCount > 0, detail: scan.ok ? `${scan.modelCount} model(s)` : (scan.error ?? 'scan failed') })
  const model = (loadModelsCache(providerNamespace(instance.id)) ?? [])[0]
  checks.push({ name: 'routing', ok: Boolean(model), detail: model ? encodeModelRef(instance.id, model.modelId) : 'no routable model' })

  if (model) {
    try {
      const response = await plugin.chat(instance.config, { model: model.modelId, messages: [{ role: 'user', content: 'Reply OK' }], maxTokens: 1 })
      checks.push({ name: 'request', ok: true, detail: `minimal request succeeded (${response.model})` })
    } catch (error) {
      checks.push({ name: 'request', ok: false, detail: error instanceof Error ? error.message : 'request failed' })
    }
  }
  return { instanceId, ok: checks.every(check => check.ok), checks }
}
