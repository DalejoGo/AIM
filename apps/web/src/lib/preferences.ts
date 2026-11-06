import type { Currency } from '@aim/contracts'

/**
 * Visitor preferences (theme and currency) live as attributes on <html> so static HTML and islands agree.
 * The inline script in Base.astro applies them before paint; this module is the runtime API for islands.
 */

export type Theme = 'light' | 'dark'

export const CURRENCY_EVENT = 'aim:currency'
const STORAGE = { theme: 'aim-theme', currency: 'aim-currency' } as const

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the choice still applies to this page.
  }
}

export function getCurrency(): Currency {
  return document.documentElement.dataset.currency === 'USD' ? 'USD' : 'COP'
}

export function setCurrency(currency: Currency): void {
  document.documentElement.dataset.currency = currency
  store(STORAGE.currency, currency)
  document.dispatchEvent(new CustomEvent<Currency>(CURRENCY_EVENT, { detail: currency }))
}

/** Calls `listener` whenever the visitor switches currency. Returns the unsubscribe function. */
export function onCurrencyChange(listener: (currency: Currency) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<Currency>).detail)
  document.addEventListener(CURRENCY_EVENT, handler)
  return () => document.removeEventListener(CURRENCY_EVENT, handler)
}

export function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  store(STORAGE.theme, theme)
}
