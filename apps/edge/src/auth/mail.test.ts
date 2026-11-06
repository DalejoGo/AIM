import { describe, expect, it } from 'vitest'
import { escapeHtml, loginCodeMail } from './mail'

describe('login code mail', () => {
  it('says what to do in Spanish, in text and html', () => {
    const mail = loginCodeMail('admin@aim.test', '042137')
    expect(mail.to).toBe('admin@aim.test')
    expect(mail.subject).toBe('Tu código para entrar a AIM')
    for (const body of [mail.text, mail.html ?? '']) {
      expect(body).toContain('042137')
      expect(body).toContain('10 minutos')
      expect(body).toContain('Si no lo pediste, ignora este correo')
    }
  })

  it('escapes what it interpolates into html', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
    expect(loginCodeMail('a@aim.test', '<b>').html).toContain('&lt;b&gt;')
  })
})
