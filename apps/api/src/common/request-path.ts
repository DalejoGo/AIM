import type { Request } from 'express'

/** Path without the query string: queries can carry what the visitor typed (`q`), which is never logged. */
export function pathOf(req: Request): string {
  return req.originalUrl.split('?')[0] ?? '/'
}
