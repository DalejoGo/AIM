import {
  type AutomationLeadInput,
  type AutomationOutcome,
  type AutomationStepEvent,
  type AutomationStreamEventName,
  AutomationStreamEvents,
} from '@aim/contracts'
import { ApiRequestError, type Fetch, messageForStatus, toApiError } from '../../lib/api'
import { readSseEvents } from '../assistant/sse'
import {
  AutomationStreamError,
  CONNECTION_LOST,
  INVALID_STREAM,
  type Problem,
  STREAM_INTERRUPTED,
  streamErrorProblem,
  toProblem,
} from './errors'

/**
 * Client of POST /api/automation/runs (apps/edge/src/routes/automation.ts): sends the test lead and reads the
 * run as Server-Sent Events, checking every payload against @aim/contracts. The island imports it only when the
 * visitor runs the flow, so zod and lib/api stay out of the page's first load.
 */

export const RUNS_PATH = '/api/automation/runs'

export interface RunRequest {
  turnstileToken: string
  lead: AutomationLeadInput
}

/** What the run reports, in order: `run`, `step`…, then `done` (or a problem). */
export type RunEvent =
  | { type: 'run'; runId: string }
  | { type: 'step'; event: AutomationStepEvent }
  | { type: 'done'; outcome: AutomationOutcome; totalMs: number }

export interface RunOptions {
  signal: AbortSignal
  onEvent: (event: RunEvent) => void
  fetchImpl?: Fetch
}

function parse<E extends AutomationStreamEventName>(name: E, data: string) {
  let value: unknown
  try {
    value = JSON.parse(data)
  } catch {
    throw new AutomationStreamError(INVALID_STREAM, `The ${name} event is not JSON`)
  }
  const parsed = AutomationStreamEvents[name].safeParse(value)
  if (!parsed.success)
    throw new AutomationStreamError(INVALID_STREAM, `The ${name} event breaks the contract`)
  return parsed.data as ReturnType<(typeof AutomationStreamEvents)[E]['parse']>
}

const isEventName = (name: string): name is AutomationStreamEventName =>
  Object.hasOwn(AutomationStreamEvents, name)

/** Reads the stream until `done` (null) or `error` (its problem). */
async function readRun(response: Response, { signal, onEvent }: RunOptions): Promise<Problem | null> {
  const type = response.headers.get('content-type') ?? ''
  if (!type.includes('text/event-stream') || !response.body) {
    await response.body?.cancel().catch(() => {})
    throw new AutomationStreamError(INVALID_STREAM, 'The answer is not an event stream')
  }
  try {
    for await (const sse of readSseEvents(response.body)) {
      // Other events (none today) are ignored, so the API can add some without breaking old pages.
      if (!isEventName(sse.event)) continue
      switch (sse.event) {
        case 'run':
          onEvent({ type: 'run', runId: parse('run', sse.data).runId })
          break
        case 'step':
          onEvent({ type: 'step', event: parse('step', sse.data) })
          break
        case 'done': {
          const done = parse('done', sse.data)
          onEvent({ type: 'done', outcome: done.outcome, totalMs: done.totalMs })
          return null
        }
        case 'error': {
          const error = parse('error', sse.data)
          return streamErrorProblem(error.code, error.message)
        }
      }
    }
  } catch (error) {
    if (error instanceof AutomationStreamError || signal.aborted) throw error
    throw new AutomationStreamError(CONNECTION_LOST, 'The connection dropped during the run')
  }
  throw new AutomationStreamError(STREAM_INTERRUPTED, 'The run stream ended without done')
}

/**
 * Runs the flow: resolves with null once `done` arrives, or with the problem that stopped it (an HTTP error, an
 * `error` event, a broken stream). Rejects only when `signal` aborts (the visitor stopped it).
 */
export async function runAutomation(request: RunRequest, options: RunOptions): Promise<Problem | null> {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  try {
    let response: Response
    try {
      response = await fetchImpl(RUNS_PATH, {
        method: 'POST',
        headers: { accept: 'text/event-stream', 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(request),
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal.aborted) throw error
      throw new ApiRequestError({ status: 0, code: 'network_error', message: messageForStatus(0) })
    }
    if (!response.ok) throw await toApiError(response)
    return await readRun(response, options)
  } catch (error) {
    if (options.signal.aborted) throw error
    return toProblem(error)
  }
}
