import { base64url } from '../lib/crypto'

/**
 * Keyset position of a lead in the admin list (created_at desc, id desc). `at` keeps the microseconds
 * Postgres stores (a JS Date only has milliseconds), so rows written with the column default are never skipped.
 */
export interface LeadCursor {
  /** UTC timestamp with microseconds, e.g. 2026-11-06T15:00:00.123456Z. */
  at: string
  id: string
}

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64URL = /^[A-Za-z0-9_-]{1,200}$/

const encoder = new TextEncoder()

/** Opaque to clients: base64url of `at|id`. */
export function encodeCursor(cursor: LeadCursor): string {
  return base64url(encoder.encode(`${cursor.at}|${cursor.id}`))
}

/** Returns null for anything this API did not produce, so a tampered cursor never reaches the database. */
export function decodeCursor(value: string): LeadCursor | null {
  if (!BASE64URL.test(value)) return null
  let text: string
  try {
    text = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
  } catch {
    return null
  }
  const [at, id, ...rest] = text.split('|')
  if (rest.length > 0 || !at || !id || !AT.test(at) || !UUID.test(id)) return null
  // Rejects impossible dates (2026-02-30) that the pattern lets through and Postgres would refuse.
  const millis = `${at.slice(0, 23)}Z`
  const parsed = new Date(millis)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== millis) return null
  return { at, id }
}
