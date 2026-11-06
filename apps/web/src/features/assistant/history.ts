/**
 * What the browser sends to POST /api/assistant/messages. The conversation lives only in memory: each question
 * goes with the latest turns. The limits come from @aim/contracts (ChatRequest).
 */

import { ASSISTANT_MAX_MESSAGE_LENGTH, ASSISTANT_MAX_MESSAGES } from '@aim/contracts/limits'

export const MAX_MESSAGES = ASSISTANT_MAX_MESSAGES
export const MAX_MESSAGE_LENGTH = ASSISTANT_MAX_MESSAGE_LENGTH

export type Role = 'user' | 'assistant'

export interface Turn {
  role: Role
  content: string
}

// \p{Cc} = control characters. Line breaks and tabs stay, as the API keeps them.
const CONTROL_BUT_LINE_BREAKS = /[^\P{Cc}\n\t]/gu

/** The text the API will see: CRLF as LF, no control characters, no surrounding spaces. */
export function normalizeContent(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_BUT_LINE_BREAKS, '').trim()
}

/**
 * Cuts a text to `max` UTF-16 units (the unit the API counts), ending in an ellipsis and never splitting
 * an emoji or any other surrogate pair.
 */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = text.slice(0, Math.max(0, max - 1))
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut.trimEnd()}…`
}

interface HistoryLimits {
  maxMessages?: number
  maxLength?: number
}

/**
 * The turns for the next request: the last `maxMessages` (10), starting and ending with the visitor.
 * Empty turns (a stopped answer that never began) are left out; when two turns of the same role meet
 * (a question that got no answer), only the latest stays. Long answers are clipped so every turn fits
 * the API's limit. Returns [] when there is no question to send.
 */
export function buildHistory(
  turns: readonly Turn[],
  { maxMessages = MAX_MESSAGES, maxLength = MAX_MESSAGE_LENGTH }: HistoryLimits = {},
): Turn[] {
  const alternating: Turn[] = []
  for (const turn of turns) {
    const content = normalizeContent(turn.content)
    if (!content) continue
    const next = { role: turn.role, content: clip(content, maxLength) }
    if (alternating.at(-1)?.role === turn.role) alternating[alternating.length - 1] = next
    else alternating.push(next)
  }
  while (alternating.at(-1)?.role === 'assistant') alternating.pop()
  const recent = alternating.slice(-maxMessages)
  while (recent[0]?.role === 'assistant') recent.shift()
  return recent
}
