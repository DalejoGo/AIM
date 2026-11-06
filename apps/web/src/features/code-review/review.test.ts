import type { CodeReviewRequest } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../lib/api'
import type { AnswerOptions, AnswerResult, CodeReviewClient } from '../assistant/client'
import { AssistantStreamError, CONNECTION_LOST } from '../assistant/errors'
import { EXAMPLES } from './examples'
import { createCodeReview, REVIEW_PAUSED_TITLE } from './review'

/** One call to `review` that the test drives: pieces of text, then done or a failure. */
interface Pending {
  request: CodeReviewRequest
  options: AnswerOptions
  delta(text: string): void
  done(reason?: string): Promise<void>
  fail(error: unknown): Promise<void>
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function fakeClient() {
  const sessions: string[] = []
  const reviews: Pending[] = []
  let status: () => Promise<boolean> = async () => false
  let session: () => Promise<void> = async () => {}
  const client: CodeReviewClient = {
    hasSession: () => status(),
    startSession(token) {
      sessions.push(token)
      return session()
    },
    review(request, options) {
      return new Promise<AnswerResult>((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason))
        reviews.push({
          request,
          options,
          delta: (text) => options.onDelta(text),
          done: async (reason = 'end_turn') => {
            resolve({ reason })
            await flush()
          },
          fail: async (error) => {
            reject(error)
            await flush()
          },
        })
      })
    },
  }
  return {
    client,
    sessions,
    reviews,
    last: () => {
      const pending = reviews.at(-1)
      if (!pending) throw new Error('no review was requested')
      return pending
    },
    statusIs(next: () => Promise<boolean>) {
      status = next
    },
    sessionFails(error: unknown) {
      session = () => Promise.reject(error)
    },
  }
}

const http = (status: number, code: string, message = 'Mensaje.', retryAfter: number | null = null) =>
  new ApiRequestError({ status, code, message, retryAfter })

const SQL = 'db.query("SELECT * FROM users WHERE id = " + id)'

/** A reviewer whose session check found an active session (the visitor passed the assistant's verification). */
async function withSession() {
  const fake = fakeClient()
  fake.statusIs(async () => true)
  const review = createCodeReview(fake.client)
  await review.checkSession()
  return { fake, review }
}

describe('the session', () => {
  it('starts checking, and skips the verification when the browser already holds a session', async () => {
    const { review } = await withSession()
    expect(review.session.value).toBe('active')
  })

  it('asks for the verification when there is no session, or the check fails', async () => {
    const fake = fakeClient()
    const review = createCodeReview(fake.client)
    expect(review.session.value).toBe('checking')
    await review.checkSession()
    expect(review.session.value).toBe('needed')

    fake.statusIs(() => Promise.reject(http(0, 'network_error')))
    await review.checkSession()
    expect(review.session.value).toBe('needed')
    expect(review.problem.value).toBeNull()
  })

  it('shows the pause when the API has no model (503)', async () => {
    const fake = fakeClient()
    fake.statusIs(() => Promise.reject(http(503, 'assistant_unavailable')))
    const review = createCodeReview(fake.client)
    await review.checkSession()
    expect(review.paused.value).toBe(true)
    expect(review.problem.value?.message).toContain(REVIEW_PAUSED_TITLE)
    expect(await review.submit('token')).toBe('ignored')

    // "Intentar de nuevo" asks again.
    fake.statusIs(async () => true)
    review.retry()
    await flush()
    expect(review.paused.value).toBe(false)
    expect(review.session.value).toBe('active')
  })

  it('needs a Turnstile token first, then spends it on a session and sends the review', async () => {
    const fake = fakeClient()
    const review = createCodeReview(fake.client)
    await review.checkSession()
    review.setCode(SQL)

    expect(await review.submit(null)).toBe('verify')
    expect(fake.reviews).toHaveLength(0)

    expect(await review.submit('token-1')).toBe('sent')
    expect(fake.sessions).toEqual(['token-1'])
    expect(review.session.value).toBe('active')
    expect(fake.last().request).toEqual({ language: 'typescript', code: SQL })
  })

  it('keeps the form when the session is refused, with the reason', async () => {
    const fake = fakeClient()
    const review = createCodeReview(fake.client)
    await review.checkSession()
    review.setCode(SQL)
    fake.sessionFails(http(422, 'captcha_failed', 'No pudimos confirmar que eres una persona.'))

    expect(await review.submit('token-1')).toBe('refused')
    expect(review.starting.value).toBe(false)
    expect(review.session.value).toBe('needed')
    expect(review.problem.value).toMatchObject({
      kind: 'request',
      message: 'No pudimos confirmar que eres una persona.',
    })
    expect(fake.reviews).toHaveLength(0)
  })

  it('asks for the verification again on 401, and sends nothing until the visitor submits', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    await fake.last().fail(http(401, 'assistant_session_required'))

    expect(review.session.value).toBe('needed')
    expect(review.problem.value).toMatchObject({
      kind: 'session',
      message: expect.stringContaining('Revisar mi código'),
    })
    expect(review.status.value).toBe('idle')

    expect(await review.submit('token-2')).toBe('sent')
    expect(fake.sessions).toEqual(['token-2'])
    expect(review.problem.value).toBeNull()
    expect(fake.reviews).toHaveLength(2)
  })

  it('blames the cookies when a brand-new session is refused', async () => {
    const fake = fakeClient()
    const review = createCodeReview(fake.client)
    await review.checkSession()
    review.setCode(SQL)
    await review.submit('token-1')
    await fake.last().fail(http(401, 'assistant_session_required'))

    expect(review.problem.value).toMatchObject({
      kind: 'cookies',
      message: expect.stringContaining('cookies'),
    })
    expect(review.session.value).toBe('active')
  })

  it('ignores a late session check once a review already knows the answer', async () => {
    const fake = fakeClient()
    let answer = (_active: boolean) => {}
    fake.statusIs(() => new Promise<boolean>((resolve) => (answer = resolve)))
    const review = createCodeReview(fake.client)
    const check = review.checkSession()
    review.session.value = 'needed'
    answer(true)
    await check
    expect(review.session.value).toBe('needed')
  })
})

describe('the form', () => {
  it('refuses empty code and says why, until the visitor types', async () => {
    const { fake, review } = await withSession()
    review.setCode(' \n\t ')
    expect(await review.submit(null)).toBe('invalid')
    expect(review.codeIssue.value).toBe('Pega el código que quieres revisar.')
    expect(fake.reviews).toHaveLength(0)

    review.setCode('x')
    expect(review.codeIssue.value).toBeNull()
  })

  it('sends the language and the cleaned code', async () => {
    const { fake, review } = await withSession()
    review.language.value = 'sql'
    review.setCode('\r\n  SELECT 1;\r\n\r\n')
    await review.submit(null)
    expect(fake.last().request).toEqual({ language: 'sql', code: '  SELECT 1;' })
  })

  it('loads an example with its language and clears the last review', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    fake.last().delta('## Resumen\nAlgo.')
    await fake.last().done()
    expect(review.status.value).toBe('done')

    const python = EXAMPLES[1]
    if (!python) throw new Error('missing example')
    expect(review.loadExample(python)).toBe(true)
    expect(review.language.value).toBe('python')
    expect(review.code.value).toBe(python.code)
    expect(review.example.value).toBe(python)
    expect(review.status.value).toBe('idle')
    expect(review.text.value).toBe('')

    await review.submit(null)
    expect(fake.last().request).toEqual({ language: 'python', code: python.code })
    expect(review.example.value).toBeNull()
  })

  it('does not load an example while a review is on its way', async () => {
    const { review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    const example = EXAMPLES[0]
    if (!example) throw new Error('missing example')
    expect(review.loadExample(example)).toBe(false)
    expect(review.code.value).toBe(SQL)
  })
})

describe('the review', () => {
  it('streams the text and ends as done', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    expect(review.streaming.value).toBe(true)
    expect(review.busy.value).toBe(true)
    expect(await review.submit(null)).toBe('ignored')

    fake.last().delta('## Resumen\n')
    fake.last().delta('Busca un usuario.')
    expect(review.text.value).toBe('## Resumen\nBusca un usuario.')
    await fake.last().done()

    expect(review.status.value).toBe('done')
    expect(review.truncated.value).toBe(false)
    expect(review.busy.value).toBe(false)
    expect(fake.reviews).toHaveLength(1)
  })

  it('marks a review cut by the length cap', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    fake.last().delta('## Resumen\nLarga')
    await fake.last().done('max_tokens')
    expect(review.status.value).toBe('done')
    expect(review.truncated.value).toBe(true)
  })

  it('"Detener" keeps the text so far, marked as stopped', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    fake.last().delta('## Resumen\n')
    review.stop()
    await flush()
    expect(review.status.value).toBe('stopped')
    expect(review.text.value).toBe('## Resumen\n')
    expect(review.problem.value).toBeNull()
  })

  it('an error event keeps the text so far, shows its message and can be retried', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    fake.last().delta('## Resumen\n')
    await fake
      .last()
      .fail(new AssistantStreamError('assistant_busy', 'El revisor está recibiendo muchas solicitudes.'))

    expect(review.status.value).toBe('cut')
    expect(review.text.value).toBe('## Resumen\n')
    expect(review.problem.value).toMatchObject({
      kind: 'answer',
      message: 'El revisor está recibiendo muchas solicitudes.',
      retryable: true,
    })

    review.retry()
    await flush()
    expect(fake.reviews).toHaveLength(2)
    expect(fake.last().request).toEqual(fake.reviews[0]?.request)
    expect(review.problem.value).toBeNull()
    expect(review.text.value).toBe('')
  })

  it('a 429 says how long to wait and is not retried', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    await fake.last().fail(http(429, 'rate_limited', 'Vuelve a intentarlo en 12 minutos.', 700))

    expect(review.status.value).toBe('idle')
    expect(review.problem.value).toMatchObject({ kind: 'rate_limited', retryable: false, retryAfter: 700 })
    review.retry()
    expect(fake.reviews).toHaveLength(1)
  })

  it('a dropped connection and an empty answer explain what happened in the reviewer voice', async () => {
    const { fake, review } = await withSession()
    review.setCode(SQL)
    await review.submit(null)
    await fake.last().fail(new AssistantStreamError(CONNECTION_LOST, 'dropped'))
    expect(review.problem.value?.message).toContain('mientras llegaba la revisión')

    await review.submit(null)
    await fake.last().done()
    expect(review.status.value).toBe('idle')
    expect(review.problem.value?.message).toBe('La revisión se cortó antes de terminar. Inténtalo de nuevo.')
  })

  it('"Revisar otro" stops the review, clears the code and the result, and keeps the language', async () => {
    const { fake, review } = await withSession()
    review.language.value = 'javascript'
    review.setCode('a == b')
    await review.submit(null)
    const first = fake.last()
    first.delta('## Resumen\n')

    review.reset()
    expect(first.options.signal.aborted).toBe(true)
    first.delta('tarde')
    await flush()
    expect(review.code.value).toBe('')
    expect(review.text.value).toBe('')
    expect(review.status.value).toBe('idle')
    expect(review.language.value).toBe('javascript')
    expect(review.busy.value).toBe(false)
  })
})
