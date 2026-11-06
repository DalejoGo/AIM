import { z } from 'zod'

/** Limits of the per-visitor sandboxes used by the API Playground. */
export interface SandboxLimits {
  /** A sandbox unused for this long is dropped and starts over with the sample tasks. */
  ttlMs: number
  /** Most sandboxes kept in memory; past it the least recently used one is dropped. */
  maxSandboxes: number
  maxTasksPerSandbox: number
}

export interface ApiConfig {
  port: number
  corsOrigins: string[]
  rateLimit: { limit: number; ttlMs: number }
  sandbox: SandboxLimits
}

export const SANDBOX_LIMITS = Symbol('SandboxLimits')

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  ttlMs: 30 * 60_000,
  maxSandboxes: 500,
  maxTasksPerSandbox: 50,
}

const Env = z.object({
  // Render sets PORT; API_PORT is the local name (.env.example).
  PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  API_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  API_CORS_ORIGINS: z.string().optional(),
  // Requests per minute per client IP. Tests lower it to check the 429.
  API_RATE_LIMIT: z.coerce.number().int().min(1).default(60),
})

/** Reads the API configuration from environment variables. Throws on invalid values so a bad deploy fails fast. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const parsed = Env.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    throw new Error(`Invalid API environment: ${problems.join('; ')}`)
  }
  const { PORT, API_PORT, API_CORS_ORIGINS, API_RATE_LIMIT } = parsed.data
  return {
    port: PORT ?? API_PORT ?? 3000,
    corsOrigins: (API_CORS_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimit: { limit: API_RATE_LIMIT, ttlMs: 60_000 },
    sandbox: DEFAULT_SANDBOX_LIMITS,
  }
}
