import type { Context } from 'hono'
import { type SSEStreamingApi, streamSSE } from 'hono/streaming'
import { type AppEnv, type Db, type Llm, LlmError, type LlmEvent, type LlmRequest } from '../deps'
import { fail } from '../lib/http'
import { log } from '../lib/log'
import { assistantLimitHit, type LimitHit, recordUsage, releaseUsage, reserveUsage } from './usage'

/** What the visitor reads when something stops an answer, in the voice of each feature (chat, reviewer). */
export interface AnswerTexts {
  /** The provider is overloaded or the free daily allocation is spent. */
  busy: string
  /** The provider failed for another reason. */
  failed: string
  /** The model refused to answer. */
  refusal: string
  /** 429 for this visitor (last hour); `wait` reads like "12 minutos". */
  hourly: (wait: string) => string
  /** 429 for everyone (last 24 hours). */
  daily: (wait: string) => string
}

/**
 * The part the assistant's chat and the code reviewer share. Both spend the same free model allocation, so
 * they share the limits too: every request is a row of assistant_usage, counted per visitor (IP hash) per
 * hour and for everyone per day. Over a limit it answers 429 with Retry-After; otherwise it counts the request
 * and streams the answer as Server-Sent Events: `delta`, then `done` or `error`.
 */
export async function streamAnswer(
  c: Context<AppEnv>,
  llm: Llm,
  request: Omit<LlmRequest, 'signal'>,
  texts: AnswerTexts,
): Promise<Response> {
  const { deps, ipHash } = c.var
  const { env } = deps
  const db = await deps.db()
  const now = deps.now()
  const limits = { perHour: env.ASSISTANT_MESSAGES_PER_HOUR, perDay: env.ASSISTANT_DAILY_LIMIT }
  const hit = await assistantLimitHit(db, { ipHash, now, limits })
  if (hit) {
    c.header('Retry-After', String(hit.retryAfter))
    return fail(
      c,
      429,
      hit.scope === 'daily' ? 'assistant_daily_limit' : 'rate_limited',
      limitMessage(hit, texts),
    )
  }
  const usageId = await reserveUsage(db, { ipHash, model: request.model, at: now })

  // The answer streams after the handler returns: the request's resources (the database connection) are
  // released once this background task settles (see createApp).
  let finished = () => {}
  deps.waitUntil(
    new Promise<void>((resolve) => {
      finished = resolve
    }),
  )
  return streamSSE(c, async (stream) => {
    try {
      await answer(stream, { db, llm, usageId, request, texts })
    } finally {
      finished()
    }
  })
}

interface Answer {
  db: Db
  llm: Llm
  usageId: string
  request: Omit<LlmRequest, 'signal'>
  texts: AnswerTexts
}

async function answer(stream: SSEStreamingApi, { db, llm, usageId, request, texts }: Answer) {
  const abort = new AbortController()
  // The visitor closed the page: stop the model so nobody pays for tokens nobody reads.
  stream.onAbort(() => abort.abort())
  let wrote = false
  let done: Extract<LlmEvent, { type: 'done' }> | undefined
  try {
    for await (const event of llm.stream({ ...request, signal: abort.signal })) {
      if (event.type === 'text') {
        wrote = true
        await stream.writeSSE({ event: 'delta', data: JSON.stringify({ text: event.text }) })
      } else {
        done = event
      }
    }
    if (!done) throw new Error('the model stream ended without a final event')
  } catch (err) {
    if (abort.signal.aborted) return
    log.error('assistant answer failed', err)
    if (!wrote) await releaseUsage(db, usageId).catch((e) => log.error('assistant usage release failed', e))
    const busy = err instanceof LlmError && err.busy
    await writeError(stream, busy ? 'assistant_busy' : 'assistant_failed', busy ? texts.busy : texts.failed)
    return
  }

  if (done.stopReason === 'refusal') await writeError(stream, 'assistant_refusal', texts.refusal)
  else await stream.writeSSE({ event: 'done', data: JSON.stringify({ reason: done.stopReason }) })
  await recordUsage(db, usageId, done.usage).catch((err) => log.error('assistant usage update failed', err))
}

function writeError(stream: SSEStreamingApi, error: string, message: string) {
  return stream.writeSSE({ event: 'error', data: JSON.stringify({ error, message }) })
}

function limitMessage(hit: LimitHit, texts: AnswerTexts): string {
  const wait = waitText(hit.retryAfter)
  return hit.scope === 'daily' ? texts.daily(wait) : texts.hourly(wait)
}

function waitText(seconds: number): string {
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`
  const hours = Math.ceil(minutes / 60)
  return `${hours} ${hours === 1 ? 'hora' : 'horas'}`
}
