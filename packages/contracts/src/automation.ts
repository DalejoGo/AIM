import { z } from 'zod'
import {
  AUTOMATION_BUDGETS,
  AUTOMATION_ERROR_CODES,
  AUTOMATION_LEAD_LIMITS,
  AUTOMATION_STATUS_STATES,
  AUTOMATION_STEPS,
  AUTOMATION_TIMELINES,
} from './limits'
import { SERVICE_IDS } from './services'

// Lab "Automatización en vivo" (docs/AUTOMATIZACION.md, the contract between the page, the edge and n8n):
// 1. the browser's POST /api/automation/runs and the payloads of its SSE events,
// 2. the edge's webhook to n8n,
// 3. n8n's report of each step to POST /api/automation/runs/:runId/events.

// \p{Cc} = control characters. Postgres rejects NUL in text and the rest only hide content.
const CONTROL = /\p{Cc}/gu
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu

/** One line, single spaces. */
const cleanLine = (value: string) => value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
/** Free text: line breaks stay. */
const cleanBlock = (value: string) =>
  value.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_BREAKS, '').trim()

const L = AUTOMATION_LEAD_LIMITS

const NAME = `Escribe un nombre de ${L.nameMin} a ${L.nameMax} caracteres.`
const COMPANY = `El nombre de la empresa puede tener hasta ${L.companyMax} caracteres.`
const EMAIL = 'Escribe un correo válido, por ejemplo laura@empresa.co.'
const SERVICE = 'Elige uno de los servicios de la lista.'
const BUDGET = 'Elige un presupuesto de la lista.'
const TIMELINE = 'Elige un plazo de la lista.'
const MESSAGE = `Cuenta qué necesita el cliente en un mensaje de ${L.messageMin} a ${L.messageMax} caracteres.`
const TURNSTILE = 'Completa la verificación de seguridad para continuar.'
const TURNSTILE_INVALID = 'La verificación de seguridad no es válida. Recarga la página e inténtalo de nuevo.'

export const AutomationBudget = z.enum(AUTOMATION_BUDGETS, { error: BUDGET })
export type AutomationBudget = z.infer<typeof AutomationBudget>

export const AutomationTimeline = z.enum(AUTOMATION_TIMELINES, { error: TIMELINE })
export type AutomationTimeline = z.infer<typeof AutomationTimeline>

/** The test lead the visitor fills in. Cleaned before the limits apply, so they count what n8n receives. */
export const AutomationLead = z.object({
  name: z
    .string({ error: NAME })
    .transform(cleanLine)
    .pipe(z.string().min(L.nameMin, { error: NAME }).max(L.nameMax, { error: NAME })),
  /** Optional; an empty one is dropped. */
  company: z
    .string({ error: COMPANY })
    .transform(cleanLine)
    .pipe(z.string().max(L.companyMax, { error: COMPANY }))
    .optional()
    .transform((value) => value || undefined),
  email: z
    .string({ error: EMAIL })
    .transform((value) => value.trim().toLowerCase())
    .pipe(z.email({ error: EMAIL }).max(L.emailMax, { error: EMAIL })),
  /** Id of a service of apps/web/src/content/services. */
  service: z.enum(SERVICE_IDS, { error: SERVICE }),
  budget: AutomationBudget,
  timeline: AutomationTimeline,
  message: z
    .string({ error: MESSAGE })
    .transform(cleanBlock)
    .pipe(z.string().min(L.messageMin, { error: MESSAGE }).max(L.messageMax, { error: MESSAGE })),
})
export type AutomationLead = z.infer<typeof AutomationLead>
export type AutomationLeadInput = z.input<typeof AutomationLead>

/** Body of POST /api/automation/runs: one Turnstile token per run. */
export const AutomationRunRequest = z.object({
  turnstileToken: z
    .string({ error: TURNSTILE })
    .min(1, { error: TURNSTILE })
    .max(4096, { error: TURNSTILE_INVALID }),
  lead: AutomationLead,
})
export type AutomationRunRequest = z.infer<typeof AutomationRunRequest>

// --- Steps (n8n → edge, and edge → browser) -------------------------------------------------------

export const AutomationStep = z.enum(AUTOMATION_STEPS)
export type AutomationStep = z.infer<typeof AutomationStep>

/** Short visible text that n8n writes (labels, SLA): one line, never empty. */
const label = (max: number) => z.string().trim().min(1).max(max)

/** `received`: n8n's `$execution.id`, proof that a real n8n runs the flow. */
export const AutomationReceived = z.object({ execution: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })

/** One business rule n8n checked (the edge already checked the format). */
export const AutomationCheck = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  label: label(120),
  ok: z.boolean(),
})
export type AutomationCheck = z.infer<typeof AutomationCheck>

/** `validated`: when `valid` is false the next step is `done` with outcome `rejected`. */
export const AutomationValidated = z.object({
  valid: z.boolean(),
  checks: z.array(AutomationCheck).min(1).max(10),
})

export const AUTOMATION_TIERS = ['hot', 'warm', 'cold'] as const
export const AutomationTier = z.enum(AUTOMATION_TIERS)
export type AutomationTier = z.infer<typeof AutomationTier>

/** What added (or took away) points from the score. */
export const AutomationFactor = z.object({
  label: label(120),
  points: z.number().int().min(-100).max(100),
})
export type AutomationFactor = z.infer<typeof AutomationFactor>

/** `scored`: 0–100 and its tier (hot ≥ 70, warm 40–69, cold < 40 in the flow's rules). */
export const AutomationScored = z.object({
  score: z.number().int().min(0).max(100),
  tier: AutomationTier,
  factors: z.array(AutomationFactor).max(10),
})

export const AUTOMATION_ROUTES = ['call', 'proposal', 'nurture'] as const
export const AutomationRoute = z.enum(AUTOMATION_ROUTES)
export type AutomationRoute = z.infer<typeof AutomationRoute>

/** `routed`: what happens next with the lead, and how soon. */
export const AutomationRouted = z.object({ route: AutomationRoute, label: label(120), sla: label(120) })

/** `drafted`: the reply's preview. It is never sent, and the page shows it as text, never as HTML. */
export const AutomationDrafted = z.object({
  subject: label(160),
  body: z.string().trim().min(1).max(2000),
})

/** `recorded`: "AIM-" and the first 8 characters of the runId, in capitals. */
export const AutomationRecorded = z.object({ reference: z.string().regex(/^AIM-[0-9A-F]{8}$/) })

export const AUTOMATION_OUTCOMES = ['accepted', 'rejected'] as const
export const AutomationOutcome = z.enum(AUTOMATION_OUTCOMES)
export type AutomationOutcome = z.infer<typeof AutomationOutcome>

/** `done`: the last step. */
export const AutomationFinished = z.object({ outcome: AutomationOutcome })

const STEP_DATA = {
  received: AutomationReceived,
  validated: AutomationValidated,
  scored: AutomationScored,
  routed: AutomationRouted,
  drafted: AutomationDrafted,
  recorded: AutomationRecorded,
  done: AutomationFinished,
} as const satisfies Record<AutomationStep, z.ZodType>

const report = <S extends AutomationStep>(name: S) =>
  z.object({ step: z.literal(name), data: STEP_DATA[name] })

/** Body of n8n's POST /api/automation/runs/:runId/events. Unknown keys are dropped, never stored. */
export const AutomationStepReport = z.discriminatedUnion('step', [
  report('received'),
  report('validated'),
  report('scored'),
  report('routed'),
  report('drafted'),
  report('recorded'),
  report('done'),
])
export type AutomationStepReport = z.infer<typeof AutomationStepReport>

/** The `data` of one step. */
export type AutomationStepData<S extends AutomationStep> = Extract<AutomationStepReport, { step: S }>['data']

const milliseconds = z.number().int().nonnegative()

const event = <S extends AutomationStep>(name: S) => report(name).extend({ atMs: milliseconds })

/** SSE `step`: a step as n8n reported it; `atMs` = milliseconds since the run started. */
export const AutomationStepEvent = z.discriminatedUnion('step', [
  event('received'),
  event('validated'),
  event('scored'),
  event('routed'),
  event('drafted'),
  event('recorded'),
  event('done'),
])
export type AutomationStepEvent = z.infer<typeof AutomationStepEvent>

// --- SSE events of POST /api/automation/runs --------------------------------------------------------

/** `run`: the run was created. */
export const AutomationRunEvent = z.object({ runId: z.uuid() })
export type AutomationRunEvent = z.infer<typeof AutomationRunEvent>

/** `waking`: n8n is still asleep (Render's free plan); one per health check. */
export const AutomationWakingEvent = z.object({ elapsedMs: milliseconds })
export type AutomationWakingEvent = z.infer<typeof AutomationWakingEvent>

/** `started`: n8n accepted the webhook. */
export const AutomationStartedEvent = z.object({})
export type AutomationStartedEvent = z.infer<typeof AutomationStartedEvent>

/** `done`: after the `done` step. */
export const AutomationDoneEvent = z.object({ outcome: AutomationOutcome, totalMs: milliseconds })
export type AutomationDoneEvent = z.infer<typeof AutomationDoneEvent>

export const AutomationErrorCode = z.enum(AUTOMATION_ERROR_CODES)
export type AutomationErrorCode = z.infer<typeof AutomationErrorCode>

/** `error`: the run stopped. `message` is Spanish and safe to show. */
export const AutomationErrorEvent = z.object({ code: AutomationErrorCode, message: z.string().min(1) })
export type AutomationErrorEvent = z.infer<typeof AutomationErrorEvent>

/** Every event of the stream, by name: the browser checks each payload with its schema. */
export const AutomationStreamEvents = {
  run: AutomationRunEvent,
  waking: AutomationWakingEvent,
  started: AutomationStartedEvent,
  step: AutomationStepEvent,
  done: AutomationDoneEvent,
  error: AutomationErrorEvent,
} as const
export type AutomationStreamEventName = keyof typeof AutomationStreamEvents

// --- GET /api/automation/status ------------------------------------------------------------------

export const AutomationStatusState = z.enum(AUTOMATION_STATUS_STATES)
export type AutomationStatusState = z.infer<typeof AutomationStatusState>

/** Asked when the page opens, so n8n wakes up while the visitor fills in the form. */
export const AutomationStatus = z.object({ state: AutomationStatusState })
export type AutomationStatus = z.infer<typeof AutomationStatus>

// --- Edge → n8n ---------------------------------------------------------------------------------

/** The lead as n8n receives it: the visitor's fields, cleaned, and the service's visible name. */
export const AutomationWebhookLead = AutomationLead.extend({ serviceTitle: z.string().min(1).max(80) })
export type AutomationWebhookLead = z.infer<typeof AutomationWebhookLead>

/**
 * Body of POST {AUTOMATION_N8N_URL}/webhook/{AUTOMATION_WEBHOOK_PATH}. n8n sends `callbackToken` back as
 * `Authorization: Bearer` with each step; it is the only credential n8n ever holds.
 */
export const AutomationWebhookPayload = z.object({
  runId: z.uuid(),
  callbackToken: z.string().min(1).max(2048),
  lead: AutomationWebhookLead,
})
export type AutomationWebhookPayload = z.infer<typeof AutomationWebhookPayload>
