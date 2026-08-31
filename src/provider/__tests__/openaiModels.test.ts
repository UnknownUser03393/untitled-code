import { afterEach, describe, expect, test, vi } from 'vitest'

const { requestJson } = vi.hoisted(() => ({ requestJson: vi.fn() }))

vi.mock('../http.js', () => ({ requestJson }))

import { openAIProvider } from '../plugins/openai/index.js'

afterEach(() => {
  requestJson.mockReset()
})

describe('OpenAI protocol model discovery', () => {
  test('custom compatible endpoints return their catalog without OpenAI GPT defaults', async () => {
    requestJson.mockResolvedValue({
      status: 200,
      headers: {},
      body: { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] },
    })

    const models = await openAIProvider.listModels({
      auth: { type: 'none' },
      apiUrl: 'http://127.0.0.1:8000/v1/',
    })

    expect(models.map(model => model.modelId)).toEqual(['deepseek-chat', 'deepseek-reasoner'])
    expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:8000/v1/models',
      headers: { 'Content-Type': 'application/json' },
    }))
  })

  test('env credential references are read from process.env', async () => {
    process.env.PROVIDER_TEST_OPENAI_KEY = 'secret-from-env'
    requestJson.mockResolvedValue({ status: 200, headers: {}, body: { data: [] } })
    try {
      await openAIProvider.listModels({
        auth: { type: 'env', envVar: 'PROVIDER_TEST_OPENAI_KEY' },
        apiUrl: 'http://localhost:9000/v1',
      })
      expect(requestJson).toHaveBeenCalledWith(expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer secret-from-env' }),
      }))
    } finally {
      delete process.env.PROVIDER_TEST_OPENAI_KEY
    }
  })
})
