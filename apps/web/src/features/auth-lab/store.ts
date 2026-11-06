import { batch, computed, signal } from '@preact/signals'
import { generateRandomCodeVerifier, generateRandomNonce, generateRandomState } from 'oauth4webapi'
import {
  buildAuthorizationUrl,
  buildCallbackUrl,
  checkCallback,
  demo,
  parseAuthorizationUrl,
} from './authorization'
import { type IdTokenVerdict, verifyIdToken } from './idToken'
import { decodeJwt, withPayload } from './jwt'
import { type ClientSession, createClientSession, type PkceCheck, verifyPkce } from './pkce'
import {
  type AuthorizationGrant,
  createIdTokenClaims,
  createSigningKey,
  exchangeCode,
  issueGrant,
  type SigningKey,
  signIdToken,
  type TokenResponse,
} from './server'

export const STEPS = [1, 2, 3, 4, 5, 6] as const
export type Step = (typeof STEPS)[number]

/** The address an attacker would rather see in the token, used by the tampering demo. */
export const ATTACKER_EMAIL = 'admin@example.com'

/** The payload as indented JSON for the editor, or nothing when the token cannot be read. */
function prettyPayload(token: string): string {
  try {
    return JSON.stringify(decodeJwt(token).payload, null, 2)
  } catch {
    return ''
  }
}

/** Re-serialises edited JSON compactly, so reformatting alone does not change the token; anything else is kept. */
function compact(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text))
  } catch {
    return text
  }
}

/**
 * State of the walkthrough. No DOM: the island renders it, the tests drive it.
 * Every async result is tagged with a run number so a slow answer never overwrites a newer one.
 */
export function createAuthLab({ now = () => Math.floor(Date.now() / 1000) } = {}) {
  const step = signal<Step>(1)
  /** Increments on every move between steps, so the island knows when to move focus. */
  const moves = signal(0)
  const busy = signal(false)

  const session = signal<ClientSession | null>(null)
  const signingKey = signal<SigningKey | null>(null)
  const grant = signal<AuthorizationGrant | null>(null)
  const receivedState = signal('')
  const sentVerifier = signal('')
  const pkce = signal<PkceCheck | null>(null)
  const tokens = signal<TokenResponse | null>(null)
  const idToken = signal('')
  const payloadText = signal('')
  const verdict = signal<IdTokenVerdict | null>(null)

  const authorizationUrl = computed(() => (session.value ? buildAuthorizationUrl(session.value) : null))
  const callbackUrl = computed(() =>
    grant.value ? buildCallbackUrl(grant.value.code, receivedState.value) : null,
  )
  const stateCheck = computed(() =>
    session.value && callbackUrl.value ? checkCallback(callbackUrl.value, session.value.state) : null,
  )
  const decodedIdToken = computed(() => {
    try {
      return decodeJwt(idToken.value)
    } catch {
      return null
    }
  })

  /** Whether the current step lets you move on: the security checks really stop the flow. */
  const canAdvance = computed(() => {
    if (busy.value) return false
    switch (step.value) {
      case 1:
        return session.value !== null && signingKey.value !== null
      case 2:
        return authorizationUrl.value !== null
      case 3:
        return grant.value !== null
      case 4:
        return stateCheck.value?.ok === true
      case 5:
        return pkce.value?.ok === true
      default:
        return false
    }
  })

  let generation = 0
  let pkceRun = 0
  let verifyRun = 0

  function go(target: Step) {
    batch(() => {
      step.value = target
      moves.value++
    })
  }

  /** Creates a fresh session and server key, dropping everything that depended on the old ones. */
  async function regenerate() {
    const run = ++generation
    batch(() => {
      session.value = null
      signingKey.value = null
      grant.value = null
      receivedState.value = ''
      sentVerifier.value = ''
      pkce.value = null
      tokens.value = null
      idToken.value = ''
      payloadText.value = ''
      verdict.value = null
      busy.value = false
    })
    const [nextSession, nextKey] = await Promise.all([createClientSession(), createSigningKey()])
    if (run !== generation) return
    batch(() => {
      session.value = nextSession
      signingKey.value = nextKey
    })
  }

  async function reset() {
    go(1)
    await regenerate()
  }

  function previous() {
    if (step.value > 1) go((step.value - 1) as Step)
  }

  async function next() {
    if (!canAdvance.value) return
    if (step.value === 5 && !tokens.value && !(await exchange())) return
    if (step.value < 6) go((step.value + 1) as Step)
  }

  /** Step 3: you accept, the server validates the request it received and issues a code. */
  async function approve() {
    const current = session.value
    const url = authorizationUrl.value
    if (!current || !url || grant.value) return
    const parsed = parseAuthorizationUrl(url)
    if (!parsed.ok) return
    batch(() => {
      grant.value = issueGrant(parsed.request)
      receivedState.value = current.state
      sentVerifier.value = current.codeVerifier
    })
    go(4)
    await checkVerifier()
  }

  function setReceivedState(value: string) {
    receivedState.value = value
  }

  function setVerifier(value: string) {
    sentVerifier.value = value
    return checkVerifier()
  }

  /** The server's PKCE check, previewed live while you edit the verifier. */
  async function checkVerifier() {
    const current = grant.value
    if (!current) return
    const run = ++pkceRun
    const result = await verifyPkce(sentVerifier.value, current.request.codeChallenge)
    if (run === pkceRun) pkce.value = result
  }

  async function exchange(): Promise<boolean> {
    const current = grant.value
    const key = signingKey.value
    if (!current || !key) return false
    busy.value = true
    try {
      const result = await exchangeCode(
        current,
        {
          grant_type: 'authorization_code',
          code: current.code,
          redirect_uri: demo.redirectUri,
          client_id: demo.clientId,
          code_verifier: sentVerifier.value,
        },
        key,
        now(),
      )
      if (!result.ok || grant.value !== current) return false
      tokens.value = result.response
      await showIdToken(result.response.id_token)
      return true
    } finally {
      busy.value = false
    }
  }

  async function showIdToken(token: string) {
    batch(() => {
      idToken.value = token
      payloadText.value = prettyPayload(token)
    })
    await verify()
  }

  /** The app's checks on whatever id_token is on screen, original or tampered. */
  async function verify() {
    const current = session.value
    const key = signingKey.value
    if (!current || !key || !idToken.value) return
    const run = ++verifyRun
    const result = await verifyIdToken(idToken.value, {
      publicKey: key.publicKey,
      issuer: demo.issuer,
      audience: demo.clientId,
      nonce: current.nonce,
      now: now(),
    })
    if (run === verifyRun) verdict.value = result
  }

  /** You edit the payload by hand: header and signature stay, as they would for an attacker. */
  async function editPayload(text: string) {
    if (!idToken.value) return
    batch(() => {
      payloadText.value = text
      idToken.value = withPayload(idToken.value, compact(text))
    })
    await verify()
  }

  async function tamperEmail() {
    const decoded = decodedIdToken.value
    if (!decoded) return
    await showIdToken(
      withPayload(idToken.value, JSON.stringify({ ...decoded.payload, email: ATTACKER_EMAIL })),
    )
  }

  /** A genuine token, correctly signed, but issued for another login: only the nonce gives it away. */
  async function replayForeignToken() {
    const current = grant.value
    const key = signingKey.value
    if (!current || !key) return
    const claims = { ...createIdTokenClaims(current, now()), nonce: generateRandomNonce() }
    await showIdToken(await signIdToken(claims, key))
  }

  async function restoreIdToken() {
    if (tokens.value) await showIdToken(tokens.value.id_token)
  }

  return {
    step,
    moves,
    busy,
    session,
    signingKey,
    grant,
    receivedState,
    sentVerifier,
    pkce,
    tokens,
    idToken,
    payloadText,
    verdict,
    authorizationUrl,
    callbackUrl,
    stateCheck,
    decodedIdToken,
    canAdvance,
    start: regenerate,
    regenerate,
    reset,
    previous,
    next,
    approve,
    setReceivedState,
    tamperState: () => setReceivedState(generateRandomState()),
    restoreState: () => setReceivedState(session.value?.state ?? ''),
    setVerifier,
    tamperVerifier: () => setVerifier(generateRandomCodeVerifier()),
    restoreVerifier: () => setVerifier(session.value?.codeVerifier ?? ''),
    editPayload,
    tamperEmail,
    replayForeignToken,
    restoreIdToken,
  }
}

export type AuthLabStore = ReturnType<typeof createAuthLab>
