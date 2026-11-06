// The burst of the "Límite de tasa en vivo" demo, as data: what each answer was and how to tell it in Spanish.

/** Requests the button sends, one after the other. More than the API accepts per window (10 by default). */
export const BURST_SIZE = 15

export interface HeaderLine {
  name: string
  value: string
}

export interface BurstHit {
  /** Position in the burst, from 1. */
  n: number
  /** HTTP status, or 0 when no answer arrived. */
  status: number
  /** From sending the request to reading its whole answer. */
  ms: number
  /** Requests the API still accepts in this window (RateLimit-Remaining), when it said so. */
  remaining: number | null
  /** Seconds to wait (Retry-After), on 429. */
  retryAfter: number | null
  /** The rate-limit header lines exactly as they arrived. */
  headers: HeaderLine[]
}

export type HitKind = 'passed' | 'blocked' | 'failed'

export function hitKind(status: number): HitKind {
  if (status >= 200 && status < 300) return 'passed'
  if (status === 429) return 'blocked'
  return 'failed'
}

/** One word for the status column, after the code. */
export function statusWord(status: number): string {
  const kind = hitKind(status)
  if (kind === 'passed') return 'aceptada'
  if (kind === 'blocked') return 'frenada'
  return status === 0 ? 'sin respuesta' : 'error'
}

export interface BurstSummary {
  sent: number
  passed: number
  blocked: number
  failed: number
  /** Retry-After of the last 429, in seconds. */
  retryAfter: number | null
}

export function summarizeBurst(hits: readonly BurstHit[]): BurstSummary {
  const summary: BurstSummary = { sent: hits.length, passed: 0, blocked: 0, failed: 0, retryAfter: null }
  for (const hit of hits) {
    const kind = hitKind(hit.status)
    summary[kind]++
    if (kind === 'blocked' && hit.retryAfter !== null) summary.retryAfter = hit.retryAfter
  }
  return summary
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** "10 pasaron y 5 fueron frenadas." Empty before the first answer. */
export function summaryText({ sent, passed, blocked, failed }: BurstSummary): string {
  if (sent === 0) return ''
  if (passed === sent)
    return sent === 1 ? 'La petición pasó.' : `Las ${sent} pasaron: el límite no se alcanzó.`
  if (blocked === sent)
    return sent === 1 ? 'La petición fue frenada.' : `Ninguna pasó: las ${sent} fueron frenadas.`
  if (failed === sent) return sent === 1 ? 'La petición falló.' : `Las ${sent} fallaron.`
  const parts: string[] = []
  parts.push(passed === 0 ? 'ninguna pasó' : `${passed} ${passed === 1 ? 'pasó' : 'pasaron'}`)
  if (blocked > 0) parts.push(`${blocked} ${blocked === 1 ? 'fue frenada' : 'fueron frenadas'}`)
  if (failed > 0) parts.push(`${failed} ${failed === 1 ? 'falló' : 'fallaron'}`)
  return `${capitalize(joinParts(parts))}.`
}

/** Whole seconds left until `deadline` (epoch ms), never negative. */
export function secondsLeft(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}

export function countdownText(seconds: number): string {
  if (seconds <= 0) return 'Ya puedes volver a intentarlo.'
  return `Vuelve a intentarlo en ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}.`
}

/** What the status region says while the burst runs and when it ends. */
export function progressText(sent: number, total: number = BURST_SIZE): string {
  return `Enviando la petición ${Math.min(sent + 1, total)} de ${total}…`
}
