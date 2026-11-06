import { CodeReviewRequest } from '@aim/contracts'
import { Hono } from 'hono'
import { type AnswerTexts, streamAnswer } from '../assistant/answer'
import { REVIEW_SYSTEM_PROMPT, reviewMessage } from '../assistant/review-prompt'
import { requireAssistantSession } from '../assistant/session'
import type { AppEnv } from '../deps'
import { fail, validate } from '../lib/http'

/**
 * Lab code reviewer: POST /api/assistant/review with `{ language, code }`. Mounted by ./assistant.ts, so it
 * shares the assistant's session cookie (Path=/api/assistant), its 503 when there is no model, its limits and
 * its SSE events: the visitor solves Turnstile once for both.
 */
export const reviewRoutes = new Hono<AppEnv>()

export const REVIEW_UNAVAILABLE =
  'El revisor de código no está disponible en este momento. Escríbele a David por WhatsApp o desde /contacto/ y te responde personalmente.'

const REVIEW_TEXTS: AnswerTexts = {
  busy: 'El revisor está recibiendo muchas solicitudes en este momento. Espera un minuto y vuelve a intentarlo.',
  failed:
    'El revisor no pudo terminar la revisión. Inténtalo de nuevo o escríbele a David por WhatsApp o desde /contacto/.',
  refusal: 'No puedo revisar ese fragmento. Prueba con otro código.',
  hourly: (wait) =>
    `Ya usaste varias veces el revisor o el asistente en la última hora: comparten el mismo límite. Vuelve a intentarlo en ${wait} o escríbele a David por WhatsApp.`,
  daily: (wait) =>
    `El revisor y el asistente llegaron a su límite de uso por hoy. Vuelve a intentarlo en ${wait} o escríbele a David por WhatsApp o desde /contacto/.`,
}

reviewRoutes.post(
  '/',
  requireAssistantSession(
    'Tu sesión venció. Completa de nuevo la verificación de seguridad para revisar tu código.',
  ),
  validate('json', CodeReviewRequest),
  async (c) => {
    const { language, code } = c.req.valid('json')
    const { env, llm } = c.var.deps
    if (!llm) return fail(c, 503, 'assistant_unavailable', REVIEW_UNAVAILABLE)
    const request = {
      model: env.ASSISTANT_MODEL,
      system: REVIEW_SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: reviewMessage(language, code) }],
      maxTokens: env.ASSISTANT_REVIEW_MAX_TOKENS,
    }
    return streamAnswer(c, llm, request, REVIEW_TEXTS)
  },
)
