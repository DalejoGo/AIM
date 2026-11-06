import { Currency, QuoteConfig } from '@aim/contracts'
import { z } from 'zod'
import faqJson from '../content/faq.json'
import profileJson from '../content/profile.json'
import quoteJson from '../content/quote.json'
import siteJson from '../content/site.json'
import { resolveSiteKey } from '../features/turnstile/siteKey'
import { whatsappLink } from './whatsapp'

// Single-file content (DEC-012): parsed at build time, so a typo in a JSON file fails the build instead of the page.

export const SiteConfig = z.object({
  brand: z.object({
    name: z.string().min(1),
    /** Official name (DEC-001): page titles, structured data, e-mails. */
    fullName: z.string().min(1),
    descriptor: z.string().min(1),
    tagline: z.string().min(1),
    description: z.string().min(1).max(200),
  }),
  founder: z.object({ name: z.string().min(1), shortName: z.string().min(1), role: z.string().min(1) }),
  contact: z.object({
    whatsapp: z.string().regex(/^\d{8,15}$/),
    whatsappMessage: z.string().min(1),
    email: z.email().optional(),
    linkedin: z.url().optional(),
    github: z.url().optional(),
    platzi: z.url().optional(),
  }),
  currency: z.object({ default: Currency }),
  media: z.object({
    cv: z.string().startsWith('/'),
    video: z.string().startsWith('/'),
    videoPoster: z.string().startsWith('/'),
    ogImage: z.string().startsWith('/'),
    logo: z.string().startsWith('/'),
  }),
})
export type SiteConfig = z.infer<typeof SiteConfig>

export const Faq = z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).min(1)

export const Profile = z.object({
  summary: z.string().min(1),
  experience: z.array(
    z.object({
      company: z.string().min(1),
      role: z.string().min(1),
      current: z.boolean(),
      description: z.string().min(1),
    }),
  ),
  education: z.array(
    z.object({ title: z.string().min(1), institution: z.string().nullable(), period: z.string().nullable() }),
  ),
  skills: z.array(z.object({ group: z.string().min(1), items: z.array(z.string().min(1)).min(1) })),
})

export const site = SiteConfig.parse(siteJson)
export const faq = Faq.parse(faqJson)
export const profile = Profile.parse(profileJson)
export const quote = QuoteConfig.parse(quoteJson)

export const whatsapp = (message: string = site.contact.whatsappMessage) =>
  whatsappLink(site.contact.whatsapp, message)

/** Turnstile site key for this build (build time only: APP_ENV is not exposed to the browser). */
export const turnstileSiteKey = () =>
  resolveSiteKey({ siteKey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY, appEnv: process.env.APP_ENV })
