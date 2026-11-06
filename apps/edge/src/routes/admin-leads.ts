import { type LeadPage, LeadStatus, UpdateLeadStatus } from '@aim/contracts'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { z } from 'zod'
import { recordAudit } from '../audit'
import { requireScope } from '../auth/middleware'
import type { AppEnv } from '../deps'
import { decodeCursor, encodeCursor } from '../leads/cursor'
import { listLeads, updateLeadStatus } from '../leads/repository'
import { fail, validate } from '../lib/http'

export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

const ListQuery = z.object({
  status: LeadStatus.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
})

/** The id is checked before it reaches Postgres, which would fail on a malformed uuid. */
const validLeadId = zValidator('param', z.object({ id: z.uuid() }), (result, c) => {
  if (result.success) return
  return fail(
    c,
    400,
    'invalid_id',
    'El identificador del contacto no es válido. Vuelve a abrirlo desde la lista de contactos.',
  )
})

/** GET /api/admin/leads, PATCH /api/admin/leads/:id */
export const adminLeadRoutes = new Hono<AppEnv>()

adminLeadRoutes.get('/', requireScope('leads:read'), validate('query', ListQuery), async (c) => {
  const { status, cursor, limit } = c.req.valid('query')
  const after = cursor === undefined ? undefined : decodeCursor(cursor)
  if (after === null) {
    return fail(
      c,
      400,
      'invalid_cursor',
      'El cursor de la página no es válido. Vuelve a cargar la lista desde el principio.',
    )
  }
  const page = await listLeads(await c.var.deps.db(), { status, after, limit })
  const body: LeadPage = { items: page.items, nextCursor: page.next ? encodeCursor(page.next) : null }
  return c.json(body)
})

adminLeadRoutes.patch(
  '/:id',
  requireScope('leads:write'),
  validLeadId,
  validate('json', UpdateLeadStatus),
  async (c) => {
    const { id } = c.req.valid('param')
    const { status } = c.req.valid('json')
    const { db: openDb, now } = c.var.deps
    const db = await openDb()

    const result = await updateLeadStatus(db, id, status)
    if (!result) {
      return fail(c, 404, 'not_found', 'Ese contacto no existe. Vuelve a cargar la lista de contactos.')
    }
    await recordAudit(db, now(), {
      actor: c.var.principal?.sub ?? null,
      action: 'lead.status_changed',
      outcome: 'ok',
      ipHash: c.var.ipHash,
      detail: { leadId: id, from: result.previous, to: status },
    })
    return c.json(result.lead)
  },
)
