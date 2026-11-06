import { z } from 'zod'
import { ServiceId } from './services'

export const LeadService = z.union([ServiceId, z.literal('other')])

export const CreateLead = z
  .object({
    name: z.string().trim().min(2).max(80),
    email: z.email().max(254).optional(),
    // International format, digits only (e.g. 573001234567).
    phone: z
      .string()
      .regex(/^\d{8,15}$/)
      .optional(),
    service: LeadService,
    message: z.string().trim().min(10).max(2000),
    // Explicit acceptance of the privacy policy (Ley 1581 de 2012).
    consent: z.literal(true),
  })
  .refine((lead) => lead.email !== undefined || lead.phone !== undefined, {
    message: 'Provide an email or a phone number',
    path: ['email'],
  })
export type CreateLead = z.infer<typeof CreateLead>
