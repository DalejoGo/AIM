import type { AutomationWebhookPayload, Principal } from '@aim/contracts'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './db/schema'
import type { EdgeEnv } from './env'

/** Works with node-postgres (production, local) and PGlite (tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

export interface Mail {
  to: string
  subject: string
  text: string
  html?: string
}

export interface Mailer {
  send(mail: Mail): Promise<void>
}

export interface Captcha {
  /** Verifies a Turnstile token server-side (never trust the widget alone). */
  verify(token: string, ip: string | null): Promise<boolean>
}

export interface LlmMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LlmRequest {
  model: string
  /** Fixed instructions and knowledge; the adapter caches it (it is the same for every visitor). */
  system: string
  /** Starts with a user message and ends with one. */
  messages: readonly LlmMessage[]
  maxTokens: number
  /** Aborted when the visitor closes the connection, so no more tokens are spent. */
  signal?: AbortSignal
}

export interface LlmUsage {
  /** Input tokens billed at full price (not read from nor written to the cache). */
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

export type LlmEvent =
  | { type: 'text'; text: string }
  /** Last event. `stopReason` is the provider's (end_turn, max_tokens, refusal…). */
  | { type: 'done'; stopReason: string; usage: LlmUsage }

/** A language model that streams its answer (Lab assistant). Errors are thrown from the iterator. */
export interface Llm {
  stream(request: LlmRequest): AsyncIterable<LlmEvent>
}

/** A provider failure. `busy`: overloaded or rate limited, worth trying again in a minute. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly busy: boolean,
  ) {
    super(message)
    this.name = 'LlmError'
  }
}

/**
 * The n8n of the Lab demo "Automatización en vivo" (docs/AUTOMATIZACION.md). Each call is one subrequest of
 * the Worker, and neither throws: a failure, a timeout or an abort is `false`.
 */
export interface N8n {
  /** GET /healthz/readiness: true only for a 200 that is not an HTML page (Render shows one while it wakes up). */
  healthy(signal: AbortSignal): Promise<boolean>
  /** POST /webhook/<path>: true when n8n accepted the run (2xx). n8n answers before running the flow. */
  trigger(payload: AutomationWebhookPayload, signal: AbortSignal): Promise<boolean>
}

/** Waits `ms`, or less when `signal` aborts. Never rejects. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>

/** Everything a route needs, injected per request so tests swap in PGlite and fakes. */
export interface Deps {
  env: EdgeEnv
  /** Opens the database lazily: routes that don't need it (health) never connect. */
  db: () => Promise<Db>
  mailer: Mailer
  captcha: Captcha
  /** Lab assistant model; absent when ANTHROPIC_API_KEY is not configured. */
  llm?: Llm
  /** n8n of the Lab automation demo; absent when AUTOMATION_N8N_URL is empty. */
  n8n?: N8n
  now: () => Date
  /** Pauses between polls (Lab automation demo). Tests move their clock instead of waiting. */
  sleep: Sleep
  /** Work that may finish after the response (notifications). Awaited in tests. */
  waitUntil: (promise: Promise<unknown>) => void
}

export interface AppEnv {
  Variables: {
    deps: Deps
    /** HMAC of the client IP (never the IP itself). */
    ipHash: string
    clientIp: string | null
    principal?: Principal
  }
}
