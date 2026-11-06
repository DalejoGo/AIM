/**
 * Where the API Playground lives (NestJS on Render, DEC-014). The URL comes from PUBLIC_PLAYGROUND_API_URL at
 * build time (CLAUDE.md rule 4: no host in the code); the CSP adds the same origin to connect-src.
 */

/** Base URL without trailing slashes, or `null` when it is missing or not an absolute http(s) URL. */
export function playgroundApiUrl(raw: string | undefined | null): string | null {
  const text = raw?.trim()
  if (!text) return null
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.search || url.hash || url.username || url.password) return null
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/** Swagger UI of the API. */
export const docsUrl = (apiUrl: string) => `${apiUrl}/docs`

/** The prefix of every Tareas endpoint. */
export const TASKS_PATH = '/api/v1/tasks'

/** Header that picks the visitor's sandbox (apps/api/src/sandbox/sandbox.guard.ts). */
export const SANDBOX_HEADER = 'X-Sandbox-Id'
