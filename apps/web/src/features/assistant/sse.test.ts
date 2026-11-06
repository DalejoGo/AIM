import { describe, expect, it } from 'vitest'
import { createSseParser, readSseEvents, type SseEvent } from './sse'

const event = (name: string, data: string, id = ''): SseEvent => ({ event: name, data, id })

/** Feeds the chunks in order and collects every event. */
function parse(...chunks: string[]): SseEvent[] {
  const parser = createSseParser()
  return chunks.flatMap((chunk) => parser.feed(chunk))
}

// What apps/edge writes (hono's writeSSE): an event line, a data line and a blank line.
const STREAM = [
  'event: delta\ndata: {"text":"Hola, "}\n\n',
  'event: delta\ndata: {"text":"¿en qué te ayudo?"}\n\n',
  'event: done\ndata: {"reason":"end_turn"}\n\n',
].join('')
const EXPECTED = [
  event('delta', '{"text":"Hola, "}'),
  event('delta', '{"text":"¿en qué te ayudo?"}'),
  event('done', '{"reason":"end_turn"}'),
]

function bytes(...parts: (string | number[])[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const part of parts)
        controller.enqueue(typeof part === 'string' ? encoder.encode(part) : Uint8Array.from(part))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const out: SseEvent[] = []
  for await (const item of readSseEvents(stream)) out.push(item)
  return out
}

describe('createSseParser', () => {
  it('parses complete events', () => {
    expect(parse(STREAM)).toEqual(EXPECTED)
  })

  it('gives the same events whatever the point where the stream is cut in two', () => {
    for (let at = 0; at <= STREAM.length; at++) {
      expect(parse(STREAM.slice(0, at), STREAM.slice(at)), `cut at ${at}`).toEqual(EXPECTED)
    }
  })

  it('gives the same events when every character arrives alone', () => {
    expect(parse(...STREAM.split(''))).toEqual(EXPECTED)
  })

  it('returns each event from the chunk that completes it', () => {
    const parser = createSseParser()
    expect(parser.feed('event: delta\ndata: {"text":"a"}\n')).toEqual([])
    expect(parser.feed('\nevent: del')).toEqual([event('delta', '{"text":"a"}')])
    expect(parser.feed('ta\ndata: b\n\n')).toEqual([event('delta', 'b')])
  })

  it('accepts CRLF, CR and LF line endings, mixed', () => {
    expect(parse('data: a\r\n\r\ndata: b\r\rdata: c\n\n')).toEqual([
      event('message', 'a'),
      event('message', 'b'),
      event('message', 'c'),
    ])
  })

  it('reads a CRLF split between two chunks as one line break', () => {
    // Read as two breaks, the LF would close the event early and split "a" and "b".
    expect(parse('data: a\r', '\ndata: b\r', '\n\r', '\n')).toEqual([event('message', 'a\nb')])
  })

  it('joins several data lines with line feeds', () => {
    expect(parse('event: delta\ndata: first\ndata: second\ndata:\ndata: fourth\n\n')).toEqual([
      event('delta', 'first\nsecond\n\nfourth'),
    ])
  })

  it('ignores comments, alone or inside an event', () => {
    expect(parse(': keep-alive\n\n', ':\n', 'event: done\n: note\ndata: {}\n\n')).toEqual([
      event('done', '{}'),
    ])
  })

  it('removes only one space after the colon, and accepts none', () => {
    expect(parse('data:x\n\n', 'data:  two spaces\n\n')).toEqual([
      event('message', 'x'),
      event('message', ' two spaces'),
    ])
  })

  it('takes a line without a colon as a field with an empty value', () => {
    expect(parse('data\n\n')).toEqual([event('message', '')])
  })

  it('keeps colons inside the value', () => {
    expect(parse('data: {"a":"b:c"}\n\n')).toEqual([event('message', '{"a":"b:c"}')])
  })

  it('does not dispatch an event without data, and forgets its type', () => {
    expect(parse('event: delta\n\n', 'data: x\n\n')).toEqual([event('message', 'x')])
  })

  it('carries the last id over to later events and ignores ids with NULL', () => {
    expect(parse('id: 7\ndata: a\n\n', 'data: b\n\n', 'id: x\0y\ndata: c\n\n', 'id\ndata: d\n\n')).toEqual([
      event('message', 'a', '7'),
      event('message', 'b', '7'),
      event('message', 'c', '7'),
      event('message', 'd', ''),
    ])
  })

  it('ignores retry and unknown fields', () => {
    expect(parse('retry: 1000\nfoo: bar\ndata: x\n\n')).toEqual([event('message', 'x')])
  })

  it('drops a byte order mark only at the very start', () => {
    expect(parse('﻿data: a\n\n', 'data: ﻿b\n\n')).toEqual([event('message', 'a'), event('message', '﻿b')])
    expect(parse('', '﻿', 'data: a\n\n')).toEqual([event('message', 'a')])
  })

  it('never dispatches an event the stream cut off', () => {
    expect(parse('event: delta\ndata: {"text":"a"}\n\nevent: delta\ndata: {"text":"b"}\n')).toEqual([
      event('delta', '{"text":"a"}'),
    ])
  })

  it('keeps text that looks like markup or JSON exactly as sent', () => {
    expect(parse('data: <img src=x onerror=alert(1)>\n\n')).toEqual([
      event('message', '<img src=x onerror=alert(1)>'),
    ])
  })
})

describe('readSseEvents', () => {
  it('reads the events of a byte stream', async () => {
    expect(await collect(bytes(STREAM))).toEqual(EXPECTED)
  })

  it('decodes a character whose bytes arrive in different chunks', async () => {
    // "ñ" is C3 B1 and "🙂" is F0 9F 99 82 in UTF-8.
    const events = await collect(bytes('data: a', [0xc3], [0xb1, 0xf0, 0x9f], [0x99, 0x82], '\n\n'))
    expect(events).toEqual([event('message', 'añ🙂')])
  })

  it('cancels the body when the reader stops early', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\ndata: two\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    for await (const item of readSseEvents(stream)) {
      expect(item.data).toBe('one')
      break
    }
    expect(cancelled).toBe(true)
  })

  it('passes on a failure of the stream', async () => {
    let pulls = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls === 1) controller.enqueue(new TextEncoder().encode('data: one\n\n'))
        else controller.error(new TypeError('network'))
      },
    })
    const seen: string[] = []
    await expect(
      (async () => {
        for await (const item of readSseEvents(stream)) seen.push(item.data)
      })(),
    ).rejects.toThrow('network')
    expect(seen).toEqual(['one'])
  })
})
