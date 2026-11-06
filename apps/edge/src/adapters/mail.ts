import type { Mail, Mailer } from '../deps'

/** Resend's HTTP API (DEC-016). */
export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(mail: Mail) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        }),
      })
      if (!res.ok) throw new Error(`Resend answered ${res.status}`)
    },
  }
}

/** Mailpit's send API, for local development (docker-compose.yml, port 8026). */
export function mailpitMailer(baseUrl: string, from: string): Mailer {
  return {
    async send(mail: Mail) {
      const res = await fetch(new URL('/api/v1/send', baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: { Email: from },
          To: [{ Email: mail.to }],
          Subject: mail.subject,
          Text: mail.text,
          HTML: mail.html,
        }),
      })
      if (!res.ok) throw new Error(`Mailpit answered ${res.status}`)
    },
  }
}

/** Keeps every mail in memory (tests). */
export function memoryMailer(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = []
  return {
    sent,
    async send(mail: Mail) {
      sent.push(mail)
    },
  }
}
