/**
 * The seam that connects the Provider Hub to the base model selection layer.
 *
 * `getMainLoopModel()` in src/utils/model/model.ts calls
 * {@link getRoutedModelFromProviderHub}. When the hub has an active routing
 * decision, it returns the provider-scoped model ref (`providerId::modelId`);
 * otherwise it returns `undefined` so the base falls through to its normal
 * Anthropic logic. This keeps the base unchanged when the hub is inactive
 * (regression-safe), and makes the hub selectable when it is active.
 *
 * `getProviderModelOptions` feeds the `/model` picker with discoverable models.
 */
import type { ModelName } from '../utils/model/model.js'
import { encodeModelRef, parseModelRef, providerNamespace } from './types.js'

export interface ActiveModelSelection {
  providerId: string
  modelId: string
  displayName: string
}

// Module-level active selection (MVP: a single default, set via routeSelectedModel
// or the providers UI). Persisted selections live elsewhere; this is the live
// in-session state that getMainLoopModel reads.
let activeSelection: ActiveModelSelection | null = null

export function setActiveModelSelection(selection: ActiveModelSelection | null): void {
  activeSelection = selection
}

export function getActiveModelSelection(): ActiveModelSelection | null {
  return activeSelection
}

/**
 * The ref the base should use as the main-loop model, or `undefined` when the
 * hub is not routing this session.
 */
export function getRoutedModelFromProviderHub(): ModelName | undefined {
  if (!activeSelection) return undefined
  return encodeModelRef(activeSelection.providerId, activeSelection.modelId) as ModelName
}

/**
 * Build model options for the `/model` picker from the hub. Each option's value
 * is the provider-scoped ref so selecting it routes through the hub.
 */
export function getProviderModelOptions(): Array<{ value: string; label: string; description?: string }> {
  // MVP: options come from the active selection only. A fuller implementation
  // would enumerate discovered models (see getUnifiedModelTable). Kept minimal
  // to avoid coupling the picker to cache/network at import time.
  const s = activeSelection
  if (!s) return []
  return [{ value: encodeModelRef(s.providerId, s.modelId), label: s.displayName, description: providerNamespace(s.providerId) }]
}

/** True if a model ref is provider-scoped (has a pre-colon namespace). */
export function isProviderScopedModel(ref: string): boolean {
  return parseModelRef(ref) !== null
}

/** Infer the provider id from a chosen model option value (or null if unnamespaced). */
export function providerIdFromRef(ref: string): string | null {
  return parseModelRef(ref)?.providerId ?? null
}
