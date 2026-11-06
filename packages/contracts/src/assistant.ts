import { z } from 'zod'
import { ASSISTANT_MAX_MESSAGE_LENGTH, ASSISTANT_MAX_MESSAGES } from './limits'

// Lab assistant (DEC-011): body of POST /api/assistant/messages and the payloads of its SSE events.

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

/** SSE `delta`: the next piece of the answer. */
export const AssistantDelta = z.object({ text: z.string() })
export type AssistantDelta = z.infer<typeof AssistantDelta>

/** SSE `done`: why the answer ended (e.g. end_turn, max_tokens). */
export const AssistantDone = z.object({ reason: z.string() })
export type AssistantDone = z.infer<typeof AssistantDone>

/** SSE `error`: same shape as ApiError, with a Spanish message that is safe to show. */
export const AssistantStreamError = z.object({ error: z.string().min(1), message: z.string().min(1) })
export type AssistantStreamError = z.infer<typeof AssistantStreamError>
