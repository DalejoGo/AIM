import type {
  AutomationDoneEvent,
  AutomationErrorCode,
  AutomationErrorEvent,
  AutomationLead,
  AutomationRunEvent,
  AutomationStartedEvent,
  AutomationStepEvent,
  AutomationWakingEvent,
} from '@aim/contracts'
import type { SSEStreamingApi } from 'hono/streaming'
import type { Db, N8n, Sleep } from '../deps'
import { log } from '../lib/log'
import { listSteps } from './repository'
import { issueCallbackToken } from './token'

// What POST /api/automation/runs does after it answers 200: everything happens inside the visitor's open SSE
// connection (nothing runs in the background), and stops as soon as the visitor leaves.
// 1. `run`  2. wake n8n (GET /healthz/readiness, `waking` each time it is not ready)  3. the webhook, then `started`
// 4. poll the steps n8n reports (`step` each), then `done`, or `error`.

/** Workers Free allows 50 subrequests per request; a run stays at or under this many. */
export const SUBREQUEST_BUDGET = 40
/** Subrequests besides the health checks: Turnstile, the database socket (counted once) and the webhook. */
const OTHER_SUBREQUESTS = 3
/** Health checks a run may make; one subrequest of the budget is left spare. */
export const MAX_HEALTH_CHECKS = SUBREQUEST_BUDGET - OTHER_SUBREQUESTS - 1
/** Pace of the health checks while n8n wakes up (longer when the wake timeout needs it to fit the budget). */
export const HEALTH_INTERVAL_MS = 6_000
/** Pace of the polls of the steps n8n reported. */
export const STEP_POLL_MS = 400
/** How long the flow may take, from the webhook to its `done` step. */
export const STEPS_TIMEOUT_MS = 30_000
/** An SSE comment at least this often, so no proxy closes a quiet connection. */
export const KEEPALIVE_MS = 10_000

export const ERROR_MESSAGES: Record<AutomationErrorCode | 'rejected_webhook', string> = {
  n8n_unreachable:
    'El servidor de n8n no despertó a tiempo. Inténtalo de nuevo en unos minutos: a veces tarda un poco más.',
  rejected_webhook: 'n8n no aceptó la ejecución. Inténtalo de nuevo en unos minutos.',
  timeout: 'n8n no terminó el flujo a tiempo. Inténtalo de nuevo en unos minutos.',
  internal: 'Algo falló de nuestro lado durante la ejecución. Inténtalo de nuevo en unos minutos.',
}

export interface RunInput {
  runId: string
  lead: AutomationLead
  /** The service's visible name, sent to n8n with the lead. */
  serviceTitle: string
  db: Db
  n8n: N8n
  secret: string
  now: () => Date
  sleep: Sleep
  /** AUTOMATION_WAKE_TIMEOUT_SECONDS in ms. */
  wakeTimeoutMs: number
}

/** The interval between health checks: every HEALTH_INTERVAL_MS, or wider when the timeout would not fit. */
export function healthInterval(wakeTimeoutMs: number): number {
  return Math.max(HEALTH_INTERVAL_MS, Math.ceil(wakeTimeoutMs / (MAX_HEALTH_CHECKS - 1)))
}

interface Payloads {
  run: AutomationRunEvent
  waking: AutomationWakingEvent
  started: AutomationStartedEvent
  step: AutomationStepEvent
  done: AutomationDoneEvent
  error: AutomationErrorEvent
}

export async function streamRun(stream: SSEStreamingApi, input: RunInput): Promise<void> {
  const { runId, db, n8n, sleep } = input
  const abort = new AbortController()
  const { signal } = abort
  // The visitor closed the page: stop polling, cut the pending request to n8n and end.
  stream.onAbort(() => abort.abort())
  const clock = () => input.now().getTime()
  let lastWrite = clock()

  async function send<E extends keyof Payloads>(event: E, data: Payloads[E]): Promise<void> {
    await stream.writeSSE({ event, data: JSON.stringify(data) })
    lastWrite = clock()
  }

  async function fail(code: AutomationErrorCode, message = ERROR_MESSAGES[code]): Promise<void> {
    if (!signal.aborted) await send('error', { code, message })
  }

  /** Waits `ms`, writing a keep-alive comment whenever the stream has been quiet for KEEPALIVE_MS. */
  async function pause(ms: number): Promise<void> {
    const until = clock() + ms
    while (!signal.aborted) {
      const left = until - clock()
      if (left <= 0) return
      const quiet = clock() - lastWrite
      if (quiet >= KEEPALIVE_MS) {
        await stream.write(': ping\n\n')
        lastWrite = clock()
        continue
      }
      await sleep(Math.min(left, KEEPALIVE_MS - quiet), signal)
    }
  }

  /** True once /healthz/readiness answers 200; false at the wake timeout, at the check budget or when the visitor leaves. */
  async function wake(): Promise<boolean> {
    const start = clock()
    const interval = healthInterval(input.wakeTimeoutMs)
    for (let check = 1; ; check++) {
      if (await n8n.healthy(signal)) return !signal.aborted
      if (signal.aborted) return false
      const elapsedMs = Math.max(0, clock() - start)
      if (elapsedMs >= input.wakeTimeoutMs || check >= MAX_HEALTH_CHECKS) return false
      await send('waking', { elapsedMs })
      // Checks keep their pace even when one is slow, and the last one lands on the timeout.
      const next = Math.min(start + check * interval, start + input.wakeTimeoutMs)
      await pause(next - clock())
      if (signal.aborted) return false
    }
  }

  /** Relays the steps n8n reports until `done`; false when the flow takes too long. */
  async function relaySteps(startedAt: number): Promise<boolean> {
    const deadline = startedAt + STEPS_TIMEOUT_MS
    const sent = new Set<string>()
    while (!signal.aborted) {
      for (const stored of await listSteps(db, runId)) {
        if (sent.has(stored.step) || signal.aborted) continue
        sent.add(stored.step)
        const atMs = Math.max(0, stored.at.getTime() - startedAt)
        const { at: _, ...report } = stored
        await send('step', { ...report, atMs })
        if (report.step === 'done') {
          await send('done', { outcome: report.data.outcome, totalMs: atMs })
          return true
        }
      }
      if (clock() >= deadline) return false
      await pause(Math.min(STEP_POLL_MS, deadline - clock()))
    }
    return true
  }

  try {
    await send('run', { runId })
    if (!(await wake())) return await fail('n8n_unreachable')

    const startedAt = clock()
    const callbackToken = await issueCallbackToken(input.secret, runId, input.now())
    const lead = { ...input.lead, serviceTitle: input.serviceTitle }
    const accepted = await n8n.trigger({ runId, callbackToken, lead }, signal)
    if (signal.aborted) return
    if (!accepted) return await fail('n8n_unreachable', ERROR_MESSAGES.rejected_webhook)
    await send('started', {})

    if (!(await relaySteps(startedAt))) await fail('timeout')
  } catch (err) {
    if (signal.aborted) return
    log.error('automation run failed', err)
    await fail('internal')
  }
}
