import { useSignal } from '@preact/signals'
import { Upload } from 'lucide-preact'
import { useEffect, useId } from 'preact/hooks'
import { formatBytes, formatCount, MAX_BYTES, MAX_ROWS } from './file'

interface Props {
  disabled: boolean
  onFile: (file: File) => void
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files')

/** File picker that also accepts drag and drop. It is a real file input, so it works with the keyboard. */
export function DropZone({ disabled, onFile }: Props) {
  const dragging = useSignal(false)
  const hintId = useId()

  // A file dropped next to the zone would make the browser leave the page to open it.
  useEffect(() => {
    const block = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  const onDragOver = (event: DragEvent) => {
    if (disabled || !hasFiles(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    dragging.value = true
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    dragging.value = false
    const file = event.dataTransfer?.files[0]
    if (file && !disabled) onFile(file)
  }

  const onChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    // Clearing the value lets the same file be chosen again after fixing it.
    input.value = ''
    if (file) onFile(file)
  }

  return (
    <div class="grid gap-2">
      <label
        class={`grid cursor-pointer justify-items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-4 has-[:focus-visible]:outline-brand ${
          dragging.value ? 'border-brand bg-brand/10' : 'border-line bg-raised hover:border-brand'
        } ${disabled ? 'cursor-wait opacity-70' : ''}`}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={() => {
          dragging.value = false
        }}
        onDrop={onDrop}
      >
        <input
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          class="sr-only"
          disabled={disabled}
          aria-describedby={hintId}
          onChange={onChange}
        />
        <Upload class="pointer-events-none text-brand" size={32} aria-hidden="true" />
        <span class="pointer-events-none text-step-1 font-semibold">
          {dragging.value ? (
            'Suelta el archivo para procesarlo'
          ) : (
            <>
              Arrastra tu CSV aquí o <span class="link">elige un archivo</span>
            </>
          )}
        </span>
      </label>
      <p id={hintId} class="text-step--1 text-muted">
        Hasta {formatBytes(MAX_BYTES)} y {formatCount(MAX_ROWS)} filas, separado por comas o punto y coma, con
        los nombres de las columnas en la primera fila.
      </p>
    </div>
  )
}
