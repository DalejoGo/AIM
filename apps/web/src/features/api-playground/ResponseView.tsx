import { CircleAlert, Hourglass, LoaderCircle, RefreshCw, Timer } from 'lucide-preact'
import type { Ref } from 'preact'
import type { Exchange } from './history'
import { nextCursorOf } from './history'
import {
  type Body,
  type ErrorExplanation,
  explainError,
  formatDuration,
  type HeaderLine,
  type ResponseMeta,
  readBody,
  readMeta,
  seconds,
  statusText,
} from './response'
import { codeBlock, isSuccess, OutcomeIcon } from './ui'
import { failureText, WAKING_TEXT, wokeUpText } from './wake'

export const RESPONSE_HEADING = 'playground-response'

export interface Waiting {
  method: string
  path: string
  elapsedMs: number
  waking: boolean
}

interface ResponseViewProps {
  exchange: Exchange | null
  waiting: Waiting | null
  /** Read by screen readers when it changes: what was sent, the waking notice and the result. */
  announcement: string
  headingRef: Ref<HTMLHeadingElement>
  onRetry: (exchange: Exchange) => void
  onNextPage: (exchange: Exchange, cursor: string) => void
}

function RequestLine({ exchange }: { exchange: Exchange }) {
  return (
    <p class="font-mono text-step--1 text-muted wrap-anywhere">
      {exchange.request.method} {exchange.request.path}
    </p>
  )
}

function WaitingBanner({ waiting }: { waiting: Waiting }) {
  const elapsed = Math.floor(waiting.elapsedMs / 1000)
  return (
    <div class="grid gap-3 rounded-xl border border-line bg-raised p-4">
      <p class="flex items-center gap-2 font-semibold">
        <LoaderCircle size={18} class="shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        Esperando la respuesta
        {elapsed >= 1 && <span class="font-normal text-muted tabular-nums">({seconds(elapsed)})</span>}
      </p>
      <p class="font-mono text-step--1 text-muted wrap-anywhere">
        {waiting.method} {waiting.path}
      </p>
      {waiting.waking && (
        <p class="flex items-start gap-2">
          <Hourglass size={18} class="mt-1 shrink-0 text-muted" aria-hidden="true" />
          {WAKING_TEXT}
        </p>
      )}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string | null }) {
  return (
    <div class="grid gap-0.5">
      <dt class="text-step--1 text-muted">{label}</dt>
      <dd class="font-semibold tabular-nums">{value ?? 'No llegó'}</dd>
    </div>
  )
}

function Metrics({ meta, totalMs }: { meta: ResponseMeta; totalMs: number }) {
  const remaining =
    meta.remaining === null
      ? null
      : meta.limit === null
        ? `${meta.remaining}`
        : `${meta.remaining} de ${meta.limit}`
  return (
    <dl class="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-4 gap-y-3">
      <Metric
        label="Tiempo en el servidor"
        value={meta.serverMs === null ? null : formatDuration(meta.serverMs)}
      />
      <Metric label="Tiempo total en tu navegador" value={formatDuration(totalMs)} />
      <Metric label="Peticiones que te quedan" value={remaining} />
    </dl>
  )
}

function Explanation({ explanation }: { explanation: ErrorExplanation }) {
  return (
    <div class="grid gap-3 rounded-xl border border-danger bg-raised p-4">
      <h3 class="flex items-center gap-2 text-step-0 font-semibold">
        <CircleAlert size={18} class="shrink-0 text-danger" aria-hidden="true" />
        Qué pasó
      </h3>
      <p>{explanation.message}</p>
      {explanation.fields.length > 0 && (
        <ul class="grid gap-2" aria-label="Campos con problemas">
          {explanation.fields.map(({ field, problems }) => (
            <li key={field} class="grid gap-0.5 border-l-2 border-danger pl-3">
              <code class="font-mono text-step--1 font-semibold wrap-anywhere">{field}</code>
              <span>{problems.join(' ')}</span>
            </li>
          ))}
        </ul>
      )}
      <p class="text-step--1 text-muted">{explanation.advice}</p>
      {explanation.code && (
        <p class="text-step--1 text-muted">
          Código del error: <code class="font-mono text-text">{explanation.code}</code>
        </p>
      )}
    </div>
  )
}

function HeadersBlock({ headers }: { headers: readonly HeaderLine[] }) {
  return (
    <div class="grid min-w-0 gap-2">
      <h3 class="text-step-0 font-semibold">Cabeceras</h3>
      {headers.length > 0 ? (
        <pre class={codeBlock}>{headers.map((line) => `${line.name}: ${line.value}`).join('\n')}</pre>
      ) : (
        <p class="text-step--1 text-muted">El navegador no dejó leer ninguna cabecera de esta respuesta.</p>
      )}
      <p class="text-step--1 text-muted">
        Desde otro dominio, el navegador solo deja leer las cabeceras que la API autoriza con CORS.
      </p>
    </div>
  )
}

function BodyBlock({ body, status }: { body: Body; status: number }) {
  return (
    <div class="grid min-w-0 gap-2">
      <h3 class="text-step-0 font-semibold">Cuerpo</h3>
      {body.kind === 'empty' ? (
        <p class="text-muted">
          Sin cuerpo{status === 204 ? ': la API responde 204 cuando borra, sin nada más que decir.' : '.'}
        </p>
      ) : (
        <section
          aria-label="Cuerpo de la respuesta"
          class="max-h-[32rem] overflow-y-auto rounded-lg"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable with the keyboard.
          tabIndex={0}
        >
          <pre class={codeBlock}>{body.text}</pre>
        </section>
      )}
    </div>
  )
}

function Answer({
  exchange,
  onNextPage,
}: {
  exchange: Exchange
  onNextPage: ResponseViewProps['onNextPage']
}) {
  const { outcome } = exchange
  if (outcome.kind !== 'response') return null
  const meta = readMeta(outcome.headers, exchange.at + outcome.totalMs)
  const body = readBody(outcome.body)
  const explanation = explainError(outcome.status, body, { retryAfter: meta.retryAfter, limit: meta.limit })
  const success = isSuccess(outcome)
  const cursor = success && exchange.request.method === 'GET' ? nextCursorOf(body) : null

  return (
    <div class="grid min-w-0 gap-6">
      <div
        class={`grid gap-4 rounded-xl border border-l-4 border-line bg-raised p-4 ${success ? 'border-l-live' : 'border-l-danger'}`}
      >
        <div class="grid gap-1">
          <p
            class={`flex items-start gap-2 text-step-1 font-semibold sm:text-step-2 ${success ? '' : 'text-danger'}`}
          >
            <span class="flex h-[1.6em] items-center">
              <OutcomeIcon outcome={outcome} size={24} />
            </span>
            <span>
              <span class="tabular-nums">{outcome.status}</span> <span>{statusText(outcome.status)}</span>
            </span>
          </p>
          <RequestLine exchange={exchange} />
        </div>
        <Metrics meta={meta} totalMs={outcome.totalMs} />
        {meta.retryAfter !== null && (
          <p class="flex items-start gap-2 font-semibold text-danger">
            <Timer size={18} class="mt-1 shrink-0" aria-hidden="true" />
            Espera {seconds(meta.retryAfter)} antes de la siguiente petición (cabecera Retry-After).
          </p>
        )}
        {exchange.slowStart && <p class="text-step--1 text-muted">{wokeUpText(outcome.totalMs)}</p>}
      </div>

      {explanation && <Explanation explanation={explanation} />}
      <BodyBlock body={body} status={outcome.status} />
      {cursor && (
        <div>
          <button type="button" class="btn btn-quiet" onClick={() => onNextPage(exchange, cursor)}>
            Pedir la página siguiente
          </button>
        </div>
      )}
      <HeadersBlock headers={outcome.headers} />
    </div>
  )
}

function Failure({ exchange, onRetry }: { exchange: Exchange; onRetry: ResponseViewProps['onRetry'] }) {
  const { outcome } = exchange
  if (outcome.kind === 'response') return null
  return (
    <div class="grid gap-4 rounded-xl border border-l-4 border-line border-l-danger bg-raised p-4">
      <div class="grid gap-1">
        <p class="flex items-center gap-2 text-step-1 font-semibold text-danger">
          <OutcomeIcon outcome={outcome} size={22} />
          {outcome.kind === 'timeout' ? 'La API no respondió a tiempo' : 'No hubo conexión con la API'}
        </p>
        <RequestLine exchange={exchange} />
      </div>
      <p>{failureText(outcome.kind, exchange.slowStart)}</p>
      <div>
        <button type="button" class="btn btn-quiet" onClick={() => onRetry(exchange)}>
          <RefreshCw size={18} class="shrink-0" aria-hidden="true" />
          Reintentar
        </button>
      </div>
    </div>
  )
}

/** "Respuesta": the selected exchange, or what the console is waiting for. */
export function ResponseView({
  exchange,
  waiting,
  announcement,
  headingRef,
  onRetry,
  onNextPage,
}: ResponseViewProps) {
  return (
    <section
      aria-labelledby={RESPONSE_HEADING}
      aria-busy={waiting !== null}
      class="grid min-w-0 content-start gap-6"
    >
      <h2 id={RESPONSE_HEADING} ref={headingRef} tabIndex={-1} class="text-step-2 font-semibold">
        Respuesta
      </h2>
      <p role="status" class="sr-only">
        {announcement}
      </p>
      {waiting && <WaitingBanner waiting={waiting} />}
      {waiting && exchange && (
        <p class="text-step--1 text-muted">Mientras tanto, esta es la respuesta anterior.</p>
      )}
      {exchange ? (
        exchange.outcome.kind === 'response' ? (
          <Answer exchange={exchange} onNextPage={onNextPage} />
        ) : (
          <Failure exchange={exchange} onRetry={onRetry} />
        )
      ) : (
        !waiting && (
          <p class="prose-measure text-muted">
            Elige un ejemplo y envía la petición. Aquí verás el código de estado, los tiempos, las cabeceras y
            el JSON de la respuesta.
          </p>
        )
      )}
    </section>
  )
}
