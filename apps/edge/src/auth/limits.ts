import { and, eq, gt, or, type SQL, sql } from 'drizzle-orm'
import { auditLog } from '../db/schema'
import type { Db } from '../deps'

// Rate limits of the login (DEC-017), counted in the access log so that admin and non-admin e-mails
// are throttled exactly alike: a limit that only applied to admin e-mails would reveal who is one.

export interface Rule {
  max: number
  windowMs: number
}

/** Codes requested per e-mail (admin or not), identified by the e-mail's HMAC. */
export const CODES_PER_EMAIL: Rule = { max: 3, windowMs: 15 * 60_000 }
/** Code requests per client IP (its HMAC). */
export const CODE_REQUESTS_PER_IP: Rule = { max: 10, windowMs: 60 * 60_000 }
/** Failed code exchanges per client IP. */
export const FAILED_LOGINS_PER_IP: Rule = { max: 20, windowMs: 60 * 60_000 }

export const CODE_REQUESTED = 'auth.code_requested'
export const LOGIN = 'auth.login'

/** Seconds until the oldest event leaves the window, or null when the rule still allows one more. */
function retryAfter(count: number, oldest: Date | null, rule: Rule, now: Date): number | null {
  if (count < rule.max || !oldest) return null
  return Math.max(1, Math.ceil((oldest.getTime() + rule.windowMs - now.getTime()) / 1000))
}

const since = (now: Date, rule: Rule) => new Date(now.getTime() - rule.windowMs)

const countWhere = (filter: SQL) => sql<number>`count(*) filter (where ${filter})`.mapWith(Number)
const oldestWhere = (filter: SQL) =>
  sql<Date | null>`min(${auditLog.at}) filter (where ${filter})`.mapWith(auditLog.at)

/**
 * Checks both limits of POST /api/auth/code in one query.
 * Returns the seconds to wait (Retry-After) or null when the request may go on.
 */
export async function codeRequestLimit(
  db: Db,
  input: { ipHash: string; emailHash: string; now: Date },
): Promise<number | null> {
  const { ipHash, emailHash, now } = input
  const byIp = sql`${eq(auditLog.ipHash, ipHash)} and ${gt(auditLog.at, since(now, CODE_REQUESTS_PER_IP))}`
  const byEmail = sql`${auditLog.detail}->>'emailHash' = ${emailHash} and ${gt(auditLog.at, since(now, CODES_PER_EMAIL))}`
  const earliest = Math.max(CODE_REQUESTS_PER_IP.windowMs, CODES_PER_EMAIL.windowMs)

  const [row] = await db
    .select({
      ipCount: countWhere(byIp),
      ipOldest: oldestWhere(byIp),
      emailCount: countWhere(byEmail),
      emailOldest: oldestWhere(byEmail),
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, CODE_REQUESTED),
        gt(auditLog.at, new Date(now.getTime() - earliest)),
        or(byIp, byEmail),
      ),
    )

  const waits = [
    retryAfter(row?.ipCount ?? 0, row?.ipOldest ?? null, CODE_REQUESTS_PER_IP, now),
    retryAfter(row?.emailCount ?? 0, row?.emailOldest ?? null, CODES_PER_EMAIL, now),
  ].filter((s): s is number => s !== null)
  return waits.length > 0 ? Math.max(...waits) : null
}

/** Limit of failed POST /api/auth/token (e-mail code grant) per IP. */
export async function failedLoginLimit(db: Db, input: { ipHash: string; now: Date }): Promise<number | null> {
  const { ipHash, now } = input
  const [row] = await db
    .select({
      count: sql<number>`count(*)`.mapWith(Number),
      oldest: sql<Date | null>`min(${auditLog.at})`.mapWith(auditLog.at),
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, LOGIN),
        eq(auditLog.outcome, 'denied'),
        eq(auditLog.ipHash, ipHash),
        gt(auditLog.at, since(now, FAILED_LOGINS_PER_IP)),
      ),
    )
  return retryAfter(row?.count ?? 0, row?.oldest ?? null, FAILED_LOGINS_PER_IP, now)
}
