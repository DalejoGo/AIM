import { CircleAlert } from 'lucide-preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { getTheme } from '../../lib/preferences'
import { loadTurnstile, type TurnstileApi } from './loader'

export interface TurnstileProps {
  /** Id of the group. Forms focus it when the verification is the first problem. */
  id: string
  siteKey: string
  /** Label for Cloudflare's analytics: contact, quote, admin-login. */
  action: string
  /** Receives each new token, and null when it expires or fails. */
  onToken: (token: string | null) => void
  /** Increment it to ask for a new token: each one is valid for a single request. */
  resetKey?: number
  error?: string
}

type Status = 'loading' | 'ready' | 'failed'

/** Below this width the normal widget (300 px) would overflow, so the compact one is used. */
const NORMAL_MIN_WIDTH = 300

/**
 * Cloudflare Turnstile widget. The script loads once per page (./loader.ts); the theme follows the
 * data-theme of <html> and the widget is drawn again if the visitor switches it before passing.
 */
export function Turnstile({ id, siteKey, action, onToken, resetKey = 0, error }: TurnstileProps) {
  const container = useRef<HTMLDivElement>(null)
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null)
  const hasToken = useRef(false)
  const report = useRef(onToken)
  report.current = onToken
  const [status, setStatus] = useState<Status>('loading')
  const [attempt, setAttempt] = useState(0)

  // `attempt` is the trigger to load and draw the widget again.
  useEffect(() => {
    let cancelled = false
    const emit = (token: string | null) => {
      hasToken.current = token !== null
      report.current(token)
    }
    setStatus('loading')
    loadTurnstile()
      .then((api) => {
        const element = container.current
        if (cancelled || !element) return
        const widgetId = api.render(element, {
          sitekey: siteKey,
          action,
          theme: getTheme(),
          language: 'es',
          size: element.clientWidth < NORMAL_MIN_WIDTH ? 'compact' : 'flexible',
          callback: (token) => {
            setStatus('ready')
            emit(token)
          },
          'expired-callback': () => emit(null),
          'timeout-callback': () => emit(null),
          'error-callback': () => {
            setStatus('failed')
            emit(null)
          },
        })
        if (widgetId !== undefined) widget.current = { api, id: widgetId }
        setStatus((current) => (current === 'loading' ? 'ready' : current))
      })
      .catch(() => {
        if (!cancelled) setStatus('failed')
      })

    // The widget cannot change theme once drawn; redraw it while there is no token to lose.
    const observer = new MutationObserver(() => {
      if (!hasToken.current) setAttempt((n) => n + 1)
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    return () => {
      cancelled = true
      observer.disconnect()
      if (widget.current) widget.current.api.remove(widget.current.id)
      widget.current = null
    }
  }, [siteKey, action, attempt])

  useEffect(() => {
    if (resetKey === 0 || !widget.current) return
    hasToken.current = false
    report.current(null)
    widget.current.api.reset(widget.current.id)
  }, [resetKey])

  const errorId = `${id}-error`
  return (
    <fieldset id={id} aria-describedby={error ? errorId : undefined} tabIndex={-1} class="grid min-w-0 gap-2">
      <legend class="mb-2 font-semibold">Verificación de seguridad</legend>
      <div ref={container} class="min-h-[65px] max-w-full overflow-hidden" />
      {status === 'loading' && <p class="text-step--1 text-muted">Cargando la verificación…</p>}
      {status === 'failed' && (
        <p class="text-step--1 text-danger">
          La verificación no cargó. Revisa tu conexión o pausa el bloqueador de contenido para este sitio.{' '}
          <button type="button" class="link font-semibold" onClick={() => setAttempt((n) => n + 1)}>
            Cargar la verificación de nuevo
          </button>
        </p>
      )}
      {error && (
        <p id={errorId} class="flex gap-1.5 text-step--1 text-danger">
          <CircleAlert size={16} class="mt-1 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </fieldset>
  )
}
