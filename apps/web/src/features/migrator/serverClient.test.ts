import type { MigrationResponse, PyLabHealth } from '@aim/contracts/migrator'
import { describe, expect, it, vi } from 'vitest'
import { runMigration } from './pipeline'
import { SAMPLE_CSV } from './sample'
import { type Fetch, fetchHealth, postMigration } from './serverClient'

const API = 'https://pylab.test'

const HEALTH: PyLabHealth = {
  status: 'ok',
  version: '0.1.0',
  limits: {
    maxUploadBytes: 10 * 1024 * 1024,
    maxRows: 50_000,
    maxColumns: 50,
    maxCells: 300_000,
    formats: ['csv', 'xls', 'xlsx'],
  },
}

function migrationResponse(): MigrationResponse {
  const outcome = runMigration(SAMPLE_CSV)
  if (!outcome.ok) throw new Error(outcome.error)
  return {
    result: outcome.result,
    meta: {
      source: {
        name: 'clientes.csv',
        bytes: 3115,
        format: 'csv',
        encoding: { name: 'utf-8', detectedBy: 'utf-8' },
        sheet: null,
        sheets: [],
      },
      timings: { readMs: 2.1, processMs: 4.3, totalMs: 6.4 },
      engine: { name: 'py-lab', version: '0.1.0', python: '3.12.15' },
    },
  }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** A clock that advances 25 ms on every reading. */
function clock() {
  let now = 0
  return () => {
    now += 25
    return now
  }
}

describe('fetchHealth', () => {
  it('returns the limits of a healthy server', async () => {
    const fetchImpl = vi.fn<Fetch>(async () => json(HEALTH))
    const outcome = await fetchHealth(API, { fetchImpl, clock: clock() })
    expect(outcome).toEqual({ kind: 'ok', data: HEALTH, totalMs: 25 })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://pylab.test/health',
      expect.objectContaining({ method: 'GET', credentials: 'omit', mode: 'cors', cache: 'no-store' }),
    )
  })

  it('treats an answer with another shape as invalid', async () => {
    const outcome = await fetchHealth(API, { fetchImpl: async () => json({ status: 'ok' }) })
    expect(outcome?.kind).toBe('invalid')
  })
})

describe('postMigration', () => {
  it('sends the file and the sheet as multipart and returns the checked answer', async () => {
    const answer = migrationResponse()
    let sent: FormData | null = null
    const fetchImpl: Fetch = async (url, init) => {
      expect(url).toBe('https://pylab.test/v1/migrations')
      expect(init.method).toBe('POST')
      sent = init.body as FormData
      return json(answer)
    }
    const file = new File(['a;b\n1;2\n'], 'libro.xlsx')
    const outcome = await postMigration(API, file, 'Proveedores', { fetchImpl })
    expect(outcome).toMatchObject({ kind: 'ok', data: answer })
    const form = sent as FormData | null
    expect(form?.get('file')).toBeInstanceOf(File)
    expect((form?.get('file') as File | undefined)?.name).toBe('libro.xlsx')
    expect(form?.get('sheet')).toBe('Proveedores')
  })

  it('leaves the sheet out for the default one', async () => {
    let sent: FormData | null = null
    await postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: async (_, init) => {
        sent = init.body as FormData
        return json(migrationResponse())
      },
    })
    expect((sent as FormData | null)?.has('sheet')).toBe(false)
  })

  it('rejects a 200 whose body breaks the contract', async () => {
    const broken = migrationResponse()
    const row = broken.result.valid[0]
    if (row) row.rowNumber = 0
    const outcome = await postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: async () => json(broken),
    })
    expect(outcome?.kind).toBe('invalid')
  })

  it('keeps the error body and Retry-After of a refusal', async () => {
    const outcome = await postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: async () =>
        json(
          { error: 'rate_limited', message: 'Hiciste demasiadas peticiones. Intenta de nuevo en 42 s.' },
          429,
          {
            'Retry-After': '42',
          },
        ),
    })
    expect(outcome).toMatchObject({
      kind: 'error',
      status: 429,
      retryAfter: 42,
      error: { error: 'rate_limited', message: 'Hiciste demasiadas peticiones. Intenta de nuevo en 42 s.' },
    })
  })

  it('has a Spanish message when an error is not the API error shape (a proxy page)', async () => {
    const outcome = await postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: async () => new Response('<h1>502 Bad Gateway</h1>', { status: 502 }),
    })
    expect(outcome).toMatchObject({ kind: 'error', status: 502, error: { error: 'unknown' } })
  })

  it('tells a dropped connection from a timeout and from a cancel', async () => {
    const network = await postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    expect(network?.kind).toBe('network')

    const hang: Fetch = (_, init) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    const timeout = await postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: hang,
      timeoutMs: 10,
    })
    expect(timeout?.kind).toBe('timeout')

    const visitor = new AbortController()
    const pending = postMigration(API, new File(['x'], 'a.csv'), null, {
      fetchImpl: hang,
      signal: visitor.signal,
    })
    visitor.abort()
    expect(await pending).toBeNull()
  })
})
