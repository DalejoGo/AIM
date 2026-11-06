import { z } from 'zod'

export const Certificate = z.object({
  title: z.string().min(1),
  topic: z.string().min(1),
  issuedOn: z.iso.date(),
  // Path of the PDF inside the web app's public folder.
  file: z.string().regex(/^\/certificados\/[a-z0-9-]+\.pdf$/),
})
export type Certificate = z.infer<typeof Certificate>
