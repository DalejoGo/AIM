import type { LabBurstResult } from '@aim/contracts'
import { Hono } from 'hono'
import type { AppEnv } from '../deps'
import { takeBurstSlot } from '../lab/burst'
import { fail } from '../lib/http'

/** Live demos of the Lab (DEC-011) that need the server. */
export const labRoutes = new Hono<AppEnv>()

const seconds = (n: number) => `${n} ${n === 1 ? 'segundo' : 'segundos'}`

/**
 * GET /api/lab/burst — "Seguridad en acción": a real rate limit per visitor (IP hash), LAB_BURST_LIMIT requests
 * every LAB_BURST_WINDOW_SECONDS. Every answer carries the RateLimit-* fields of the IETF draft
 * (draft-ietf-httpapi-ratelimit-headers); past the limit, 429 with Retry-After.
 */
labRoutes.get('/burst', async (c) => {
  const deps = c.var.deps
  const policy = { limit: deps.env.LAB_BURST_LIMIT, windowSeconds: deps.env.LAB_BURST_WINDOW_SECONDS }
  const decision = await takeBurstSlot(await deps.db(), { ipHash: c.var.ipHash, now: deps.now(), policy })

  c.header('RateLimit-Policy', `${policy.limit};w=${policy.windowSeconds}`)
  c.header('RateLimit-Limit', String(decision.limit))
  c.header('RateLimit-Remaining', String(decision.remaining))
  c.header('RateLimit-Reset', String(decision.resetInSeconds))

  if (!decision.allowed) {
    c.header('Retry-After', String(decision.resetInSeconds))
    return fail(
      c,
      429,
      'rate_limited',
      `Llegaste al límite de ${policy.limit} peticiones cada ${seconds(policy.windowSeconds)}. Vuelve a intentarlo en ${seconds(decision.resetInSeconds)}.`,
    )
  }
  const body: LabBurstResult = {
    ok: true,
    remaining: decision.remaining,
    resetInSeconds: decision.resetInSeconds,
  }
  return c.json(body)
})
