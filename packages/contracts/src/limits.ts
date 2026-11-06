// Plain constants (no zod): browser islands import them from '@aim/contracts/limits' without pulling schemas in.

/** POST /api/assistant/messages: how many turns travel with each question, and how long each may be. */
export const ASSISTANT_MAX_MESSAGES = 10
export const ASSISTANT_MAX_MESSAGE_LENGTH = 1000

/** POST /api/assistant/review: the languages the reviewer is told about ("otro": it works it out). */
export const CODE_REVIEW_LANGUAGES = ['typescript', 'javascript', 'python', 'sql', 'otro'] as const

/** POST /api/assistant/review: the longest fragment, in UTF-16 units (what a textarea's maxlength counts). */
export const CODE_REVIEW_MAX_LENGTH = 4000
