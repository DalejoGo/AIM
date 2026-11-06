import { describe, expect, it } from 'vitest'
import { ATTACKER_EMAIL, createAuthLab } from './store'

const NOW = 1_800_000_000

/** A lab already walked up to the given step along the happy path. */
async function labAt(step: 2 | 3 | 4 | 5 | 6) {
  const lab = createAuthLab({ now: () => NOW })
  await lab.start()
  await lab.next()
  if (step >= 3) await lab.next()
  if (step >= 4) await lab.approve()
  if (step >= 5) await lab.next()
  if (step >= 6) await lab.next()
  expect(lab.step.value).toBe(step)
  return lab
}

const failingChecks = (lab: Awaited<ReturnType<typeof labAt>>) =>
  lab.verdict.value?.checks.filter((c) => !c.ok).map((c) => c.id)

describe('createAuthLab', () => {
  it('waits for real values before letting you leave step 1', async () => {
    const lab = createAuthLab({ now: () => NOW })
    expect(lab.canAdvance.value).toBe(false)
    await lab.next()
    expect(lab.step.value).toBe(1)
    await lab.start()
    expect(lab.session.value?.codeVerifier).toBeTruthy()
    expect(lab.authorizationUrl.value?.searchParams.get('code_challenge')).toBe(
      lab.session.value?.codeChallenge,
    )
    expect(lab.canAdvance.value).toBe(true)
  })

  it('needs your consent before the server redirects you back', async () => {
    const lab = await labAt(3)
    expect(lab.canAdvance.value).toBe(false)
    await lab.next()
    expect(lab.step.value).toBe(3)
    await lab.approve()
    expect(lab.step.value).toBe(4)
    expect(lab.callbackUrl.value?.searchParams.get('code')).toBe(lab.grant.value?.code)
    expect(lab.stateCheck.value).toMatchObject({ ok: true })
  })

  it('stops the flow when the state is altered and resumes when restored', async () => {
    const lab = await labAt(4)
    lab.tamperState()
    expect(lab.stateCheck.value).toEqual({ ok: false, reason: 'state_mismatch' })
    expect(lab.canAdvance.value).toBe(false)
    await lab.next()
    expect(lab.step.value).toBe(4)
    lab.setReceivedState('')
    expect(lab.stateCheck.value).toEqual({ ok: false, reason: 'state_missing' })
    lab.restoreState()
    expect(lab.canAdvance.value).toBe(true)
  })

  it('stops the exchange when the verifier is altered', async () => {
    const lab = await labAt(5)
    expect(lab.pkce.value).toMatchObject({ ok: true, computed: lab.session.value?.codeChallenge })
    await lab.tamperVerifier()
    expect(lab.pkce.value).toMatchObject({ ok: false, reason: 'mismatch' })
    expect(lab.canAdvance.value).toBe(false)
    await lab.next()
    expect(lab.step.value).toBe(5)
    expect(lab.tokens.value).toBeNull()
    await lab.setVerifier('short')
    expect(lab.pkce.value).toMatchObject({ ok: false, reason: 'malformed' })
    await lab.restoreVerifier()
    await lab.next()
    expect(lab.step.value).toBe(6)
  })

  it('verifies the id_token and catches every kind of tampering', async () => {
    const lab = await labAt(6)
    expect(lab.verdict.value?.ok).toBe(true)
    const original = lab.idToken.value

    await lab.tamperEmail()
    expect(lab.decodedIdToken.value?.payload.email).toBe(ATTACKER_EMAIL)
    expect(lab.payloadText.value).toContain(ATTACKER_EMAIL)
    expect(failingChecks(lab)).toEqual(['signature'])

    await lab.replayForeignToken()
    expect(failingChecks(lab)).toEqual(['nonce'])

    await lab.restoreIdToken()
    expect(lab.idToken.value).toBe(original)
    expect(lab.verdict.value?.ok).toBe(true)
  })

  it('treats hand edits of the payload like an attacker would', async () => {
    const lab = await labAt(6)
    const original = lab.idToken.value
    const pretty = lab.payloadText.value

    await lab.editPayload(pretty.replace(/\n\s*/g, ''))
    expect(lab.idToken.value).toBe(original)
    expect(lab.verdict.value?.ok).toBe(true)

    await lab.editPayload(pretty.replace('Ana Ejemplo', 'Ana Atacante'))
    expect(failingChecks(lab)).toEqual(['signature'])

    await lab.editPayload('{ "email": ')
    expect(failingChecks(lab)).toEqual(['format'])
  })

  it('moves back without losing progress and counts every move', async () => {
    const lab = await labAt(5)
    const moves = lab.moves.value
    lab.previous()
    expect(lab.step.value).toBe(4)
    expect(lab.moves.value).toBe(moves + 1)
    await lab.next()
    expect(lab.step.value).toBe(5)
  })

  it('starts over with new values on reset', async () => {
    const lab = await labAt(6)
    const before = lab.session.value
    await lab.reset()
    expect(lab.step.value).toBe(1)
    expect(lab.grant.value).toBeNull()
    expect(lab.tokens.value).toBeNull()
    expect(lab.verdict.value).toBeNull()
    expect(lab.session.value?.codeVerifier).not.toBe(before?.codeVerifier)
    expect(lab.session.value?.state).not.toBe(before?.state)
  })
})
