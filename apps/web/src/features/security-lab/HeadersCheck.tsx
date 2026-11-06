import { useSignal } from '@preact/signals'
import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle, RefreshCw } from 'lucide-preact'
import { useEffect } from 'preact/hooks'
import {
  CSP,
  checkHeaders,
  fetchSiteHeaders,
  type HeaderCheck,
  headersSummaryText,
  owaspText,
} from './headers'

const HEADING = 'security-lab-headers'

type State = { phase: 'loading' } | { phase: 'done'; checks: HeaderCheck[] } | { phase: 'error' }

/** A CSP delivered in the page's HTML instead of an HTTP header. */
function metaCsp(): string | null {
  const meta = document.querySelector(`meta[http-equiv="${CSP}" i]`)
  return meta?.getAttribute('content') ?? null
}

function presence(check: HeaderCheck): string {
  if (check.source === 'meta') return 'Presente, en una etiqueta meta del HTML'
  return check.source === 'header' ? 'Presente' : 'No llegó'
}

function HeaderItem({ check }: { check: HeaderCheck }) {
  const present = check.value !== null
  return (
    <li class="grid min-w-0 gap-3 rounded-xl border border-line bg-raised p-4 sm:p-5">
      <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h3 class="min-w-0 font-mono text-step-0 font-semibold tracking-normal break-all hyphens-none">
          {check.name}
        </h3>
        <p class="flex items-center gap-1.5 text-step--1">
          {present ? (
            <CircleCheck class="size-4 shrink-0 text-live" aria-hidden="true" />
          ) : (
            <CircleDashed class="size-4 shrink-0 text-muted" aria-hidden="true" />
          )}
          {presence(check)}
        </p>
      </div>
      {present && (
        <code class="block rounded-lg bg-ink px-3 py-2 font-mono text-step--1 leading-relaxed break-all">
          {check.value}
        </code>
      )}
      <p class="prose-measure">{check.stops}</p>
      <p class="text-step--1 text-muted">{owaspText(check.owasp)}.</p>
    </li>
  )
}

/** "Cabeceras que protegen este sitio": the security headers of the site's real answer, read by the browser. */
export function HeadersCheck() {
  const state = useSignal<State>({ phase: 'loading' })
  const attempt = useSignal(0)
  const round = attempt.value

  useEffect(() => {
    let cancelled = false
    state.value = { phase: 'loading' }
    fetchSiteHeaders()
      .then((headers) => {
        if (!cancelled) state.value = { phase: 'done', checks: checkHeaders(headers, metaCsp()) }
      })
      .catch(() => {
        if (!cancelled) state.value = { phase: 'error' }
      })
    return () => {
      cancelled = true
    }
  }, [round, state])

  const current = state.value
  const checks = current.phase === 'done' ? current.checks : []
  const missing = checks.some((c) => c.value === null)

  return (
    <section aria-labelledby={HEADING} class="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div class="grid gap-3">
        <h2 id={HEADING} class="text-step-2 font-semibold md:text-step-3">
          Cabeceras que protegen este sitio
        </h2>
        <p class="prose-measure">
          Con cada página, el servidor manda instrucciones de seguridad que tu navegador obedece: las
          cabeceras HTTP. Esta lista sale de la respuesta real que tu navegador acaba de recibir al pedir la
          portada del sitio, con los valores tal como llegaron.
        </p>
      </div>

      <p role="status" class="flex min-h-7 items-center gap-2 font-semibold">
        {current.phase === 'loading' && (
          <>
            <LoaderCircle class="shrink-0 motion-safe:animate-spin" size={18} aria-hidden="true" />
            Revisando las cabeceras de este sitio…
          </>
        )}
        {current.phase === 'done' && headersSummaryText(checks)}
      </p>

      {current.phase === 'error' && (
        <div role="alert" class="grid gap-3 rounded-xl border border-danger bg-raised p-4">
          <p class="flex items-start gap-3 text-danger">
            <CircleAlert class="mt-1 shrink-0" size={20} aria-hidden="true" />
            No pudimos leer las cabeceras: tu navegador no recibió respuesta del sitio. Revisa tu conexión y
            vuelve a intentarlo.
          </p>
          <div>
            <button type="button" class="btn btn-quiet" onClick={() => attempt.value++}>
              <RefreshCw class="shrink-0" size={18} aria-hidden="true" />
              Revisar de nuevo
            </button>
          </div>
        </div>
      )}

      {missing && (
        <p class="prose-measure text-muted">
          Estas cabeceras las agrega Cloudflare cuando el sitio está publicado. Si abriste una copia local o
          de desarrollo, es normal que no lleguen.
        </p>
      )}

      {checks.length > 0 && (
        <ul class="grid gap-4" aria-label="Cabeceras de seguridad">
          {checks.map((check) => (
            <HeaderItem key={check.name} check={check} />
          ))}
        </ul>
      )}
    </section>
  )
}
