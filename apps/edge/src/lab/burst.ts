import { sql } from 'drizzle-orm'
import { labHits } from '../db/schema'
import type { Db } from '../deps'

// The real rate limit behind the Lab demo "Seguridad en acción" (GET /api/lab/burst): a sliding window per IP
// hash, counted in Postgres. Every query on lab_hits lives here.

export interface BurstPolicy {
  /** Requests accepted per window. */
  limit: number
  windowSeconds: number
}

/** What the limiter decided for one request; the route turns it into the RateLimit-* headers. */
export interface BurstDecision {
  allowed: boolean
  limit: number
  /** Requests still accepted in the current window after this one. */
  remaining: number
  /** Seconds until the oldest request in the window leaves it and frees a slot (at least 1). */
  resetInSeconds: number
}

/** The visitor's requests already in the window, before this one. */
export interface BurstWindow {
  hits: number
  /** When the oldest of them was accepted (epoch ms), or null when there are none. */
  oldestMs: number | null
}

/** Pure decision: accepted while the window holds fewer requests than the limit. */
export function decideBurst(policy: BurstPolicy, window: BurstWindow, nowMs: number): BurstDecision {
  const windowMs = policy.windowSeconds * 1000
  const allowed = window.hits < policy.limit
  // An empty window starts with this request, so its slot frees a whole window from now.
  const oldestMs = Math.min(window.oldestMs ?? nowMs, nowMs)
  const seconds = Math.ceil((oldestMs + windowMs - nowMs) / 1000)
  return {
    allowed,
    limit: policy.limit,
    remaining: allowed ? policy.limit - window.hits - 1 : 0,
    resetInSeconds: Math.min(policy.windowSeconds, Math.max(1, seconds)),
  }
}

interface WindowRow {
  hits: number | string
  oldest_ms: number | string | null
}

/**
 * Counts the request and decides in one transaction:
 * 1. A transaction-scoped advisory lock per IP hash, so parallel requests from one visitor queue up instead
 *    of all reading "9 used" and slipping past the limit. Other visitors never wait.
 * 2. One statement that deletes the visitor's rows older than the window (the table does not grow), counts
 *    the ones inside it and stores this request only if it fits. Rejected requests are not stored: hammering
 *    the endpoint does not push the wait further.
 * Four round trips (BEGIN, lock, statement, COMMIT) and almost no CPU in the Worker.
 */
export async function takeBurstSlot(
  db: Db,
  input: { ipHash: string; now: Date; policy: BurstPolicy },
): Promise<BurstDecision> {
  const { ipHash, now, policy } = input
  const windowStart = new Date(now.getTime() - policy.windowSeconds * 1000).toISOString()
  const at = now.toISOString()

  const window = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`lab_burst:${ipHash}`}, 0))`)
    // Data-modifying CTEs all run against the same snapshot: `recent` filters by time itself, so it does not
    // matter that it cannot see the rows `pruned` deletes.
    const result = await tx.execute(sql`
      with pruned as (
        delete from ${labHits} where ${labHits.ipHash} = ${ipHash} and ${labHits.at} <= ${windowStart}::timestamptz
      ),
      recent as (
        select count(*)::int as hits, (extract(epoch from min(${labHits.at})) * 1000)::float8 as oldest_ms
        from ${labHits}
        where ${labHits.ipHash} = ${ipHash} and ${labHits.at} > ${windowStart}::timestamptz
      ),
      taken as (
        insert into ${labHits} (${sql.identifier(labHits.at.name)}, ${sql.identifier(labHits.ipHash.name)})
        select ${at}::timestamptz, ${ipHash} from recent where hits < ${policy.limit}
      )
      select hits, oldest_ms from recent
    `)
    // node-postgres and PGlite both answer { rows }; int and float8 arrive as numbers in both.
    const [row] = (result as unknown as { rows: WindowRow[] }).rows
    return {
      hits: Number(row?.hits ?? 0),
      oldestMs: row?.oldest_ms == null ? null : Number(row.oldest_ms),
    }
  })

  return decideBurst(policy, window, now.getTime())
}
