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
})
export type EdgeEnv = z.infer<typeof EdgeEnv>
export type EdgeBindings = z.input<typeof EdgeEnv>
