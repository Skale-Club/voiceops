import { vi, beforeEach } from 'vitest'

describe('Redis singleton — src/lib/redis.ts', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exports a default redis client object', async () => {
    // Stub REDIS_URL to a local value so connect() does not throw on missing env
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    const mod = await import('@/lib/redis')
    expect(mod.default).toBeDefined()
  })

  it('module loads without crashing when REDIS_URL is set', async () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    // Should not throw during module evaluation
    await expect(import('@/lib/redis')).resolves.toBeDefined()
  })
})
