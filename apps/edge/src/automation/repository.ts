import { AUTOMATION_STEPS, AutomationStepReport } from '@aim/contracts'
import { eq, lte, sql } from 'drizzle-orm'
import { automationEvents, automationRuns, automationUsage } from '../db/schema'
import type { Db } from '../deps'
import { type BurstDecision, type BurstPolicy, decideBurst } from '../lab/burst'

// Every query of the Lab demo "Automatización en vivo" lives here: its limits, its runs and their steps.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
/** Runs and their steps (the test lead's drafted reply) are deleted after this (docs/AUTOMATIZACION.md §5). */
export const RUN_RETENTION_MS = HOUR_MS

export interface RunLimits {
  /** Runs per visitor (IP hash) in a sliding window. */
  burst: BurstPolicy
  /** Runs for everyone in a rolling 24 hours. */
  daily: number
}

export interface RunSlot {
  /** The visitor's window, for the RateLimit-* headers; `allowed` is false when it is full. */
  burst: BurstDecision
  /** Seconds until the daily cap frees a run, or null when it is not reached. */
  dailyRetryAfter: number | null
  /** True when the run was counted: both limits had room. */
  taken: boolean
}

interface UsageRow {
  day_runs: number | string
  day_oldest_ms: number | string | null
  ip_runs: number | string
  ip_oldest_ms: number | string | null
}

const toMs = (value: number | string | null) => (value === null ? null : Number(value))

/**
 * Checks both limits and counts the run in one transaction, like the Lab burst (lab/burst.ts): an advisory lock
 * per IP hash so one visitor's parallel requests queue up, then one statement that deletes the counts older
 * than a day, reads both windows and stores this run only if both have room. Refused runs are not counted.
 */
export async function takeRunSlot(
  db: Db,
  input: { ipHash: string; now: Date; limits: RunLimits },
): Promise<RunSlot> {
  const { ipHash, now, limits } = input
  const nowMs = now.getTime()
  const dayStart = new Date(nowMs - DAY_MS).toISOString()
  const windowStart = new Date(nowMs - limits.burst.windowSeconds * 1000).toISOString()
  const at = now.toISOString()

  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`automation_runs:${ipHash}`}, 0))`)
    const result = await tx.execute(sql`
      with pruned as (
        delete from ${automationUsage} where ${automationUsage.at} <= ${dayStart}::timestamptz
      ),
      day as (
        select count(*)::int as runs, (extract(epoch from min(${automationUsage.at})) * 1000)::float8 as oldest_ms
        from ${automationUsage}
        where ${automationUsage.at} > ${dayStart}::timestamptz
      ),
      ip as (
        select count(*)::int as runs, (extract(epoch from min(${automationUsage.at})) * 1000)::float8 as oldest_ms
        from ${automationUsage}
        where ${automationUsage.ipHash} = ${ipHash} and ${automationUsage.at} > ${windowStart}::timestamptz
      ),
      taken as (
        insert into ${automationUsage} (${sql.identifier(automationUsage.at.name)}, ${sql.identifier(automationUsage.ipHash.name)})
        select ${at}::timestamptz, ${ipHash} from day, ip
        where day.runs < ${limits.daily} and ip.runs < ${limits.burst.limit}
      )
      select day.runs as day_runs, day.oldest_ms as day_oldest_ms, ip.runs as ip_runs, ip.oldest_ms as ip_oldest_ms
      from day, ip
    `)
    // node-postgres and PGlite both answer { rows }.
    return (result as unknown as { rows: UsageRow[] }).rows[0]
  })

  const dayRuns = Number(row?.day_runs ?? 0)
  const dailyFull = dayRuns >= limits.daily
  const dayOldest = toMs(row?.day_oldest_ms ?? null) ?? nowMs
  const dailyRetryAfter = dailyFull ? Math.max(1, Math.ceil((dayOldest + DAY_MS - nowMs) / 1000)) : null

  const window = { hits: Number(row?.ip_runs ?? 0), oldestMs: toMs(row?.ip_oldest_ms ?? null) }
  const decision = decideBurst(limits.burst, window, nowMs)
  // decideBurst counts this run in `remaining`; a run the daily cap refused was not stored.
  const burst =
    decision.allowed && dailyFull
      ? { ...decision, remaining: Math.max(0, limits.burst.limit - window.hits) }
      : decision
  return { burst, dailyRetryAfter, taken: decision.allowed && !dailyFull }
}

/** Deletes the runs older than an hour; their steps go with them (ON DELETE CASCADE). */
export async function pruneRuns(db: Db, now: Date): Promise<void> {
  await db
    .delete(automationRuns)
    .where(lte(automationRuns.createdAt, new Date(now.getTime() - RUN_RETENTION_MS)))
}

export async function createRun(db: Db, now: Date): Promise<string> {
  const [row] = await db
    .insert(automationRuns)
    .values({ createdAt: now })
    .returning({ id: automationRuns.id })
  if (!row) throw new Error('automation run insert returned no row')
  return row.id
}

export type StepWrite = 'stored' | 'duplicate' | 'unknown_run'

/** Stores one step n8n reported. A step already stored for the run is refused, not replaced. */
export async function recordStep(
  db: Db,
  input: { runId: string; report: AutomationStepReport; at: Date },
): Promise<StepWrite> {
  const { runId, report, at } = input
  const [run] = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(eq(automationRuns.id, runId))
    .limit(1)
  if (!run) return 'unknown_run'
  const stored = await db
    .insert(automationEvents)
    .values({ runId, step: report.step, data: report.data, at })
    .onConflictDoNothing()
    .returning({ step: automationEvents.step })
  return stored.length > 0 ? 'stored' : 'duplicate'
}

export type StoredStep = AutomationStepReport & { at: Date }

const ORDER = new Map(AUTOMATION_STEPS.map((step, index) => [step, index]))

/**
 * The run's steps so far, in the order they arrived (the protocol's order on a tie). Each row is read back
 * through the contract, so what reaches the browser always has its shape.
 */
export async function listSteps(db: Db, runId: string): Promise<StoredStep[]> {
  const rows = await db
    .select({ step: automationEvents.step, data: automationEvents.data, at: automationEvents.at })
    .from(automationEvents)
    .where(eq(automationEvents.runId, runId))
  const steps: StoredStep[] = []
  for (const row of rows) {
    const parsed = AutomationStepReport.safeParse({ step: row.step, data: row.data })
    if (parsed.success) steps.push({ ...parsed.data, at: row.at })
  }
  return steps.sort(
    (a, b) => a.at.getTime() - b.at.getTime() || (ORDER.get(a.step) ?? 0) - (ORDER.get(b.step) ?? 0),
  )
}
