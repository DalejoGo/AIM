import {
  EMAIL_OTP_GRANT,
  type Principal,
  RequestCode,
  type Scope,
  TokenRequest,
  type TokenResponse,
} from '@aim/contracts'
import { type Context, Hono } from 'hono'
import { recordAudit } from '../audit'
import { clearSessionCookies, readRefreshCookie, setSessionCookies } from '../auth/cookies'
import { CODE_REQUESTED, codeRequestLimit, failedLoginLimit, LOGIN } from '../auth/limits'
import { loginCodeMail } from '../auth/mail'
import { requireScope } from '../auth/middleware'
import { hashEmail, isAdminEmail, issueLoginCode, normalizeEmail, redeemLoginCode } from '../auth/otp'
import {
  type IssuedRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  startRefreshFamily,
} from '../auth/refresh'
import { ADMIN_SCOPES, issueAccessToken } from '../auth/tokens'
import type { AppEnv } from '../deps'
import { fail, validate } from '../lib/http'
import { log } from '../lib/log'

/** POST /api/auth/code, POST /api/auth/token, POST /api/auth/revoke, GET /api/auth/me (DEC-017). */
export const authRoutes = new Hono<AppEnv>()

/** Same answer whether or not the e-mail has access, so nobody can tell admins apart. */
const CODE_SENT = {
  message: 'Si el correo tiene acceso, te enviamos un código. Revisa tu bandeja de entrada y la de spam.',
} as const

const MESSAGES = {
  captcha: 'No pudimos confirmar que eres una persona. Recarga la página e inténtalo de nuevo.',
  invalidCode:
    'El código no es válido o ya venció. Revisa el último correo que te enviamos o pide un código nuevo.',
  noSession: 'No hay una sesión activa. Inicia sesión con tu correo.',
  sessionEnded: 'Tu sesión terminó. Inicia sesión de nuevo con tu correo.',
} as const

type Ctx = Context<AppEnv>

function rateLimited(c: Ctx, retryAfter: number) {
  const minutes = Math.ceil(retryAfter / 60)
  c.header('Retry-After', String(retryAfter))
  return fail(
    c,
    429,
    'rate_limited',
    `Hiciste demasiados intentos. Espera ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'} e inténtalo de nuevo.`,
  )
}

/** Sets both tokens as cookies; the body only describes them (RFC 6749 §5.1 without the secrets). */
async function grantTokens(c: Ctx, subject: string, scope: readonly Scope[], refresh: IssuedRefreshToken) {
  const { env, now } = c.var.deps
  const access = await issueAccessToken(env.JWT_SECRET, subject, scope, now())
  setSessionCookies(c, {
    access: access.token,
    accessMaxAge: access.expiresIn,
    refresh: refresh.token,
    refreshMaxAge: refresh.maxAge,
  })
  const body: TokenResponse = { token_type: 'Bearer', expires_in: access.expiresIn, scope: scope.join(' ') }
  return c.json(body, 200)
}

authRoutes.post('/code', validate('json', RequestCode), async (c) => {
  const { deps, ipHash, clientIp } = c.var
  const { env } = deps
  const body = c.req.valid('json')

  if (!(await deps.captcha.verify(body.turnstileToken, clientIp))) {
    return fail(c, 422, 'captcha_failed', MESSAGES.captcha)
  }

  const now = deps.now()
  const db = await deps.db()
  const email = normalizeEmail(body.email)
  const admin = isAdminEmail(env, email)
  const actor = admin ? email : null
  const emailHash = await hashEmail(env.JWT_SECRET, email)

  const retryAfter = await codeRequestLimit(db, { ipHash, emailHash, now })
  if (retryAfter) {
    await recordAudit(db, now, {
      actor,
      action: 'auth.rate_limited',
      outcome: 'denied',
      ipHash,
      detail: { endpoint: 'code', emailHash },
    })
    return rateLimited(c, retryAfter)
  }

  if (admin) {
    const code = await issueLoginCode(db, env.JWT_SECRET, { email, ipHash, now })
    deps.waitUntil(
      deps.mailer.send(loginCodeMail(email, code)).catch((err) => log.error('login code mail failed', err)),
    )
  }
  await recordAudit(db, now, {
    actor,
    action: CODE_REQUESTED,
    outcome: admin ? 'ok' : 'denied',
    ipHash,
    detail: { emailHash },
  })
  return c.json(CODE_SENT, 202)
})

authRoutes.post('/token', validate('json', TokenRequest), async (c) => {
  const body = c.req.valid('json')
  return body.grant_type === EMAIL_OTP_GRANT ? emailCodeGrant(c, body.email, body.code) : refreshGrant(c)
})

/** Extension grant `urn:aim:grant-type:email-otp` (RFC 6749 §4.5). */
async function emailCodeGrant(c: Ctx, rawEmail: string, code: string) {
  const { deps, ipHash } = c.var
  const { env } = deps
  const now = deps.now()
  const db = await deps.db()

  const retryAfter = await failedLoginLimit(db, { ipHash, now })
  if (retryAfter) {
    await recordAudit(db, now, {
      actor: null,
      action: 'auth.rate_limited',
      outcome: 'denied',
      ipHash,
      detail: { endpoint: 'token' },
    })
    return rateLimited(c, retryAfter)
  }

  const email = normalizeEmail(rawEmail)
  const admin = isAdminEmail(env, email)
  // Runs for every e-mail so admins and strangers take the same path (and a removed admin's code dies).
  const check = await redeemLoginCode(db, env.JWT_SECRET, { email, code, now })

  if (!check.ok || !admin) {
    const reason = check.ok ? 'not_admin' : check.reason
    await recordAudit(db, now, {
      actor: admin ? email : null,
      action: LOGIN,
      outcome: 'denied',
      ipHash,
      detail: admin ? { reason } : { reason, emailHash: await hashEmail(env.JWT_SECRET, email) },
    })
    return fail(c, 400, 'invalid_grant', MESSAGES.invalidCode)
  }

  const refresh = await startRefreshFamily(db, env.JWT_SECRET, { subject: email, scope: ADMIN_SCOPES, now })
  await recordAudit(db, now, {
    actor: email,
    action: LOGIN,
    outcome: 'ok',
    ipHash,
    detail: { familyId: refresh.familyId },
  })
  return grantTokens(c, email, ADMIN_SCOPES, refresh)
}

/** `refresh_token` grant with rotation and reuse detection. The token comes from its HttpOnly cookie. */
async function refreshGrant(c: Ctx) {
  const { deps, ipHash } = c.var
  const { env } = deps
  const token = readRefreshCookie(c)
  if (!token) return fail(c, 400, 'invalid_grant', MESSAGES.noSession)

  const now = deps.now()
  const db = await deps.db()
  const result = await rotateRefreshToken(db, env.JWT_SECRET, {
    token,
    isAllowed: (subject) => isAdminEmail(env, subject),
    now,
  })

  if (!result.ok) {
    await recordAudit(db, now, {
      actor: result.subject,
      action: result.reason === 'reused' ? 'auth.refresh_reuse' : 'auth.refresh',
      outcome: 'denied',
      ipHash,
      detail: { reason: result.reason, familyId: result.familyId },
    })
    clearSessionCookies(c)
    return fail(c, 400, 'invalid_grant', MESSAGES.sessionEnded)
  }

  await recordAudit(db, now, {
    actor: result.subject,
    action: 'auth.refresh',
    outcome: 'ok',
    ipHash,
    detail: { familyId: result.refresh.familyId },
  })
  return grantTokens(c, result.subject, result.scope, result.refresh)
}

/** Logout (RFC 7009 in spirit): revokes the refresh family and clears both cookies. Idempotent. */
authRoutes.post('/revoke', async (c) => {
  const { deps, ipHash } = c.var
  const token = readRefreshCookie(c)
  if (token) {
    const now = deps.now()
    const db = await deps.db()
    const revoked = await revokeRefreshToken(db, deps.env.JWT_SECRET, { token, now })
    if (revoked) {
      await recordAudit(db, now, {
        actor: revoked.subject,
        action: 'auth.logout',
        outcome: 'ok',
        ipHash,
        detail: { familyId: revoked.familyId },
      })
    }
  }
  clearSessionCookies(c)
  return c.body(null, 204)
})

authRoutes.get('/me', requireScope(), (c) => {
  const principal = c.get('principal')
  if (!principal) return fail(c, 401, 'unauthorized', 'Tu sesión venció o no has iniciado sesión.')
  const body: Principal = principal
  return c.json(body)
})
