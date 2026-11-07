import type { AutomationOutcome, AutomationStepEvent } from '@aim/contracts'
import { batch, computed, signal } from '@preact/signals'
import type { RunEvent, RunOptions, RunRequest } from './client'
import type { Problem } from './errors'
import { announceStep, formatMs, OUTCOME_LABELS, type StepsSoFar, stepStatuses, TIER_LABELS } from './steps'

/** The gap between two steps appearing, so each one can be read; their real times are shown as they came. */
export const STEP_PACE_MS = 350
/** How often the wait for n8n to wake up is redrawn. */
export const WAKE_TICK_MS = 1_000

/**
 * idle: nothing sent yet; sending: waiting for the API's answer; waking: n8n is asleep and the API is waking
 * it; running: n8n accepted the run and the steps arrive; done; failed: problem says why; stopped: the visitor
 * stopped it.
 */
export type Phase = 'idle' | 'sending' | 'waking' | 'running' | 'done' | 'failed' | 'stopped'

export type StartRun = (
  request: RunRequest,
  options: Omit<RunOptions, 'fetchImpl'>,
) => Promise<Problem | null>

export interface AutomationRunDeps {
  /** runAutomation (./client.ts), which the island loads only when the visitor runs the flow. */
  start: StartRun
  paceMs?: number
  /** Milliseconds; Date.now in the browser (and Vitest's fake clock in the tests). */
  clock?: () => number
}

export type SubmitResult = 'sent' | 'ignored'

type Queued = { kind: 'step'; event: AutomationStepEvent } | { kind: 'final'; apply: () => void }

/**
 * State of the automation demo without DOM: the run's phase, the wait for n8n, the steps as they are revealed
 * (one every STEP_PACE_MS at most), the result and what went wrong. The component renders it and moves focus.
 */
export function createAutomationRun({
  start,
  paceMs = STEP_PACE_MS,
  clock = () => Date.now(),
}: AutomationRunDeps) {
  const phase = signal<Phase>('idle')
  const runId = signal<string | null>(null)
  const steps = signal<StepsSoFar>({})
  const result = signal<{ outcome: AutomationOutcome; totalMs: number } | null>(null)
  const problem = signal<Problem | null>(null)
  /** How long n8n has been waking up, redrawn every second while it does. */
  const wakeMs = signal(0)
  /** How long n8n took to wake up, once it did; null when it was awake. */
  const wokeAfterMs = signal<number | null>(null)
  /** What the live region says: the wait, each step and the result. Not every tick. */
  const announcement = signal('')

  const busy = computed(() => ['sending', 'waking', 'running'].includes(phase.value))
  const statuses = computed(() => {
    const run =
      phase.value === 'running'
        ? 'running'
        : phase.value === 'done'
          ? 'finished'
          : phase.value === 'idle'
            ? 'idle'
            : 'stopped'
    return stepStatuses(steps.value, run)
  })

  let controller: AbortController | null = null
  // Bumped by every run and by reset: whatever an older run still delivers is dropped.
  let generation = 0
  let queue: Queued[] = []
  let paceTimer: ReturnType<typeof setTimeout> | null = null
  let lastReveal = Number.NEGATIVE_INFINITY
  let wakeTimer: ReturnType<typeof setInterval> | null = null
  /** The API's last report of the wait, and when it arrived here. */
  let wakeBase: { serverMs: number; at: number } | null = null

  const currentWake = () => (wakeBase ? wakeBase.serverMs + Math.max(0, clock() - wakeBase.at) : 0)

  function stopWakeTimer() {
    if (wakeTimer !== null) clearInterval(wakeTimer)
    wakeTimer = null
  }

  function clearQueue() {
    if (paceTimer !== null) clearTimeout(paceTimer)
    paceTimer = null
    queue = []
  }

  function reveal(event: AutomationStepEvent) {
    batch(() => {
      steps.value = { ...steps.value, [event.step]: event }
      announcement.value = announceStep(event)
    })
    lastReveal = clock()
  }

  /** Applies what is queued, one step every `paceMs`; final actions wait for the steps before them. */
  function drain() {
    if (paceTimer !== null) return
    while (queue.length > 0) {
      const next = queue[0] as Queued
      if (next.kind === 'step') {
        const wait = lastReveal + paceMs - clock()
        if (wait > 0) {
          paceTimer = setTimeout(() => {
            paceTimer = null
            drain()
          }, wait)
          return
        }
        queue.shift()
        reveal(next.event)
      } else {
        queue.shift()
        next.apply()
      }
    }
  }

  function enqueue(item: Queued) {
    queue.push(item)
    drain()
  }

  /** Reveals at once whatever is still queued (the visitor stopped the run). */
  function flush() {
    if (paceTimer !== null) clearTimeout(paceTimer)
    paceTimer = null
    for (const item of queue.splice(0)) {
      if (item.kind === 'step') reveal(item.event)
    }
  }

  function onEvent(event: RunEvent) {
    switch (event.type) {
      case 'run':
        runId.value = event.runId
        break
      case 'waking': {
        const first = wakeBase === null
        wakeBase = { serverMs: event.elapsedMs, at: clock() }
        batch(() => {
          phase.value = 'waking'
          wakeMs.value = event.elapsedMs
          if (first) {
            announcement.value =
              'El servidor gratuito de n8n estaba dormido. Despertarlo tarda de 1 a 2 minutos; la demo sigue sola.'
          }
        })
        if (wakeTimer === null) {
          wakeTimer = setInterval(() => {
            wakeMs.value = currentWake()
          }, WAKE_TICK_MS)
        }
        break
      }
      case 'started':
        stopWakeTimer()
        batch(() => {
          if (wakeBase) wokeAfterMs.value = currentWake()
          phase.value = 'running'
          announcement.value = 'n8n recibió la solicitud. El flujo está corriendo.'
        })
        break
      case 'step':
        enqueue({ kind: 'step', event: event.event })
        break
      case 'done':
        enqueue({
          kind: 'final',
          apply: () =>
            batch(() => {
              result.value = { outcome: event.outcome, totalMs: event.totalMs }
              phase.value = 'done'
              announcement.value = summary(steps.value, event.outcome, event.totalMs)
            }),
        })
        break
    }
  }

  async function submit(request: RunRequest): Promise<SubmitResult> {
    if (busy.value) return 'ignored'
    const current = ++generation
    const abort = new AbortController()
    controller = abort
    clearQueue()
    stopWakeTimer()
    wakeBase = null
    lastReveal = Number.NEGATIVE_INFINITY
    batch(() => {
      phase.value = 'sending'
      runId.value = null
      steps.value = {}
      result.value = null
      problem.value = null
      wakeMs.value = 0
      wokeAfterMs.value = null
      announcement.value = 'Enviando la solicitud de prueba…'
    })
    try {
      const found = await start(request, {
        signal: abort.signal,
        onEvent: (event) => {
          if (current === generation) onEvent(event)
        },
      })
      if (current !== generation || !found) return 'sent'
      enqueue({
        kind: 'final',
        apply: () =>
          batch(() => {
            stopWakeTimer()
            problem.value = found
            phase.value = 'failed'
            announcement.value = ''
          }),
      })
    } catch {
      // Only an abort rejects: the visitor stopped the run. Whatever it still delivers is dropped.
      if (current !== generation) return 'sent'
      generation++
      stopWakeTimer()
      flush()
      batch(() => {
        phase.value = 'stopped'
        announcement.value = 'Detuviste la ejecución.'
      })
    } finally {
      if (controller === abort) controller = null
    }
    return 'sent'
  }

  /** Closes the stream: the API stops waking n8n and polling the steps as soon as the connection ends. */
  function stop() {
    controller?.abort()
  }

  /** Back to the form, for another run. */
  function reset() {
    generation++
    controller?.abort()
    controller = null
    clearQueue()
    stopWakeTimer()
    wakeBase = null
    batch(() => {
      phase.value = 'idle'
      runId.value = null
      steps.value = {}
      result.value = null
      problem.value = null
      wakeMs.value = 0
      wokeAfterMs.value = null
      announcement.value = ''
    })
  }

  return {
    phase,
    runId,
    steps,
    result,
    problem,
    wakeMs,
    wokeAfterMs,
    announcement,
    busy,
    statuses,
    submit,
    stop,
    reset,
  }
}

export type AutomationRun = ReturnType<typeof createAutomationRun>

/** The sentence read when the run ends: the outcome, its priority and how long it took. */
export function summary(steps: StepsSoFar, outcome: AutomationOutcome, totalMs: number): string {
  const tier = steps.scored ? `, ${TIER_LABELS[steps.scored.data.tier].toLowerCase()}` : ''
  return `Listo: ${OUTCOME_LABELS[outcome].toLowerCase()}${tier}. El flujo tardó ${formatMs(totalMs)}.`
}
