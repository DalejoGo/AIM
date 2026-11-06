import preact from '@astrojs/preact'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import { BOOT_SCRIPT } from './src/lib/boot'
import { CSP_SCRIPT_RESOURCES, CSP_STYLE_RESOURCES, cspDirectives, cspHash } from './src/lib/csp'

// No host is hard-coded (DEC-007): the public URL comes from the environment.
const site = process.env.PUBLIC_BASE_URL ?? 'http://localhost:4321'

/** Private pages stay out of the sitemap (they also carry noindex). */
const PRIVATE_PATHS = ['/admin/']

export default defineConfig({
  site,
  output: 'static',
  trailingSlash: 'always',
  devToolbar: { enabled: false },
  // Content Security Policy as a <meta> on every page, with the hashes of the scripts and styles Astro emits
  // (src/lib/csp.ts explains each directive). Islands use classes, never inline style attributes.
  security: {
    csp: {
      algorithm: 'SHA-256',
      directives: cspDirectives({ connectTo: [process.env.PUBLIC_PLAYGROUND_API_URL] }),
      scriptDirective: { resources: CSP_SCRIPT_RESOURCES, hashes: [cspHash(BOOT_SCRIPT)] },
      styleDirective: { resources: CSP_STYLE_RESOURCES },
    },
  },
  // Shiki colours code blocks with inline style attributes, which the CSP blocks; Prism only adds classes.
  markdown: { syntaxHighlight: 'prism' },
  integrations: [
    preact(),
    sitemap({ filter: (page) => !PRIVATE_PATHS.some((path) => new URL(page).pathname.startsWith(path)) }),
  ],
  vite: {
    plugins: [tailwindcss()],
    // Fonts are always files: font-src only allows 'self', and a font inlined as a data: URI would be blocked.
    // Everything else keeps Vite's default limit (undefined).
    build: { assetsInlineLimit: (file: string) => (/\.woff2?$/.test(file) ? false : undefined) },
  },
})
