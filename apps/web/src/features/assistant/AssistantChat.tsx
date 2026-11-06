import { type Signal, useSignal } from '@preact/signals'
import { CircleAlert, CirclePause, Info, Mail, MessageCircle, RotateCcw, Send, Square } from 'lucide-preact'
import type { RefObject } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'preact/hooks'
import { focusSoon, inputClass, Spinner } from '../forms/fields'
import { Turnstile } from '../turnstile/Turnstile'
import { type AssistantChat as Chat, type ChatMessage, createAssistantChat } from './chat'
import { assistantClient } from './client'
import { PAUSED_TITLE } from './errors'
import { MAX_MESSAGE_LENGTH } from './history'
import { RichText } from './RichText'

export interface AssistantChatProps {
  turnstileSiteKey: string
  /** wa.me link: the way out stays one tap away whatever happens to the assistant. */
  whatsappUrl: string
}

export const SUGGESTIONS = [
  '¿Cuánto cuesta una página web?',
  '¿Qué automatizaciones haces?',
  '¿Cómo es el proceso de trabajo?',
  '¿Trabajas con clientes fuera de Colombia?',
]

const NEW_TAB = <span class="sr-only"> (se abre en otra pestaña)</span>

/** Lab demo: the AIM assistant. First the presentation and the verification, then the conversation. */
export function AssistantChat({ turnstileSiteKey, whatsappUrl }: AssistantChatProps) {
  const chat = useMemo(() => createAssistantChat(assistantClient), [])
  return chat.phase.value === 'gate' ? (
    <Gate chat={chat} siteKey={turnstileSiteKey} whatsappUrl={whatsappUrl} />
  ) : (
    <Conversation chat={chat} siteKey={turnstileSiteKey} whatsappUrl={whatsappUrl} />
  )
}

interface PartProps {
  chat: Chat
  siteKey: string
  whatsappUrl: string
}

// --- Before the conversation -----------------------------------------------------------------------

function Gate({ chat, siteKey, whatsappUrl }: PartProps) {
  const alertRef = useRef<HTMLDivElement>(null)
  const paused = chat.paused.value

  // The verification gives way to the pause notice: the focus follows it.
  useEffect(() => {
    if (paused) alertRef.current?.focus()
  }, [paused])

  return (
    <div class="grid min-w-0 gap-6 rounded-2xl border border-line bg-raised p-5 sm:p-8">
      <div class="grid gap-3">
        <h2 class="text-step-2 font-semibold">Pregúntale al asistente</h2>
        <p class="prose-measure">
          Responde con la información publicada en este sitio. Puedes preguntarle por:
        </p>
        <ul class="grid list-disc gap-1 pl-6">
          <li>Los servicios de AIM y qué incluye cada uno.</li>
          <li>Los precios de referencia: desde cuánto arranca cada servicio.</li>
          <li>Los proyectos publicados en el portafolio.</li>
          <li>Cómo es trabajar con David, de la primera conversación a la entrega.</li>
        </ul>
      </div>
      <Notice />
      {!paused && (
        <Verification
          chat={chat}
          siteKey={siteKey}
          id="assistant-turnstile"
          formLabel="Empezar a conversar con el asistente"
          submitLabel="Empezar a conversar"
        />
      )}
      {/* No retry here: a failed start is retried with the button, once the verification passes again. */}
      <ProblemAlert chat={chat} whatsappUrl={whatsappUrl} alertRef={alertRef} retry={false} />
      <ContactExits whatsappUrl={whatsappUrl} />
    </div>
  )
}

function Notice() {
  return (
    <div class="flex gap-3 rounded-xl border border-line bg-ink p-4 text-step--1">
      <Info size={20} class="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
      <div class="grid gap-2">
        <p>
          <strong class="font-semibold">Es una inteligencia artificial y puede equivocarse.</strong> Antes de
          decidir, confirma precios y plazos con David.
        </p>
        <p>
          Tus mensajes se procesan en Cloudflare Workers AI, con el modelo abierto Gemma de Google, para
          escribir cada respuesta. Este sitio no guarda la conversación; aun así, evita escribir datos
          personales.{' '}
          <a href="/privacidad/" class="link">
            Lee la política de privacidad
          </a>
          .
        </p>
      </div>
    </div>
  )
}

interface VerificationProps {
  chat: Chat
  siteKey: string
  /** Id of the Turnstile group, focused when the visitor submits without passing it. */
  id: string
  formLabel: string
  submitLabel: string
}

/** Turnstile and the button that spends its token on a session (to start, or to go on after a 401). */
function Verification({ chat, siteKey, id, formLabel, submitLabel }: VerificationProps) {
  const token = useSignal<string | null>(null)
  const resetKey = useSignal(0)
  const missing = useSignal(false)
  const starting = chat.starting.value

  async function submit(event: Event) {
    event.preventDefault()
    if (chat.starting.value) return
    const spent = token.value
    if (!spent) {
      missing.value = true
      focusSoon(id)
      return
    }
    token.value = null
    // Each token is good for one request: a refused one is replaced.
    if (!(await chat.startSession(spent))) resetKey.value += 1
  }

  return (
    <form noValidate onSubmit={submit} aria-label={formLabel} class="grid min-w-0 gap-4">
      <Turnstile
        id={id}
        siteKey={siteKey}
        action="assistant"
        resetKey={resetKey.value}
        onToken={(next) => {
          token.value = next
          if (next) missing.value = false
        }}
        error={missing.value ? 'Completa la verificación de seguridad para continuar.' : undefined}
      />
      <div>
        <button
          type="submit"
          class="btn btn-primary w-full aria-disabled:cursor-wait aria-disabled:opacity-80 sm:w-auto"
          aria-disabled={starting}
        >
          {starting ? <Spinner /> : <MessageCircle size={18} aria-hidden="true" />}
          {starting ? 'Conectando…' : submitLabel}
        </button>
      </div>
    </form>
  )
}

// --- The conversation ------------------------------------------------------------------------------

function Conversation({ chat, siteKey, whatsappUrl }: PartProps) {
  const draft = useSignal('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const alertRef = useRef<HTMLDivElement>(null)
  // Follow the newest text unless the visitor scrolled up to read something.
  const follow = useRef(true)

  const messages = chat.messages.value
  const answer = chat.answer.value
  const busy = answer !== null
  const renewing = chat.renewing.value
  const paused = chat.paused.value
  const empty = messages.length === 0 && !busy

  useLayoutEffect(() => {
    const log = logRef.current
    if (log && follow.current) log.scrollTop = log.scrollHeight
  }, [messages, answer])

  // The composer gives way to the pause notice or to a new verification: the focus goes to the notice.
  const replaced = paused || renewing
  useEffect(() => {
    if (replaced) alertRef.current?.focus()
  }, [replaced])

  function onScroll() {
    const log = logRef.current
    if (log) follow.current = log.scrollHeight - log.scrollTop - log.clientHeight < 48
  }

  function send(text: string, fromDraft: boolean) {
    if (!chat.send(text)) return
    if (fromDraft) draft.value = ''
    follow.current = true
    inputRef.current?.focus()
  }

  function startOver() {
    chat.reset()
    draft.value = ''
    follow.current = true
    inputRef.current?.focus()
  }

  return (
    <section
      aria-labelledby="assistant-title"
      class="grid min-w-0 gap-4 rounded-2xl border border-line bg-raised p-4 sm:p-6"
    >
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 id="assistant-title" class="text-step-1 font-semibold">
          Conversación
        </h2>
        {!empty && (
          <button type="button" class="btn btn-quiet min-h-0 px-3 py-1.5 text-step--1" onClick={startOver}>
            <RotateCcw size={16} aria-hidden="true" />
            Nueva conversación
          </button>
        )}
      </div>

      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Mensajes de la conversación"
        tabIndex={empty ? undefined : 0}
        onScroll={onScroll}
        class={
          empty
            ? 'hidden'
            : 'grid max-h-[min(34rem,65vh)] content-start gap-4 overflow-y-auto rounded-lg py-1'
        }
      >
        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}
        {answer !== null && <Pending text={answer} />}
      </div>

      {empty && <Suggestions onPick={(text) => send(text, false)} />}

      <p role="status" class="sr-only">
        {busy ? 'El asistente está escribiendo la respuesta.' : ''}
      </p>
      <ProblemAlert chat={chat} whatsappUrl={whatsappUrl} alertRef={alertRef} />

      {renewing ? (
        <Verification
          chat={chat}
          siteKey={siteKey}
          id="assistant-renew-turnstile"
          formLabel="Renovar la sesión con el asistente"
          submitLabel="Seguir conversando"
        />
      ) : (
        !paused && (
          <Composer chat={chat} draft={draft} inputRef={inputRef} onSend={(text) => send(text, true)} />
        )
      )}

      <div class="grid gap-1 border-t border-line pt-4 text-step--1 text-muted">
        <p>Es una inteligencia artificial y puede equivocarse: confirma precios y plazos con David.</p>
        <ContactExits whatsappUrl={whatsappUrl} />
      </div>
    </section>
  )
}

function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div class="grid gap-3">
      <p id="assistant-suggestions" class="text-muted">
        Escribe tu pregunta o empieza con una de estas:
      </p>
      <ul aria-labelledby="assistant-suggestions" class="flex flex-wrap gap-2">
        {SUGGESTIONS.map((text) => (
          <li key={text} class="min-w-0">
            <button
              type="button"
              class="rounded-2xl border border-line bg-ink px-4 py-2 text-left text-step--1 hover:border-brand"
              onClick={() => onPick(text)}
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

const bubble = 'min-w-0 rounded-2xl px-4 py-3 [overflow-wrap:anywhere]'

function Message({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div class="flex justify-end">
        <div class={`${bubble} max-w-[85%] rounded-br-sm bg-brand text-brand-contrast`}>
          <span class="sr-only">Tú: </span>
          <span class="whitespace-pre-wrap">{message.content}</span>
        </div>
      </div>
    )
  }
  return (
    <div class={`${bubble} max-w-[92%] justify-self-start rounded-bl-sm border border-line bg-ink`}>
      <span class="sr-only">Asistente: </span>
      {message.content && <RichText text={message.content} />}
      {message.state === 'stopped' && <p class="mt-2 text-step--1 text-muted">Detuviste la respuesta.</p>}
      {message.state === 'cut' && <p class="mt-2 text-step--1 text-muted">La respuesta quedó incompleta.</p>}
    </div>
  )
}

/**
 * The answer while it streams. Hidden from screen readers: the log announces it once, when it is finished
 * and becomes a Message, instead of every piece. Its links are plain text until then.
 */
function Pending({ text }: { text: string }) {
  return (
    <div
      aria-hidden="true"
      class={`${bubble} max-w-[92%] justify-self-start rounded-bl-sm border border-line bg-ink`}
    >
      {text && <RichText text={text} interactive={false} />}
      <p class={`flex items-center gap-2 text-step--1 text-muted ${text ? 'mt-2' : ''}`}>
        <span class="flex gap-1">
          {/* Staggered with classes, not inline styles (the CSP blocks style attributes). */}
          {['[animation-delay:0ms]', '[animation-delay:150ms]', '[animation-delay:300ms]'].map((delay) => (
            <span
              key={delay}
              class={`size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none ${delay}`}
            />
          ))}
        </span>
        Escribiendo…
      </p>
    </div>
  )
}

interface ComposerProps {
  chat: Chat
  draft: Signal<string>
  inputRef: RefObject<HTMLTextAreaElement>
  onSend: (text: string) => void
}

function Composer({ chat, draft, inputRef, onSend }: ComposerProps) {
  const busy = chat.busy.value
  const length = draft.value.length

  // The composer appears when the chat opens and after a pause or a renewal: the visitor can type at once.
  useEffect(() => {
    inputRef.current?.focus()
  }, [inputRef])

  function onKeyDown(event: KeyboardEvent) {
    // Enter sends; Shift+Enter is a new line; Enter that confirms an IME composition is left alone (Safari
    // reports it with isComposing false, hence keyCode 229).
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
    event.preventDefault()
    if (!busy) onSend(draft.value)
  }

  function submit(event: Event) {
    event.preventDefault()
    onSend(draft.value)
  }

  return (
    <form noValidate onSubmit={submit} aria-label="Escribir al asistente" class="grid min-w-0 gap-2">
      <label for="assistant-question" class="font-semibold">
        Tu pregunta
      </label>
      <div class="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <textarea
          ref={inputRef}
          id="assistant-question"
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          enterkeyhint="send"
          value={draft.value}
          onInput={(event) => {
            draft.value = event.currentTarget.value
          }}
          onKeyDown={onKeyDown}
          aria-describedby="assistant-question-hint assistant-question-count"
          class={`${inputClass} max-h-48 min-h-[3.25rem] resize-none [field-sizing:content]`}
        />
        {/* One button that changes role, so the focus stays on it when the answer starts or ends. */}
        {busy ? (
          <button type="button" class="btn btn-quiet" onClick={() => chat.stop()}>
            <Square size={14} fill="currentColor" aria-hidden="true" />
            Detener
          </button>
        ) : (
          <button type="submit" class="btn btn-primary">
            <Send size={18} aria-hidden="true" />
            Enviar
          </button>
        )}
      </div>
      <div class="flex flex-wrap justify-between gap-x-4 gap-y-1 text-step--1 text-muted">
        <p id="assistant-question-hint">Enter envía; Shift + Enter agrega una línea.</p>
        <p
          id="assistant-question-count"
          class={length >= MAX_MESSAGE_LENGTH ? 'font-semibold text-danger' : ''}
        >
          {length} de {MAX_MESSAGE_LENGTH} caracteres
        </p>
      </div>
    </form>
  )
}

// --- Shared ----------------------------------------------------------------------------------------

interface ProblemAlertProps {
  chat: Chat
  whatsappUrl: string
  alertRef: RefObject<HTMLDivElement>
  /** Offer "Intentar de nuevo" for problems where asking again can work. */
  retry?: boolean
}

/** What went wrong, as an alert announced when it appears; with a retry when asking again can help. */
function ProblemAlert({ chat, whatsappUrl, alertRef, retry = true }: ProblemAlertProps) {
  const problem = chat.problem.value
  const renewing = chat.renewing.value

  let content = null
  if (problem?.kind === 'paused') {
    content = (
      <div class="grid gap-3 rounded-xl border border-line bg-ink p-4">
        <h3 class="flex items-center gap-2 text-step-1 font-semibold">
          <CirclePause size={22} class="shrink-0 text-brand" aria-hidden="true" />
          {PAUSED_TITLE}
        </h3>
        <p>
          Mientras vuelve, escríbele a David por WhatsApp o desde el formulario de contacto. Te responde
          personalmente.
        </p>
        <div class="flex flex-wrap gap-3">
          <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" class="btn btn-primary">
            <MessageCircle size={18} aria-hidden="true" />
            Escribir por WhatsApp
            {NEW_TAB}
          </a>
          <a href="/contacto/" class="btn btn-quiet">
            <Mail size={18} aria-hidden="true" />
            Ir al formulario de contacto
          </a>
        </div>
        <div>
          <button type="button" class="link text-step--1 font-semibold" onClick={() => chat.retry()}>
            Intentar de nuevo
          </button>
        </div>
      </div>
    )
  } else if (problem) {
    const notice = problem.kind === 'session'
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
          {retry && problem.retryable && !renewing && (
            <div>
              <button type="button" class="link font-semibold" onClick={() => chat.retry()}>
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

function ContactExits({ whatsappUrl }: { whatsappUrl: string }) {
  return (
    <p class="text-step--1 text-muted">
      ¿Prefieres hablar con David?{' '}
      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" class="link font-semibold">
        Escribir por WhatsApp
        {NEW_TAB}
      </a>{' '}
      o{' '}
      <a href="/contacto/" class="link font-semibold">
        usar el formulario de contacto
      </a>
      .
    </p>
  )
}
