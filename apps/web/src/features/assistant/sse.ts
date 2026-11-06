/**
 * Incremental Server-Sent Events parser (WHATWG HTML, "Parsing an event stream"). The assistant answers a POST,
 * and EventSource only does GET, so the stream is read with fetch and parsed here, chunk by chunk.
 */

export interface SseEvent {
  /** The `event:` field, or "message" when the event had none. */
  event: string
  /** Every `data:` line of the event, joined with line feeds. */
  data: string
  /** The last `id:` seen so far in the stream (it carries over to later events). */
  id: string
}

export interface SseParser {
  /** Parses one decoded chunk and returns the events it completed. A chunk may end anywhere, even mid-line. */
  feed(chunk: string): SseEvent[]
}

/**
 * Lines end in CRLF, LF or CR; a blank line dispatches the event. Lines starting with ":" are comments
 * (keep-alives). An event cut off by the end of the stream is never dispatched, as the spec says.
 */
export function createSseParser(): SseParser {
  let buffer = ''
  let started = false
  // A chunk that ends in CR may be the first half of a CRLF: the LF that opens the next chunk is skipped.
  let skipLeadingLf = false
  let data: string[] = []
  let eventType = ''
  let lastId = ''

  function line(text: string, out: SseEvent[]) {
    if (text === '') {
      if (data.length > 0) out.push({ event: eventType || 'message', data: data.join('\n'), id: lastId })
      data = []
      eventType = ''
      return
    }
    if (text.startsWith(':')) return
    const colon = text.indexOf(':')
    const field = colon === -1 ? text : text.slice(0, colon)
    let value = colon === -1 ? '' : text.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') eventType = value
    else if (field === 'id' && !value.includes('\0')) lastId = value
    // `retry` and unknown fields are ignored: this client does not reconnect.
  }

  return {
    feed(chunk) {
      let text = chunk
      if (!started && text.length > 0) {
        started = true
        if (text.startsWith('﻿')) text = text.slice(1)
      }
      if (skipLeadingLf && text.length > 0) {
        if (text.startsWith('\n')) text = text.slice(1)
        skipLeadingLf = false
      }
      const scanFrom = buffer.length
      buffer += text
      const out: SseEvent[] = []
      let start = 0
      for (let i = scanFrom; i < buffer.length; i++) {
        const char = buffer[i]
        if (char !== '\n' && char !== '\r') continue
        const end = i
        if (char === '\r') {
          if (i + 1 < buffer.length) {
            if (buffer[i + 1] === '\n') i++
          } else {
            skipLeadingLf = true
          }
        }
        line(buffer.slice(start, end), out)
        start = i + 1
      }
      buffer = buffer.slice(start)
      return out
    },
  }
}

/**
 * Reads a fetch body as SSE events. Bytes are decoded as a stream, so a character split between two chunks
 * arrives whole. Leaving the loop early (or an error) cancels the body.
 */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser()
  let finished = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield* parser.feed(decoder.decode(value, { stream: true }))
    }
    finished = true
    yield* parser.feed(decoder.decode())
  } finally {
    if (!finished) await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
