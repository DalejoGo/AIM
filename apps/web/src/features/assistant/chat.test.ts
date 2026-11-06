import { describe, expect, it } from 'vitest'
import { ApiRequestError } from '../../lib/api'
import { createAssistantChat } from './chat'
import type { AnswerOptions, AnswerResult, AssistantClient } from './client'
import { AssistantStreamError, CONNECTION_LOST } from './errors'
import type { Turn } from './history'

/** One call to `answer` that the test drives: pieces of text, then done or a failure. */
interface Pending {
  messages: Turn[]
  options: AnswerOptions
  delta(text: string): void
  done(reason?: string): Promise<void>
  fail(error: unknown): Promise<void>
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function fakeClient() {
  const sessions: string[] = []
  const answers: Pending[] = []
  let session: () => Promise<void> = async () => {}
  const client: AssistantClient = {
    startSession(token) {
      sessions.push(token)
      return session()
    },
    answer(messages, options) {
      return new Promise<AnswerResult>((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason))
        answers.push({
          messages,
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
    answers,
    last: () => {
      const pending = answers.at(-1)
      if (!pending) throw new Error('no answer was requested')
      return pending
    },
    sessionFails(error: unknown) {
      session = () => Promise.reject(error)
    },
    sessionWorks() {
      session = async () => {}
    },
  }
}

const http = (status: number, code: string, message = 'Mensaje.', retryAfter: number | null = null) =>
  new ApiRequestError({ status, code, message, retryAfter })

/** A chat past the verification. */
async function open() {
  const fake = fakeClient()
  const chat = createAssistantChat(fake.client)
  expect(await chat.startSession('token-1')).toBe(true)
  return { fake, chat }
}

const contents = (chat: ReturnType<typeof createAssistantChat>) =>
  chat.messages.value.map((m) => [m.role, m.content, m.state])

describe('the verification', () => {
  it('opens the chat once the session exists', async () => {
    const fake = fakeClient()
    const chat = createAssistantChat(fake.client)
    expect(chat.phase.value).toBe('gate')
    expect(chat.send('hola')).toBe(false)

    const started = chat.startSession('token-1')
    expect(chat.starting.value).toBe(true)
    expect(await started).toBe(true)
    expect(fake.sessions).toEqual(['token-1'])
    expect(chat.phase.value).toBe('chat')
    expect(chat.starting.value).toBe(false)
    expect(chat.canSend.value).toBe(true)
  })

  it('stays at the gate with the problem when the API refuses the session', async () => {
    const fake = fakeClient()
    fake.sessionFails(http(422, 'captcha_failed', 'No pudimos confirmar que eres una persona.'))
    const chat = createAssistantChat(fake.client)
    expect(await chat.startSession('t')).toBe(false)
    expect(chat.phase.value).toBe('gate')
    expect(chat.problem.value).toMatchObject({
      kind: 'request',
      message: 'No pudimos confirmar que eres una persona.',
    })

    fake.sessionWorks()
    expect(await chat.startSession('t2')).toBe(true)
    expect(chat.problem.value).toBeNull()
  })

  it('shows the pause when the assistant has no model, and goes back to the gate on retry', async () => {
    const fake = fakeClient()
    fake.sessionFails(http(503, 'assistant_unavailable'))
    const chat = createAssistantChat(fake.client)
    await chat.startSession('t')
    expect(chat.paused.value).toBe(true)
    chat.retry()
    expect(chat.paused.value).toBe(false)
    expect(chat.phase.value).toBe('gate')
  })

  it('ignores a second start while one is on its way', async () => {
    const fake = fakeClient()
    const chat = createAssistantChat(fake.client)
    const first = chat.startSession('a')
    expect(await chat.startSession('b')).toBe(false)
    await first
    expect(fake.sessions).toEqual(['a'])
  })
})

describe('a question', () => {
  it('streams the answer and keeps it in the conversation', async () => {
    const { fake, chat } = await open()
    expect(chat.send('  ¿Cuánto cuesta una página web?  ')).toBe(true)
    expect(contents(chat)).toEqual([['user', '¿Cuánto cuesta una página web?', 'done']])
    expect(chat.busy.value).toBe(true)
    expect(chat.answer.value).toBe('')
    expect(fake.last().messages).toEqual([{ role: 'user', content: '¿Cuánto cuesta una página web?' }])

    fake.last().delta('Desde ')
    expect(chat.answer.value).toBe('Desde ')
    fake.last().delta('**USD 250**.')
    expect(chat.answer.value).toBe('Desde **USD 250**.')
    await fake.last().done()

    expect(chat.busy.value).toBe(false)
    expect(chat.answer.value).toBeNull()
    expect(contents(chat)).toEqual([
      ['user', '¿Cuánto cuesta una página web?', 'done'],
      ['assistant', 'Desde **USD 250**.', 'done'],
    ])
  })

  it('takes no question while an answer is on its way, nor an empty one', async () => {
    const { fake, chat } = await open()
    expect(chat.send('   ')).toBe(false)
    chat.send('uno')
    expect(chat.canSend.value).toBe(false)
    expect(chat.send('dos')).toBe(false)
    expect(fake.answers).toHaveLength(1)
  })

  it('refuses a question over 1000 characters', async () => {
    const { fake, chat } = await open()
    expect(chat.send('a'.repeat(1001))).toBe(false)
    expect(chat.problem.value).toMatchObject({ kind: 'request' })
    expect(chat.problem.value?.message).toMatch(/1000 caracteres/)
    expect(fake.answers).toHaveLength(0)
    expect(chat.messages.value).toHaveLength(0)
  })

  it('sends the last 10 messages at most, ending with the question', async () => {
    const { fake, chat } = await open()
    for (let i = 1; i <= 7; i++) {
      chat.send(`pregunta ${i}`)
      fake.last().delta(`respuesta ${i}`)
      await fake.last().done()
    }
    chat.send('pregunta 8')
    const sent = fake.last().messages
    expect(sent.length).toBeLessThanOrEqual(10)
    expect(sent[0]).toEqual({ role: 'user', content: 'pregunta 4' })
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'pregunta 8' })
    // The screen keeps the whole conversation; only the request is trimmed.
    expect(chat.messages.value).toHaveLength(15)
  })

  it('reports an answer that ended without text', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().done()
    expect(chat.messages.value).toHaveLength(1)
    expect(chat.problem.value).toMatchObject({ kind: 'interrupted', retryable: true })
  })
})

describe('stopping', () => {
  it('keeps what arrived, marked as stopped', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    fake.last().delta('Una página web')
    chat.stop()
    await flush()
    expect(fake.last().options.signal.aborted).toBe(true)
    expect(chat.busy.value).toBe(false)
    expect(chat.problem.value).toBeNull()
    expect(contents(chat).at(-1)).toEqual(['assistant', 'Una página web', 'stopped'])
  })

  it('marks an answer stopped before it began, and leaves it out of the next request', async () => {
    const { fake, chat } = await open()
    chat.send('primera')
    chat.stop()
    await flush()
    expect(contents(chat).at(-1)).toEqual(['assistant', '', 'stopped'])
    chat.send('segunda')
    expect(fake.last().messages).toEqual([{ role: 'user', content: 'segunda' }])
  })
})

describe('when something fails', () => {
  it('asks for a new verification on 401 and sends the question again, once', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(401, 'assistant_session_required'))
    expect(chat.renewing.value).toBe(true)
    expect(chat.problem.value?.kind).toBe('session')
    expect(chat.canSend.value).toBe(false)
    expect(chat.messages.value).toHaveLength(1)

    expect(await chat.startSession('token-2')).toBe(true)
    expect(fake.sessions).toEqual(['token-1', 'token-2'])
    expect(chat.renewing.value).toBe(false)
    expect(fake.answers).toHaveLength(2)
    expect(fake.last().messages).toEqual([{ role: 'user', content: 'hola' }])
    fake.last().delta('Hola')
    await fake.last().done()
    expect(contents(chat).at(-1)).toEqual(['assistant', 'Hola', 'done'])
  })

  it('stops asking for verifications when the new session is refused too', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(401, 'assistant_session_required'))
    await chat.startSession('token-2')
    await fake.last().fail(http(401, 'assistant_session_required'))
    expect(chat.renewing.value).toBe(false)
    expect(chat.problem.value).toMatchObject({ kind: 'cookies', retryable: false })
    expect(fake.answers).toHaveLength(2)
  })

  it('keeps renewing when the new verification is refused', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(401, 'assistant_session_required'))
    fake.sessionFails(http(422, 'captcha_failed', 'No pudimos confirmar que eres una persona.'))
    expect(await chat.startSession('token-2')).toBe(false)
    expect(chat.renewing.value).toBe(true)
    expect(chat.problem.value?.message).toBe('No pudimos confirmar que eres una persona.')
    expect(fake.answers).toHaveLength(1)
  })

  it('shows the wait of a 429 and lets the visitor ask later', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(429, 'rate_limited', 'Vuelve a intentarlo en 5 minutos.', 300))
    expect(chat.problem.value).toEqual({
      kind: 'rate_limited',
      message: 'Vuelve a intentarlo en 5 minutos.',
      retryable: false,
      retryAfter: 300,
    })
    expect(chat.messages.value).toHaveLength(1)
    expect(chat.canSend.value).toBe(true)
  })

  it('pauses on 503 and asks again on retry', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(503, 'assistant_unavailable'))
    expect(chat.paused.value).toBe(true)
    expect(chat.canSend.value).toBe(false)
    chat.retry()
    expect(chat.paused.value).toBe(false)
    expect(fake.answers).toHaveLength(2)
    expect(fake.last().messages).toEqual([{ role: 'user', content: 'hola' }])
  })

  it('keeps the text before an error event as a cut answer, and retry asks again without it', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    fake.last().delta('Una página')
    await fake.last().fail(new AssistantStreamError('assistant_failed', 'El asistente no pudo terminar.'))
    expect(contents(chat).at(-1)).toEqual(['assistant', 'Una página', 'cut'])
    expect(chat.problem.value).toMatchObject({ kind: 'answer', message: 'El asistente no pudo terminar.' })

    chat.retry()
    expect(chat.problem.value).toBeNull()
    expect(contents(chat)).toEqual([['user', 'hola', 'done']])
    expect(fake.last().messages).toEqual([{ role: 'user', content: 'hola' }])
  })

  it('reports a lost connection and retries the same question', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(new AssistantStreamError(CONNECTION_LOST, 'x'))
    expect(chat.problem.value).toMatchObject({ kind: 'network', retryable: true })
    expect(chat.messages.value).toHaveLength(1)
    chat.retry()
    expect(fake.answers).toHaveLength(2)
  })

  it('a new question clears the previous problem', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(0, 'network_error'))
    chat.send('otra')
    expect(chat.problem.value).toBeNull()
    expect(fake.last().messages).toEqual([{ role: 'user', content: 'otra' }])
  })
})

describe('a new conversation', () => {
  it('forgets everything, stops the answer and ignores what it still sends', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    const first = fake.last()
    first.delta('Una')
    chat.reset()
    expect(first.options.signal.aborted).toBe(true)
    expect(chat.messages.value).toEqual([])
    expect(chat.answer.value).toBeNull()
    first.delta(' página')
    await flush()
    expect(chat.messages.value).toEqual([])
    expect(chat.answer.value).toBeNull()
    expect(chat.phase.value).toBe('chat')
    expect(chat.canSend.value).toBe(true)
  })

  it('leaves a renewal behind', async () => {
    const { fake, chat } = await open()
    chat.send('hola')
    await fake.last().fail(http(401, 'assistant_session_required'))
    chat.reset()
    expect(chat.renewing.value).toBe(false)
    expect(chat.problem.value).toBeNull()
    expect(chat.canSend.value).toBe(true)
  })
})
