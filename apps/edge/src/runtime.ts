import { drizzle } from 'drizzle-orm/node-postgres'
import { Client } from 'pg'
import { turnstile } from './adapters/captcha'
import { anthropicLlm } from './adapters/llm'
import { mailpitMailer, resendMailer } from './adapters/mail'
import { WORKERS_AI_DEFAULT_MODEL, type WorkersAi, workersAiLlm } from './adapters/workers-ai'
import type { ResolveDeps } from './app'
import * as schema from './db/schema'
import type { Db, Llm, Mailer } from './deps'
import { EdgeEnv } from './env'

/**
 * Production wiring for Cloudflare Pages Functions. Workers cannot share I/O objects across requests,
 * so each request opens (lazily) and closes its own connection to Neon's pooled endpoint.
 */
export const resolveRuntimeDeps: ResolveDeps = async ({ env: bindings, executionCtx }) => {
  const env = EdgeEnv.parse(bindings)
  const assistant = pickAssistant(env, bindings)
  if (assistant) env.ASSISTANT_MODEL = assistant.model
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
    // Optional: without a model the assistant answers 503 and nothing else changes.
    ...(assistant ? { llm: assistant.llm } : {}),
    now: () => new Date(),
    waitUntil: (promise) => executionCtx?.waitUntil(promise),
    async dispose() {
      await client?.end()
    },
  }
}

/**
 * Lab assistant model (DEC-018): Claude when ANTHROPIC_API_KEY is set, otherwise the free Workers AI model through
 * the `AI` binding. ASSISTANT_MODEL overrides the model only when it is set explicitly for that provider.
 */
function pickAssistant(env: EdgeEnv, bindings: unknown): { llm: Llm; model: string } | undefined {
  const raw = (bindings ?? {}) as { AI?: WorkersAi; ASSISTANT_MODEL?: string }
  if (env.ANTHROPIC_API_KEY) {
    return { llm: anthropicLlm({ apiKey: env.ANTHROPIC_API_KEY }), model: env.ASSISTANT_MODEL }
  }
  if (raw.AI) {
    const model = raw.ASSISTANT_MODEL?.startsWith('@cf/') ? raw.ASSISTANT_MODEL : WORKERS_AI_DEFAULT_MODEL
    return { llm: workersAiLlm(raw.AI), model }
  }
  return undefined
}

function pickMailer(env: EdgeEnv): Mailer {
  if (env.RESEND_API_KEY) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM)
  if (env.MAILPIT_URL) return mailpitMailer(env.MAILPIT_URL, env.MAIL_FROM)
  throw new Error('Configure RESEND_API_KEY (production) or MAILPIT_URL (local)')
}
