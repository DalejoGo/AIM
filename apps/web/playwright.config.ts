import { defineConfig, devices } from '@playwright/test'

const port = 4322

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
    command: `node e2e/serve.mjs ${port}`,
    port,
    reuseExistingServer: !process.env.CI,
  },
})
