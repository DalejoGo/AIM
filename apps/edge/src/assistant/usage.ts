import { eq, gt, type SQL, sql } from 'drizzle-orm'
import { assistantUsage } from '../db/schema'
import type { Db, LlmUsage } from '../deps'

// Every query on assistant_usage lives here. A message is counted when it is accepted (so parallel requests
// from one visitor cannot slip past the limit) and gets its real token counts when the answer ends.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export interface AssistantLimits {
  perHour: number
  perDay: number
}

export type LimitHit = { scope: 'ip' | 'daily'; retryAfter: number }

const countWhere = (filter: SQL) => sql<number>`count(*) filter (where ${filter})`.mapWith(Number)
const oldestWhere = (filter: SQL) =>
  sql<Date | null>`min(${assistantUsage.at}) filter (where ${filter})`.mapWith(assistantUsage.at)

/** Seconds until the oldest message leaves the window, or null when one more fits. */
function retryAfter(count: number, oldest: Date | null, max: number, windowMs: number, now: Date) {
  if (count < max || !oldest) return null
  return Math.max(1, Math.ceil((oldest.getTime() + windowMs - now.getTime()) / 1000))
}

/** Both limits in one query: the global one of the last 24 hours and the visitor's of the last hour. */
export async function assistantLimitHit(
  db: Db,
  input: { ipHash: string; now: Date; limits: AssistantLimits },
): Promise<LimitHit | null> {
  const { ipHash, now, limits } = input
  const lastHourFromIp = sql`${eq(assistantUsage.ipHash, ipHash)} and ${gt(assistantUsage.at, new Date(now.getTime() - HOUR_MS))}`
  const [row] = await db
    .select({
      dayCount: sql<number>`count(*)`.mapWith(Number),
      dayOldest: sql<Date | null>`min(${assistantUsage.at})`.mapWith(assistantUsage.at),
      ipCount: countWhere(lastHourFromIp),
      ipOldest: oldestWhere(lastHourFromIp),
    })
    .from(assistantUsage)
    .where(gt(assistantUsage.at, new Date(now.getTime() - DAY_MS)))

  const daily = retryAfter(row?.dayCount ?? 0, row?.dayOldest ?? null, limits.perDay, DAY_MS, now)
  if (daily !== null) return { scope: 'daily', retryAfter: daily }
  const ip = retryAfter(row?.ipCount ?? 0, row?.ipOldest ?? null, limits.perHour, HOUR_MS, now)
  return ip === null ? null : { scope: 'ip', retryAfter: ip }
}

/** Counts the message now; the token columns stay at 0 until recordUsage. */
export async function reserveUsage(db: Db, input: { ipHash: string; model: string; at: Date }) {
  const [row] = await db.insert(assistantUsage).values(input).returning({ id: assistantUsage.id })
  if (!row) throw new Error('assistant usage insert returned no row')
  return row.id
}

export async function recordUsage(db: Db, id: string, usage: LlmUsage): Promise<void> {
  await db.update(assistantUsage).set(usage).where(eq(assistantUsage.id, id))
}

/** The provider failed before writing anything: the visitor got no answer, so the message does not count. */
export async function releaseUsage(db: Db, id: string): Promise<void> {
  await db.delete(assistantUsage).where(eq(assistantUsage.id, id))
}
