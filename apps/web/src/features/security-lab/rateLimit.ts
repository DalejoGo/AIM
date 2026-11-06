import { parseRetryAfter } from '../../lib/api'
import type { HeaderLine } from './burst'

/**
 * The rate-limit fields the API sends (apps/edge/src/routes/lab.ts), in the order the demo shows them:
 * RateLimit-* from the IETF draft (draft-ietf-httpapi-ratelimit-headers) and Retry-After (RFC 9110).
 */
export const RATE_LIMIT_FIELDS = [
  'RateLimit-Policy',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
  'Retry-After',
] as const

export interface RateLimitInfo {
  /** Requests accepted per window. */
  limit: number | null
  /** Requests still accepted in this window. */
  remaining: number | null
  /** Seconds until a slot frees up. */
  reset: number | null
  /** Length of the window, from RateLimit-Policy (`10;w=10`). */
  windowSeconds: number | null
  /** Seconds to wait before trying again. */
  retryAfter: number | null
}

/** A non-negative integer field; anything else (empty, negative, decimals, text) counts as absent. */
export function parseCount(value: string | null): number | null {
  const text = value?.trim()
  return text && /^\d+$/.test(text) ? Number(text) : null
}

/** The `w` parameter of a policy such as `10;w=10` or `"burst";q=10;w=10`. */
export function parsePolicyWindow(value: string | null): number | null {
  const match = value ? /(?:^|;)\s*w\s*=\s*(\d+)\s*(?:;|$)/.exec(value) : null
  return match?.[1] ? Number(match[1]) : null
}

export function readRateLimit(headers: Headers, now: number = Date.now()): RateLimitInfo {
  return {
    limit: parseCount(headers.get('RateLimit-Limit')),
    remaining: parseCount(headers.get('RateLimit-Remaining')),
    reset: parseCount(headers.get('RateLimit-Reset')),
    windowSeconds: parsePolicyWindow(headers.get('RateLimit-Policy')),
    retryAfter: parseRetryAfter(headers.get('Retry-After'), now),
  }
}

/** The rate-limit lines that arrived, with the values untouched (to show them as they are). */
export function rateLimitLines(headers: Headers): HeaderLine[] {
  return RATE_LIMIT_FIELDS.flatMap((name) => {
    const value = headers.get(name)
    return value === null ? [] : [{ name, value }]
  })
}
