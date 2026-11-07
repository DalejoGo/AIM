import type { AutomationOutcome, AutomationStepEvent } from '@aim/contracts'
import { batch, computed, signal } from '@preact/signals'
import type { RunEvent, RunOptions, RunRequest } from './client'
import type { Problem } from './errors'
import {
  announceStep,
  formatMs,
  formatSeconds,
  OUTCOME_LABELS,
  type StepsSoFar,
  stepStatuses,
  TIER_LABELS,
} from './steps'

/**
 * The gap between two steps appearing. The flow runs in under a millisecond, so every step arrives at once;
 * this cascade lets the eye follow them. Each step still shows the real time it took.
 */
export const STEP_PACE_MS = 120

/**
 * idle: nothing sent yet; sending: waiting for the API's answer; running: the API created the run and the
 * steps arrive; done; failed: problem says why; stopped: the visitor stopped it.
 */
export type Phase = 'idle' | 'sending' | 'running' | 'done' | 'failed' | 'stopped'

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

export interface RunResult {
  outcome: AutomationOutcome
  /** How long the flow took, as the API measured it. */
  totalMs: number
  /** Measured here: from the visitor's submit until the result was shown. */
  clickToResultMs: number
}

type Queued = { kind: 'step'; event: AutomationStepEvent } | { kind: 'final'; apply: () => void }

/**
 * State of the automation demo without DOM: the run's phase, the steps as they are revealed (one every
 * STEP_PACE_MS at most), the result and what went wrong. The component renders it and moves focus.
 */
export function createAutomationRun({
  start,
  paceMs = STEP_PACE_MS,
  clock = () => Date.now(),
}: AutomationRunDeps) {
  const phase = signal<Phase>('idle')
  const runId = signal<string | null>(null)
  const steps = signal<StepsSoFar>({})
  const result = signal<RunResult | null>(null)
  const problem = signal<Problem | null>(null)
  /** What the live region says: the request, each step and the result. */
  const announcement = signal('')

  const busy = computed(() => ['sending', 'running'].includes(phase.value))
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
  /** When the visitor submitted the current run. */
  let sentAt = 0

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
        batch(() => {
          runId.value = event.runId
          phase.value = 'running'
        })
        break
      case 'step':
        enqueue({ kind: 'step', event: event.event })
        break
      case 'done':
        enqueue({
          kind: 'final',
          apply: () => {
            const next: RunResult = {
              outcome: event.outcome,
              totalMs: event.totalMs,
              clickToResultMs: Math.max(0, clock() - sentAt),
            }
            batch(() => {
              result.value = next
              phase.value = 'done'
              announcement.value = summary(steps.value, next)
            })
          },
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
    lastReveal = Number.NEGATIVE_INFINITY
    sentAt = clock()
    batch(() => {
      phase.value = 'sending'
      runId.value = null
      steps.value = {}
      result.value = null
      problem.value = null
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
            problem.value = found
            phase.value = 'failed'
            announcement.value = ''
          }),
      })
    } catch {
      // Only an abort rejects: the visitor stopped the run. Whatever it still delivers is dropped.
      if (current !== generation) return 'sent'
      generation++
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

  /** Closes the stream. */
  function stop() {
    controller?.abort()
  }

  /** Back to the form, for another run. */
  function reset() {
    generation++
    controller?.abort()
    controller = null
    clearQueue()
    batch(() => {
      phase.value = 'idle'
      runId.value = null
      steps.value = {}
      result.value = null
      problem.value = null
      announcement.value = ''
    })
  }

  return {
    phase,
    runId,
    steps,
    result,
    problem,
    announcement,
    busy,
    statuses,
    submit,
    stop,
    reset,
  }
}

export type AutomationRun = ReturnType<typeof createAutomationRun>

/** The sentence read when the run ends: the outcome, its priority, how long the flow took and the wait. */
export function summary(steps: StepsSoFar, { outcome, totalMs, clickToResultMs }: RunResult): string {
  const tier = steps.scored ? `, ${TIER_LABELS[steps.scored.data.tier].toLowerCase()}` : ''
  return `Listo: ${OUTCOME_LABELS[outcome].toLowerCase()}${tier}. El flujo tardó ${formatMs(totalMs)}; del clic al resultado, ${formatSeconds(clickToResultMs)}.`
}
