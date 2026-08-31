/**
 * Ollama provider — local model runner, OpenAI-compatible endpoint (no API key).
 *
 * Ollama exposes an OpenAI-compatible API at `http://localhost:11434/v1`, so it
 * can reuse the generic plugin factory. Auth is `none` (local daemon), so the
 * factory's `apiKey` path is bypassed by setting the auth type to `env` with a
 * harmless var, or by providing a built-in no-op. We use the factory with a
 * permissive key handling.
 */
import { createOpenAiCompatiblePlugin } from '../openaiCompatible/index.js'
import { CHAT_TOOLS_CAPABILITIES } from '../common.js'

export const ollamaProvider = createOpenAiCompatiblePlugin({
  id: 'ollama',
  name: 'Ollama',
  baseUrl: 'http://localhost:11434/v1',
  noAuth: true,
  builtin: [
    { id: 'llama3.2', displayName: 'Llama 3.2', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'qwen2.5', displayName: 'Qwen 2.5', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
    { id: 'phi4', displayName: 'Phi 4', contextWindow: 131072, capabilities: CHAT_TOOLS_CAPABILITIES },
  ],
})
