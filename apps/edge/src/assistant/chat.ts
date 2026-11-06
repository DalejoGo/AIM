// Body of POST /api/assistant/messages: the shape and limits live in @aim/contracts (CLAUDE.md, rule 6).
import type { ChatRequest } from '@aim/contracts'
import type { LlmMessage } from '../deps'

export {
  ASSISTANT_MAX_MESSAGE_LENGTH as MAX_MESSAGE_LENGTH,
  ASSISTANT_MAX_MESSAGES as MAX_MESSAGES,
  ChatRequest,
} from '@aim/contracts'

/** The model expects the conversation to start with the visitor: older answers cut off by the browser are dropped. */
export function toLlmMessages(messages: ChatRequest['messages']): LlmMessage[] {
  const first = messages.findIndex((m) => m.role === 'user')
  return messages.slice(first)
}
