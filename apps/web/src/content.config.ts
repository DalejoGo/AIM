import { defineCollection } from 'astro:content'
import { Certificate, Project, Service } from '@aim/contracts'
import { file, glob } from 'astro/loaders'
import { z } from 'zod'

const kebab = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'kebab-case')

/** A Lab demo (DEC-011). Adding one is adding a Markdown file to src/content/lab/. */
export const LabDemo = z
  .object({
    slug: kebab,
    title: z.string().min(1),
    summary: z.string().min(1).max(260),
    status: z.enum(['live', 'soon']),
    runsOn: z.enum(['browser', 'server']),
    href: z.string().startsWith('/').optional(),
    order: z.number().int().nonnegative(),
    stack: z.array(z.string().min(1)).min(1),
    certificates: z.array(kebab).default([]),
  })
  .refine((demo) => demo.status === 'soon' || demo.href !== undefined, {
    message: 'A live demo needs an href',
    path: ['href'],
  })
export type LabDemo = z.infer<typeof LabDemo>

export const collections = {
  services: defineCollection({
    loader: glob({ pattern: '*.json', base: './src/content/services' }),
    schema: Service,
  }),
  projects: defineCollection({
    loader: glob({ pattern: '*.md', base: './src/content/projects' }),
    schema: Project,
  }),
  lab: defineCollection({ loader: glob({ pattern: '*.md', base: './src/content/lab' }), schema: LabDemo }),
  certificates: defineCollection({ loader: file('./src/content/certificates.json'), schema: Certificate }),
}
