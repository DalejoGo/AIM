import type { Exchange } from './history'
import { explainError, formatDuration, readBody, readMeta, seconds, statusText } from './response'
import { failureText } from './wake'

/** What the status region reads out when an answer arrives: the status, the time and, for errors, why. */
export function resultAnnouncement(exchange: Exchange): string {
  const { outcome } = exchange
  if (outcome.kind !== 'response') return failureText(outcome.kind, exchange.slowStart)

  const parts = [
    `Respuesta ${outcome.status}, ${statusText(outcome.status)}, en ${formatDuration(outcome.totalMs)}.`,
  ]
  const meta = readMeta(outcome.headers, exchange.at + outcome.totalMs)
  const explanation = explainError(outcome.status, readBody(outcome.body), {
    retryAfter: meta.retryAfter,
    limit: meta.limit,
  })
  if (explanation) {
    parts.push(explanation.message)
    if (explanation.fields.length > 0) {
      const count = explanation.fields.length
      parts.push(count === 1 ? 'Hay 1 campo con problemas.' : `Hay ${count} campos con problemas.`)
    }
  }
  if (meta.retryAfter !== null) parts.push(`Espera ${seconds(meta.retryAfter)}.`)
  return parts.join(' ')
}
