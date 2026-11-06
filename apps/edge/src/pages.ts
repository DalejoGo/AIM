import { handle } from 'hono/cloudflare-pages'
import { createApp } from './app'
import { resolveRuntimeDeps } from './runtime'

/** Entry for Cloudflare Pages Functions: apps/web/functions/api/[[route]].ts re-exports it. */
export const onRequest = handle(createApp(resolveRuntimeDeps))
