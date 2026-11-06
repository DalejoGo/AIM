import type { CodeReviewRequest } from '@aim/contracts'
import { batch, computed, signal } from '@preact/signals'
import type { CodeReviewClient } from '../assistant/client'
import {
  AssistantStreamError,
  cookiesProblem,
  type Problem,
  type ProblemTexts,
  STREAM_INTERRUPTED,
  toProblem,
} from '../assistant/errors'
import { codeError, type Language, normalizeCode } from './code'
import type { CodeExample } from './examples'

export const REVIEW_PAUSED_TITLE = 'El revisor está en pausa'

/** The reviewer's own words for what the browser detects; the API's messages arrive in the error itself. */
export const REVIEW_TEXTS: ProblemTexts = {
  session:
    'Tu sesión venció. Completa de nuevo la verificación de seguridad y vuelve a pulsar Revisar mi código.',
  cookies:
    'El revisor no pudo mantener tu sesión. Revisa que tu navegador acepte las cookies de este sitio y recarga la página.',
  paused: `${REVIEW_PAUSED_TITLE}. Mientras vuelve, escríbele a David por WhatsApp o desde el formulario de contacto.`,
  network: 'No hay conexión con el revisor. Revisa tu internet e inténtalo de nuevo.',
  connectionLost:
    'Se cortó la conexión mientras llegaba la revisión. Revisa tu internet e inténtalo de nuevo.',
  interrupted: 'La revisión se cortó antes de terminar. Inténtalo de nuevo.',
  invalid: 'La revisión llegó con un formato inesperado. Recarga la página e inténtalo de nuevo.',
  failed: 'El revisor no pudo terminar la revisión. Inténtalo de nuevo.',
  unknown: 'Algo falló al hablar con el revisor. Inténtalo de nuevo en unos minutos.',
  rateLimited: (wait) =>
    wait === null
      ? 'Pediste muchas revisiones seguidas. Espera unos minutos y vuelve a intentarlo.'
      : `Pediste muchas revisiones seguidas. Vuelve a intentarlo en ${wait}.`,
}

/**
 * checking: asking the API whether the browser still holds the session (from the assistant or an earlier
 * review); needed: the form shows Turnstile; active: it does not.
 */
export type SessionState = 'checking' | 'needed' | 'active'

/** done; stopped: the visitor pressed "Detener"; cut: an error ended the review half-way. */
export type ReviewStatus = 'idle' | 'streaming' | 'done' | 'stopped' | 'cut'

export type SubmitResult =
  /** The review is on its way. */
  | 'sent'
  /** The code cannot be sent: codeIssue says why. */
  | 'invalid'
  /** A session is needed and there is no Turnstile token yet. */
  | 'verify'
  /** The session was refused (the token is spent): problem says why. */
  | 'refused'
  /** A review or a session request is already on its way, or the reviewer is paused. */
  | 'ignored'

/**
 * State of the code reviewer island, without DOM: the form, the shared session, the review being streamed
 * and what went wrong. The component only renders it and moves the focus.
 */
export function createCodeReview(client: CodeReviewClient) {
  const language = signal<Language>('typescript')
  const code = signal('')
  /** Why the code cannot be sent, shown under the field after a submit; typing clears it. */
  const codeIssue = signal<string | null>(null)
  /** The example loaded last, until the visitor asks for a review or starts over. */
  const example = signal<CodeExample | null>(null)
  const session = signal<SessionState>('checking')
  /** A session request is on its way. */
  const starting = signal(false)
  /** The review so far. */
  const text = signal('')
  const status = signal<ReviewStatus>('idle')
  /** The review reached the model's length cap (done with max_tokens). */
  const truncated = signal(false)
  const problem = signal<Problem | null>(null)

  const streaming = computed(() => status.value === 'streaming')
  const busy = computed(() => streaming.value || starting.value)
  const paused = computed(() => problem.value?.kind === 'paused')

  let controller: AbortController | null = null
  // Bumped by "Revisar otro" and by each review: whatever an older request still delivers is dropped.
  let generation = 0

  function clearResult() {
    batch(() => {
      text.value = ''
      status.value = 'idle'
      truncated.value = false
    })
  }

  async function run(request: CodeReviewRequest, freshSession: boolean): Promise<void> {
    const current = ++generation
    const abort = new AbortController()
    controller = abort
    batch(() => {
      text.value = ''
      status.value = 'streaming'
      truncated.value = false
      problem.value = null
      example.value = null
    })
    let received = ''
    try {
      const result = await client.review(request, {
        signal: abort.signal,
        onDelta: (piece) => {
          if (current !== generation) return
          received += piece
          text.value = received
        },
      })
      if (current !== generation) return
      batch(() => {
        if (received.trim()) {
          status.value = 'done'
          truncated.value = result.reason === 'max_tokens'
        } else {
          status.value = 'idle'
          problem.value = toProblem(
            new AssistantStreamError(STREAM_INTERRUPTED, 'Empty review'),
            REVIEW_TEXTS,
          )
        }
      })
    } catch (error) {
      if (current !== generation) return
      if (abort.signal.aborted) {
        status.value = 'stopped'
        return
      }
      const found = toProblem(error, REVIEW_TEXTS)
      batch(() => {
        if (found.kind === 'session') {
          clearResult()
          // A session refused right after it was issued will not work with another verification.
          if (freshSession) problem.value = cookiesProblem(REVIEW_TEXTS)
          else {
            session.value = 'needed'
            problem.value = found
          }
          return
        }
        status.value = received.trim() ? 'cut' : 'idle'
        problem.value = found
      })
    } finally {
      if (controller === abort) controller = null
    }
  }

  const api = {
    language,
    code,
    codeIssue,
    example,
    session,
    starting,
    text,
    status,
    truncated,
    problem,
    streaming,
    busy,
    paused,

    /**
     * Asks the API whether the browser still holds a session, so a visitor who already passed the
     * verification (here or in the assistant) is not asked again. A 503 shows the pause at once.
     */
    async checkSession(): Promise<void> {
      session.value = 'checking'
      let active = false
      let found: Problem | null = null
      try {
        active = await client.hasSession()
      } catch (error) {
        found = toProblem(error, REVIEW_TEXTS)
      }
      // A review that answered meanwhile already knows better.
      if (session.value !== 'checking') return
      batch(() => {
        session.value = active ? 'active' : 'needed'
        if (found?.kind === 'paused') problem.value = found
      })
    },

    /** The visitor edits the code: the field's error goes away until the next submit. */
    setCode(value: string): void {
      batch(() => {
        code.value = value
        codeIssue.value = null
      })
    },

    /** Loads an example into the form. False while a review is on its way. */
    loadExample(next: CodeExample): boolean {
      if (busy.value) return false
      batch(() => {
        language.value = next.language
        code.value = next.code
        codeIssue.value = null
        example.value = next
        if (!paused.value) problem.value = null
        clearResult()
      })
      return true
    },

    /**
     * "Revisar mi código". Without a session it first spends the Turnstile token on one (the same session
     * the assistant uses). Resolves once the review is on its way, not when it ends.
     */
    async submit(turnstileToken: string | null): Promise<SubmitResult> {
      if (busy.value || paused.value) return 'ignored'
      const issue = codeError(code.value)
      if (issue) {
        codeIssue.value = issue
        return 'invalid'
      }
      codeIssue.value = null
      const request: CodeReviewRequest = { language: language.value, code: normalizeCode(code.value) }

      let freshSession = false
      if (session.value === 'needed') {
        if (!turnstileToken) return 'verify'
        batch(() => {
          starting.value = true
          problem.value = null
        })
        try {
          await client.startSession(turnstileToken)
        } catch (error) {
          batch(() => {
            starting.value = false
            problem.value = toProblem(error, REVIEW_TEXTS)
          })
          return 'refused'
        }
        batch(() => {
          starting.value = false
          session.value = 'active'
        })
        freshSession = true
      }
      void run(request, freshSession)
      return 'sent'
    },

    /** "Detener": the review so far stays, marked as stopped. */
    stop(): void {
      controller?.abort()
    },

    /** "Intentar de nuevo": after a pause it asks for the session again; otherwise it sends the form again. */
    retry(): void {
      if (busy.value) return
      if (paused.value) {
        problem.value = null
        void api.checkSession()
        return
      }
      if (problem.value?.retryable && session.value !== 'needed') void api.submit(null)
    },

    /** "Revisar otro": stops the review, clears the form (the language stays) and the result. */
    reset(): void {
      generation += 1
      controller?.abort()
      controller = null
      batch(() => {
        code.value = ''
        codeIssue.value = null
        example.value = null
        if (!paused.value) problem.value = null
        clearResult()
      })
    },
  }
  return api
}

export type CodeReview = ReturnType<typeof createCodeReview>
