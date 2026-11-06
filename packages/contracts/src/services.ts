import { z } from 'zod'

export const SERVICE_IDS = ['web', 'app', 'automation', 'content', 'chatbot'] as const

export const ServiceId = z.enum(SERVICE_IDS)
export type ServiceId = z.infer<typeof ServiceId>

export const Service = z.object({
  id: ServiceId,
  title: z.string().min(1),
  tagline: z.string().min(1),
  includes: z.array(z.string().min(1)).min(1),
  deliverables: z.array(z.string().min(1)).min(1),
  technologies: z.array(z.string().min(1)).min(1),
  idealFor: z.string().min(1),
  // Starting price in COP. Absent until David sets it (DEC-006): the site then shows "Cotiza sin costo".
  priceFrom: z.number().int().positive().optional(),
})
export type Service = z.infer<typeof Service>
