import { describe, expect, it } from 'vitest'
import {
  buildAuthorizationUrl,
  buildCallbackUrl,
  checkCallback,
  demo,
  parseAuthorizationUrl,
} from './authorization'
import { createClientSession } from './pkce'

const session = await createClientSession()
const authorizationUrl = buildAuthorizationUrl(session)

/** The authorization URL with one parameter replaced (or removed with null). */
function withParam(name: string, value: string | null): URL {
  const url = new URL(authorizationUrl)
  if (value === null) url.searchParams.delete(name)
  else url.searchParams.set(name, value)
  return url
}

describe('buildAuthorizationUrl', () => {
  it('targets the simulated authorization endpoint with every parameter', () => {
    expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(demo.authorizationEndpoint)
    expect(Object.fromEntries(authorizationUrl.searchParams)).toEqual({
      response_type: 'code',
      client_id: demo.clientId,
      redirect_uri: demo.redirectUri,
      scope: 'openid profile email',
      state: session.state,
      nonce: session.nonce,
      code_challenge: session.codeChallenge,
      code_challenge_method: 'S256',
    })
  })

  it('never carries the code verifier', () => {
    expect(authorizationUrl.href).not.toContain(session.codeVerifier)
    expect(authorizationUrl.searchParams.has('code_verifier')).toBe(false)
  })
})

describe('parseAuthorizationUrl', () => {
  it('reads back what the app sent', () => {
    expect(parseAuthorizationUrl(authorizationUrl.href)).toEqual({
      ok: true,
      request: {
        clientId: demo.clientId,
        redirectUri: demo.redirectUri,
        scope: demo.scope,
        state: session.state,
        nonce: session.nonce,
        codeChallenge: session.codeChallenge,
      },
    })
  })

  it('refuses an unknown client', () => {
    expect(parseAuthorizationUrl(withParam('client_id', 'other-app'))).toMatchObject({
      ok: false,
      error: 'unauthorized_client',
    })
  })

  it('refuses any redirect_uri that is not exactly the registered one', () => {
    for (const uri of [
      `${demo.redirectUri}/../evil`,
      `${demo.redirectUri}?next=x`,
      'https://evil.example/callback',
    ]) {
      expect(parseAuthorizationUrl(withParam('redirect_uri', uri))).toMatchObject({
        ok: false,
        parameter: 'redirect_uri',
      })
    }
  })

  it('requires PKCE with S256', () => {
    expect(parseAuthorizationUrl(withParam('code_challenge_method', 'plain'))).toMatchObject({
      ok: false,
      parameter: 'code_challenge_method',
    })
    expect(parseAuthorizationUrl(withParam('code_challenge', null))).toMatchObject({
      ok: false,
      parameter: 'code_challenge',
    })
  })

  it('requires the code flow and the openid scope', () => {
    expect(parseAuthorizationUrl(withParam('response_type', 'token'))).toMatchObject({
      ok: false,
      error: 'unsupported_response_type',
    })
    expect(parseAuthorizationUrl(withParam('scope', 'profile email'))).toMatchObject({
      ok: false,
      error: 'invalid_scope',
    })
  })

  it('refuses missing or repeated parameters', () => {
    expect(parseAuthorizationUrl(withParam('state', null))).toMatchObject({ ok: false, parameter: 'state' })
    const repeated = new URL(authorizationUrl)
    repeated.searchParams.append('state', 'second')
    expect(parseAuthorizationUrl(repeated)).toMatchObject({ ok: false, error: 'invalid_request' })
  })
})

describe('checkCallback', () => {
  it('accepts the state the app kept and returns the code', () => {
    const callback = buildCallbackUrl('the-code', session.state)
    expect(callback.href.startsWith(`${demo.redirectUri}?`)).toBe(true)
    expect(checkCallback(callback, session.state)).toEqual({ ok: true, code: 'the-code' })
  })

  it('rejects an altered state (CSRF protection)', () => {
    const altered = `${session.state.slice(0, -1)}${session.state.endsWith('x') ? 'y' : 'x'}`
    expect(checkCallback(buildCallbackUrl('the-code', altered), session.state)).toEqual({
      ok: false,
      reason: 'state_mismatch',
    })
  })

  it('rejects a callback without state', () => {
    expect(checkCallback(buildCallbackUrl('the-code', ''), session.state)).toEqual({
      ok: false,
      reason: 'state_missing',
    })
    expect(checkCallback(`${demo.redirectUri}?code=the-code`, session.state)).toEqual({
      ok: false,
      reason: 'state_missing',
    })
  })

  it('rejects an error response or a response without code', () => {
    const denied = new URL(demo.redirectUri)
    denied.search = new URLSearchParams({ error: 'access_denied', state: session.state }).toString()
    expect(checkCallback(denied, session.state)).toEqual({ ok: false, reason: 'invalid_response' })
    expect(checkCallback(`${demo.redirectUri}?state=${session.state}`, session.state)).toEqual({
      ok: false,
      reason: 'invalid_response',
    })
  })
})
