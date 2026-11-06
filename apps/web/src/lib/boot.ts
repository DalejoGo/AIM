/**
 * The page's first script, inline in <head> before anything else runs. Base.astro writes it and astro.config.ts
 * allows exactly this text in the CSP by its hash: it is a plain string so both see the same bytes (editing it
 * changes the hash on the next build, with nothing else to update).
 *
 * 1. Zod runs without `new Function` (its "jitless" mode). The CSP has no 'unsafe-eval', and Zod decides when
 *    each schema is built, as @aim/contracts loads, so the setting must exist before any island's code runs.
 *    Zod reads this shared object when it loads (it is what `z.config()` returns; boot.test.ts checks it).
 * 2. The saved preferences (theme and currency) apply before the first paint. src/lib/preferences.ts is the
 *    runtime API that islands use afterwards.
 */
export const BOOT_SCRIPT = `(() => {
  globalThis.__zod_globalConfig = { ...globalThis.__zod_globalConfig, jitless: true }
  const root = document.documentElement
  let theme
  let currency
  try {
    theme = localStorage.getItem('aim-theme')
    currency = localStorage.getItem('aim-currency')
  } catch {}
  root.dataset.theme = theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  root.dataset.currency = currency || (/-CO$/i.test(navigator.language) ? 'COP' : 'USD')
})()`
