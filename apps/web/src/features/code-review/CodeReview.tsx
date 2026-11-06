import { useSignal } from '@preact/signals'
import { CircleAlert, FileCode, Info, RotateCcw, ScanSearch, Square } from 'lucide-preact'
import type { RefObject } from 'preact'
import { useEffect, useMemo, useRef } from 'preact/hooks'
import { assistantClient } from '../assistant/client'
import { ContactExits, PausedNotice, TypingDots } from '../assistant/parts'
import { RichText } from '../assistant/RichText'
import { FieldError, focusSoon, inputClass, Spinner } from '../forms/fields'
import { Turnstile } from '../turnstile/Turnstile'
import { isLanguage, LANGUAGES, MAX_CODE_LENGTH } from './code'
import { EXAMPLES } from './examples'
import { createCodeReview, REVIEW_PAUSED_TITLE, type CodeReview as Review } from './review'

export interface CodeReviewProps {
  turnstileSiteKey: string
  /** wa.me link: the way out stays one tap away whatever happens to the reviewer. */
  whatsappUrl: string
}

const CODE_ID = 'code-review-code'
const TURNSTILE_ID = 'code-review-turnstile'

/** Lab demo: the code reviewer. The form and its verification, then the review as it streams. */
export function CodeReview({ turnstileSiteKey, whatsappUrl }: CodeReviewProps) {
  const review = useMemo(() => createCodeReview(assistantClient), [])
  const resultRef = useRef<HTMLElement>(null)
  const streaming = review.streaming.value
  const status = review.status.value

  // A session from the assistant (or an earlier review) spares the verification.
  useEffect(() => {
    void review.checkSession()
  }, [review])

  // The review appears under the form: bring its start into view, without leaving the button behind.
  useEffect(() => {
    if (!streaming) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    resultRef.current?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [streaming])

  function another() {
    review.reset()
    focusSoon(CODE_ID)
  }

  return (
    <div class="grid min-w-0 gap-6">
      <section
        aria-labelledby="code-review-title"
        class="grid min-w-0 gap-6 rounded-2xl border border-line bg-raised p-5 sm:p-8"
      >
        <div class="grid gap-3">
          <h2 id="code-review-title" class="text-step-2 font-semibold">
            Revisa tu código
          </h2>
          <p class="prose-measure">
            Pega una función o un fragmento corto y elige el lenguaje. La revisión trae un resumen, los
            riesgos (con su categoría OWASP cuando son de seguridad), las pruebas que harías y mejoras de
            legibilidad y rendimiento.
          </p>
        </div>
        <Notice />
        <ReviewForm review={review} siteKey={turnstileSiteKey} whatsappUrl={whatsappUrl} />
        <ContactExits whatsappUrl={whatsappUrl} />
      </section>

      <p role="status" class="sr-only">
        {announcement(review)}
      </p>

      {status !== 'idle' && (
        <section
          ref={resultRef}
          aria-labelledby="code-review-result-title"
          class="grid min-w-0 scroll-mt-24 gap-4 rounded-2xl border border-line bg-raised p-5 sm:p-8"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h2 id="code-review-result-title" class="text-step-2 font-semibold">
              Revisión
            </h2>
            {!streaming && (
              <button type="button" class="btn btn-quiet" onClick={another}>
                <RotateCcw size={18} aria-hidden="true" />
                Revisar otro
              </button>
            )}
          </div>
          {streaming ? <Pending text={review.text.value} /> : <Finished review={review} />}
          <p class="border-t border-line pt-4 text-step--1 text-muted">
            Es una inteligencia artificial y puede equivocarse: confirma cada hallazgo antes de cambiar tu
            código.
          </p>
        </section>
      )}
    </div>
  )
}

/** What the live region says: the review starting and ending, or the example just loaded. */
function announcement(review: Review): string {
  switch (review.status.value) {
    case 'streaming':
      return 'Revisando tu código.'
    case 'done':
      return 'La revisión está lista, debajo del formulario.'
    case 'stopped':
      return 'Detuviste la revisión.'
    case 'cut':
      return 'La revisión quedó incompleta.'
    default: {
      const example = review.example.value
      return example ? `Cargaste el ejemplo de ${example.title}: ${example.description.toLowerCase()}.` : ''
    }
  }
}

function Notice() {
  return (
    <div class="flex gap-3 rounded-xl border border-line bg-ink p-4 text-step--1">
      <Info size={20} class="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
      <div class="grid gap-2">
        <p>
          <strong class="font-semibold">Es una inteligencia artificial y puede equivocarse.</strong> Úsala
          como una segunda mirada, no como la última palabra.
        </p>
        <p>
          Tu código se procesa en Cloudflare Workers AI, con el modelo abierto Gemma de Google, para escribir
          la revisión. Este sitio no lo guarda; aun así, no pegues secretos (llaves, contraseñas o tokens) ni
          datos personales.{' '}
          <a href="/privacidad/" class="link">
            Lee la política de privacidad
          </a>
          .
        </p>
      </div>
    </div>
  )
}

interface FormProps {
  review: Review
  siteKey: string
  whatsappUrl: string
}

function ReviewForm({ review, siteKey, whatsappUrl }: FormProps) {
  const token = useSignal<string | null>(null)
  const resetKey = useSignal(0)
  const missing = useSignal(false)
  const alertRef = useRef<HTMLDivElement>(null)

  const paused = review.paused.value
  const streaming = review.streaming.value
  const starting = review.starting.value
  const needsVerification = review.session.value === 'needed'
  const issue = review.codeIssue.value
  const length = review.code.value.length

  // The button gives way to the pause notice, or the session ended and the verification is back: the
  // focus goes to the notice, which says what to do.
  const expired = review.problem.value?.kind === 'session'
  useEffect(() => {
    if (paused || expired) alertRef.current?.focus()
  }, [paused, expired])

  async function submit(event: Event) {
    event.preventDefault()
    const spent = needsVerification ? token.value : null
    const result = await review.submit(spent)
    if (result === 'invalid') {
      focusSoon(CODE_ID)
    } else if (result === 'verify') {
      missing.value = true
      focusSoon(TURNSTILE_ID)
    } else if (spent && (result === 'sent' || result === 'refused')) {
      token.value = null
      // Each token is good for one request: a refused one is replaced.
      if (result === 'refused') resetKey.value += 1
    }
  }

  const describedBy = [
    'code-review-code-hint',
    'code-review-code-count',
    issue ? 'code-review-code-error' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <form noValidate onSubmit={submit} aria-label="Revisar código" class="grid min-w-0 gap-5">
      <Examples review={review} />

      <div class="grid min-w-0 gap-1.5 sm:max-w-xs">
        <label for="code-review-language" class="font-semibold">
          Lenguaje
        </label>
        <select
          id="code-review-language"
          value={review.language.value}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (isLanguage(value)) review.language.value = value
          }}
          class={inputClass}
        >
          {LANGUAGES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div class="grid min-w-0 gap-1.5">
        <label for={CODE_ID} class="font-semibold">
          Tu código
        </label>
        <p id="code-review-code-hint" class="text-step--1 text-muted">
          Una función o un fragmento corto. Sin llaves, contraseñas ni datos personales.
        </p>
        <textarea
          id={CODE_ID}
          rows={14}
          maxLength={MAX_CODE_LENGTH}
          wrap="off"
          spellcheck={false}
          autocapitalize="off"
          autocomplete="off"
          value={review.code.value}
          onInput={(event) => review.setCode(event.currentTarget.value)}
          aria-invalid={issue ? true : undefined}
          aria-describedby={describedBy}
          class={`${inputClass} min-h-48 resize-y font-mono text-step--1 leading-relaxed`}
        />
        <p
          id="code-review-code-count"
          class={`text-step--1 ${length >= MAX_CODE_LENGTH ? 'font-semibold text-danger' : 'text-muted'}`}
        >
          {length} de {MAX_CODE_LENGTH} caracteres
        </p>
        {issue && <FieldError id="code-review-code-error">{issue}</FieldError>}
      </div>

      <ProblemAlert review={review} whatsappUrl={whatsappUrl} alertRef={alertRef} />

      {!paused && needsVerification && (
        <Turnstile
          id={TURNSTILE_ID}
          siteKey={siteKey}
          action="code-review"
          resetKey={resetKey.value}
          onToken={(next) => {
            token.value = next
            if (next) missing.value = false
          }}
          error={missing.value ? 'Completa la verificación de seguridad para continuar.' : undefined}
        />
      )}

      {!paused && (
        <div>
          {/* One button that changes role, so the focus stays on it when the review starts or ends. Stopping
              turns it back into the submit button before the click finishes: preventDefault keeps that click
              from submitting the form again. */}
          {streaming ? (
            <button
              type="button"
              class="btn btn-quiet w-full sm:w-auto"
              onClick={(event) => {
                event.preventDefault()
                review.stop()
              }}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
              Detener
            </button>
          ) : (
            <button
              type="submit"
              class="btn btn-primary w-full aria-disabled:cursor-wait aria-disabled:opacity-80 sm:w-auto"
              aria-disabled={starting}
            >
              {starting ? <Spinner /> : <ScanSearch size={18} aria-hidden="true" />}
              {starting ? 'Verificando…' : 'Revisar mi código'}
            </button>
          )}
        </div>
      )}
    </form>
  )
}

function Examples({ review }: { review: Review }) {
  const busy = review.busy.value
  return (
    <div class="grid gap-3">
      <p id="code-review-examples" class="font-semibold">
        ¿Sin código a mano? Carga un ejemplo con fallos reales
      </p>
      <ul aria-labelledby="code-review-examples" class="grid gap-2 sm:grid-cols-3">
        {EXAMPLES.map((example) => (
          <li key={example.id} class="min-w-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => review.loadExample(example)}
              class="grid h-full w-full gap-1 rounded-xl border border-line bg-ink px-4 py-3 text-left hover:border-brand disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span class="flex items-center gap-2 font-semibold">
                <FileCode size={18} class="shrink-0 text-brand" aria-hidden="true" />
                {example.title}
              </span>
              <span class="text-step--1 text-muted">{example.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The review while it streams. Hidden from screen readers: the live region says when it starts and ends,
 * and the finished review is read once, as a whole. Its links are plain text until then.
 */
function Pending({ text }: { text: string }) {
  return (
    <div aria-hidden="true" class="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
      {text && <RichText text={text} interactive={false} code headings />}
      <p class="flex items-center gap-2 text-step--1 text-muted">
        <TypingDots />
        Escribiendo la revisión…
      </p>
    </div>
  )
}

function Finished({ review }: { review: Review }) {
  const status = review.status.value
  const text = review.text.value
  return (
    <div class="grid min-w-0 gap-3 [overflow-wrap:anywhere]">
      {text && <RichText text={text} code headings />}
      {status === 'stopped' && <p class="text-step--1 text-muted">Detuviste la revisión.</p>}
      {status === 'cut' && <p class="text-step--1 text-muted">La revisión quedó incompleta.</p>}
      {status === 'done' && review.truncated.value && (
        <p class="text-step--1 text-muted">La revisión llegó a su largo máximo y puede estar incompleta.</p>
      )}
    </div>
  )
}

interface ProblemAlertProps {
  review: Review
  whatsappUrl: string
  alertRef: RefObject<HTMLDivElement>
}

/** What went wrong, as an alert announced when it appears; with a retry when sending again can help. */
function ProblemAlert({ review, whatsappUrl, alertRef }: ProblemAlertProps) {
  const problem = review.problem.value

  let content = null
  if (problem?.kind === 'paused') {
    content = (
      <PausedNotice title={REVIEW_PAUSED_TITLE} whatsappUrl={whatsappUrl} onRetry={() => review.retry()} />
    )
  } else if (problem) {
    const notice = problem.kind === 'session'
    const canRetry = problem.retryable && !notice && review.session.value === 'active'
    content = (
      <div
        class={`flex gap-2 rounded-lg border p-3 text-step--1 ${notice ? 'border-line' : 'border-danger'}`}
      >
        {notice ? (
          <Info size={18} class="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
        ) : (
          <CircleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        )}
        <div class="grid gap-2">
          <p class="font-semibold">{problem.message}</p>
          {canRetry && (
            <div>
              <button type="button" class="link font-semibold" onClick={() => review.retry()}>
                Intentar de nuevo
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={alertRef} role="alert" tabIndex={-1} class={problem ? 'min-w-0' : 'hidden'}>
      {content}
    </div>
  )
}
