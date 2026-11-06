import { Hono } from 'hono'
import type { AppEnv } from '../deps'
import { adminLeadRoutes } from './admin-leads'
import { auditRoutes } from './audit'

/** /api/admin/* — every sub-router protects itself with requireScope (src/auth/middleware.ts). */
export const adminRoutes = new Hono<AppEnv>()
adminRoutes.route('/leads', adminLeadRoutes)
adminRoutes.route('/audit', auditRoutes)
