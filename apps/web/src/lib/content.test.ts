import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Certificate, Service } from '@aim/contracts'
import { describe, expect, it } from 'vitest'
import { faq, profile, quote, site } from './site'

const content = join(import.meta.dirname, '../content')
const publicDir = join(import.meta.dirname, '../../public')
const json = (path: string) => JSON.parse(readFileSync(join(content, path), 'utf8'))
const frontmatterSlug = (md: string) => /^slug:\s*(\S+)$/m.exec(md)?.[1]

describe('content', () => {
  it('parses the single-file configs', () => {
    expect(site.brand.name).toBe('AIM')
    expect(faq.length).toBeGreaterThan(0)
    expect(profile.experience.length).toBeGreaterThan(0)
  })

  it('names every service file after its id and quotes every service', () => {
    const services = readdirSync(join(content, 'services')).map((f) => ({
      f,
      s: Service.parse(json(`services/${f}`)),
    }))
    for (const { f, s } of services) expect(f).toBe(`${s.id}.json`)
    expect(quote.services.map((q) => q.service).sort()).toEqual(services.map(({ s }) => s.id).sort())
  })

  it('keeps each Markdown slug equal to its file name', () => {
    for (const dir of ['projects', 'lab']) {
      for (const f of readdirSync(join(content, dir))) {
        expect(frontmatterSlug(readFileSync(join(content, dir, f), 'utf8'))).toBe(f.replace(/\.md$/, ''))
      }
    }
  })

  it('links certificates to existing PDFs and Lab demos', () => {
    const labSlugs = new Set(readdirSync(join(content, 'lab')).map((f) => f.replace(/\.md$/, '')))
    const certificates = Certificate.array().parse(json('certificates.json'))
    for (const c of certificates) {
      expect(() => readFileSync(join(publicDir, c.file))).not.toThrow()
      if (c.demo) expect(labSlugs.has(c.demo)).toBe(true)
    }
  })
})
