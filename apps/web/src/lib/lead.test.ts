import { describe, expect, it } from 'vitest'
import { ApiRequestError } from './api'
import {
  EMAIL_OR_PHONE,
  firstLeadError,
  type LeadDraft,
  leadFieldMessage,
  leadServerProblem,
  QUOTE_PROBLEM,
  validateLead,
} from './lead'

const draft = (overrides: Partial<LeadDraft> = {}): LeadDraft => ({
  name: '  Ana Pérez ',
  email: ' ana@example.com ',
  phone: '',
  service: 'web',
  message: ' Quiero una página para mi panadería. ',
  consent: true,
  turnstileToken: 'token',
  ...overrides,
})

describe('validateLead', () => {
  it('returns the trimmed submission', () => {
    const result = validateLead(draft())
    expect(result).toEqual({
      ok: true,
      lead: {
        name: 'Ana Pérez',
        email: 'ana@example.com',
        service: 'web',
        message: 'Quiero una página para mi panadería.',
        consent: true,
        turnstileToken: 'token',
      },
    })
  })

  it('accepts a phone without e-mail and normalizes it', () => {
    const result = validateLead(draft({ email: '', phone: '300 123 4567', service: 'other' }))
    expect(result.ok && result.lead).toMatchObject({ phone: '573001234567', service: 'other' })
    expect(result.ok && result.lead.email).toBeUndefined()
  })

  it('asks for an e-mail or a phone, together with the other errors', () => {
    const result = validateLead(draft({ name: 'A', email: '', phone: '' }))
    expect(result).toEqual({
      ok: false,
      errors: { name: leadFieldMessage('name'), email: EMAIL_OR_PHONE },
    })
  })

  it('marks every invalid field in Spanish', () => {
    const result = validateLead(
      draft({
        email: 'ana@',
        phone: '300 12',
        service: '',
        message: 'Hola',
        consent: false,
        turnstileToken: null,
      }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors).toEqual({
      email: leadFieldMessage('email'),
      phone: leadFieldMessage('phone'),
      service: leadFieldMessage('service'),
      message: leadFieldMessage('message'),
      consent: leadFieldMessage('consent'),
      turnstileToken: leadFieldMessage('turnstileToken'),
    })
    expect(firstLeadError(result.errors)).toBe('email')
  })

  it('explains a message that is too long', () => {
    const result = validateLead(draft({ message: 'a'.repeat(2001) }))
    expect(!result.ok && result.errors.message).toBe(leadFieldMessage('message', 'too_big'))
    expect(leadFieldMessage('message', 'too_big')).toContain('2000')
  })

  it('keeps the quote snapshot', () => {
    const quote = {
      service: 'web' as const,
      options: ['blog'],
      timeline: 'normal',
      currency: 'COP' as const,
      min: 1,
      max: 2,
    }
    const result = validateLead(draft({ quote }))
    expect(result.ok && result.lead.quote).toEqual(quote)
  })
})

describe('leadServerProblem', () => {
  const error = (
    code: string,
    fields: Record<string, string[]> = {},
    message = 'Revisa los datos marcados.',
  ) => new ApiRequestError({ status: code === 'captcha_failed' ? 422 : 400, code, message, fields })

  it('maps API field keys to Spanish messages and keeps the general message', () => {
    const problem = leadServerProblem(
      error('invalid_request', { email: ['Invalid email address'], message: ['Too small'] }),
    )
    expect(problem).toEqual({
      errors: { email: leadFieldMessage('email'), message: leadFieldMessage('message') },
      form: 'Revisa los datos marcados.',
    })
  })

  it('puts a failed captcha on the verification', () => {
    const problem = leadServerProblem(
      error('captcha_failed', {}, 'No pudimos confirmar que eres una persona.'),
    )
    expect(problem).toEqual({
      errors: { turnstileToken: 'No pudimos confirmar que eres una persona.' },
      form: null,
    })
  })

  it('explains problems with the quote snapshot', () => {
    expect(leadServerProblem(error('invalid_request', { 'quote.max': ['Too small'] })).form).toBe(
      QUOTE_PROBLEM,
    )
  })

  it('keeps the message of errors without fields', () => {
    expect(leadServerProblem(error('rate_limited', {}, 'Espera 5 minutos.'))).toEqual({
      errors: {},
      form: 'Espera 5 minutos.',
    })
  })
})
