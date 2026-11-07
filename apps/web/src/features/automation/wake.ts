/**
 * Early wake-up of n8n (Render's free plan puts it to sleep; booting takes 1–2 minutes). The page asks
 * GET /api/automation/status as soon as it opens, which already starts the wake-up on Render, and keeps asking
 * while n8n is `waking`, so the visitor's run starts at once once the form is filled.
 *
 * Without zod or lib/api: this runs on load, before the visitor does anything.
 */

import type { AutomationStatusState } from '@aim/contracts'
import { AUTOMATION_STATUS_STATES } from '@aim/contracts/limits'
import { signal } from '@preact/signals'

export const STATUS_PATH = '/api/automation/status'
/** How often the page asks again while n8n wakes up. */
export const WAKE_POLL_MS = 5_000
/** When the page stops asking: the same wait a run allows (AUTOMATION_WAKE_TIMEOUT_SECONDS in the edge). */
export const WAKE_GIVE_UP_MS = 180_000
/** How often the visible counter is redrawn. */
export const WAKE_TICK_MS = 1_000

export type Fetch = (input: string, init: RequestInit) => Promise<Response>

const isState = (value: unknown): value is AutomationStatusState =>
  (AUTOMATION_STATUS_STATES as readonly unknown[]).includes(value)

/** One GET /api/automation/status: the state, or null for any failure (the indicator then hides). */
export async function fetchStatus(
  signal: AbortSignal,
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): Promise<AutomationStatusState | null> {
  try {
    const response = await fetchImpl(STATUS_PATH, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return null
    }
    const body: unknown = await response.json()
    const state = typeof body === 'object' && body !== null ? (body as { state?: unknown }).state : undefined
    return isState(state) ? state : null
  } catch {
    return null
  }
}

/** hidden: nothing to say (not asked yet, disabled, an error, gave up or a run took over). */
export type WakeView = 'hidden' | 'waking' | 'ready'

export interface WakeWatchDeps {
  check: (signal: AbortSignal) => Promise<AutomationStatusState | null>
  /** Milliseconds; Date.now in the browser (and Vitest's fake clock in the tests). */
  clock?: () => number
  pollMs?: number
  giveUpMs?: number
}

/**
 * State of the early wake-up without DOM. `start` asks once (even in a background tab: that request is what
 * wakes n8n); while the answer is `waking` it asks again every `pollMs`, never while the tab is hidden, and
 * stops at `ready`, at the first failure, after `giveUpMs` or for good when a run starts (`stop`).
 */
export function createWakeWatch({
  check,
  clock = () => Date.now(),
  pollMs = WAKE_POLL_MS,
  giveUpMs = WAKE_GIVE_UP_MS,
}: WakeWatchDeps) {
  const view = signal<WakeView>('hidden')
  /** How long n8n has been waking up, since the page first asked. */
  const elapsedMs = signal(0)

  let startedAt: number | null = null
  /** No more checks: ready, disabled, an error, gave up or stopped. */
  let finished = false
  let pageHidden = false
  let pending: AbortController | null = null
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let tickTimer: ReturnType<typeof setInterval> | null = null

  const since = () => (startedAt === null ? 0 : Math.max(0, clock() - startedAt))

  function clearTimers() {
    if (pollTimer !== null) clearTimeout(pollTimer)
    if (tickTimer !== null) clearInterval(tickTimer)
    pollTimer = null
    tickTimer = null
  }

  function finish(next: WakeView) {
    finished = true
    clearTimers()
    pending?.abort()
    pending = null
    view.value = next
  }

  function tick() {
    if (tickTimer !== null || pageHidden) return
    tickTimer = setInterval(() => {
      elapsedMs.value = since()
    }, WAKE_TICK_MS)
  }

  async function ask(): Promise<void> {
    if (finished || pending) return
    const abort = new AbortController()
    pending = abort
    const state = await check(abort.signal).catch(() => null)
    if (pending !== abort) return
    pending = null
    if (finished) return

    if (state === 'ready') return finish('ready')
    if (state !== 'waking' || since() >= giveUpMs) return finish('hidden')
    elapsedMs.value = since()
    view.value = 'waking'
    tick()
    if (!pageHidden) pollTimer = setTimeout(() => void ask(), pollMs)
  }

  return {
    view,
    elapsedMs,
    /** Asks the first time. */
    start(): Promise<void> {
      if (startedAt !== null) return Promise.resolve()
      startedAt = clock()
      return ask()
    },
    /** A hidden tab does not ask (nor redraw the counter); back in view it asks at once. */
    setPageHidden(hidden: boolean): Promise<void> {
      if (hidden === pageHidden) return Promise.resolve()
      pageHidden = hidden
      if (hidden) {
        clearTimers()
        return Promise.resolve()
      }
      if (finished || startedAt === null || view.value !== 'waking') return Promise.resolve()
      elapsedMs.value = since()
      tick()
      return ask()
    },
    /** For good: a run started, and its own `waking` events take over. */
    stop() {
      finish('hidden')
    },
  }
}

export type WakeWatch = ReturnType<typeof createWakeWatch>

/** The counter next to the form: "0:07", "1:23". */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
