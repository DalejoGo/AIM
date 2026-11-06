import { useSignal } from '@preact/signals'
import { CircleAlert, CircleCheck, CircleX, LoaderCircle, Send, Timer } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import {
  BURST_SIZE,
  type BurstHit,
  countdownText,
  hitKind,
  progressText,
  secondsLeft,
  statusWord,
  summarizeBurst,
  summaryText,
} from './burst'

const HEADING = 'security-lab-burst'
const LOAD_FAILED = 'No se pudo cargar esta parte de la demo. Recarga la página e inténtalo de nuevo.'

const th = 'border-b border-line px-2 py-2 font-semibold sm:px-4'
const td = 'border-b border-line px-2 py-2 sm:px-4'

/** Shown when a value did not come in the answer. */
function NoValue() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span class="sr-only">sin dato</span>
    </>
  )
}

/** One request. Accepted rows carry the live color only on the icon and the border; the text stays readable. */
function TimelineRow({ hit }: { hit: BurstHit }) {
  const passed = hitKind(hit.status) === 'passed'
  return (
    <tr>
      <th
        scope="row"
        class={`${td} border-l-4 font-semibold tabular-nums ${passed ? 'border-l-live' : 'border-l-danger'}`}
      >
        {hit.n}
      </th>
      <td class={`${td} ${passed ? '' : 'text-danger'}`}>
        <span class="flex items-center gap-2">
          {passed ? (
            <CircleCheck class="size-4 shrink-0 text-live" aria-hidden="true" />
          ) : (
            <CircleX class="size-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            {hit.status > 0 && <span class="font-semibold tabular-nums">{hit.status} </span>}
            <span class={hit.status > 0 ? 'sr-only sm:not-sr-only' : ''}>{statusWord(hit.status)}</span>
          </span>
        </span>
      </td>
      <td class={`${td} text-right whitespace-nowrap tabular-nums`}>{hit.ms} ms</td>
      <td class={`${td} text-right tabular-nums`}>{hit.remaining ?? <NoValue />}</td>
    </tr>
  )
}

function Timeline({ hits, busy }: { hits: readonly BurstHit[]; busy: boolean }) {
  return (
    <div class="relative max-w-2xl rounded-xl border border-line bg-raised" aria-busy={busy}>
      <table class="w-full border-collapse text-left text-step--1">
        <caption class="sr-only">Respuesta de la API a cada petición, en el orden en que se enviaron</caption>
        <thead class="text-muted">
          <tr>
            <th scope="col" class={th}>
              Petición
            </th>
            <th scope="col" class={th}>
              Estado
            </th>
            <th scope="col" class={`${th} text-right`}>
              Tiempo
            </th>
            <th scope="col" class={`${th} text-right`}>
              Quedan
            </th>
          </tr>
        </thead>
        <tbody>
          {hits.map((hit) => (
            <TimelineRow key={hit.n} hit={hit} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The rate-limit lines of the last answer, exactly as they arrived. */
function LastAnswer({ hit }: { hit: BurstHit }) {
  const lines = [`HTTP ${hit.status}`, ...hit.headers.map((h) => `${h.name}: ${h.value}`)]
  return (
    <div class="grid min-w-0 gap-2">
      <h3 class="text-step-0 font-semibold">Lo que respondió la API a la última petición</h3>
      <pre class="rounded-lg border border-line bg-raised px-4 py-3 font-mono text-step--1 leading-relaxed break-all whitespace-pre-wrap">
        {lines.join('\n')}
      </pre>
      <p class="prose-measure text-step--1 text-muted">
        Las cabeceras RateLimit siguen el borrador del IETF para límites de tasa: cuántas peticiones caben,
        cuántas te quedan y en cuántos segundos se libera un cupo. Retry-After dice cuánto esperar antes de
        insistir.
      </p>
    </div>
  )
}

/** "Límite de tasa en vivo": 15 real requests to GET /api/lab/burst, one after the other. */
export function BurstDemo() {
  const hits = useSignal<BurstHit[]>([])
  const running = useSignal(false)
  const problem = useSignal<string | null>(null)
  /** When the last Retry-After ends (epoch ms). */
  const deadline = useSignal<number | null>(null)
  const now = useSignal(0)
  /** What the status region reads out: the start, the result and the end of the wait. Not every second. */
  const announcement = useSignal('')
  const controller = useRef<AbortController | null>(null)

  useEffect(() => () => controller.current?.abort(), [])

  const until = deadline.value
  useEffect(() => {
    if (until === null) return
    const tick = () => {
      now.value = Date.now()
      if (now.value < until) return
      clearInterval(timer)
      if (!running.value) announcement.value = countdownText(0)
    }
    const timer = setInterval(tick, 250)
    tick()
    return () => clearInterval(timer)
  }, [until, now, running, announcement])

  async function start() {
    if (running.value) return
    const run = new AbortController()
    controller.current = run
    running.value = true
    hits.value = []
    problem.value = null
    deadline.value = null
    announcement.value = `Enviando ${BURST_SIZE} peticiones a la API…`
    try {
      const { runBurst } = await import('./client')
      const result = await runBurst({
        count: BURST_SIZE,
        signal: run.signal,
        onHit: (hit) => {
          hits.value = [...hits.value, hit]
          if (hit.retryAfter !== null) {
            now.value = Date.now()
            deadline.value = now.value + hit.retryAfter * 1000
          }
        },
      })
      if (run.signal.aborted) return
      problem.value = result.error?.message ?? null
    } catch {
      if (run.signal.aborted) return
      problem.value = LOAD_FAILED
    } finally {
      if (controller.current === run) running.value = false
    }
    const wait = deadline.value === null ? '' : countdownText(secondsLeft(deadline.value, Date.now()))
    announcement.value = [summaryText(summarizeBurst(hits.value)), wait].filter(Boolean).join(' ')
  }

  const list = hits.value
  const busy = running.value
  const last = list.at(-1)
  const seconds = until === null ? null : secondsLeft(until, now.value)

  return (
    <section aria-labelledby={HEADING} class="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div class="grid gap-3">
        <h2 id={HEADING} class="text-step-2 font-semibold md:text-step-3">
          Límite de tasa en vivo
        </h2>
        <p class="prose-measure">
          La API de este sitio acepta hasta 10 peticiones por minuto desde una misma conexión. Envía 15, una
          detrás de otra, y mira en qué momento te frena.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          class="btn btn-primary aria-disabled:cursor-wait aria-disabled:opacity-70"
          aria-disabled={busy}
          onClick={() => void start()}
        >
          {busy ? (
            <LoaderCircle class="shrink-0 motion-safe:animate-spin" size={18} aria-hidden="true" />
          ) : (
            <Send class="shrink-0" size={18} aria-hidden="true" />
          )}
          Enviar {BURST_SIZE} peticiones
        </button>
        {busy && <p class="text-step--1 text-muted">{progressText(list.length)}</p>}
      </div>

      <p role="status" class="sr-only">
        {announcement.value}
      </p>

      {problem.value && (
        <div
          role="alert"
          class="flex items-start gap-3 rounded-xl border border-danger bg-raised p-4 text-danger"
        >
          <CircleAlert class="mt-1 shrink-0" size={20} aria-hidden="true" />
          <p>{problem.value}</p>
        </div>
      )}

      {list.length > 0 && <Timeline hits={list} busy={busy} />}

      {!busy && list.length > 0 && (
        <div class="grid gap-1">
          <p class="text-step-1 font-semibold">{summaryText(summarizeBurst(list))}</p>
          {seconds !== null && (
            <p class="flex items-center gap-2 text-muted">
              <Timer class="shrink-0" size={18} aria-hidden="true" />
              {countdownText(seconds)}
            </p>
          )}
        </div>
      )}

      {!busy && last && last.headers.length > 0 && <LastAnswer hit={last} />}

      <div class="prose-measure grid gap-3">
        <h3 class="text-step-0 font-semibold">Por qué importa</h3>
        <p>
          Sin un límite, un programa puede probar miles de contraseñas por minuto hasta dar con la tuya
          (fuerza bruta), o llenar un formulario con mensajes basura hasta tumbar el servicio. Frenar cada
          conexión después de unas cuantas peticiones corta esos abusos sin molestar a quien usa el sitio con
          normalidad.
        </p>
        <p>
          En el OWASP Top 10 de 2021 esto cae en A04, diseño inseguro, y en A07, fallas de identificación y
          autenticación. En este sitio también tienen su propio límite el formulario de contacto, el inicio de
          sesión del panel y el asistente.
        </p>
        <p class="text-step--1 text-muted">
          El conteo vive en Postgres y se lleva por conexión: la API guarda una huella irreversible de tu IP,
          nunca la IP.
        </p>
      </div>
    </section>
  )
}
