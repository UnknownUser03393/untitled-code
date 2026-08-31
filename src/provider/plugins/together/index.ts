/**
 * Together AI provider — OpenAI-compatible wire format.
 */
import { createOpenAiCompatiblePlugin } from '../openaiCompatible/index.js'
import { CHAT_TOOLS_CAPABILITIES } from '../common.js'

export const togetherProvider = createOpenAiCompatiblePlugin({
  id: 'together',
  name: 'Together AI',
  baseUrl: 'https://api.together.xyz/v1',
  builtin: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', displayName: 'Llama 3.3 70B Instruct', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', displayName: 'Qwen 2.5 72B Instruct', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
  ],
})
