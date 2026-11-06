import type { AuditPage } from '@aim/contracts'
import { desc, sql } from 'drizzle-orm'
import { z } from 'zod'
import { auditLog } from '../db/schema'
import type { Db } from '../deps'
import { base64url } from '../lib/crypto'

// Read side of the access log for /admin (GET /api/admin/audit), with keyset pagination.

export const AUDIT_PAGE_DEFAULT = 20
export const AUDIT_PAGE_MAX = 100

/** `?cursor=&limit=` with empty values means "not given". */
const blankToUndefined = (value: unknown) => (value === '' ? undefined : value)

export const AuditQuery = z.object({
  cursor: z.preprocess(blankToUndefined, z.string().max(512).optional()),
  limit: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(AUDIT_PAGE_MAX).default(AUDIT_PAGE_DEFAULT),
  ),
})

/**
 * The cursor keeps the exact Postgres timestamp (microseconds) and the id of the last row of the page,
 * so rows that share `at` are neither skipped nor repeated.
 */
const Cursor = z.object({
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
  id: z.uuid(),
})
export type Cursor = z.infer<typeof Cursor>

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function encodeCursor(cursor: Cursor): string {
  return base64url(encoder.encode(JSON.stringify(cursor)))
}

/** Null for anything that is not a cursor this API produced. */
export function decodeCursor(value: string): Cursor | null {
  try {
    const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'))
    const json = decoder.decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))
    const parsed = Cursor.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Newest first (`at` desc, `id` desc). Never selects `ip_hash` or `detail`. */
export async function listAudit(db: Db, input: { cursor: Cursor | null; limit: number }): Promise<AuditPage> {
  const { cursor, limit } = input
  const rows = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      actor: auditLog.actor,
      action: auditLog.action,
      outcome: auditLog.outcome,
      cursorAt: sql<string>`to_char(${auditLog.at} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(auditLog)
    .where(
      cursor
        ? sql`(${auditLog.at}, ${auditLog.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
        : undefined,
    )
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(({ id, at, actor, action, outcome }) => ({
      id,
      at: at.toISOString(),
      actor,
      action,
      outcome,
    })),
    nextCursor: rows.length > limit && last ? encodeCursor({ at: last.cursorAt, id: last.id }) : null,
  }
}
