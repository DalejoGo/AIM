import type { Mail } from '../deps'
import { CODE_TTL_MINUTES } from './otp'

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/** The mail with the one-time login code (DEC-017). */
export function loginCodeMail(to: string, code: string): Mail {
  const text = [
    'Hola,',
    '',
    `Tu código para entrar al panel de AIM es: ${code}`,
    '',
    `Vence en ${CODE_TTL_MINUTES} minutos y solo sirve una vez.`,
    '',
    'Si no lo pediste, ignora este correo: sin el código nadie puede entrar.',
  ].join('\n')

  const html = [
    '<!doctype html>',
    '<html lang="es"><body style="font-family:system-ui,sans-serif;color:#111;line-height:1.5">',
    '<p>Hola,</p>',
    '<p>Tu código para entrar al panel de AIM es:</p>',
    `<p style="font-family:monospace;font-size:28px;font-weight:700;letter-spacing:6px">${escapeHtml(code)}</p>`,
    `<p>Vence en ${escapeHtml(String(CODE_TTL_MINUTES))} minutos y solo sirve una vez.</p>`,
    '<p style="color:#555">Si no lo pediste, ignora este correo: sin el código nadie puede entrar.</p>',
    '</body></html>',
  ].join('\n')

  return { to, subject: 'Tu código para entrar a AIM', text, html }
}
