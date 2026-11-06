import type { Lead, LeadStatus, QuoteSnapshot } from '@aim/contracts'
import { and, count, desc, eq, gt, min, type SQL, sql } from 'drizzle-orm'
import { leads } from '../db/schema'
import type { Db } from '../deps'
import type { LeadCursor } from './cursor'

// Every query on the leads table lives here; routes only orchestrate.

export interface NewLead {
  createdAt: Date
  name: string
  email: string | null
  phone: string | null
  service: Lead['service']
  message: string
  quote: QuoteSnapshot | null
  consentAt: Date
  /** HMAC of the client IP, for the rate limit. */
  ipHash: string
}

/** What the admin may see: never the IP hash nor the consent timestamp. */
const leadColumns = {
  id: leads.id,
  createdAt: leads.createdAt,
  status: leads.status,
  name: leads.name,
  email: leads.email,
  phone: leads.phone,
  service: leads.service,
  message: leads.message,
  quote: leads.quote,
}

type LeadRow = Pick<typeof leads.$inferSelect, keyof typeof leadColumns>

/** Exact position of a row for keyset pagination (see LeadCursor). */
const cursorAt = sql<string>`to_char(${leads.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

export function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    name: row.name,
    email: row.email,
    phone: row.phone,
    // The column is text; only POST /api/leads writes it, after validating it against the contract.
    service: row.service as Lead['service'],
    message: row.message,
    quote: row.quote,
  }
}

export async function insertLead(db: Db, values: NewLead): Promise<string> {
  const [row] = await db.insert(leads).values(values).returning({ id: leads.id })
  if (!row) throw new Error('lead insert returned no row')
  return row.id
}

/** Leads stored from one IP after `since`, and the oldest of them (it leaves the window first). */
export async function recentLeadsFromIp(
  db: Db,
  ipHash: string,
  since: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const [row] = await db
    .select({ count: count(), oldest: min(leads.createdAt) })
    .from(leads)
    .where(and(eq(leads.ipHash, ipHash), gt(leads.createdAt, since)))
  return { count: row?.count ?? 0, oldest: row?.oldest ?? null }
}

export interface LeadListQuery {
  status?: LeadStatus | undefined
  after?: LeadCursor | undefined
  limit: number
}

/** Newest first, keyset-paginated (no OFFSET): the cost of a page does not grow with the page number. */
export async function listLeads(
  db: Db,
  { status, after, limit }: LeadListQuery,
): Promise<{ items: Lead[]; next: LeadCursor | null }> {
  const filters: SQL[] = []
  if (status) filters.push(eq(leads.status, status))
  if (after) {
    filters.push(sql`(${leads.createdAt}, ${leads.id}) < (${after.at}::timestamptz, ${after.id}::uuid)`)
  }
  const rows = await db
    .select({ ...leadColumns, cursorAt })
    .from(leads)
    .where(and(...filters))
    .orderBy(desc(leads.createdAt), desc(leads.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(toLead),
    next: rows.length > limit && last ? { at: last.cursorAt, id: last.id } : null,
  }
}

/**
 * Changes the status in one statement and returns the status it had before (for the audit log).
 * The row lock in the sub-select makes `previous` exact even with concurrent updates.
 */
export async function updateLeadStatus(
  db: Db,
  id: string,
  status: LeadStatus,
): Promise<{ lead: Lead; previous: LeadStatus } | null> {
  const before = db
    .select({ id: leads.id, status: leads.status })
    .from(leads)
    .where(eq(leads.id, id))
    .for('update')
    .as('before')
  const [row] = await db
    .update(leads)
    .set({ status })
    .from(before)
    .where(eq(leads.id, before.id))
    .returning({ ...leadColumns, previous: before.status })
  if (!row) return null
  return { lead: toLead(row), previous: row.previous }
}
