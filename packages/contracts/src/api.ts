import { z } from 'zod'
import { CreateLead, LeadService } from './leads'
import { Currency } from './services'

/** Error body of every API response that is not 2xx. `message` is Spanish and safe to show. */
export const ApiError = z.object({
  error: z.string().min(1),
  message: z.string().min(1),
  fields: z.record(z.string(), z.array(z.string())).optional(),
})
export type ApiError = z.infer<typeof ApiError>

// --- Leads ---------------------------------------------------------------------------------------

/** What the cotizador attaches to a lead, so David sees the estimate the visitor saw. */
export const QuoteSnapshot = z.object({
  service: LeadService,
  options: z.array(z.string().min(1)).max(20),
  timeline: z.string().min(1),
  currency: Currency,
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
})
export type QuoteSnapshot = z.infer<typeof QuoteSnapshot>

/** POST /api/leads */
export const LeadSubmission = CreateLead.and(
  z.object({
    turnstileToken: z.string().min(1).max(4096),
    quote: QuoteSnapshot.optional(),
  }),
)
export type LeadSubmission = z.infer<typeof LeadSubmission>

/** 201 answer of POST /api/leads */
export const LeadCreated = z.object({ id: z.uuid() })
export type LeadCreated = z.infer<typeof LeadCreated>

export const LEAD_STATUSES = ['new', 'contacted', 'won', 'lost', 'spam'] as const
export const LeadStatus = z.enum(LEAD_STATUSES)
export type LeadStatus = z.infer<typeof LeadStatus>

export const Lead = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  status: LeadStatus,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  service: LeadService,
  message: z.string(),
  quote: QuoteSnapshot.nullable(),
})
export type Lead = z.infer<typeof Lead>

/** GET /api/admin/leads?status=&cursor= */
export const LeadPage = z.object({ items: z.array(Lead), nextCursor: z.string().nullable() })
export type LeadPage = z.infer<typeof LeadPage>

/** PATCH /api/admin/leads/:id */
export const UpdateLeadStatus = z.object({ status: LeadStatus })
export type UpdateLeadStatus = z.infer<typeof UpdateLeadStatus>

// --- Auth (DEC-017) ------------------------------------------------------------------------------

export const SCOPES = ['leads:read', 'leads:write', 'audit:read'] as const
export const Scope = z.enum(SCOPES)
export type Scope = z.infer<typeof Scope>

export const EMAIL_OTP_GRANT = 'urn:aim:grant-type:email-otp'

/** POST /api/auth/code — always answers 202 with the same body (no user enumeration). */
export const RequestCode = z.object({
  email: z.email().max(254),
  turnstileToken: z.string().min(1).max(4096),
})
export type RequestCode = z.infer<typeof RequestCode>

/** 202 answer of POST /api/auth/code: always the same body, whether or not the e-mail has access. */
export const CodeSent = z.object({ message: z.string().min(1) })
export type CodeSent = z.infer<typeof CodeSent>

/** POST /api/auth/token — OAuth 2.0 token endpoint with an extension grant (RFC 6749 §4.5). */
export const TokenRequest = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal(EMAIL_OTP_GRANT),
    email: z.email().max(254),
    code: z.string().regex(/^\d{6}$/),
  }),
  // The refresh token travels in its HttpOnly cookie, never in the body.
  z.object({ grant_type: z.literal('refresh_token') }),
])
export type TokenRequest = z.infer<typeof TokenRequest>

/** Tokens are set as HttpOnly cookies; the body only describes them (RFC 6749 §5.1 without the secrets). */
export const TokenResponse = z.object({
  token_type: z.literal('Bearer'),
  expires_in: z.number().int().positive(),
  scope: z.string().min(1),
})
export type TokenResponse = z.infer<typeof TokenResponse>

/** GET /api/auth/me */
export const Principal = z.object({
  sub: z.string().min(1),
  scope: z.array(Scope),
  exp: z.number().int().positive(),
})
export type Principal = z.infer<typeof Principal>

export const AuditEntry = z.object({
  id: z.uuid(),
  at: z.iso.datetime(),
  actor: z.string().nullable(),
  action: z.string().min(1),
  outcome: z.enum(['ok', 'denied', 'error']),
})
export type AuditEntry = z.infer<typeof AuditEntry>

/** GET /api/admin/audit */
export const AuditPage = z.object({ items: z.array(AuditEntry), nextCursor: z.string().nullable() })
export type AuditPage = z.infer<typeof AuditPage>

/** 200 answer of GET /api/lab/burst (Lab "Seguridad en acción"); a 429 is an ApiError with Retry-After. */
export const LabBurstResult = z.object({
  ok: z.literal(true),
  remaining: z.number().int().nonnegative(),
  resetInSeconds: z.number().int().nonnegative(),
})
export type LabBurstResult = z.infer<typeof LabBurstResult>
