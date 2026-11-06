import { describe, expect, it } from 'vitest'
import { config } from 'zod'
import { BOOT_SCRIPT } from './boot'

describe('BOOT_SCRIPT', () => {
  it('turns on Zod jitless mode through the global config Zod reads', () => {
    expect(BOOT_SCRIPT).toContain(
      'globalThis.__zod_globalConfig = { ...globalThis.__zod_globalConfig, jitless: true }',
    )
    // If a Zod upgrade renames its shared config, this fails before the CSP starts reporting `eval`.
    expect(config()).toBe((globalThis as { __zod_globalConfig?: unknown }).__zod_globalConfig)
  })

  it('applies the saved theme and currency', () => {
    expect(BOOT_SCRIPT).toContain("localStorage.getItem('aim-theme')")
    expect(BOOT_SCRIPT).toContain("localStorage.getItem('aim-currency')")
  })
})
