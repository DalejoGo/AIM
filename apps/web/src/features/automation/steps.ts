/**
 * How the page names and shows each step of the flow (docs/AUTOMATIZACION.md) and the times of the run.
 * Types only from @aim/contracts: nothing here pulls zod into the page.
 */

import type { AutomationOutcome, AutomationStep, AutomationStepEvent, AutomationTier } from '@aim/contracts'
import { AUTOMATION_STEPS } from '@aim/contracts/limits'

export const STEPS: readonly AutomationStep[] = AUTOMATION_STEPS

export const STEP_INFO: Record<AutomationStep, { title: string; description: string }> = {
  received: { title: 'Recibido', description: 'La API del sitio recibe la solicitud.' },
  validated: { title: 'Validado', description: 'Revisa las reglas del negocio.' },
  scored: { title: 'Calificado', description: 'Suma puntos por presupuesto, plazo, servicio y detalle.' },
  routed: { title: 'Enrutado', description: 'Decide qué sigue y en cuánto tiempo.' },
  drafted: { title: 'Respuesta redactada', description: 'Escribe el correo de respuesta. No se envía.' },
  recorded: { title: 'Registrado', description: 'Guarda la solicitud con una referencia.' },
  done: { title: 'Terminado', description: 'El flujo devuelve el resultado.' },
}

export const TIER_LABELS: Record<AutomationTier, string> = {
  hot: 'Prioridad alta',
  warm: 'Prioridad media',
  cold: 'Prioridad baja',
}

export const OUTCOME_LABELS: Record<AutomationOutcome, string> = {
  accepted: 'Solicitud aceptada',
  rejected: 'Solicitud rechazada',
}

/** Steps that ran, by name, as the stream reported them. */
export type StepsSoFar = Partial<{ [S in AutomationStep]: Extract<AutomationStepEvent, { step: S }> }>

export type StepStatus = 'pending' | 'active' | 'done' | 'skipped'

/** The steps this run goes through: a lead that fails validation jumps from `validated` to `done`. */
export function expectedPath(steps: StepsSoFar): readonly AutomationStep[] {
  return steps.validated?.data.valid === false ? ['received', 'validated', 'done'] : STEPS
}

/**
 * Where each step stands. `running`: the flow is on (the first step still to come is active); otherwise the
 * steps that never came are pending, or skipped when the run finished without them.
 */
export function stepStatuses(
  steps: StepsSoFar,
  run: 'idle' | 'running' | 'finished' | 'stopped',
): Record<AutomationStep, StepStatus> {
  const path = expectedPath(steps)
  const next = run === 'running' ? path.find((step) => !steps[step]) : undefined
  const statuses = {} as Record<AutomationStep, StepStatus>
  for (const step of STEPS) {
    if (steps[step]) statuses[step] = 'done'
    else if (step === next) statuses[step] = 'active'
    else if (!path.includes(step) && (run === 'finished' || steps.done)) statuses[step] = 'skipped'
    else statuses[step] = 'pending'
  }
  return statuses
}

export const STATUS_TEXT: Record<StepStatus, string> = {
  pending: 'Pendiente',
  active: 'En curso',
  done: 'Listo',
  skipped: 'Omitido',
}

const seconds = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** Times of the flow, which usually runs in under a millisecond: "menos de 1 ms", "3 ms", "1,2 s". */
export function formatMs(ms: number): string {
  const whole = Math.round(Math.max(0, ms))
  if (whole < 1) return 'menos de 1 ms'
  if (whole < 1000) return `${whole} ms`
  return `${seconds.format(whole / 1000)} s`
}

/** What the visitor waited, from the click to the result: "0,8 s", "1,4 s" (formatMs under 0,1 s). */
export function formatSeconds(ms: number): string {
  if (ms < 100) return formatMs(ms)
  return `${seconds.format(ms / 1000)} s`
}

/** Points with their sign, as the factors list shows them: "+15", "−5", "0". */
export function formatPoints(points: number): string {
  if (points > 0) return `+${points}`
  if (points < 0) return `−${Math.abs(points)}`
  return '0'
}

/** One sentence per step for the live region, read when the step appears. */
export function announceStep(event: AutomationStepEvent): string {
  const title = STEP_INFO[event.step].title
  switch (event.step) {
    case 'received':
      return `${title}: flujo ${event.data.flow}.`
    case 'validated': {
      const passed = event.data.checks.filter((check) => check.ok).length
      const verdict = event.data.valid ? 'válida' : 'no válida'
      return `${title}: ${passed} de ${event.data.checks.length} reglas cumplidas, solicitud ${verdict}.`
    }
    case 'scored':
      return `${title}: ${event.data.score} de 100 puntos, ${TIER_LABELS[event.data.tier].toLowerCase()}.`
    case 'routed':
      return `${title}: ${event.data.sla}.`
    case 'drafted':
      return `${title}: ${event.data.subject}.`
    case 'recorded':
      return `${title} con la referencia ${event.data.reference}.`
    case 'done':
      return `${title}: ${OUTCOME_LABELS[event.data.outcome].toLowerCase()}.`
  }
}
