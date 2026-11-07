import { AUTOMATION_STEPS, type AutomationStepEvent } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import { EVENTS } from './fixtures'
import {
  announceStep,
  expectedPath,
  formatElapsed,
  formatMs,
  formatPoints,
  STEP_INFO,
  STEPS,
  type StepsSoFar,
  stepStatuses,
} from './steps'

const rejectedValidation: Extract<AutomationStepEvent, { step: 'validated' }> = {
  ...EVENTS.validated,
  data: { valid: false, checks: [{ id: 'links', label: 'Sin enlaces sospechosos', ok: false }] },
}

describe('steps', () => {
  it('names the seven steps of the contract, in order', () => {
    expect(STEPS).toEqual([...AUTOMATION_STEPS])
    expect(Object.keys(STEP_INFO)).toEqual([...AUTOMATION_STEPS])
  })

  it('follows the full path, or the short one after a failed validation', () => {
    expect(expectedPath({})).toEqual(STEPS)
    expect(expectedPath({ validated: EVENTS.validated })).toEqual(STEPS)
    expect(expectedPath({ validated: rejectedValidation })).toEqual(['received', 'validated', 'done'])
  })

  it('marks the next step active while the flow runs', () => {
    expect(stepStatuses({}, 'idle')).toEqual(Object.fromEntries(STEPS.map((s) => [s, 'pending'])))
    const running = stepStatuses({ received: EVENTS.received }, 'running')
    expect(running.received).toBe('done')
    expect(running.validated).toBe('active')
    expect(running.scored).toBe('pending')
  })

  it('skips the steps a rejected lead never goes through', () => {
    const soFar: StepsSoFar = { received: EVENTS.received, validated: rejectedValidation }
    const running = stepStatuses(soFar, 'running')
    expect(running.done).toBe('active')
    expect(running.scored).toBe('pending')
    const finished = stepStatuses(
      { ...soFar, done: { ...EVENTS.done, data: { outcome: 'rejected' } } },
      'finished',
    )
    expect(STEPS.map((s) => finished[s])).toEqual([
      'done',
      'done',
      'skipped',
      'skipped',
      'skipped',
      'skipped',
      'done',
    ])
  })

  it('leaves what never came as pending when the run stops half-way', () => {
    const stopped = stepStatuses({ received: EVENTS.received }, 'stopped')
    expect(STEPS.map((s) => stopped[s])).toEqual(['done', ...Array(6).fill('pending')])
  })
})

describe('formatting', () => {
  it('shows step times with one decimal, in Spanish', () => {
    expect(formatMs(0)).toBe('0,0 s')
    expect(formatMs(412)).toBe('0,4 s')
    expect(formatMs(12_345)).toBe('12,3 s')
    expect(formatMs(-5)).toBe('0,0 s')
  })

  it('shows the wait in seconds, then minutes', () => {
    expect(formatElapsed(0)).toBe('0 s')
    expect(formatElapsed(42_900)).toBe('42 s')
    expect(formatElapsed(65_000)).toBe('1 min 05 s')
    expect(formatElapsed(125_000)).toBe('2 min 05 s')
  })

  it('signs the points of each factor', () => {
    expect(formatPoints(15)).toBe('+15')
    expect(formatPoints(-5)).toBe('−5')
    expect(formatPoints(0)).toBe('0')
  })
})

describe('announceStep', () => {
  it('says one sentence per step', () => {
    expect(announceStep(EVENTS.received)).toBe('Recibido: ejecución de n8n número 1042.')
    expect(announceStep(EVENTS.validated)).toBe('Validado: 2 de 3 reglas cumplidas, solicitud válida.')
    expect(announceStep(rejectedValidation)).toBe('Validado: 0 de 1 reglas cumplidas, solicitud no válida.')
    expect(announceStep(EVENTS.scored)).toBe('Calificado: 75 de 100 puntos, prioridad alta.')
    expect(announceStep(EVENTS.routed)).toBe('Enrutado: Llamada en menos de 24 horas.')
    expect(announceStep(EVENTS.drafted)).toBe('Respuesta redactada: Laura, hablemos.')
    expect(announceStep(EVENTS.recorded)).toBe('Registrado con la referencia AIM-0B7C6A2E.')
    expect(announceStep(EVENTS.done)).toBe('Terminado: solicitud aceptada.')
  })
})
