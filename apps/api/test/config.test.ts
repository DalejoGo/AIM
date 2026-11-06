import { describe, expect, it } from 'vitest'
import { DEFAULT_SANDBOX_LIMITS, loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('has safe defaults', () => {
    expect(loadConfig({})).toEqual({
      port: 3000,
      corsOrigins: [],
      rateLimit: { limit: 60, ttlMs: 60_000 },
      sandbox: { ttlMs: 30 * 60_000, maxSandboxes: 500, maxTasksPerSandbox: 50 },
    })
    expect(DEFAULT_SANDBOX_LIMITS.maxTasksPerSandbox).toBe(50)
  })

  it('takes the port from PORT (Render) before API_PORT', () => {
    expect(loadConfig({ API_PORT: '4000' }).port).toBe(4000)
    expect(loadConfig({ PORT: '10000', API_PORT: '4000' }).port).toBe(10000)
  })

  it('splits API_CORS_ORIGINS and reads API_RATE_LIMIT', () => {
    const config = loadConfig({
      API_CORS_ORIGINS: ' https://a.example ,https://b.example,',
      API_RATE_LIMIT: '5',
    })
    expect(config.corsOrigins).toEqual(['https://a.example', 'https://b.example'])
    expect(config.rateLimit.limit).toBe(5)
  })

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ API_RATE_LIMIT: 'many' })).toThrow(/API_RATE_LIMIT/)
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/)
  })
})
