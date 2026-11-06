import type { Captcha } from '../deps'

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare Turnstile server-side verification. */
export function turnstile(secret: string): Captcha {
  return {
    async verify(token, ip) {
      const form = new FormData()
      form.set('secret', secret)
      form.set('response', token)
      if (ip) form.set('remoteip', ip)
      const res = await fetch(SITEVERIFY, { method: 'POST', body: form })
      if (!res.ok) return false
      const body = (await res.json()) as { success?: boolean }
      return body.success === true
    },
  }
}

/** Fixed answer (tests). */
export function fixedCaptcha(answer: boolean): Captcha {
  return { verify: async () => answer }
}
