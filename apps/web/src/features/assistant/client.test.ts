import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../lib/api'
import { createAssistantClient } from './client'
import { AssistantStreamError, CONNECTION_LOST, INVALID_STREAM, STREAM_INTERRUPTED } from './errors'

interface Call {
  path: string
  init: RequestInit
}

const QUESTION = [{ role: 'user' as const, content: '¿Cuánto cuesta una página web?' }]

const sse = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`

/** A streamed body that hands out the chunks one by one, as the network would. */
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

const eventStream = (body: string[] | ReadableStream<Uint8Array>) =>
  new Response(Array.isArray(body) ? streamOf(body) : body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
  })

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function setup(reply: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const client = createAssistantClient(async (path, init) => {
    const call = { path, init }
    calls.push(call)
    return reply(call)
  })
  return { client, calls }
}

async function ask(client: ReturnType<typeof createAssistantClient>, signal = new AbortController().signal) {
  const deltas: string[] = []
  const result = await client.answer(QUESTION, { signal, onDelta: (text) => deltas.push(text) })
  return { deltas, result }
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected the promise to fail')
}

describe('startSession', () => {
  it('posts the Turnstile token as JSON, with the cookies of the site', async () => {
    const { client, calls } = setup(() => json(200, { expiresIn: 1800 }))
    await client.startSession('token-1')
    expect(calls).toHaveLength(1)
    expect(calls[0]?.path).toBe('/api/assistant/session')
    expect(calls[0]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ turnstileToken: 'token-1' })
  })

  it("fails with the API's error", async () => {
    const { client } = setup(() =>
      json(422, { error: 'captcha_failed', message: 'No pudimos confirmar que eres una persona.' }),
    )
    const error = await failure(client.startSession('t'))
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status: 422, code: 'captcha_failed' })
  })
})

describe('answer', () => {
  it('posts the conversation and streams each piece of text until done', async () => {
    const body =
      sse('delta', { text: 'Desde ' }) +
      sse('delta', { text: 'USD 250.' }) +
      sse('done', { reason: 'end_turn' })
    // Cut in odd places: inside the event name, inside the JSON, between the two line feeds.
    const { client, calls } = setup(() =>
      eventStream([body.slice(0, 9), body.slice(9, 40), body.slice(40, 51), body.slice(51)]),
    )
    const { deltas, result } = await ask(client)

    expect(deltas).toEqual(['Desde ', 'USD 250.'])
    expect(result).toEqual({ reason: 'end_turn' })
    expect(calls[0]?.path).toBe('/api/assistant/messages')
    expect(calls[0]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    const headers = calls[0]?.init.headers as Record<string, string> | undefined
    expect(headers?.accept).toBe('text/event-stream')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ messages: QUESTION })
  })

  it('ignores comments and events it does not know', async () => {
    const { client } = setup(() =>
      eventStream([
        ': ping\n\n',
        sse('usage', { tokens: 3 }),
        sse('delta', { text: 'Hola' }),
        sse('done', { reason: 'max_tokens' }),
      ]),
    )
    const { deltas, result } = await ask(client)
    expect(deltas).toEqual(['Hola'])
    expect(result.reason).toBe('max_tokens')
  })

  it('fails with the code and message of an error event, after the text before it', async () => {
    const { client } = setup(() =>
      eventStream([
        sse('delta', { text: 'Una página ' }),
        sse('error', { error: 'assistant_failed', message: 'El asistente no pudo terminar la respuesta.' }),
      ]),
    )
    const deltas: string[] = []
    const error = await failure(
      client.answer(QUESTION, { signal: new AbortController().signal, onDelta: (t) => deltas.push(t) }),
    )
    expect(deltas).toEqual(['Una página '])
    expect(error).toBeInstanceOf(AssistantStreamError)
    expect(error).toMatchObject({
      code: 'assistant_failed',
      message: 'El asistente no pudo terminar la respuesta.',
    })
  })

  it('fails as interrupted when the stream ends without done', async () => {
    const { client } = setup(() => eventStream([sse('delta', { text: 'Una' })]))
    expect(await failure(ask(client))).toMatchObject({ code: STREAM_INTERRUPTED })
  })

  it('fails as a lost connection when the body breaks', async () => {
    let pulls = 0
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls === 1) controller.enqueue(new TextEncoder().encode(sse('delta', { text: 'Una' })))
        else controller.error(new TypeError('network error'))
      },
    })
    const { client } = setup(() => eventStream(broken))
    expect(await failure(ask(client))).toMatchObject({ code: CONNECTION_LOST })
  })

  it('fails as an invalid stream on a malformed delta or a body that is not SSE', async () => {
    const bad = setup(() => eventStream(['event: delta\ndata: {"text":\n\n']))
    expect(await failure(ask(bad.client))).toMatchObject({ code: INVALID_STREAM })
    const html = setup(
      () => new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    expect(await failure(ask(html.client))).toMatchObject({ code: INVALID_STREAM })
  })

  it.each([
    [401, 'assistant_session_required', {}],
    [400, 'invalid_request', {}],
    [503, 'assistant_unavailable', {}],
  ])('fails with ApiRequestError on HTTP %i before the stream', async (status, code) => {
    const { client } = setup(() => json(status, { error: code, message: 'Mensaje.' }))
    const error = await failure(ask(client))
    expect(error).toBeInstanceOf(ApiRequestError)
    expect(error).toMatchObject({ status, code, message: 'Mensaje.' })
  })

  it('keeps Retry-After on 429', async () => {
    const { client } = setup(() =>
      json(
        429,
        { error: 'rate_limited', message: 'Vuelve a intentarlo en 5 minutos.' },
        { 'Retry-After': '300' },
      ),
    )
    expect(await failure(ask(client))).toMatchObject({ status: 429, retryAfter: 300 })
  })

  it('fails with a network error when nothing arrives', async () => {
    const { client } = setup(() => Promise.reject(new TypeError('Failed to fetch')))
    expect(await failure(ask(client))).toMatchObject({ status: 0, code: 'network_error' })
  })

  it('passes the abort on untouched, before or during the stream', async () => {
    const before = new AbortController()
    const early = setup((call) => {
      before.abort()
      return Promise.reject(call.init.signal?.reason)
    })
    const first = await failure(ask(early.client, before.signal))
    expect(first).not.toBeInstanceOf(ApiRequestError)
    expect(before.signal.aborted).toBe(true)

    const during = new AbortController()
    const late = setup(() => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse('delta', { text: 'Una' })))
          during.signal.addEventListener('abort', () => controller.error(during.signal.reason))
        },
      })
      return eventStream(body)
    })
    const pending = late.client.answer(QUESTION, {
      signal: during.signal,
      onDelta: () => during.abort(),
    })
    const second = await failure(pending)
    expect(second).not.toBeInstanceOf(AssistantStreamError)
    expect((second as Error).name).toBe('AbortError')
  })
})
