import { Hono } from 'hono'
import { AuditQuery, decodeCursor, listAudit } from '../auth/audit-page'
import { requireScope } from '../auth/middleware'
import type { AppEnv } from '../deps'
import { fail, validate } from '../lib/http'

/** GET /api/admin/audit?cursor=&limit= — newest first; never exposes IP hashes or details. */
export const auditRoutes = new Hono<AppEnv>()

auditRoutes.get('/', requireScope('audit:read'), validate('query', AuditQuery), async (c) => {
  const { cursor, limit } = c.req.valid('query')
  const decoded = cursor ? decodeCursor(cursor) : null
  if (cursor && !decoded) {
    return fail(
      c,
      400,
      'invalid_cursor',
      'El cursor no es válido. Vuelve a cargar la lista desde el principio.',
    )
  }
  const db = await c.var.deps.db()
  return c.json(await listAudit(db, { cursor: decoded, limit }))
})
