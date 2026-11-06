import type { QuoteSnapshot } from '@aim/contracts'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export const leadStatus = pgEnum('lead_status', ['new', 'contacted', 'won', 'lost', 'spam'])
export const auditOutcome = pgEnum('audit_outcome', ['ok', 'denied', 'error'])

/** Contacts sent from the site (DEC-014). IPs are never stored in clear: only an HMAC for rate limiting. */
export const leads = pgTable(
  'leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    status: leadStatus('status').notNull().default('new'),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    service: text('service').notNull(),
    message: text('message').notNull(),
    quote: jsonb('quote').$type<QuoteSnapshot>(),
    consentAt: timestamp('consent_at', { withTimezone: true }).notNull(),
    ipHash: text('ip_hash').notNull(),
  },
  (t) => [
    index('leads_created_at_idx').on(t.createdAt),
    index('leads_ip_hash_idx').on(t.ipHash, t.createdAt),
  ],
)

/** One-time login codes (DEC-017). Only the HMAC of the code is stored. */
export const loginCodes = pgTable(
  'login_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    email: text('email').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    ipHash: text('ip_hash').notNull(),
  },
  (t) => [
    index('login_codes_email_idx').on(t.email, t.createdAt),
    index('login_codes_ip_idx').on(t.ipHash, t.createdAt),
  ],
)

/** Refresh tokens with rotation: every token belongs to a family; reusing a rotated token revokes the family. */
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    familyId: uuid('family_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    subject: text('subject').notNull(),
    scope: text('scope').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [index('refresh_tokens_family_idx').on(t.familyId)],
)

/** Access log of the admin area (logins, refreshes, denials, lead changes). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor'),
    action: text('action').notNull(),
    outcome: auditOutcome('outcome').notNull(),
    ipHash: text('ip_hash'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
  },
  // Rate limits read recent rows by action (src/auth/limits.ts).
  (t) => [index('audit_log_at_idx').on(t.at), index('audit_log_action_at_idx').on(t.action, t.at)],
)

/**
 * One row per message sent to the Lab assistant: its rate limits (per IP hash, global per day) and its token bill.
 * The row is written when the message is accepted and gets the real token counts when the answer ends.
 */
export const assistantUsage = pgTable(
  'assistant_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    ipHash: text('ip_hash').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  },
  (t) => [index('assistant_usage_at_idx').on(t.at), index('assistant_usage_ip_hash_idx').on(t.ipHash, t.at)],
)
