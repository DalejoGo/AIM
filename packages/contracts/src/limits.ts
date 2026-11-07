// Plain constants (no zod): browser islands import them from '@aim/contracts/limits' without pulling schemas in.

/** POST /api/assistant/messages: how many turns travel with each question, and how long each may be. */
export const ASSISTANT_MAX_MESSAGES = 10
export const ASSISTANT_MAX_MESSAGE_LENGTH = 1000

/** POST /api/assistant/review: the languages the reviewer is told about ("otro": it works it out). */
export const CODE_REVIEW_LANGUAGES = ['typescript', 'javascript', 'python', 'sql', 'otro'] as const

/** POST /api/assistant/review: the longest fragment, in UTF-16 units (what a textarea's maxlength counts). */
export const CODE_REVIEW_MAX_LENGTH = 4000

// Lab "Automatización en vivo" (docs/AUTOMATIZACION.md): the form's choices and limits, and the steps n8n reports.

/** Budget of the test lead, in USD: under 500, 500–2000, 2000–5000, over 5000 or not known yet. */
export const AUTOMATION_BUDGETS = ['lt500', '500-2000', '2000-5000', 'gt5000', 'unknown'] as const

/** When the test lead needs it: urgent (under 2 weeks), month (1–2 months) or flexible. */
export const AUTOMATION_TIMELINES = ['urgent', 'month', 'flexible'] as const

/** Lengths of the test lead's fields, in UTF-16 units (what an input's maxlength counts). */
export const AUTOMATION_LEAD_LIMITS = {
  nameMin: 2,
  nameMax: 80,
  companyMax: 80,
  emailMax: 120,
  messageMin: 10,
  messageMax: 1000,
} as const

/** The steps n8n reports, in order. A rejected lead goes from `validated` straight to `done`. */
export const AUTOMATION_STEPS = [
  'received',
  'validated',
  'scored',
  'routed',
  'drafted',
  'recorded',
  'done',
] as const

/** Codes of the SSE `error` event of POST /api/automation/runs. */
export const AUTOMATION_ERROR_CODES = ['n8n_unreachable', 'timeout', 'internal'] as const
