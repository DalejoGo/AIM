import { formatDuration } from './response'

/**
 * Render's free plan puts the API to sleep after about 15 minutes without traffic, and the first request then
 * waits around a minute while it starts (DEC-014). The console says so instead of looking frozen.
 */

/** A request still waiting after this long, on an API that may be asleep, gets the "waking up" notice. */
export const WAKE_HINT_AFTER_MS = 3000
/** Generous enough for a cold start; past it the console gives up and offers to try again. */
export const REQUEST_TIMEOUT_MS = 75_000
/** A little under Render's 15 minutes, so the notice errs on the side of showing up. */
export const ASLEEP_AFTER_MS = 14 * 60_000

export const WAKING_TEXT = 'La API está despertando (plan gratuito de Render); puede tardar hasta un minuto.'

/** True until the API has answered in this session, and again once it has been quiet long enough to sleep. */
export function mayBeAsleep(lastAnswerAt: number | null, now: number): boolean {
  return lastAnswerAt === null || now - lastAnswerAt >= ASLEEP_AFTER_MS
}

/** Whether a request in flight should show the "waking up" notice. */
export function isWaking({ elapsedMs, asleep }: { elapsedMs: number; asleep: boolean }): boolean {
  return asleep && elapsedMs >= WAKE_HINT_AFTER_MS
}

/** Under the answer that took the cold start. */
export function wokeUpText(totalMs: number): string {
  return `La API estaba dormida y tardó ${formatDuration(totalMs)} en arrancar. Las siguientes peticiones serán rápidas.`
}

/** Why no answer arrived; `waking` when the notice was on screen. */
export function failureText(kind: 'timeout' | 'network', waking: boolean): string {
  const seconds = Math.round(REQUEST_TIMEOUT_MS / 1000)
  if (kind === 'timeout') {
    return `La API no respondió en ${seconds} segundos. Puede que siga despertando: vuelve a intentarlo.`
  }
  return waking
    ? 'Se cortó la conexión mientras la API despertaba. Vuelve a intentarlo en unos segundos.'
    : 'No pudimos conectar con la API. Revisa tu conexión y vuelve a intentarlo.'
}
