import { describe, expect, it } from 'vitest'
import { issueAccessToken, verifyAccessToken } from './tokens'

const secret = 'test-secret-test-secret-test-secret!'
const now = new Date('2026-11-06T15:00:00Z')

describe('access tokens', () => {
  it('round-trips subject and scopes', async () => {
    const { token, expiresIn } = await issueAccessToken(secret, 'admin@aim.test', ['leads:read'], now)
    expect(expiresIn).toBe(900)
    expect(await verifyAccessToken(secret, token, now)).toMatchObject({
      sub: 'admin@aim.test',
      scope: ['leads:read'],
    })
  })

  it('rejects expired tokens', async () => {
    const { token } = await issueAccessToken(secret, 'a@aim.test', ['leads:read'], now)
    expect(await verifyAccessToken(secret, token, new Date(now.getTime() + 16 * 60_000))).toBeNull()
  })

  it('rejects tokens signed with another secret', async () => {
    const { token } = await issueAccessToken(
      'another-secret-another-secret-123',
      'a@aim.test',
      ['leads:read'],
      now,
    )
    expect(await verifyAccessToken(secret, token, now)).toBeNull()
  })

  it('rejects tampered payloads', async () => {
    const { token } = await issueAccessToken(secret, 'a@aim.test', ['leads:read'], now)
    const [h, p, s] = token.split('.')
    const forged = JSON.parse(Buffer.from(p ?? '', 'base64url').toString())
    forged.scope = 'leads:read leads:write audit:read'
    const tampered = [h, Buffer.from(JSON.stringify(forged)).toString('base64url'), s].join('.')
    expect(await verifyAccessToken(secret, tampered, now)).toBeNull()
  })

  it('rejects unsigned tokens (alg none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url')
    const body = Buffer.from(
      JSON.stringify({ sub: 'x', scope: 'leads:read', iss: 'aim-edge', aud: 'aim-admin', exp: 9999999999 }),
    ).toString('base64url')
    expect(await verifyAccessToken(secret, `${header}.${body}.`, now)).toBeNull()
  })
})
