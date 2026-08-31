/**
 * DeepSeek provider — OpenAI-compatible wire format.
 */
import { createOpenAiCompatiblePlugin } from '../openaiCompatible/index.js'
import { CHAT_TOOLS_CAPABILITIES } from '../common.js'

export const deepSeekProvider = createOpenAiCompatiblePlugin({
  id: 'deepseek',
  name: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  builtin: [
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat', contextWindow: 64000, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', contextWindow: 64000, capabilities: CHAT_TOOLS_CAPABILITIES },
  ],
})
