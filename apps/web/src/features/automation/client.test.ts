import { describe, expect, it } from 'vitest'
import { type RunEvent, type RunRequest, runAutomation } from './client'
import { TEXTS, toProblem } from './errors'
import { EVENTS } from './fixtures'

const REQUEST: RunRequest = {
  turnstileToken: 'turnstile-token',
  lead: {
    name: 'Laura Pérez',
    email: 'laura@cafelamontana.co',
    service: 'automation',
    budget: '500-2000',
    timeline: 'month',
    message: 'Queremos que los pedidos de WhatsApp lleguen solos a una hoja.',
  },
}

const RUN_ID = '0b7c6a2e-5f1d-4c3a-9e8b-7a6d5c4b3a21'

const sse = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let index = 0
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk === undefined) controller.close()
      else controller.enqueue(encoder.encode(chunk))
    },
  })
}

const eventStream = (chunks: string[]) =>
  new Response(streamOf(chunks), {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

async function run(reply: () => Response | Promise<Response>, signal = new AbortController().signal) {
  const events: RunEvent[] = []
  const calls: { path: string; init: RequestInit }[] = []
  const problem = await runAutomation(REQUEST, {
    signal,
    onEvent: (event) => events.push(event),
    fetchImpl: async (path, init) => {
      calls.push({ path, init })
      return reply()
    },
  })
  return { events, calls, problem }
}

describe('runAutomation', () => {
  it('posts the lead and reports every event of a run until done', async () => {
    const { events, calls, problem } = await run(() =>
      eventStream([
        sse('run', { runId: RUN_ID }),
        ': ping\n\n',
        // A chunk may end anywhere, even inside an event.
        sse('step', EVENTS.received).slice(0, 10),
        sse('step', EVENTS.received).slice(10),
        sse('step', EVENTS.done),
        sse('done', { outcome: 'accepted', totalMs: 0 }),
        sse('step', EVENTS.validated),
      ]),
    )

    expect(problem).toBeNull()
    expect(events).toEqual([
      { type: 'run', runId: RUN_ID },
      { type: 'step', event: EVENTS.received },
      { type: 'step', event: EVENTS.done },
      { type: 'done', outcome: 'accepted', totalMs: 0 },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/automation/runs')
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
    })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(REQUEST)
  })

  it('ignores events it does not know', async () => {
    const { events, problem } = await run(() =>
      eventStream([
        sse('run', { runId: RUN_ID }),
        sse('progress', { x: 1 }),
        sse('done', { outcome: 'rejected', totalMs: 3 }),
      ]),
    )
    expect(problem).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['run', 'done'])
  })

  it('resolves an error event with its message', async () => {
    const message = 'Algo falló de nuestro lado.'
    const { events, problem } = await run(() =>
      eventStream([sse('run', { runId: RUN_ID }), sse('error', { code: 'internal', message })]),
    )
    expect(events).toEqual([{ type: 'run', runId: RUN_ID }])
    expect(problem).toEqual({ kind: 'internal', message, fields: {} })
  })

  it.each([
    ['a step that breaks the contract', sse('step', { step: 'scored', data: { score: 400 }, atMs: 1 })],
    ['data that is not JSON', 'event: run\ndata: {nope\n\n'],
    ['an unknown error code', sse('error', { code: 'boom', message: 'x' })],
    [
      'a received step of the old n8n protocol',
      sse('step', { step: 'received', data: { execution: '1' }, atMs: 0 }),
    ],
  ])('treats %s as an invalid answer', async (_, chunk) => {
    const { problem } = await run(() => eventStream([chunk]))
    expect(problem).toMatchObject({ kind: 'server', message: TEXTS.invalid })
  })

  it('says the run was cut when the stream ends without done', async () => {
    const { problem } = await run(() =>
      eventStream([sse('run', { runId: RUN_ID }), sse('step', EVENTS.received)]),
    )
    expect(problem).toMatchObject({ kind: 'interrupted', message: TEXTS.interrupted })
  })

  it('says the connection dropped when the body fails half-way', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse('run', { runId: RUN_ID })))
        controller.error(new TypeError('network'))
      },
    })
    const { problem } = await run(
      () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    expect(problem).toMatchObject({ kind: 'network', message: TEXTS.connectionLost })
  })

  it('refuses an answer that is not an event stream', async () => {
    const { problem } = await run(() => json(200, { ok: true }))
    expect(problem).toMatchObject({ kind: 'server', message: TEXTS.invalid })
  })

  it('reports no connection', async () => {
    const { problem } = await run(() => {
      throw new TypeError('Failed to fetch')
    })
    expect(problem).toMatchObject({ kind: 'network', message: TEXTS.network })
  })

  it('rejects when the visitor stops the run', async () => {
    const controller = new AbortController()
    const pending = run(() => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    }, controller.signal)
    await expect(pending).rejects.toThrow('aborted')
  })
})

describe('HTTP errors before the stream', () => {
  const fails = (response: Response) => run(() => response).then((r) => r.problem)

  it('keeps the field errors of a 400', async () => {
    const problem = await fails(
      json(400, {
        error: 'invalid_request',
        message: 'Revisa los datos marcados e inténtalo de nuevo.',
        fields: { 'lead.email': ['Escribe un correo válido.'] },
      }),
    )
    expect(problem).toEqual({
      kind: 'invalid',
      message: 'Revisa los datos marcados e inténtalo de nuevo.',
      fields: { 'lead.email': ['Escribe un correo válido.'] },
    })
  })

  it.each([
    [403, 'captcha_failed'],
    [503, 'captcha_unavailable'],
  ])('asks for a new verification on %i %s', async (status, error) => {
    const problem = await fails(
      json(status, { error, message: 'No pudimos confirmar que eres una persona.' }),
    )
    expect(problem).toMatchObject({ kind: 'captcha', message: 'No pudimos confirmar que eres una persona.' })
  })

  it('reports a 429 from something in front of the API with the generic message and its wait', async () => {
    const problem = await fails(new Response('Too many', { status: 429, headers: { 'Retry-After': '120' } }))
    expect(problem).toEqual({
      kind: 'server',
      message: 'Hiciste demasiados intentos. Espera 2 minutos e inténtalo de nuevo.',
      fields: {},
    })
  })

  it('pauses the demo on a 404 (no API here)', async () => {
    const response = json(404, { error: 'not_found', message: 'Esta ruta de la API no existe.' })
    expect(await fails(response)).toMatchObject({ kind: 'paused', message: TEXTS.paused })
  })

  it.each([
    [
      '403 forbidden_origin',
      json(403, { error: 'forbidden_origin', message: 'Solo desde el sitio.' }),
      'Solo desde el sitio.',
    ],
    [
      '413 payload_too_large',
      json(413, { error: 'payload_too_large', message: 'La solicitud es demasiado grande.' }),
      'La solicitud es demasiado grande.',
    ],
    ['a 500 with the API body', json(500, { error: 'internal', message: 'Algo falló.' }), 'Algo falló.'],
    [
      'a 502 proxy page',
      new Response('<html>', { status: 502 }),
      'El servidor no pudo responder. Inténtalo de nuevo en unos minutos.',
    ],
  ])('reports %s as a server problem', async (_, response, message) => {
    expect(await fails(response)).toMatchObject({ kind: 'server', message })
  })
})

describe('errors', () => {
  it('maps anything unknown to a generic problem', () => {
    expect(toProblem(new Error('x'))).toMatchObject({ kind: 'server', message: TEXTS.unknown })
  })
})
