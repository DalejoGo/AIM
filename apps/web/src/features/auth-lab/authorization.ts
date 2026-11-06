import { type AuthorizationServer, type Client, validateAuthResponse } from 'oauth4webapi'
import type { ClientSession } from './pkce'

/**
 * The simulated parties. example.com is reserved for documentation (RFC 2606), so these URLs belong to no one;
 * they are only displayed and never requested.
 */
export const demo = {
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  jwksUri: 'https://auth.example.com/.well-known/jwks.json',
  clientId: 'aim-auth-lab',
  clientName: 'Auth Lab de AIM',
  redirectUri: 'https://tuapp.example.com/callback',
  scope: 'openid profile email',
} as const

/** The same parties described with oauth4webapi's types, for its validators. */
export const authorizationServer: AuthorizationServer = {
  issuer: demo.issuer,
  authorization_endpoint: demo.authorizationEndpoint,
  token_endpoint: demo.tokenEndpoint,
  jwks_uri: demo.jwksUri,
  id_token_signing_alg_values_supported: ['ES256'],
}

export const client: Client = { client_id: demo.clientId, id_token_signed_response_alg: 'ES256' }

/** Step 2: the URL the app redirects your browser to. Only the challenge travels, never the verifier. */
export function buildAuthorizationUrl(session: ClientSession): URL {
  const url = new URL(demo.authorizationEndpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: demo.clientId,
    redirect_uri: demo.redirectUri,
    scope: demo.scope,
    state: session.state,
    nonce: session.nonce,
    code_challenge: session.codeChallenge,
    code_challenge_method: 'S256',
  }).toString()
  return url
}

export interface AuthorizationRequest {
  clientId: string
  redirectUri: string
  scope: string
  state: string
  nonce: string
  codeChallenge: string
}

export type AuthorizationError =
  | 'invalid_request'
  | 'unauthorized_client'
  | 'unsupported_response_type'
  | 'invalid_scope'

export type ParsedAuthorization =
  | { ok: true; request: AuthorizationRequest }
  | { ok: false; error: AuthorizationError; parameter: string }

const REQUIRED = [
  'response_type',
  'client_id',
  'redirect_uri',
  'scope',
  'state',
  'nonce',
  'code_challenge',
  'code_challenge_method',
] as const

/** Server side of step 2: reads the request and refuses anything a registered public client would not send. */
export function parseAuthorizationUrl(input: URL | string): ParsedAuthorization {
  const params = new URL(input).searchParams
  for (const name of REQUIRED) {
    if (params.getAll(name).length !== 1 || !params.get(name)) {
      return { ok: false, error: 'invalid_request', parameter: name }
    }
  }
  const get = (name: (typeof REQUIRED)[number]) => params.get(name) ?? ''
  if (get('client_id') !== demo.clientId)
    return { ok: false, error: 'unauthorized_client', parameter: 'client_id' }
  // Exact match only: a loose comparison here is how authorization codes get sent to an attacker's site.
  if (get('redirect_uri') !== demo.redirectUri) {
    return { ok: false, error: 'invalid_request', parameter: 'redirect_uri' }
  }
  if (get('response_type') !== 'code') {
    return { ok: false, error: 'unsupported_response_type', parameter: 'response_type' }
  }
  if (!get('scope').split(' ').includes('openid'))
    return { ok: false, error: 'invalid_scope', parameter: 'scope' }
  // Public clients must use PKCE with S256; "plain" would send the secret itself.
  if (get('code_challenge_method') !== 'S256') {
    return { ok: false, error: 'invalid_request', parameter: 'code_challenge_method' }
  }
  return {
    ok: true,
    request: {
      clientId: get('client_id'),
      redirectUri: get('redirect_uri'),
      scope: get('scope'),
      state: get('state'),
      nonce: get('nonce'),
      codeChallenge: get('code_challenge'),
    },
  }
}

/** Step 4: where the server sends your browser back after you accept. */
export function buildCallbackUrl(code: string, state: string): URL {
  const url = new URL(demo.redirectUri)
  url.search = new URLSearchParams({ code, state }).toString()
  return url
}

export type CallbackCheck =
  | { ok: true; code: string }
  | { ok: false; reason: 'state_missing' | 'state_mismatch' | 'invalid_response' }

/** App side of step 4: oauth4webapi compares the returned state with the one kept in the session. */
export function checkCallback(callback: URL | string, expectedState: string): CallbackCheck {
  const url = new URL(callback)
  try {
    const params = validateAuthResponse(authorizationServer, client, url, expectedState)
    const code = params.get('code')
    return code ? { ok: true, code } : { ok: false, reason: 'invalid_response' }
  } catch {
    if (!url.searchParams.get('state')) return { ok: false, reason: 'state_missing' }
    if (url.searchParams.get('state') !== expectedState) return { ok: false, reason: 'state_mismatch' }
    return { ok: false, reason: 'invalid_response' }
  }
}
