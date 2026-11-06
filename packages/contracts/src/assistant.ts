import { z } from 'zod'
import {
  ASSISTANT_MAX_MESSAGE_LENGTH,
  ASSISTANT_MAX_MESSAGES,
  CODE_REVIEW_LANGUAGES,
  CODE_REVIEW_MAX_LENGTH,
} from './limits'

// Lab assistant and code reviewer (DEC-011): the bodies of /api/assistant/* and the payloads of their SSE
// events. Both share the session, the limits and the events.

// \p{Cc} = control characters. Line breaks and tabs stay; the rest only hide content.
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu

const content = z
  .string({ error: 'Cada mensaje debe ser texto.' })
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_BREAKS, '').trim())
  .pipe(
    z
      .string()
      .min(1, { error: 'Escribe tu pregunta antes de enviarla.' })
      .max(ASSISTANT_MAX_MESSAGE_LENGTH, {
        error: `Cada mensaje puede tener hasta ${ASSISTANT_MAX_MESSAGE_LENGTH} caracteres. Acórtalo y vuelve a enviarlo.`,
      }),
  )

export const AssistantRole = z.enum(['user', 'assistant'], {
  error: 'Cada mensaje debe ser del visitante o del asistente.',
})
export type AssistantRole = z.infer<typeof AssistantRole>

/** The conversation lives in the browser: it sends the latest turns, ending with the visitor's question. */
export const ChatRequest = z.object({
  messages: z
    .array(z.object({ role: AssistantRole, content }), {
      error: 'Envía la conversación como una lista de mensajes.',
    })
    .min(1, { error: 'Escribe tu pregunta antes de enviarla.' })
    .max(ASSISTANT_MAX_MESSAGES, {
      error: `La conversación admite hasta ${ASSISTANT_MAX_MESSAGES} mensajes. Envía solo los más recientes o empieza una nueva.`,
    })
    .refine((messages) => messages.at(-1)?.role === 'user', {
      error: 'El último mensaje debe ser la pregunta del visitante.',
    }),
})
export type ChatRequest = z.infer<typeof ChatRequest>

/** GET /api/assistant/session: the cookie is HttpOnly, so the page asks whether it still holds a session. */
export const AssistantSessionStatus = z.object({
  active: z.boolean(),
  /** Seconds left; 0 when there is no session. */
  expiresIn: z.number().int().nonnegative(),
})
export type AssistantSessionStatus = z.infer<typeof AssistantSessionStatus>

export const CodeReviewLanguage = z.enum(CODE_REVIEW_LANGUAGES, {
  error: 'Elige el lenguaje del código: TypeScript, JavaScript, Python, SQL u otro.',
})
export type CodeReviewLanguage = z.infer<typeof CodeReviewLanguage>

// Blank lines before the code say nothing; the indentation of its first line does, so it stays.
const LEADING_BLANK_LINES = /^(?:[ \t]*\n)+/

/** The fragment as the model sees it: CRLF as LF, no control characters but tabs, no blank edges. */
const code = z
  .string({ error: 'Pega el código como texto.' })
  .transform((value) =>
    value
      .replace(/\r\n?/g, '\n')
      .replace(CONTROL_BUT_LINE_BREAKS, '')
      .replace(LEADING_BLANK_LINES, '')
      .trimEnd(),
  )
  .pipe(
    z
      .string()
      .min(1, { error: 'Pega el código que quieres revisar.' })
      .max(CODE_REVIEW_MAX_LENGTH, {
        error: `El código puede tener hasta ${CODE_REVIEW_MAX_LENGTH} caracteres. Pega solo la parte que quieres revisar.`,
      }),
  )

/** Body of POST /api/assistant/review: one fragment, reviewed on its own (there is no conversation). */
export const CodeReviewRequest = z.object({ language: CodeReviewLanguage, code })
export type CodeReviewRequest = z.infer<typeof CodeReviewRequest>

/** SSE `delta`: the next piece of the answer. */
export const AssistantDelta = z.object({ text: z.string() })
export type AssistantDelta = z.infer<typeof AssistantDelta>

/** SSE `done`: why the answer ended (e.g. end_turn, max_tokens). */
export const AssistantDone = z.object({ reason: z.string() })
export type AssistantDone = z.infer<typeof AssistantDone>

/** SSE `error`: same shape as ApiError, with a Spanish message that is safe to show. */
export const AssistantStreamError = z.object({ error: z.string().min(1), message: z.string().min(1) })
export type AssistantStreamError = z.infer<typeof AssistantStreamError>
