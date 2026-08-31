import { describe, expect, test } from 'vitest'
import {
  getRoutedModelFromProviderHub,
  setActiveModelSelection,
  getProviderModelOptions,
  isProviderScopedModel,
  providerIdFromRef,
} from '../modelSeam.js'
import { parseModelRef } from '../types.js'
import { getEffortSuffix, modelSupportsEffort } from '../../utils/effort.js'
import { firstPartyNameToCanonical, normalizeModelStringForAPI } from '../../utils/model/model.js'

describe('modelSeam', () => {
  test('no active selection returns undefined (hub inactive -> base unchanged)', () => {
    setActiveModelSelection(null)
    expect(getRoutedModelFromProviderHub()).toBeUndefined()
  })

  test('active selection returns provider-scoped ref', () => {
    setActiveModelSelection({ providerId: 'openai', modelId: 'gpt-4o', displayName: 'GPT-4o' })
    const ref = getRoutedModelFromProviderHub()
    expect(ref).toBe('openai/gpt-4o')
    expect(parseModelRef(ref!)).toEqual({ providerId: 'openai', modelId: 'gpt-4o' })
    setActiveModelSelection(null)
  })

  test('getProviderModelOptions yields a value+label when active, empty otherwise', () => {
    setActiveModelSelection(null)
    expect(getProviderModelOptions()).toEqual([])

    setActiveModelSelection({ providerId: 'gemini', modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro' })
    const opts = getProviderModelOptions()
    expect(opts[0].value).toBe('gemini/gemini-2.5-pro')
    expect(opts[0].label).toBe('Gemini 2.5 Pro')
    setActiveModelSelection(null)
  })

  test('isProviderScopedModel / providerIdFromRef', () => {
    expect(isProviderScopedModel('openai::gpt-4o')).toBe(true)
    expect(isProviderScopedModel('claude-opus-4-6')).toBe(false)
    expect(providerIdFromRef('gemini::gemini-2.5-pro')).toBe('gemini')
    expect(providerIdFromRef('claude-opus-4-6')).toBeNull()
  })

  test('firstPartyNameToCanonical never misclassifies a provider-scoped name', () => {
    expect(firstPartyNameToCanonical('openai::gpt-4o')).toBe('openai::gpt-4o')
    expect(firstPartyNameToCanonical('ollama::qwen2.5')).toBe('ollama::qwen2.5')
    // Anthropic names still canonicalize normally
    expect(firstPartyNameToCanonical('claude-opus-4-6')).toBe('claude-opus-4-6')
  })
})

describe('normalizeModelStringForAPI (provider-prefix strip)', () => {
  test('strips a provider-scoped prefix so the gateway gets the bare id', () => {
    expect(normalizeModelStringForAPI('openai::gpt-4o')).toBe('gpt-4o')
    expect(normalizeModelStringForAPI('openai::gpt-4o[1m]')).toBe('gpt-4o')
    expect(normalizeModelStringForAPI('gemini::gemini-2.5-pro')).toBe('gemini-2.5-pro')
    expect(normalizeModelStringForAPI('deepseek/deepseek-v4-pro')).toBe('deepseek-v4-pro')
  })

  test('leaves native Anthropic models and single-colon tags untouched', () => {
    expect(normalizeModelStringForAPI('claude-opus-4-6')).toBe('claude-opus-4-6')
    expect(normalizeModelStringForAPI('claude-opus-4-6[1m]')).toBe('claude-opus-4-6')
    expect(normalizeModelStringForAPI('qwen2.5:14b')).toBe('qwen2.5:14b')
  })

  test('provider-scoped models do not inherit first-party effort support', () => {
    expect(modelSupportsEffort('deepseek/deepseek-v4-pro')).toBe(false)
    expect(getEffortSuffix('deepseek/deepseek-v4-pro', 'medium')).toBe('')
  })
})
