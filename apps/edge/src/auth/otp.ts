import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { loginCodes } from '../db/schema'
import type { Db } from '../deps'
import type { EdgeEnv } from '../env'
import { hmac, randomDigits, timingSafeEqual } from '../lib/crypto'

// One-time login codes (DEC-017): 6 digits, 10 minutes, 5 attempts. Only the HMAC is stored.

export const CODE_LENGTH = 6
export const CODE_TTL_MINUTES = 10
export const MAX_CODE_ATTEMPTS = 5

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** `ADMIN_EMAILS` is already lower-cased by the env schema. */
export function isAdminEmail(env: EdgeEnv, email: string): boolean {
  return env.ADMIN_EMAILS.includes(normalizeEmail(email))
}

/** Identifies an e-mail in the audit log and the rate limits without storing it in clear. */
export function hashEmail(secret: string, email: string): Promise<string> {
  return hmac(secret, 'email', normalizeEmail(email))
}

function hashCode(secret: string, email: string, code: string): Promise<string> {
  return hmac(secret, 'login-code', `${email}:${code}`)
}

/**
 * Creates a new code for `email` (already normalized) and consumes every earlier unused one,
 * so only the latest mail works. Returns the code in clear only so it can be mailed.
 */
export async function issueLoginCode(
  db: Db,
  secret: string,
  input: { email: string; ipHash: string; now: Date },
): Promise<string> {
  const { email, ipHash, now } = input
  const code = randomDigits(CODE_LENGTH)
  const codeHash = await hashCode(secret, email, code)
  await db
    .update(loginCodes)
    .set({ consumedAt: now })
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)))
  await db.insert(loginCodes).values({
    email,
    codeHash,
    ipHash,
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
  })
  return code
}

export type CodeRejection = 'no_code' | 'too_many_attempts' | 'expired' | 'mismatch' | 'already_used'
export type CodeCheck = { ok: true } | { ok: false; reason: CodeRejection }

/**
 * Checks `code` against the latest unused code of `email` (already normalized) and consumes it on success.
 * The attempt is counted atomically before comparing, so parallel guesses cannot exceed the limit.
 */
export async function redeemLoginCode(
  db: Db,
  secret: string,
  input: { email: string; code: string; now: Date },
): Promise<CodeCheck> {
  const { email, code, now } = input
  const latest = db
    .select({ id: loginCodes.id })
    .from(loginCodes)
    .where(and(eq(loginCodes.email, email), isNull(loginCodes.consumedAt)))
    .orderBy(desc(loginCodes.createdAt))
    .limit(1)
  const [row] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(inArray(loginCodes.id, latest))
    .returning({
      id: loginCodes.id,
      codeHash: loginCodes.codeHash,
      expiresAt: loginCodes.expiresAt,
      attempts: loginCodes.attempts,
    })

  if (!row) return { ok: false, reason: 'no_code' }
  if (row.attempts > MAX_CODE_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' }
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: 'expired' }
  if (!timingSafeEqual(await hashCode(secret, email, code), row.codeHash)) {
    return { ok: false, reason: 'mismatch' }
  }

  // Guarded update: of two parallel requests with the right code, only one gets the session.
  const [used] = await db
    .update(loginCodes)
    .set({ consumedAt: now })
    .where(and(eq(loginCodes.id, row.id), isNull(loginCodes.consumedAt)))
    .returning({ id: loginCodes.id })
  return used ? { ok: true } : { ok: false, reason: 'already_used' }
}
