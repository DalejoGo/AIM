// Plain constants (no zod): browser islands import them from '@aim/contracts/limits' without pulling schemas in.

/** POST /api/assistant/messages: how many turns travel with each question, and how long each may be. */
export const ASSISTANT_MAX_MESSAGES = 10
export const ASSISTANT_MAX_MESSAGE_LENGTH = 1000
