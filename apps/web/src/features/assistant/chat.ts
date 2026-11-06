import { batch, computed, signal } from '@preact/signals'
import type { AssistantClient } from './client'
import { AssistantStreamError, cookiesProblem, type Problem, STREAM_INTERRUPTED, toProblem } from './errors'
import { buildHistory, MAX_MESSAGE_LENGTH, normalizeContent, type Role } from './history'

export interface ChatMessage {
  id: number
  role: Role
  content: string
  /** done; stopped: the visitor pressed "Detener"; cut: an error ended the answer half-way. */
  state: 'done' | 'stopped' | 'cut'
}

/** gate: presentation and verification; chat: the conversation. */
export type Phase = 'gate' | 'chat'

/**
 * State of the assistant island, without DOM: the verification, the conversation in memory, the answer
 * being streamed and what went wrong. The component only renders it and moves the focus.
 */
export function createAssistantChat(client: AssistantClient) {
  const phase = signal<Phase>('gate')
  /** A session request is on its way. */
  const starting = signal(false)
  /** Finished turns, in order. */
  const messages = signal<ChatMessage[]>([])
  /** The answer being written: null when there is none, '' until the first piece arrives. */
  const answer = signal<string | null>(null)
  const problem = signal<Problem | null>(null)
  /** A 401 stopped the last question: after a new verification it is sent again, once. */
  const renewing = signal(false)

  const busy = computed(() => answer.value !== null)
  const paused = computed(() => problem.value?.kind === 'paused')
  const canSend = computed(
    () => phase.value === 'chat' && !busy.value && !renewing.value && !paused.value && !starting.value,
  )

  let nextId = 1
  let controller: AbortController | null = null
  // Bumped by "Nueva conversación": whatever an older request still delivers is dropped.
  let generation = 0

  const add = (role: Role, content: string, state: ChatMessage['state'] = 'done') => {
    messages.value = [...messages.value, { id: nextId++, role, content, state }]
  }

  const unanswered = () => messages.value.at(-1)?.role === 'user'

  async function ask(afterRenewal: boolean): Promise<void> {
    const history = buildHistory(messages.value)
    if (history.length === 0) return
    const run = ++generation
    const abort = new AbortController()
    controller = abort
    batch(() => {
      answer.value = ''
      problem.value = null
    })
    let text = ''
    try {
      await client.answer(history, {
        signal: abort.signal,
        onDelta: (piece) => {
          if (run !== generation) return
          text += piece
          answer.value = text
        },
      })
      if (run !== generation) return
      batch(() => {
        answer.value = null
        if (text.trim()) add('assistant', text)
        else problem.value = toProblem(new AssistantStreamError(STREAM_INTERRUPTED, 'Empty answer'))
      })
    } catch (error) {
      if (run !== generation) return
      if (abort.signal.aborted) {
        batch(() => {
          answer.value = null
          add('assistant', text, 'stopped')
        })
        return
      }
      const found = toProblem(error)
      batch(() => {
        answer.value = null
        if (found.kind === 'session') {
          // A session that is refused right after it was issued will not work with another verification.
          if (afterRenewal) problem.value = cookiesProblem()
          else {
            renewing.value = true
            problem.value = found
          }
          return
        }
        if (text.trim()) add('assistant', text, 'cut')
        problem.value = found
      })
    } finally {
      if (controller === abort) controller = null
    }
  }

  return {
    phase,
    starting,
    messages,
    answer,
    problem,
    renewing,
    busy,
    paused,
    canSend,

    /**
     * Spends a Turnstile token on a new session: it opens the chat, or, after a 401, sends the
     * interrupted question again. Resolves false when the API refused it (the token is spent either way).
     */
    async startSession(token: string): Promise<boolean> {
      if (starting.value) return false
      batch(() => {
        starting.value = true
        if (!renewing.value) problem.value = null
      })
      try {
        await client.startSession(token)
      } catch (error) {
        const found = toProblem(error)
        batch(() => {
          starting.value = false
          problem.value = found
          // Paused: there is nothing to renew until the assistant is back.
          if (found.kind === 'paused') renewing.value = false
        })
        return false
      }
      const resume = renewing.value && unanswered()
      batch(() => {
        starting.value = false
        renewing.value = false
        problem.value = null
        phase.value = 'chat'
      })
      if (resume) void ask(true)
      return true
    },

    /** Sends a question. False when it was not sent: empty, too long, or the chat cannot take it now. */
    send(text: string): boolean {
      const content = normalizeContent(text)
      if (!content || !canSend.value) return false
      if (content.length > MAX_MESSAGE_LENGTH) {
        problem.value = {
          kind: 'request',
          message: `Tu pregunta puede tener hasta ${MAX_MESSAGE_LENGTH} caracteres. Acórtala y vuelve a enviarla.`,
          retryable: false,
          retryAfter: null,
        }
        return false
      }
      add('user', content)
      void ask(false)
      return true
    },

    /** "Detener": the answer so far stays, marked as stopped. */
    stop(): void {
      controller?.abort()
    },

    /** Asks the last question again (after a cut answer, a lost connection or a pause). */
    retry(): void {
      if (busy.value || renewing.value || starting.value) return
      if (phase.value === 'gate') {
        problem.value = null
        return
      }
      const last = messages.value.at(-1)
      if (last?.role === 'assistant' && last.state === 'cut') messages.value = messages.value.slice(0, -1)
      if (unanswered()) void ask(false)
      else problem.value = null
    },

    /** "Nueva conversación": forgets every turn and stops the answer in progress. The session stays. */
    reset(): void {
      generation += 1
      controller?.abort()
      controller = null
      batch(() => {
        messages.value = []
        answer.value = null
        problem.value = null
        renewing.value = false
      })
    },
  }
}

export type AssistantChat = ReturnType<typeof createAssistantChat>
