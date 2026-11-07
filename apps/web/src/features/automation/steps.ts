/**
 * How the page names and shows each step of the flow (docs/AUTOMATIZACION.md) and the times of the run.
 * Types only from @aim/contracts: nothing here pulls zod into the page.
 */

import type { AutomationOutcome, AutomationStep, AutomationStepEvent, AutomationTier } from '@aim/contracts'
import { AUTOMATION_STEPS } from '@aim/contracts/limits'

export const STEPS: readonly AutomationStep[] = AUTOMATION_STEPS

export const STEP_INFO: Record<AutomationStep, { title: string; description: string }> = {
  received: { title: 'Recibido', description: 'n8n recibe la solicitud por un webhook.' },
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
const wholeSeconds = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 })

/** A step's time since the run started: "0,4 s", "12,3 s". */
export function formatMs(ms: number): string {
  return `${seconds.format(Math.max(0, ms) / 1000)} s`
}

/** The wait while n8n wakes up: "8 s", "1 min 05 s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${wholeSeconds.format(total)} s`
  const minutes = Math.floor(total / 60)
  const rest = String(total % 60).padStart(2, '0')
  return `${minutes} min ${rest} s`
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
      return `${title}: ejecución de n8n número ${event.data.execution}.`
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
