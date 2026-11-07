import { CircleCheck, LoaderCircle } from 'lucide-preact'
import { formatClock, type WakeWatch } from './wake'

/**
 * The early wake-up of n8n, next to the form. A polite live region that is always in the page (so changes are
 * read) and empty, hence hidden, when there is nothing to say. The counter is not read every second.
 */
export function WakeNotice({ watch }: { watch: WakeWatch }) {
  const view = watch.view.value
  return (
    <p role="status" class="flex gap-2 rounded-xl border border-line p-3 text-step--1 empty:hidden">
      {view === 'waking' && (
        <>
          <LoaderCircle
            size={18}
            class="mt-0.5 shrink-0 animate-spin text-brand motion-reduce:animate-none"
            aria-hidden="true"
          />
          <span>
            Despertando n8n en el servidor gratuito…{' '}
            <span aria-hidden="true" class="font-semibold tabular-nums">
              {formatClock(watch.elapsedMs.value)}
            </span>{' '}
            — puedes ir llenando el formulario.
          </span>
        </>
      )}
      {view === 'ready' && (
        <>
          <CircleCheck size={18} class="mt-0.5 shrink-0 text-live" aria-hidden="true" />
          <span>n8n está listo: tu ejecución arrancará al instante.</span>
        </>
      )}
    </p>
  )
}
