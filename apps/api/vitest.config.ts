import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

// Vitest's default transform (esbuild) drops decorator metadata, which NestJS needs for dependency injection.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: { include: ['test/**/*.test.ts', 'src/**/*.test.ts'] },
})
