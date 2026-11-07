import type { N8n } from '../deps'

/** One health check: a sleeping Render service may hold the request while it boots, so it is cut short. */
export const N8N_HEALTH_TIMEOUT_MS = 5_000
/** The webhook: n8n answers 202 as soon as it queues the flow, but the first call after waking took 6–8 s on Render Free. */
export const N8N_WEBHOOK_TIMEOUT_MS = 30_000

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

export interface HttpN8nOptions {
  /** AUTOMATION_N8N_URL, without a trailing slash. */
  baseUrl: string
  /** AUTOMATION_WEBHOOK_PATH. */
  webhookPath: string
  /** Injected in tests, which count every call (the Worker's subrequest budget). */
  fetch?: Fetch
}

/** Reads nothing of the answer but its status and type, and frees the connection. */
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {})
}

const within = (signal: AbortSignal, ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)])

/**
 * n8n over HTTP. Redirects are not followed: each one would be another subrequest, and n8n's own endpoints
 * never redirect (a redirect means a proxy page, so n8n is not ready).
 */
export function httpN8n({
  baseUrl,
  webhookPath,
  fetch: fetchImpl = (url, init) => fetch(url, init),
}: HttpN8nOptions): N8n {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    async healthy(signal) {
      try {
        // /healthz answers ~15 s before the webhook is registered; /healthz/readiness only once it is.
        const response = await fetchImpl(`${base}/healthz/readiness`, {
          method: 'GET',
          headers: { accept: 'application/json' },
          redirect: 'manual',
          signal: within(signal, N8N_HEALTH_TIMEOUT_MS),
        })
        await discard(response)
        const type = response.headers.get('content-type') ?? ''
        return response.status === 200 && !type.includes('html')
      } catch {
        return false
      }
    },

    async trigger(payload, signal) {
      try {
        const response = await fetchImpl(`${base}/webhook/${webhookPath}`, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify(payload),
          redirect: 'manual',
          signal: within(signal, N8N_WEBHOOK_TIMEOUT_MS),
        })
        await discard(response)
        // Only n8n's own "queued" answer counts: while booting it may answer 200 "n8n is starting up" or 404.
        return response.status === 202
      } catch {
        return false
      }
    },
  }
}
