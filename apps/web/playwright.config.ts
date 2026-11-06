import { defineConfig, devices } from '@playwright/test'

// E2E_PORT and E2E_DIST let a run test another build folder without touching dist/ (e.g. parallel builds).
const port = Number(process.env.E2E_PORT ?? 4322)
const dist = process.env.E2E_DIST ? ` ${JSON.stringify(process.env.E2E_DIST)}` : ''

// E2E and accessibility checks against the production build (run `pnpm build` first).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 320, height: 640 } } },
  ],
  webServer: {
    command: `node e2e/serve.mjs ${port}${dist}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
})
