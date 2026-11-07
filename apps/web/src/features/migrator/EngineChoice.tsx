import { CircleAlert, CircleCheck, Hourglass, LoaderCircle, RotateCcw } from 'lucide-preact'
import { useId } from 'preact/hooks'
import { formatDuration } from '../api-playground/response'
import { formatBytes, formatCount, MAX_BYTES, MAX_ROWS } from './file'
import { type Engine, SERVER_WAKING_TEXT } from './server'

/** Where the Python engine stands while the visitor picks a file. */
export type ServerStatus =
  | { phase: 'idle' }
  | { phase: 'checking'; elapsedMs: number; waking: boolean }
  | { phase: 'ready'; totalMs: number; woke: boolean }
  | { phase: 'unavailable'; message: string }

interface Props {
  engine: Engine
  disabled: boolean
  status: ServerStatus
  onChange: (engine: Engine) => void
  onRetry: () => void
}

const choiceClass =
  'flex cursor-pointer gap-3 rounded-xl border border-line bg-raised p-4 transition-colors hover:border-brand has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-70'
const inputClass = 'mt-1 size-5 shrink-0 cursor-pointer accent-brand disabled:cursor-not-allowed'

/** The two engines as radio cards, and, for the server, whether it is awake. */
export function EngineChoice({ engine, disabled, status, onChange, onRetry }: Props) {
  const name = useId()
  const browserHint = useId()
  const serverHint = useId()

  return (
    <div class="grid gap-3">
      <fieldset class="grid gap-3" disabled={disabled}>
        <legend class="mb-3 font-semibold">¿Dónde quieres procesar el archivo?</legend>
        <div class="grid gap-3 sm:grid-cols-2">
          <label class={choiceClass}>
            <input
              type="radio"
              name={name}
              value="browser"
              checked={engine === 'browser'}
              aria-describedby={browserHint}
              class={inputClass}
              onChange={() => onChange('browser')}
            />
            <span class="grid min-w-0 gap-1">
              <span class="font-semibold">En tu navegador (TypeScript)</span>
              <span id={browserHint} class="text-step--1 text-muted">
                El archivo nunca sale de tu dispositivo. CSV de hasta {formatBytes(MAX_BYTES)} y{' '}
                {formatCount(MAX_ROWS)} filas.
              </span>
            </span>
          </label>
          <label class={choiceClass}>
            <input
              type="radio"
              name={name}
              value="server"
              checked={engine === 'server'}
              aria-describedby={serverHint}
              class={inputClass}
              onChange={() => onChange('server')}
            />
            <span class="grid min-w-0 gap-1">
              <span class="font-semibold">En el servidor (Python + FastAPI)</span>
              <span id={serverHint} class="text-step--1 text-muted">
                También Excel y archivos más grandes. El archivo se envía al servidor, se procesa en memoria y
                no se guarda.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
      {engine === 'server' && <ServerState status={status} onRetry={onRetry} />}
    </div>
  )
}

function ServerState({ status, onRetry }: { status: ServerStatus; onRetry: () => void }) {
  const line = 'flex items-start gap-2 text-step--1'
  // The live region changes only when the phase does; the seconds counter beside it is not read out.
  return (
    <div class="grid gap-2" data-testid="server-state">
      <p aria-live="polite" class={line}>
        {status.phase === 'checking' && !status.waking && (
          <>
            <LoaderCircle size={18} class="mt-0.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            Conectando con el servidor…
          </>
        )}
        {status.phase === 'checking' && status.waking && (
          <>
            <Hourglass size={18} class="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
            {SERVER_WAKING_TEXT}
          </>
        )}
        {status.phase === 'ready' && (
          <>
            <CircleCheck size={18} class="mt-0.5 shrink-0 text-live" aria-hidden="true" />
            {status.woke
              ? `Servidor listo: estaba dormido y tardó ${formatDuration(status.totalMs)} en despertar.`
              : 'Servidor listo.'}
          </>
        )}
        {status.phase === 'unavailable' && (
          <>
            <CircleAlert size={18} class="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
            {status.message}
          </>
        )}
      </p>
      {status.phase === 'checking' && status.elapsedMs >= 1000 && (
        <p class="text-step--1 text-muted tabular-nums" aria-hidden="true">
          Llevas {formatDuration(Math.floor(status.elapsedMs / 1000) * 1000)} esperando.
        </p>
      )}
      {status.phase === 'unavailable' && (
        <div>
          <button type="button" class="btn btn-quiet" onClick={onRetry}>
            <RotateCcw size={18} class="shrink-0" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}
    </div>
  )
}
