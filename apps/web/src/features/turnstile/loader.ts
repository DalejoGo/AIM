/**
 * Cloudflare Turnstile, loaded once per page with explicit rendering. Cloudflare asks that the script is
 * always fetched from this exact address (no proxy, no copy).
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export interface TurnstileOptions {
  sitekey: string
  action?: string
  theme?: 'light' | 'dark' | 'auto'
  language?: string
  size?: 'normal' | 'flexible' | 'compact'
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'timeout-callback'?: () => void
  'error-callback'?: (code: string) => void
}

/** The part of `window.turnstile` this site uses. E2E tests define a fake with the same shape. */
export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileOptions): string | undefined
  reset(widgetId: string): void
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | null = null

/**
 * Resolves with `window.turnstile`, adding the script the first time. If something already defined
 * `window.turnstile` (a fake in tests), it is used as is. A failed load can be retried.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('Turnstile loaded without window.turnstile'))
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Turnstile script failed to load'))
    }
    document.head.append(script)
  }).catch((error: unknown) => {
    loading = null
    throw error
  })
  return loading
}
