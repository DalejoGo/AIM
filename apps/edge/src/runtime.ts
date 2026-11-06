import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { turnstile } from './adapters/captcha'
import { anthropicLlm } from './adapters/llm'
import { mailpitMailer, resendMailer } from './adapters/mail'
import type { ResolveDeps } from './app'
import * as schema from './db/schema'
import type { Db, Mailer } from './deps'
import { EdgeEnv } from './env'

/**
 * Production wiring for Cloudflare Pages Functions. Workers cannot share I/O objects across requests,
 * so each request opens (lazily) and closes its own connection to Neon's pooled endpoint.
 */
export const resolveRuntimeDeps: ResolveDeps = async ({ env: bindings, executionCtx }) => {
  const env = EdgeEnv.parse(bindings)
  let client: Client | undefined
  let db: Db | undefined

  return {
    env,
    async db() {
      if (!db) {
        client = new Client({ connectionString: env.DATABASE_URL })
        await client.connect()
        db = drizzle(client, { schema })
      }
      return db
    },
    mailer: pickMailer(env),
    captcha: turnstile(env.TURNSTILE_SECRET),
    // Optional: without the key the assistant answers 503 and nothing else changes.
    ...(env.ANTHROPIC_API_KEY ? { llm: anthropicLlm({ apiKey: env.ANTHROPIC_API_KEY }) } : {}),
    now: () => new Date(),
    waitUntil: (promise) => executionCtx?.waitUntil(promise),
    async dispose() {
      await client?.end()
    },
  }
}

function pickMailer(env: EdgeEnv): Mailer {
  if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
  if (env.MAILPIT_URL) return mailpitMailer(env.MAILPIT_URL, env.MAIL_FROM)
  throw new Error('Configure RESEND_API_KEY (production) or MAILPIT_URL (local)')
}
