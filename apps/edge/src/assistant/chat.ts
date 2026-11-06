import { z } from 'zod'
import type { LlmMessage } from '../deps'

// Body of POST /api/assistant/messages. The conversation lives in the browser: it sends the last turns each time.

export const MAX_MESSAGES = 10
export const MAX_MESSAGE_LENGTH = 1000

// \p{Cc} = control characters. Line breaks and tabs stay; the rest only hide content.
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu

const content = z
  .string({ error: 'Cada mensaje debe ser texto.' })
  .transform((value) => value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_BREAKS, '').trim())
  .pipe(
    z
      .string()
      .min(1, { error: 'Escribe tu pregunta antes de enviarla.' })
      .max(MAX_MESSAGE_LENGTH, {
        error: `Cada mensaje puede tener hasta ${MAX_MESSAGE_LENGTH} caracteres. Acórtalo y vuelve a enviarlo.`,
      }),
  )

export const ChatRequest = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant'], {
          error: 'Cada mensaje debe ser del visitante o del asistente.',
        }),
        content,
      }),
      { error: 'Envía la conversación como una lista de mensajes.' },
    )
    .min(1, { error: 'Escribe tu pregunta antes de enviarla.' })
    .max(MAX_MESSAGES, {
      error: `La conversación admite hasta ${MAX_MESSAGES} mensajes. Envía solo los más recientes o empieza una nueva.`,
    })
    .refine((messages) => messages.at(-1)?.role === 'user', {
      error: 'El último mensaje debe ser la pregunta del visitante.',
    }),
})
export type ChatRequest = z.infer<typeof ChatRequest>

/** The model expects the conversation to start with the visitor: older answers cut off by the browser are dropped. */
export function toLlmMessages(messages: ChatRequest['messages']): LlmMessage[] {
  const first = messages.findIndex((m) => m.role === 'user')
  return messages.slice(first)
}
