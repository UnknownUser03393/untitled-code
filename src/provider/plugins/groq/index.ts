/**
 * Groq provider — OpenAI-compatible wire format, fast inference gateway.
 */
import { createOpenAiCompatiblePlugin } from '../openaiCompatible/index.js'
import { CHAT_TOOLS_CAPABILITIES } from '../common.js'

export const groqProvider = createOpenAiCompatiblePlugin({
  id: 'groq',
  name: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  builtin: [
    { id: 'llama-3.3-70b-versatile', displayName: 'Llama 3.3 70B Versatile', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'llama-3.1-8b-instant', displayName: 'Llama 3.1 8B Instant', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'mixtral-8x7b-32768', displayName: 'Mixtral 8x7B', contextWindow: 32768, capabilities: CHAT_TOOLS_CAPABILITIES },
  ],
})
