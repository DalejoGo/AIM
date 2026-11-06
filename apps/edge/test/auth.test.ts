import type { AuditPage } from '@aim/contracts'
import { type ApiError, AuditEntry, EMAIL_OTP_GRANT, SCOPES } from '@aim/contracts'
import { desc, eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { fixedCaptcha } from '../src/adapters/captcha'
import { recordAudit } from '../src/audit'
import { startRefreshFamily } from '../src/auth/refresh'
import { ACCESS_COOKIE, issueAccessToken, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../src/auth/tokens'
import { auditLog, loginCodes, refreshTokens } from '../src/db/schema'
import { createTestContext, type TestContext, testEnv } from './helpers'

const ADMIN = 'admin@aim.test'
const STRANGER = 'nadie@otro.test'
const ALL_SCOPES = 'leads:read leads:write audit:read'

interface Init {
  ip?: string
  origin?: string | null
  headers?: Record<string, string>
}

function post(t: TestContext, path: string, body: unknown, init: Init = {}) {
  return t.request(path, { method: 'POST', body: JSON.stringify(body), ...init })
}

const requestCode = (t: TestContext, email = ADMIN, init: Init = {}) =>
  post(t, '/api/auth/code', { email, turnstileToken: 'turnstile-ok' }, init)

const exchange = (t: TestContext, code: string, email = ADMIN, init: Init = {}) =>
  post(t, '/api/auth/token', { grant_type: EMAIL_OTP_GRANT, email, code }, init)

const refresh = (t: TestContext, token: string, init: Init = {}) =>
  post(
    t,
    '/api/auth/token',
    { grant_type: 'refresh_token' },
    { ...init, headers: { cookie: `${REFRESH_COOKIE}=${token}` } },
  )

const revoke = (t: TestContext, token?: string) =>
  t.request('/api/auth/revoke', {
    method: 'POST',
    headers: token ? { cookie: `${REFRESH_COOKIE}=${token}` } : {},
  })

const me = (t: TestContext, access: string) =>
  t.request('/api/auth/me', { headers: { cookie: `${ACCESS_COOKIE}=${access}` } })

const bearer = (t: TestContext, path: string, token: string) =>
  t.request(path, { headers: { authorization: `Bearer ${token}` } })

/** The code of the last mail, after the mailer's waitUntil settled. */
async function lastCode(t: TestContext): Promise<string> {
  await t.settle()
  const code = t.mailer.sent.at(-1)?.text.match(/\b(\d{6})\b/)?.[1]
  if (!code) throw new Error('no login code was mailed')
  return code
}

const wrongCode = (code: string) => (code === '000000' ? '111111' : '000000')

interface ParsedCookie {
  value: string
  attrs: Record<string, string | true>
}

function setCookies(res: Response): Record<string, ParsedCookie> {
  const cookies: Record<string, ParsedCookie> = {}
  for (const line of res.headers.getSetCookie()) {
    const [pair = '', ...rest] = line.split(';').map((s) => s.trim())
    const eq = pair.indexOf('=')
    const attrs: Record<string, string | true> = {}
    for (const attr of rest) {
      const i = attr.indexOf('=')
      if (i < 0) attrs[attr.toLowerCase()] = true
      else attrs[attr.slice(0, i).toLowerCase()] = attr.slice(i + 1)
    }
    cookies[pair.slice(0, eq)] = { value: pair.slice(eq + 1), attrs }
  }
  return cookies
}

async function login(t: TestContext, email = ADMIN) {
  expect((await requestCode(t, email)).status).toBe(202)
  const res = await exchange(t, await lastCode(t), email)
  expect(res.status).toBe(200)
  const cookies = setCookies(res)
  const access = cookies[ACCESS_COOKIE]?.value
  const refreshToken = cookies[REFRESH_COOKIE]?.value
  if (!access || !refreshToken) throw new Error('login did not set both cookies')
  return { res, access, refresh: refreshToken }
}

async function auditRows(t: TestContext) {
  return t.db.select().from(auditLog)
}

function advance(t: TestContext, ms: number) {
  t.clock.now = new Date(t.clock.now.getTime() + ms)
}

const MINUTE = 60_000

describe('POST /api/auth/code', () => {
  it('mails a 6-digit code to an admin and stores only its HMAC', async () => {
    const t = await createTestContext()
    const res = await requestCode(t)
    expect(res.status).toBe(202)

    const code = await lastCode(t)
    const mail = t.mailer.sent[0]
    expect(mail).toMatchObject({ to: ADMIN, subject: 'Tu código para entrar a AIM' })
    expect(mail?.text).toContain('10 minutos')
    expect(mail?.text).toContain('Si no lo pediste, ignora este correo')
    expect(mail?.html).toContain(code)

    const [row] = await t.db.select().from(loginCodes)
    expect(row?.email).toBe(ADMIN)
    expect(row?.codeHash).not.toContain(code)
    expect(row?.expiresAt.getTime()).toBe(t.clock.now.getTime() + 10 * MINUTE)

    const [audit] = await auditRows(t)
    expect(audit).toMatchObject({ action: 'auth.code_requested', outcome: 'ok', actor: ADMIN })
  })

  it('answers the same 202 to e-mails without access and sends nothing', async () => {
    const t = await createTestContext()
    const forAdmin = await requestCode(t)
    const forStranger = await requestCode(t, STRANGER)
    await t.settle()

    expect(forStranger.status).toBe(202)
    expect(await forStranger.text()).toBe(await forAdmin.text())
    expect(t.mailer.sent.map((m) => m.to)).toEqual([ADMIN])
    expect(await t.db.select().from(loginCodes).where(eq(loginCodes.email, STRANGER))).toEqual([])

    const [audit] = await t.db.select().from(auditLog).where(eq(auditLog.outcome, 'denied'))
    expect(audit).toMatchObject({ action: 'auth.code_requested', actor: null })
    expect(audit?.detail).toHaveProperty('emailHash')
    expect(JSON.stringify(audit)).not.toContain(STRANGER)
  })

  it('normalizes the e-mail before matching ADMIN_EMAILS', async () => {
    const t = await createTestContext()
    expect((await requestCode(t, 'SECOND@aim.TEST')).status).toBe(202)
    await t.settle()
    expect(t.mailer.sent.map((m) => m.to)).toEqual(['second@aim.test'])
  })

  it('rejects a failed captcha with 422 and does nothing else', async () => {
    const t = await createTestContext({ captcha: fixedCaptcha(false) })
    const res = await requestCode(t)
    await t.settle()
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: 'captcha_failed' })
    expect(t.mailer.sent).toEqual([])
    expect(await t.db.select().from(loginCodes)).toEqual([])
  })

  it('validates the body', async () => {
    const t = await createTestContext()
    const res = await post(t, '/api/auth/code', { email: 'no-es-correo', turnstileToken: '' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('limits codes to 3 per e-mail every 15 minutes, for admins and strangers alike', async () => {
    const t = await createTestContext()
    for (const [email, ip] of [
      [ADMIN, '198.51.100.1'],
      [STRANGER, '198.51.100.2'],
    ] as const) {
      for (let i = 0; i < 3; i++) expect((await requestCode(t, email, { ip })).status).toBe(202)
      const limited = await requestCode(t, email, { ip })
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBe('900')
      expect(await limited.json()).toMatchObject({ error: 'rate_limited' })
    }
    await t.settle()
    expect(t.mailer.sent).toHaveLength(3)

    advance(t, 15 * MINUTE + 1000)
    expect((await requestCode(t, ADMIN)).status).toBe(202)
  })

  it('limits code requests to 10 per IP every hour', async () => {
    const t = await createTestContext()
    for (let i = 0; i < 10; i++) {
      expect((await requestCode(t, `persona${i}@otro.test`)).status).toBe(202)
    }
    const limited = await requestCode(t, ADMIN)
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('3600')
    await t.settle()
    expect(t.mailer.sent).toEqual([])

    expect((await requestCode(t, ADMIN, { ip: '198.51.100.9' })).status).toBe(202)
    const throttled = await t.db.select().from(auditLog).where(eq(auditLog.action, 'auth.rate_limited'))
    expect(throttled).toHaveLength(1)
  })
})

describe('POST /api/auth/token (e-mail code)', () => {
  it('runs the whole session: code, token, me, refresh, logout', async () => {
    const t = await createTestContext()
    const { res, access, refresh: first } = await login(t)

    const body = await res.json()
    expect(body).toEqual({ token_type: 'Bearer', expires_in: 900, scope: ALL_SCOPES })
    expect(JSON.stringify(body)).not.toContain(access)
    expect(JSON.stringify(body)).not.toContain(first)

    const who = await me(t, access)
    expect(who.status).toBe(200)
    expect(await who.json()).toEqual({
      sub: ADMIN,
      scope: [...SCOPES],
      exp: Math.floor(t.clock.now.getTime() / 1000) + 900,
    })

    advance(t, 5 * MINUTE)
    const renewed = await refresh(t, first)
    expect(renewed.status).toBe(200)
    expect(await renewed.json()).toEqual({ token_type: 'Bearer', expires_in: 900, scope: ALL_SCOPES })
    const cookies = setCookies(renewed)
    const second = cookies[REFRESH_COOKIE]?.value ?? ''
    const newAccess = cookies[ACCESS_COOKIE]?.value ?? ''
    expect(second).not.toBe(first)
    expect((await me(t, newAccess)).status).toBe(200)

    const out = await revoke(t, second)
    expect(out.status).toBe(204)
    expect((await refresh(t, second)).status).toBe(400)

    const actions = (await auditRows(t)).map((r) => `${r.action}:${r.outcome}:${r.actor}`)
    expect(actions).toEqual(
      expect.arrayContaining([
        `auth.code_requested:ok:${ADMIN}`,
        `auth.login:ok:${ADMIN}`,
        `auth.refresh:ok:${ADMIN}`,
        `auth.logout:ok:${ADMIN}`,
        `auth.refresh:denied:${ADMIN}`,
      ]),
    )
  })

  it('rejects a wrong code with invalid_grant and still accepts the right one', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const code = await lastCode(t)

    const res = await exchange(t, wrongCode(code))
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiError
    expect(body).toMatchObject({ error: 'invalid_grant' })
    expect(body.message).toContain('pide un código nuevo')
    expect(res.headers.getSetCookie()).toEqual([])

    expect((await exchange(t, code)).status).toBe(200)
    const denied = await t.db.select().from(auditLog).where(eq(auditLog.outcome, 'denied'))
    expect(denied).toMatchObject([{ action: 'auth.login', actor: ADMIN, detail: { reason: 'mismatch' } }])
  })

  it('rejects an expired code', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const code = await lastCode(t)
    advance(t, 10 * MINUTE + 1000)
    const res = await exchange(t, code)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('allows 5 attempts per code', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const code = await lastCode(t)
    for (let i = 0; i < 4; i++) expect((await exchange(t, wrongCode(code))).status).toBe(400)
    expect((await exchange(t, code)).status).toBe(200)
  })

  it('kills the code after 5 failed attempts, even for the right code', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const code = await lastCode(t)
    for (let i = 0; i < 5; i++) expect((await exchange(t, wrongCode(code))).status).toBe(400)
    const res = await exchange(t, code)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('accepts a code only once', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const code = await lastCode(t)
    expect((await exchange(t, code)).status).toBe(200)
    expect((await exchange(t, code)).status).toBe(400)
  })

  it('invalidates the previous code when a new one is requested', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const first = await lastCode(t)
    await requestCode(t)
    const second = await lastCode(t)

    const rows = await t.db.select().from(loginCodes).orderBy(loginCodes.createdAt)
    expect(rows.filter((r) => r.consumedAt === null)).toHaveLength(1)
    // 1 in a million both codes match; then the old one can't be told apart over HTTP.
    if (first !== second) expect((await exchange(t, first)).status).toBe(400)
    expect((await exchange(t, second)).status).toBe(200)
  })

  it('denies e-mails without access with the same answer', async () => {
    const t = await createTestContext()
    const res = await exchange(t, '123456', STRANGER)
    expect(res.status).toBe(400)
    const body = (await res.json()) as ApiError
    expect(body.message).toBe(
      'El código no es válido o ya venció. Revisa el último correo que te enviamos o pide un código nuevo.',
    )
    const [audit] = await auditRows(t)
    expect(audit).toMatchObject({ action: 'auth.login', outcome: 'denied', actor: null })
    expect(JSON.stringify(audit)).not.toContain(STRANGER)
  })

  it('limits failed attempts to 20 per IP every hour', async () => {
    const t = await createTestContext()
    await requestCode(t, ADMIN, { ip: '198.51.100.50' })
    const code = await lastCode(t)

    const ip = '198.51.100.66'
    for (let i = 0; i < 20; i++) {
      expect((await exchange(t, '123456', `persona${i}@otro.test`, { ip })).status).toBe(400)
    }
    const limited = await exchange(t, code, ADMIN, { ip })
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('3600')
    expect(await limited.json()).toMatchObject({ error: 'rate_limited' })

    expect((await exchange(t, code, ADMIN, { ip: '198.51.100.67' })).status).toBe(200)
  })

  it('requires the site Origin', async () => {
    const t = await createTestContext()
    await requestCode(t)
    const res = await exchange(t, await lastCode(t), ADMIN, { origin: 'https://evil.test' })
    expect(res.status).toBe(403)
  })
})

describe('session cookies', () => {
  it('sets both tokens HttpOnly, Secure, SameSite=Strict with their paths', async () => {
    const t = await createTestContext()
    const { res } = await login(t)
    const cookies = setCookies(res)

    expect(cookies[ACCESS_COOKIE]?.attrs).toEqual({
      'max-age': '900',
      path: '/',
      httponly: true,
      secure: true,
      samesite: 'Strict',
    })
    expect(cookies[REFRESH_COOKIE]?.attrs).toEqual({
      'max-age': String(7 * 24 * 60 * 60),
      path: REFRESH_COOKIE_PATH,
      httponly: true,
      secure: true,
      samesite: 'Strict',
    })
  })

  it('clears both cookies on logout with the same attributes', async () => {
    const t = await createTestContext()
    const res = await revoke(t)
    const cookies = setCookies(res)
    expect(cookies[ACCESS_COOKIE]).toEqual({
      value: '',
      attrs: { 'max-age': '0', path: '/', httponly: true, secure: true, samesite: 'Strict' },
    })
    expect(cookies[REFRESH_COOKIE]).toEqual({
      value: '',
      attrs: { 'max-age': '0', path: REFRESH_COOKIE_PATH, httponly: true, secure: true, samesite: 'Strict' },
    })
  })
})

describe('POST /api/auth/token (refresh_token)', () => {
  it('revokes the whole family when a rotated token is reused', async () => {
    const t = await createTestContext()
    const { refresh: first } = await login(t)
    const rotated = await refresh(t, first)
    expect(rotated.status).toBe(200)
    const second = setCookies(rotated)[REFRESH_COOKIE]?.value ?? ''

    const replay = await refresh(t, first)
    expect(replay.status).toBe(400)
    expect(await replay.json()).toMatchObject({ error: 'invalid_grant' })
    expect(setCookies(replay)[REFRESH_COOKIE]?.attrs['max-age']).toBe('0')

    // The legitimate holder's newer token dies with the family.
    expect((await refresh(t, second)).status).toBe(400)

    const family = await t.db.select().from(refreshTokens)
    expect(family).toHaveLength(2)
    expect(family.every((r) => r.revokedAt !== null)).toBe(true)

    const reuse = await t.db.select().from(auditLog).where(eq(auditLog.action, 'auth.refresh_reuse'))
    expect(reuse).toMatchObject([{ outcome: 'denied', actor: ADMIN }])
  })

  it('rejects an expired refresh token', async () => {
    const t = await createTestContext()
    const { refresh: token } = await login(t)
    advance(t, 7 * 24 * 60 * MINUTE + 1000)
    const res = await refresh(t, token)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('rejects unknown tokens and a missing cookie', async () => {
    const t = await createTestContext()
    expect((await refresh(t, 'no-existe')).status).toBe(400)
    const res = await post(t, '/api/auth/token', { grant_type: 'refresh_token' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_grant' })
  })

  it('revokes the family of a subject that is no longer an admin', async () => {
    const t = await createTestContext()
    const issued = await startRefreshFamily(t.db, testEnv.JWT_SECRET, {
      subject: 'antes-admin@aim.test',
      scope: SCOPES,
      now: t.clock.now,
    })
    expect((await refresh(t, issued.token)).status).toBe(400)
    const [row] = await t.db.select().from(refreshTokens)
    expect(row?.revokedAt).not.toBeNull()
  })
})

describe('POST /api/auth/revoke', () => {
  it('is idempotent', async () => {
    const t = await createTestContext()
    const { refresh: token } = await login(t)
    expect((await revoke(t, token)).status).toBe(204)
    expect((await revoke(t, token)).status).toBe(204)
    expect((await revoke(t)).status).toBe(204)
    expect((await refresh(t, token)).status).toBe(400)
  })
})

describe('GET /api/auth/me', () => {
  it('answers 401 without a token', async () => {
    const t = await createTestContext()
    const res = await t.request('/api/auth/me')
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toContain('Bearer')
  })

  it('accepts an Authorization: Bearer header', async () => {
    const t = await createTestContext()
    const { token } = await issueAccessToken(testEnv.JWT_SECRET, ADMIN, ['leads:read'], t.clock.now)
    const res = await bearer(t, '/api/auth/me', token)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ sub: ADMIN, scope: ['leads:read'] })
  })

  it('rejects the access cookie after 15 minutes', async () => {
    const t = await createTestContext()
    const { access } = await login(t)
    advance(t, 15 * MINUTE + 1000)
    expect((await me(t, access)).status).toBe(401)
  })
})

describe('GET /api/admin/audit', () => {
  async function adminToken(t: TestContext) {
    return (await issueAccessToken(testEnv.JWT_SECRET, ADMIN, SCOPES, t.clock.now)).token
  }

  async function readAll(t: TestContext, token: string, limit: number) {
    const ids: string[] = []
    let cursor: string | null = ''
    let pages = 0
    while (cursor !== null) {
      const res = await bearer(t, `/api/admin/audit?limit=${limit}&cursor=${cursor}`, token)
      expect(res.status).toBe(200)
      const page = (await res.json()) as AuditPage
      expect(page.items.length).toBeLessThanOrEqual(limit)
      for (const item of page.items) ids.push(AuditEntry.parse(item).id)
      cursor = page.nextCursor
      pages++
    }
    return { ids, pages }
  }

  it('answers 401 without a token and 403 without audit:read', async () => {
    const t = await createTestContext()
    expect((await t.request('/api/admin/audit')).status).toBe(401)
    const { token } = await issueAccessToken(testEnv.JWT_SECRET, ADMIN, ['leads:read'], t.clock.now)
    const res = await bearer(t, '/api/admin/audit', token)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'insufficient_scope' })
  })

  it('works with the session cookie of a real login', async () => {
    const t = await createTestContext()
    const { access } = await login(t)
    const res = await t.request('/api/admin/audit', { headers: { cookie: `${ACCESS_COOKIE}=${access}` } })
    expect(res.status).toBe(200)
    const page = (await res.json()) as AuditPage
    expect(page.items.map((i) => i.action).sort()).toEqual(['auth.code_requested', 'auth.login'])
  })

  it('pages newest first with an opaque cursor, without repeating or skipping rows', async () => {
    const t = await createTestContext()
    const base = t.clock.now.getTime()
    // Pairs share the same instant, so the id tiebreaker matters.
    for (let i = 0; i < 25; i++) {
      await recordAudit(t.db, new Date(base - Math.floor(i / 2) * 1000), {
        actor: ADMIN,
        action: 'lead.status_changed',
        outcome: 'ok',
        ipHash: 'secret-ip-hash',
        detail: { secret: 'no-mostrar' },
      })
    }
    // Microsecond timestamps that a millisecond cursor would mix up.
    await t.db.execute(sql`
      insert into audit_log (at, action, outcome) values
        ('2026-11-06T14:00:00.123456Z', 'micro.a', 'ok'),
        ('2026-11-06T14:00:00.123457Z', 'micro.b', 'ok'),
        ('2026-11-06T14:00:00.123458Z', 'micro.c', 'ok')`)

    const token = await adminToken(t)
    const expected = (
      await t.db.select({ id: auditLog.id }).from(auditLog).orderBy(desc(auditLog.at), desc(auditLog.id))
    ).map((r) => r.id)
    expect(expected).toHaveLength(28)

    for (const limit of [1, 7, 100]) {
      const { ids, pages } = await readAll(t, token, limit)
      expect(ids).toEqual(expected)
      expect(pages).toBe(Math.ceil(28 / limit))
    }

    const res = await bearer(t, '/api/admin/audit?limit=5', token)
    const text = await res.text()
    expect(text).not.toContain('secret-ip-hash')
    expect(text).not.toContain('no-mostrar')
    const { items } = JSON.parse(text) as { items: Record<string, unknown>[] }
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['action', 'actor', 'at', 'id', 'outcome'])
  })

  it('defaults to 20 items and caps the limit at 100', async () => {
    const t = await createTestContext()
    for (let i = 0; i < 25; i++) {
      await recordAudit(t.db, new Date(t.clock.now.getTime() - i * 1000), {
        actor: null,
        action: 'x',
        outcome: 'ok',
      })
    }
    const token = await adminToken(t)
    for (const path of ['/api/admin/audit', '/api/admin/audit?cursor=&limit=']) {
      const page = (await (await bearer(t, path, token)).json()) as AuditPage
      expect(page.items).toHaveLength(20)
      expect(typeof page.nextCursor).toBe('string')
    }
    expect((await bearer(t, '/api/admin/audit?limit=101', token)).status).toBe(400)
    expect((await bearer(t, '/api/admin/audit?limit=0', token)).status).toBe(400)
  })

  it('rejects a cursor it did not produce', async () => {
    const t = await createTestContext()
    const token = await adminToken(t)
    const res = await bearer(t, '/api/admin/audit?cursor=no-es-un-cursor', token)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_cursor' })
  })
})
