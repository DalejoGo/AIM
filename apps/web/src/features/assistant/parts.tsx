import { CirclePause, Mail, MessageCircle } from 'lucide-preact'

// Pieces the assistant's chat and the code reviewer share, so both say and look the same.

export const NEW_TAB = <span class="sr-only"> (se abre en otra pestaña)</span>

/** The way out: whatever happens to the model, WhatsApp and the contact form stay one tap away. */
export function ContactExits({ whatsappUrl }: { whatsappUrl: string }) {
  return (
    <p class="text-step--1 text-muted">
      ¿Prefieres hablar con David?{' '}
      <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" class="link font-semibold">
        Escribir por WhatsApp
        {NEW_TAB}
      </a>{' '}
      o{' '}
      <a href="/contacto/" class="link font-semibold">
        usar el formulario de contacto
      </a>
      .
    </p>
  )
}

interface PausedNoticeProps {
  /** "El asistente está en pausa". */
  title: string
  whatsappUrl: string
  onRetry: () => void
}

/** 503 (no model) or no API behind /api: the contact channels take the place of the demo. */
export function PausedNotice({ title, whatsappUrl, onRetry }: PausedNoticeProps) {
  return (
    <div class="grid gap-3 rounded-xl border border-line bg-ink p-4">
      <h3 class="flex items-center gap-2 text-step-1 font-semibold">
        <CirclePause size={22} class="shrink-0 text-brand" aria-hidden="true" />
        {title}
      </h3>
      <p>
        Mientras vuelve, escríbele a David por WhatsApp o desde el formulario de contacto. Te responde
        personalmente.
      </p>
      <div class="flex flex-wrap gap-3">
        <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" class="btn btn-primary">
          <MessageCircle size={18} aria-hidden="true" />
          Escribir por WhatsApp
          {NEW_TAB}
        </a>
        <a href="/contacto/" class="btn btn-quiet">
          <Mail size={18} aria-hidden="true" />
          Ir al formulario de contacto
        </a>
      </div>
      <div>
        <button type="button" class="link text-step--1 font-semibold" onClick={onRetry}>
          Intentar de nuevo
        </button>
      </div>
    </div>
  )
}

/** Three pulsing dots while an answer streams (staggered with classes: the CSP blocks style attributes). */
export function TypingDots() {
  return (
    <span class="flex gap-1">
      {['[animation-delay:0ms]', '[animation-delay:150ms]', '[animation-delay:300ms]'].map((delay) => (
        <span
          key={delay}
          class={`size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none ${delay}`}
        />
      ))}
    </span>
  )
}
