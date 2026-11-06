import type { INestApplication } from '@nestjs/common'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

describe('API', () => {
  let app: INestApplication

  beforeAll(async () => {
    app = await createApp({ logger: false })
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /api/v1/health answers ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200)
    expect(res.body).toMatchObject({ status: 'ok' })
    expect(typeof res.body.uptimeSeconds).toBe('number')
  })

  it('serves the OpenAPI document', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200)
    expect(res.body.info.title).toBe('AIM API')
    expect(Object.keys(res.body.paths)).toContain('/api/v1/health')
  })
})
