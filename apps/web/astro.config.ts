import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

// No host is hard-coded (DEC-007): the public URL comes from the environment.
const site = process.env.PUBLIC_BASE_URL ?? 'http://localhost:4321'

/** Private pages stay out of the sitemap (they also carry noindex). */
const PRIVATE_PATHS = ['/admin/']

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  integrations: [
    preact(),
    sitemap({ filter: (page) => !PRIVATE_PATHS.some((path) => new URL(page).pathname.startsWith(path)) }),
  ],
  vite: { plugins: [tailwindcss()] },
})
