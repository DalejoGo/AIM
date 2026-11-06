import { z } from 'zod'
import { Price, ServiceId } from './services'

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case')

export const QuoteOption = z.object({
  id,
  label: z.string().min(1),
  description: z.string().min(1),
  price: Price,
})
export type QuoteOption = z.infer<typeof QuoteOption>

export const QuoteService = z.object({
  service: ServiceId,
  base: Price,
  options: z.array(QuoteOption),
})
export type QuoteService = z.infer<typeof QuoteService>

export const QuoteTimeline = z.object({
  id,
  label: z.string().min(1),
  // Applied to the subtotal: 1 is the normal pace, above 1 is a rush.
  multiplier: z.number().min(0.5).max(3),
})
export type QuoteTimeline = z.infer<typeof QuoteTimeline>

/** Cotizador configuration, edited in content (DEC-006); the API reuses it in Phase 2. */
export const QuoteConfig = z
  .object({
    services: z.array(QuoteService).min(1),
    timelines: z.array(QuoteTimeline).min(1),
    // The estimate is shown as a range: [subtotal, subtotal * (1 + spread)].
    spread: z.number().min(0).max(1),
  })
  .superRefine((config, ctx) => {
    const seen = new Set<string>()
    for (const [i, s] of config.services.entries()) {
      if (seen.has(s.service))
        ctx.addIssue({ code: 'custom', message: 'Duplicate service', path: ['services', i] })
      seen.add(s.service)
    }
  })
export type QuoteConfig = z.infer<typeof QuoteConfig>
