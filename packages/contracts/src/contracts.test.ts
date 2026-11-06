import { describe, expect, it } from 'vitest'
import { CreateLead, Project } from './index'

const lead = {
  name: 'Ana Pérez',
  email: 'ana@example.com',
  service: 'web',
  message: 'Necesito una página para mi negocio.',
  consent: true,
}

describe('CreateLead', () => {
  it('accepts a valid lead', () => {
    expect(CreateLead.parse(lead)).toMatchObject({ name: 'Ana Pérez', service: 'web' })
  })

  it('accepts a phone instead of an email', () => {
    const { email: _, ...rest } = lead
    expect(CreateLead.safeParse({ ...rest, phone: '573001234567' }).success).toBe(true)
  })

  it('requires an email or a phone', () => {
    const { email: _, ...rest } = lead
    expect(CreateLead.safeParse(rest).success).toBe(false)
  })

  it('requires explicit consent', () => {
    expect(CreateLead.safeParse({ ...lead, consent: false }).success).toBe(false)
  })

  it('rejects unknown services', () => {
    expect(CreateLead.safeParse({ ...lead, service: 'seo' }).success).toBe(false)
  })
})

describe('Project', () => {
  const project = {
    slug: 'agencia-de-viajes',
    title: 'Agencia de viajes',
    summary: 'Plataforma de reservas.',
    kind: 'web',
    year: 2026,
    role: 'Desarrollo full stack',
    stack: ['Astro', 'Hono'],
    challenge: 'Reto',
    solution: 'Solución',
  }

  it('defaults to unlisted and not featured', () => {
    expect(Project.parse(project)).toMatchObject({ public: false, featured: false, results: [], links: {} })
  })

  it('rejects a featured project that is not public', () => {
    expect(Project.safeParse({ ...project, featured: true }).success).toBe(false)
  })

  it('rejects slugs that are not kebab-case', () => {
    expect(Project.safeParse({ ...project, slug: 'Agencia Viajes' }).success).toBe(false)
  })
})
