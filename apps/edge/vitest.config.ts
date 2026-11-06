import { defineConfig } from 'vitest/config'

// Every test gets its own PGlite (Postgres in WebAssembly); a few workers keep memory and CPU in check.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
