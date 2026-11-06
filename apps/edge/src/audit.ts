import { auditLog } from './db/schema'
import type { Db } from './deps'
import { log } from './lib/log'

export interface AuditInput {
  actor: string | null
  /** Dotted verb, e.g. `auth.login`, `lead.status_changed`. */
  action: string
  outcome: 'ok' | 'denied' | 'error'
  ipHash?: string
  detail?: Record<string, unknown>
}

/** Writes to the access log. Never throws: an audit failure must not break the request it describes. */
export async function recordAudit(db: Db, at: Date, entry: AuditInput): Promise<void> {
  try {
    await db
      .insert(auditLog)
      .values({ ...entry, at, ipHash: entry.ipHash ?? null, detail: entry.detail ?? null })
  } catch (err) {
    log.error('audit write failed', err)
  }
}
