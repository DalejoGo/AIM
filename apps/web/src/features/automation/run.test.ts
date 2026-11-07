import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent, RunRequest } from './client'
import type { Problem } from './errors'
import { EVENTS } from './fixtures'
import { createAutomationRun, STEP_PACE_MS, type StartRun, summary } from './run'
import { STEPS } from './steps'

const REQUEST: RunRequest = {
  turnstileToken: 't',
  lead: {
    name: 'Laura',
    email: 'laura@empresa.co',
    service: 'web',
    budget: 'unknown',
    timeline: 'month',
    message: 'Necesito una página.',
  },
}

/** A run the test drives: it emits events when told and ends when told. */
function scripted() {
  let emit: (event: RunEvent) => void = () => {}
  let finish: (problem: Problem | null) => void = () => {}
  let fail: (error: unknown) => void = () => {}
  const signals: AbortSignal[] = []
  const start: StartRun = (_request, { signal, onEvent }) => {
    signals.push(signal)
    emit = onEvent
    return new Promise((resolve, reject) => {
      finish = resolve
      fail = reject
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })
  }
  return {
    start,
    signals,
    emit: (event: RunEvent) => emit(event),
    finish: (problem: Problem | null = null) => finish(problem),
    fail: (error: unknown) => fail(error),
  }
}

const allSteps = () => STEPS.map((step) => ({ type: 'step' as const, event: EVENTS[step] }))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createAutomationRun', () => {
  it('goes from sending to running and reveals one step every 350 ms, then the result', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)

    expect(run.phase.value).toBe('sending')
    expect(run.busy.value).toBe(true)
    expect(run.announcement.value).toBe('Enviando la solicitud de prueba…')
    script.emit({ type: 'run', runId: 'run-1' })
    script.emit({ type: 'started' })
    expect(run.phase.value).toBe('running')
    expect(run.runId.value).toBe('run-1')
    expect(run.statuses.value.received).toBe('active')

    // Every step arrives at once (n8n is fast): they still appear one by one.
    for (const event of allSteps()) script.emit(event)
    script.emit({ type: 'done', outcome: 'accepted', totalMs: 900 })
    script.finish()
    await sent

    expect(Object.keys(run.steps.value)).toEqual(['received'])
    expect(run.announcement.value).toBe('Recibido: ejecución de n8n número 1042.')
    expect(run.statuses.value.validated).toBe('active')

    await vi.advanceTimersByTimeAsync(STEP_PACE_MS - 1)
    expect(Object.keys(run.steps.value)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(Object.keys(run.steps.value)).toEqual(['received', 'validated'])
    expect(run.phase.value).toBe('running')

    await vi.advanceTimersByTimeAsync(STEP_PACE_MS * 5)
    expect(Object.keys(run.steps.value)).toEqual([...STEPS])
    expect(run.phase.value).toBe('done')
    expect(run.busy.value).toBe(false)
    expect(run.result.value).toEqual({ outcome: 'accepted', totalMs: 900 })
    expect(run.announcement.value).toBe('Listo: solicitud aceptada, prioridad alta. El flujo tardó 0,9 s.')
    expect(Object.values(run.statuses.value)).toEqual(Array(7).fill('done'))
    // The real times stay as n8n reported them.
    expect(run.steps.value.done?.atMs).toBe(900)
  })

  it('shows steps as soon as they come when they are slower than the pace', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    void run.submit(REQUEST)
    script.emit({ type: 'started' })
    script.emit({ type: 'step', event: EVENTS.received })
    await vi.advanceTimersByTimeAsync(2_000)
    script.emit({ type: 'step', event: EVENTS.validated })
    expect(Object.keys(run.steps.value)).toEqual(['received', 'validated'])
  })

  it('counts the wait while n8n wakes up and keeps how long it took', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    void run.submit(REQUEST)
    script.emit({ type: 'run', runId: 'run-1' })
    script.emit({ type: 'waking', elapsedMs: 0 })

    expect(run.phase.value).toBe('waking')
    expect(run.announcement.value).toContain('El servidor gratuito de n8n estaba dormido')
    const announced = run.announcement.value
    await vi.advanceTimersByTimeAsync(3_000)
    expect(run.wakeMs.value).toBe(3_000)
    // The API's own count resyncs it.
    script.emit({ type: 'waking', elapsedMs: 6_500 })
    expect(run.wakeMs.value).toBe(6_500)
    expect(run.announcement.value).toBe(announced)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(run.wakeMs.value).toBe(8_500)

    await vi.advanceTimersByTimeAsync(500)
    script.emit({ type: 'started' })
    expect(run.phase.value).toBe('running')
    expect(run.wokeAfterMs.value).toBe(9_000)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run.wakeMs.value).toBe(8_500)
  })

  it('does not report a wake when n8n was already awake', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    void run.submit(REQUEST)
    script.emit({ type: 'started' })
    expect(run.wokeAfterMs.value).toBeNull()
  })

  it('skips the steps of a rejected lead', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start, paceMs: 0 })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'started' })
    script.emit({ type: 'step', event: EVENTS.received })
    script.emit({
      type: 'step',
      event: {
        ...EVENTS.validated,
        data: { valid: false, checks: [{ id: 'links', label: 'Enlaces', ok: false }] },
      },
    })
    expect(run.statuses.value.done).toBe('active')
    script.emit({ type: 'step', event: { ...EVENTS.done, data: { outcome: 'rejected' } } })
    script.emit({ type: 'done', outcome: 'rejected', totalMs: 300 })
    script.finish()
    await sent

    expect(run.phase.value).toBe('done')
    expect(STEPS.map((s) => run.statuses.value[s])).toEqual([
      'done',
      'done',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'done',
    ])
    expect(run.announcement.value).toBe('Listo: solicitud rechazada. El flujo tardó 0,3 s.')
  })

  it('fails after the steps that came before the problem are shown', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'started' })
    script.emit({ type: 'step', event: EVENTS.received })
    script.emit({ type: 'step', event: EVENTS.validated })
    const problem: Problem = { kind: 'timeout', message: 'n8n no terminó.', fields: {}, retryAfter: null }
    script.finish(problem)
    await sent

    expect(run.phase.value).toBe('running')
    await vi.advanceTimersByTimeAsync(STEP_PACE_MS)
    expect(run.phase.value).toBe('failed')
    expect(run.problem.value).toEqual(problem)
    expect(Object.keys(run.steps.value)).toEqual(['received', 'validated'])
    expect(run.statuses.value.scored).toBe('pending')
  })

  it('fails at once when the API refuses the run, and stops the wake counter', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'waking', elapsedMs: 0 })
    const problem: Problem = {
      kind: 'n8n_unreachable',
      message: 'No despertó.',
      fields: {},
      retryAfter: null,
    }
    script.finish(problem)
    await sent
    expect(run.phase.value).toBe('failed')
    const shown = run.wakeMs.value
    await vi.advanceTimersByTimeAsync(5_000)
    expect(run.wakeMs.value).toBe(shown)
  })

  it('stops: aborts the request, shows what had arrived and ignores the rest', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'started' })
    script.emit({ type: 'step', event: EVENTS.received })
    script.emit({ type: 'step', event: EVENTS.validated })
    run.stop()
    await sent

    expect(script.signals[0]?.aborted).toBe(true)
    expect(run.phase.value).toBe('stopped')
    expect(run.announcement.value).toBe('Detuviste la ejecución.')
    expect(Object.keys(run.steps.value)).toEqual(['received', 'validated'])
    script.emit({ type: 'step', event: EVENTS.scored })
    await vi.advanceTimersByTimeAsync(STEP_PACE_MS * 2)
    expect(run.steps.value.scored).toBeUndefined()
  })

  it('ignores a second submit while one runs, and starts clean the next time', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start, paceMs: 0 })
    const first = run.submit(REQUEST)
    expect(await run.submit(REQUEST)).toBe('ignored')
    script.emit({ type: 'started' })
    script.emit({ type: 'step', event: EVENTS.received })
    script.emit({ type: 'done', outcome: 'accepted', totalMs: 1 })
    script.finish()
    await first
    expect(run.phase.value).toBe('done')

    const second = run.submit(REQUEST)
    expect(run.steps.value).toEqual({})
    expect(run.result.value).toBeNull()
    expect(run.phase.value).toBe('sending')
    script.finish({ kind: 'limited', message: 'Espera.', fields: {}, retryAfter: 60 })
    await second
    expect(run.phase.value).toBe('failed')
  })

  it('resets to idle and drops what an old run still sends', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start, paceMs: 0 })
    void run.submit(REQUEST)
    script.emit({ type: 'started' })
    run.reset()
    expect(run.phase.value).toBe('idle')
    script.emit({ type: 'step', event: EVENTS.received })
    expect(run.steps.value).toEqual({})
  })
})

describe('summary', () => {
  it('says the outcome, the priority when there is one, and the time', () => {
    expect(summary({ scored: EVENTS.scored }, 'accepted', 1234)).toBe(
      'Listo: solicitud aceptada, prioridad alta. El flujo tardó 1,2 s.',
    )
    expect(summary({}, 'rejected', 300)).toBe('Listo: solicitud rechazada. El flujo tardó 0,3 s.')
  })
})
