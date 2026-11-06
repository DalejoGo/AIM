import { createHash } from 'node:crypto'
import { TURNSTILE_SCRIPT } from '../features/turnstile/loader'

/**
 * The site's Content Security Policy, read by astro.config.ts (build time only). Astro emits it on every page
 * as a <meta http-equiv="content-security-policy"> and adds to `script-src` and `style-src` the hashes of the
 * scripts and styles it generates; what Astro cannot see (the inline script of Base.astro) is hashed here.
 *
 * A <meta> cannot carry `frame-ancestors`: framing is refused by X-Frame-Options: DENY in public/_headers.
 */

/** Cloudflare Turnstile serves its script and its challenge iframe from this origin (features/turnstile). */
export const TURNSTILE_ORIGIN = new URL(TURNSTILE_SCRIPT).origin

/** Cloudflare Web Analytics (cookieless): the beacon script, and the endpoint it reports to. */
export const CF_ANALYTICS_SCRIPT = 'https://static.cloudflareinsights.com/beacon.min.js'
export const CF_ANALYTICS_ORIGIN = new URL(CF_ANALYTICS_SCRIPT).origin
export const CF_ANALYTICS_REPORT_ORIGIN = 'https://cloudflareinsights.com'

export interface CspOptions {
  /**
   * Extra origins the browser may call with fetch, e.g. the API Playground on Render
   * (PUBLIC_PLAYGROUND_API_URL). Empty values are ignored; anything else must be an http(s) URL.
   */
  connectTo?: (string | undefined)[]
  /** Production builds with a Web Analytics token: allow its beacon to report page views. */
  analytics?: boolean
}

/** The origin of an absolute http(s) URL. A typo fails the build instead of shipping a policy that blocks the demo. */
export function cspOrigin(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`CSP: "${url}" is not an absolute URL (check PUBLIC_PLAYGROUND_API_URL).`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`CSP: "${url}" must use https (or http locally).`)
  }
  return parsed.origin
}

type DirectiveName =
  | 'default-src'
  | 'connect-src'
  | 'img-src'
  | 'font-src'
  | 'media-src'
  | 'frame-src'
  | 'object-src'
  | 'base-uri'
  | 'form-action'

/** A directive with its sources, typed so Astro's `security.csp.directives` accepts it. */
export type CspDirective = `${DirectiveName} ${string}`

/** Every directive except script-src and style-src, which Astro writes with its hashes. */
export function cspDirectives({ connectTo = [], analytics = false }: CspOptions = {}): CspDirective[] {
  const extraConnect = [
    ...new Set(
      connectTo
        .map((url) => url?.trim())
        .filter((url): url is string => Boolean(url))
        .map(cspOrigin),
    ),
  ]
  return [
    "default-src 'self'",
    // Same-origin /api (DEC-014), the configured external APIs and, in production, Web Analytics.
    `connect-src ${["'self'", ...extraConnect, ...(analytics ? [CF_ANALYTICS_REPORT_ORIGIN] : [])].join(' ')}`,
    "img-src 'self' data:",
    // Fonts are self-hosted files (astro.config.ts never inlines them as data: URIs).
    "font-src 'self'",
    "media-src 'self'",
    // The Turnstile challenge runs in an iframe from Cloudflare.
    `frame-src ${TURNSTILE_ORIGIN}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]
}

/** Sources for script-src besides Astro's hashes: own bundles and the Turnstile script. */
export const CSP_SCRIPT_RESOURCES = ["'self'", TURNSTILE_ORIGIN]

/** script-src sources, plus the Web Analytics beacon when it is enabled. */
export function cspScriptResources({ analytics = false }: Pick<CspOptions, 'analytics'> = {}): string[] {
  return analytics ? [...CSP_SCRIPT_RESOURCES, CF_ANALYTICS_ORIGIN] : CSP_SCRIPT_RESOURCES
}

/** Sources for style-src besides Astro's hashes: only own stylesheets (no inline style attributes). */
export const CSP_STYLE_RESOURCES = ["'self'"]

/** CSP hash source of an inline script or style, in the format Astro expects (`sha256-…`, unquoted). */
export function cspHash(content: string): `sha256-${string}` {
  return `sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}`
}
