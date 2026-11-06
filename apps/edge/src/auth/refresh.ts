import type { Scope } from '@aim/contracts'
import { and, eq, isNull } from 'drizzle-orm'
import { refreshTokens } from '../db/schema'
import type { Db } from '../deps'
import { hmac, randomToken } from '../lib/crypto'
import { ADMIN_SCOPES, REFRESH_TOKEN_TTL_SECONDS } from './tokens'

// Opaque refresh tokens with rotation and reuse detection per family (DEC-017, OAuth 2.0 Security BCP §4.14).
// Only the HMAC of a token is stored.

export interface IssuedRefreshToken {
  token: string
  familyId: string
  expiresAt: Date
  /** Seconds, for the cookie's Max-Age. */
  maxAge: number
}

function hashRefreshToken(secret: string, token: string): Promise<string> {
  return hmac(secret, 'refresh', token)
}

async function insertRefreshToken(
  db: Db,
  secret: string,
  input: { familyId: string; subject: string; scope: readonly Scope[]; now: Date },
): Promise<IssuedRefreshToken> {
  const { familyId, subject, scope, now } = input
  const token = randomToken(32)
  const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000)
  await db.insert(refreshTokens).values({
    familyId,
    subject,
    tokenHash: await hashRefreshToken(secret, token),
    scope: scope.join(' '),
    createdAt: now,
    expiresAt,
  })
  return { token, familyId, expiresAt, maxAge: REFRESH_TOKEN_TTL_SECONDS }
}

/** First refresh token of a new session (a new family). */
export function startRefreshFamily(
  db: Db,
  secret: string,
  input: { subject: string; scope: readonly Scope[]; now: Date },
): Promise<IssuedRefreshToken> {
  return insertRefreshToken(db, secret, { ...input, familyId: crypto.randomUUID() })
}

async function revokeFamily(db: Db, familyId: string, now: Date): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: now })
    .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
}

/** Scopes can only shrink on refresh: the stored grant intersected with what admins get today. */
function currentScope(stored: string): Scope[] {
  const granted = new Set(stored.split(' '))
  return ADMIN_SCOPES.filter((s) => granted.has(s))
}

export type RefreshRejection = 'unknown' | 'reused' | 'revoked' | 'expired' | 'not_admin'

export type RotateResult =
  | { ok: true; subject: string; scope: Scope[]; refresh: IssuedRefreshToken }
  | { ok: false; reason: RefreshRejection; subject: string | null; familyId: string | null }

/**
 * Exchanges a refresh token for a new one in the same family. A token that was already rotated means
 * it leaked (or was replayed): the whole family is revoked, so the legitimate holder's token dies too.
 */
export async function rotateRefreshToken(
  db: Db,
  secret: string,
  input: { token: string; isAllowed: (subject: string) => boolean; now: Date },
): Promise<RotateResult> {
  const { token, isAllowed, now } = input
  const [row] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, await hashRefreshToken(secret, token)))
    .limit(1)
  if (!row) return { ok: false, reason: 'unknown', subject: null, familyId: null }

  const deny = (reason: RefreshRejection): RotateResult => ({
    ok: false,
    reason,
    subject: row.subject,
    familyId: row.familyId,
  })

  if (row.rotatedAt) {
    await revokeFamily(db, row.familyId, now)
    return deny('reused')
  }
  if (row.revokedAt) return deny('revoked')
  if (row.expiresAt.getTime() <= now.getTime()) return deny('expired')

  const scope = currentScope(row.scope)
  if (!isAllowed(row.subject) || scope.length === 0) {
    await revokeFamily(db, row.familyId, now)
    return deny('not_admin')
  }

  // Guarded update: when two requests race with the same token, the loser sees it as already rotated.
  const [rotated] = await db
    .update(refreshTokens)
    .set({ rotatedAt: now })
    .where(
      and(eq(refreshTokens.id, row.id), isNull(refreshTokens.rotatedAt), isNull(refreshTokens.revokedAt)),
    )
    .returning({ id: refreshTokens.id })
  if (!rotated) {
    await revokeFamily(db, row.familyId, now)
    return deny('reused')
  }

  const refresh = await insertRefreshToken(db, secret, {
    familyId: row.familyId,
    subject: row.subject,
    scope,
    now,
  })
  return { ok: true, subject: row.subject, scope, refresh }
}

/** Logout: revokes the family of `token` if it exists. Returns who it belonged to, for the audit log. */
export async function revokeRefreshToken(
  db: Db,
  secret: string,
  input: { token: string; now: Date },
): Promise<{ subject: string; familyId: string } | null> {
  const [row] = await db
    .select({ subject: refreshTokens.subject, familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, await hashRefreshToken(secret, input.token)))
    .limit(1)
  if (!row) return null
  await revokeFamily(db, row.familyId, input.now)
  return row
}
