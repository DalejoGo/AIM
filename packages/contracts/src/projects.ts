import { z } from 'zod'

export const ProjectKind = z.enum(['web', 'app', 'mobile', 'api', 'automation', 'ai'])
export type ProjectKind = z.infer<typeof ProjectKind>

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case')

export const Project = z
  .object({
    slug,
    title: z.string().min(1),
    summary: z.string().min(1).max(200),
    kind: ProjectKind,
    year: z.number().int().min(2020).max(2100),
    role: z.string().min(1),
    stack: z.array(z.string().min(1)).min(1),
    challenge: z.string().min(1),
    solution: z.string().min(1),
    results: z.array(z.string().min(1)).default([]),
    featured: z.boolean().default(false),
    // A project stays unlisted until David confirms it can be shown (DEC-008).
    public: z.boolean().default(false),
    links: z
      .object({
        demo: z.url().optional(),
        repo: z.url().optional(),
      })
      .default({}),
  })
  .refine((p) => p.public || !p.featured, {
    message: 'A featured project must be public',
    path: ['featured'],
  })
export type Project = z.infer<typeof Project>
