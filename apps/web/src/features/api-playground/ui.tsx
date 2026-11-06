import { CircleCheck, CircleX } from 'lucide-preact'
import type { Outcome } from './client'
import { statusKind, statusText } from './response'

/** Code, JSON and headers: the only places the console uses the monospaced font (docs/DISENO.md). */
export const codeBlock =
  'rounded-lg border border-line bg-ink px-3 py-3 font-mono text-step--1 leading-relaxed whitespace-pre-wrap wrap-anywhere sm:px-4'

/** The live color only marks success on the icon; errors are danger. */
export function OutcomeIcon({ outcome, size = 18 }: { outcome: Outcome; size?: number }) {
  if (outcome.kind === 'response' && statusKind(outcome.status) === 'success') {
    return <CircleCheck size={size} class="shrink-0 text-live" aria-hidden="true" />
  }
  return <CircleX size={size} class="shrink-0 text-danger" aria-hidden="true" />
}

/** "201 Creado", or why nothing arrived. */
export function outcomeLabel(outcome: Outcome): string {
  if (outcome.kind === 'timeout') return 'Sin respuesta a tiempo'
  if (outcome.kind === 'network') return 'Sin conexión'
  return `${outcome.status} ${statusText(outcome.status)}`
}

export const isSuccess = (outcome: Outcome) =>
  outcome.kind === 'response' && statusKind(outcome.status) === 'success'
