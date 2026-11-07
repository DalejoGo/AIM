import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunEvent, RunRequest } from './client'
import type { Problem } from './errors'
import { EVENTS, FLOW_NAME } from './fixtures'
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
  it('goes from sending to running and reveals one step every 120 ms, then the result', async () => {
    expect(STEP_PACE_MS).toBe(120)
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)

    expect(run.phase.value).toBe('sending')
    expect(run.busy.value).toBe(true)
    expect(run.announcement.value).toBe('Enviando la solicitud de prueba…')
    // The API answers after 150 ms.
    await vi.advanceTimersByTimeAsync(150)
    script.emit({ type: 'run', runId: 'run-1' })
    expect(run.phase.value).toBe('running')
    expect(run.runId.value).toBe('run-1')
    expect(run.statuses.value.received).toBe('active')

    // Every step arrives at once (the flow runs in under a millisecond): they still appear one by one.
    for (const event of allSteps()) script.emit(event)
    script.emit({ type: 'done', outcome: 'accepted', totalMs: 0 })
    script.finish()
    await sent

    expect(Object.keys(run.steps.value)).toEqual(['received'])
    expect(run.announcement.value).toBe(`Recibido: flujo ${FLOW_NAME}.`)
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
    // From the submit: 150 ms of network, then six gaps of 120 ms.
    expect(run.result.value).toEqual({ outcome: 'accepted', totalMs: 0, clickToResultMs: 870 })
    expect(run.announcement.value).toBe(
      'Listo: solicitud aceptada, prioridad alta. El flujo tardó menos de 1 ms; del clic al resultado, 0,9 s.',
    )
    expect(Object.values(run.statuses.value)).toEqual(Array(7).fill('done'))
    // The real times stay as the API reported them.
    expect(run.steps.value.done?.atMs).toBe(1)
  })

  it('shows steps as soon as they come when they are slower than the pace', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    void run.submit(REQUEST)
    script.emit({ type: 'run', runId: 'run-1' })
    script.emit({ type: 'step', event: EVENTS.received })
    await vi.advanceTimersByTimeAsync(2_000)
    script.emit({ type: 'step', event: EVENTS.validated })
    expect(Object.keys(run.steps.value)).toEqual(['received', 'validated'])
  })

  it('skips the steps of a rejected lead', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start, paceMs: 0 })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'run', runId: 'run-1' })
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
    script.emit({ type: 'done', outcome: 'rejected', totalMs: 2 })
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
    expect(run.announcement.value).toBe(
      'Listo: solicitud rechazada. El flujo tardó 2 ms; del clic al resultado, menos de 1 ms.',
    )
  })

  it('fails after the steps that came before the problem are shown', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'run', runId: 'run-1' })
    script.emit({ type: 'step', event: EVENTS.received })
    script.emit({ type: 'step', event: EVENTS.validated })
    const problem: Problem = { kind: 'internal', message: 'Algo falló.', fields: {} }
    script.finish(problem)
    await sent

    expect(run.phase.value).toBe('running')
    await vi.advanceTimersByTimeAsync(STEP_PACE_MS)
    expect(run.phase.value).toBe('failed')
    expect(run.problem.value).toEqual(problem)
    expect(Object.keys(run.steps.value)).toEqual(['received', 'validated'])
    expect(run.statuses.value.scored).toBe('pending')
    expect(run.result.value).toBeNull()
  })

  it('fails at once when the API refuses the run', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)
    const problem: Problem = { kind: 'captcha', message: 'Verifica otra vez.', fields: {} }
    script.finish(problem)
    await sent
    expect(run.phase.value).toBe('failed')
    expect(run.busy.value).toBe(false)
    expect(run.problem.value).toEqual(problem)
  })

  it('stops: aborts the request, shows what had arrived and ignores the rest', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start })
    const sent = run.submit(REQUEST)
    script.emit({ type: 'run', runId: 'run-1' })
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
    script.emit({ type: 'run', runId: 'run-1' })
    script.emit({ type: 'step', event: EVENTS.received })
    script.emit({ type: 'done', outcome: 'accepted', totalMs: 1 })
    script.finish()
    await first
    expect(run.phase.value).toBe('done')

    const second = run.submit(REQUEST)
    expect(run.steps.value).toEqual({})
    expect(run.result.value).toBeNull()
    expect(run.phase.value).toBe('sending')
    script.finish({ kind: 'captcha', message: 'Verifica otra vez.', fields: {} })
    await second
    expect(run.phase.value).toBe('failed')
  })

  it('resets to idle and drops what an old run still sends', async () => {
    const script = scripted()
    const run = createAutomationRun({ start: script.start, paceMs: 0 })
    void run.submit(REQUEST)
    script.emit({ type: 'run', runId: 'run-1' })
    run.reset()
    expect(run.phase.value).toBe('idle')
    script.emit({ type: 'step', event: EVENTS.received })
    expect(run.steps.value).toEqual({})
  })
})

describe('summary', () => {
  it('says the outcome, the priority when there is one, the flow time and the wait', () => {
    expect(
      summary({ scored: EVENTS.scored }, { outcome: 'accepted', totalMs: 0, clickToResultMs: 812 }),
    ).toBe(
      'Listo: solicitud aceptada, prioridad alta. El flujo tardó menos de 1 ms; del clic al resultado, 0,8 s.',
    )
    expect(summary({}, { outcome: 'rejected', totalMs: 3, clickToResultMs: 1_460 })).toBe(
      'Listo: solicitud rechazada. El flujo tardó 3 ms; del clic al resultado, 1,5 s.',
    )
  })
})
