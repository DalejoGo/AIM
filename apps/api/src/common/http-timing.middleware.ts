import { Logger } from '@nestjs/common'
import type { NextFunction, Request, Response } from 'express'
import { pathOf } from './request-path.js'

export const RESPONSE_TIME_HEADER = 'X-Response-Time'

/**
 * Express middleware, mounted first: sets `X-Response-Time` right before the headers go out (also on errors,
 * 404s and 429s) and logs one line per request with method, path, status and duration. No body, no query.
 */
export function httpTiming(logger = new Logger('HTTP')) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = process.hrtime.bigint()
    const elapsedMs = () => Number(process.hrtime.bigint() - start) / 1e6

    const writeHead = res.writeHead
    res.writeHead = function (this: Response, ...args: unknown[]) {
      if (!this.headersSent) this.setHeader(RESPONSE_TIME_HEADER, `${elapsedMs().toFixed(1)}ms`)
      return writeHead.apply(this, args as Parameters<Response['writeHead']>)
    } as Response['writeHead']

    res.once('finish', () => {
      const line = `${req.method} ${pathOf(req)} ${res.statusCode} ${elapsedMs().toFixed(1)}ms`
      if (res.statusCode >= 500) logger.error(line)
      else if (res.statusCode >= 400) logger.warn(line)
      else logger.log(line)
    })
    next()
  }
}
