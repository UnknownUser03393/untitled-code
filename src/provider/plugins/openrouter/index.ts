/**
 * OpenRouter provider — OpenAI-compatible gateway that proxies many models.
 */
import { createOpenAiCompatiblePlugin } from '../openaiCompatible/index.js'
import { CHAT_TOOLS_CAPABILITIES } from '../common.js'

export const openRouterProvider = createOpenAiCompatiblePlugin({
  id: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  builtin: [
    { id: 'anthropic/claude-3.5-sonnet', displayName: 'Claude 3.5 Sonnet', contextWindow: 200000, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'openai/gpt-4o', displayName: 'GPT-4o', contextWindow: 128000, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'google/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', contextWindow: 1048576, capabilities: CHAT_TOOLS_CAPABILITIES },
  ],
})
