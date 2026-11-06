/** Cloudflare's test site key that always passes (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
export const TURNSTILE_TEST_SITE_KEY = '1x00000000000000000000AA'

interface SiteKeyEnv {
  /** PUBLIC_TURNSTILE_SITE_KEY */
  siteKey?: string
  /** APP_ENV: development, staging or production */
  appEnv?: string
}

/**
 * The Turnstile site key for this build. Outside production the test key is the fallback, so local runs,
 * CI and E2E work without an account; a production build without a real key fails instead of shipping
 * a widget that never passes.
 */
export function resolveSiteKey({ siteKey, appEnv }: SiteKeyEnv): string {
  const key = siteKey?.trim()
  if (key) return key
  if (appEnv === 'production') {
    throw new Error('PUBLIC_TURNSTILE_SITE_KEY is required for production builds (docs/DESPLIEGUE.md).')
  }
  return TURNSTILE_TEST_SITE_KEY
}
