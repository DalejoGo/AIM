import { z } from 'zod'

/** Bindings of the Pages Function (secrets and vars). Parsed once per request; a missing secret fails loudly. */
export const EdgeEnv = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  /** Origin of the site, e.g. https://aimweb-9hc.pages.dev. State-changing requests must come from it. */
  SITE_ORIGIN: z.url(),
  DATABASE_URL: z.string().startsWith('postgres'),
  /** Signs access tokens and keys the HMACs of codes, tokens and IPs. At least 32 characters. */
  JWT_SECRET: z.string().min(32),
  /** Comma-separated e-mails allowed into /admin (DEC-017). */
  ADMIN_EMAILS: z
    .string()
    .min(3)
    .transform((s) =>
      s
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  TURNSTILE_SECRET: z.string().min(1),
  /** Resend in staging/production; Mailpit's HTTP API in local development (DEC-016). */
  RESEND_API_KEY: z.string().min(1).optional(),
  MAILPIT_URL: z.url().optional(),
  MAIL_FROM: z.string().min(3),
  /** Who receives the new-lead notice. */
  NOTIFY_TO: z.email(),
  /** Lab assistant (DEC-011). Optional: without it /api/assistant/* answers 503 and the rest of the API works. */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Small, cheap model: answers come from a short knowledge text, not from reasoning. */
  ASSISTANT_MODEL: z.string().min(1).default('claude-haiku-5-5'),
  /** Output cap per answer (a few short paragraphs). */
  ASSISTANT_MAX_TOKENS: z.coerce.number().int().min(64).max(4096).default(500),
  /** Output cap per code review: four short sections and maybe a small fix, so more room than a chat answer. */
  ASSISTANT_REVIEW_MAX_TOKENS: z.coerce.number().int().min(64).max(4096).default(800),
  /** Messages per visitor (IP hash) in a rolling hour. */
  ASSISTANT_MESSAGES_PER_HOUR: z.coerce.number().int().positive().default(15),
  /** Messages for everyone in a rolling 24 hours: the hard ceiling of the API bill. */
  ASSISTANT_DAILY_LIMIT: z.coerce.number().int().positive().default(300),
  /** Lab "Seguridad en acción": requests per visitor (IP hash) that GET /api/lab/burst accepts in each window. */
  LAB_BURST_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  /** Length of that sliding window, in seconds. */
  LAB_BURST_WINDOW_SECONDS: z.coerce.number().int().min(1).max(3600).default(10),
  /**
   * Lab "Automatización en vivo" (docs/AUTOMATIZACION.md): base URL of the n8n that runs the flow, e.g.
   * https://aimweb-n8n.onrender.com. Empty: POST /api/automation/runs answers 503 and the rest of the API works.
   */
  AUTOMATION_N8N_URL: z
    .string()
    .trim()
    .default('')
    .pipe(z.union([z.literal(''), z.url({ protocol: /^https?$/ })]))
    .transform((url) => url.replace(/\/+$/, '')),
  /** Path of the flow's webhook: POST {AUTOMATION_N8N_URL}/webhook/{AUTOMATION_WEBHOOK_PATH}. */
  AUTOMATION_WEBHOOK_PATH: z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/)
    .default('aim-lead-demo'),
  /** Runs for everyone in a rolling 24 hours (Render's free hours and the Workers subrequests). */
  AUTOMATION_DAILY_LIMIT: z.coerce.number().int().positive().default(150),
  /** How long a run waits for n8n to wake up (Render's free plan sleeps it) before giving up. */
  AUTOMATION_WAKE_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(600).default(180),
  /** Runs per visitor (IP hash) in each window. */
  AUTOMATION_BURST_LIMIT: z.coerce.number().int().min(1).max(100).default(3),
  /** Length of that sliding window, in seconds (at most a day: the counts live 24 hours). */
  AUTOMATION_BURST_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(600),
})
export type EdgeEnv = z.infer<typeof EdgeEnv>
export type EdgeBindings = z.input<typeof EdgeEnv>
