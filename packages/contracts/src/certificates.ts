import { z } from 'zod'

const id = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case')

export const Certificate = z.object({
  id,
  title: z.string().min(1),
  issuer: z.string().min(1),
  issuedOn: z.iso.date(),
  hours: z.number().int().positive().optional(),
  // Path of the PDF inside the web app's public folder.
  file: z.string().regex(/^\/certificados\/[a-z0-9-]+\.pdf$/),
  // Slug of the Lab demo that proves this certificate (DEC-011), when it exists.
  demo: id.optional(),
})
export type Certificate = z.infer<typeof Certificate>
