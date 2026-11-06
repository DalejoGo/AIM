import { z } from 'zod'

export const SERVICE_IDS = ['web', 'app', 'automation', 'content', 'chatbot'] as const

export const ServiceId = z.enum(SERVICE_IDS)
export type ServiceId = z.infer<typeof ServiceId>

export const CURRENCIES = ['COP', 'USD'] as const
export const Currency = z.enum(CURRENCIES)
export type Currency = z.infer<typeof Currency>

/** An amount in every supported currency (whole units). Prices are edited in content files (DEC-006). */
export const Price = z.object({
  COP: z.number().int().nonnegative(),
  USD: z.number().int().nonnegative(),
})
export type Price = z.infer<typeof Price>

export const Service = z.object({
  id: ServiceId,
  // Spanish URL segment (/servicios/<slug>/).
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case'),
  order: z.number().int().nonnegative(),
  title: z.string().min(1),
  tagline: z.string().min(1),
  summary: z.string().min(1),
  includes: z.array(z.string().min(1)).min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  technologies: z.array(z.string().min(1)).min(1),
  idealFor: z.string().min(1),
  timeline: z.string().min(1),
  // Starting price. Absent: the site shows "Cotiza sin costo" (DEC-006).
  priceFrom: Price.optional(),
})
export type Service = z.infer<typeof Service>
