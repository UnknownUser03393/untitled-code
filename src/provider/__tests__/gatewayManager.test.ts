import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadProviderInstances: vi.fn(),
  startGateway: vi.fn(),
  stopGateway: vi.fn(async () => undefined),
}))

vi.mock('../configStore.js', () => ({ loadProviderInstances: mocks.loadProviderInstances }))
vi.mock('../gateway/server.js', () => ({ startGateway: mocks.startGateway, stopGateway: mocks.stopGateway }))

describe('gateway instance switching', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.startGateway.mockReset()
    mocks.stopGateway.mockClear()
    // The manager asserts the env var is not left set; isolate it so a
    // developer's own ANTHROPIC_BASE_URL doesn't leak into the assertion.
    delete process.env.ANTHROPIC_BASE_URL
    mocks.loadProviderInstances.mockResolvedValue([
      { id: 'A', displayName: 'A', providerId: 'openai', enabled: true, config: { auth: { type: 'none' }, apiUrl: 'http://a/v1' } },
      { id: 'B', displayName: 'B', providerId: 'openai', enabled: true, config: { auth: { type: 'none' }, apiUrl: 'http://b/v1' } },
    ])
    mocks.startGateway.mockImplementation(() => ({ on: vi.fn() }))
  })

  test('stops and reconfigures the gateway when the instance changes', async () => {
    const { ensureGatewayStarted } = await import('../gateway/manager.js')
    expect(await ensureGatewayStarted('A')).toBe(true)
    expect(await ensureGatewayStarted('B')).toBe(true)
    expect(mocks.startGateway).toHaveBeenNthCalledWith(1, expect.objectContaining({ apiUrl: 'http://a/v1' }))
    expect(mocks.startGateway).toHaveBeenNthCalledWith(2, expect.objectContaining({ apiUrl: 'http://b/v1' }))
    expect(mocks.stopGateway).toHaveBeenCalledTimes(1)
    expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})
