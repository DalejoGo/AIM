import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// No host is hard-coded (DEC-007): the public URL comes from the environment.
const site = process.env.PUBLIC_BASE_URL ?? 'http://localhost:4321'

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  integrations: [preact(), sitemap()],
  vite: { plugins: [tailwindcss()] },
})
