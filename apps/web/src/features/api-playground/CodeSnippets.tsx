import { useSignal } from '@preact/signals'
import { Check, Copy } from 'lucide-preact'
import { useEffect, useRef } from 'preact/hooks'
import type { PreparedRequest } from './request'
import { toCurl, toFetch } from './snippets'
import { codeBlock } from './ui'

export const CODE_HEADING = 'playground-code'

type TabId = 'curl' | 'fetch'

const TABS: { id: TabId; label: string }[] = [
  { id: 'curl', label: 'curl' },
  { id: 'fetch', label: 'fetch (JavaScript)' },
]

type CopyState = 'idle' | 'copied' | 'failed'

/** "Código equivalente": the current request as curl and fetch, ready to copy. Tabs follow the WAI-ARIA pattern. */
export function CodeSnippets({ request }: { request: PreparedRequest }) {
  const active = useSignal<TabId>('curl')
  const copy = useSignal<CopyState>('idle')
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])

  const code = active.value === 'curl' ? toCurl(request) : toFetch(request)

  // A new request or another tab means the copied text is no longer what is on screen.
  useEffect(() => {
    clearTimeout(timer.current)
    copy.value = 'idle'
  }, [code, copy])

  const select = (index: number) => {
    const tab = TABS[(index + TABS.length) % TABS.length]
    if (!tab) return
    active.value = tab.id
    buttons.current[TABS.indexOf(tab)]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: TABS.length - 1,
    }
    const next = moves[event.key]
    if (next === undefined) return
    event.preventDefault()
    select(next)
  }

  async function copyCode() {
    clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(code)
      copy.value = 'copied'
    } catch {
      // No clipboard API (insecure context) or permission denied: the code is on screen to select by hand.
      copy.value = 'failed'
    }
    timer.current = setTimeout(() => {
      copy.value = 'idle'
    }, 4000)
  }

  return (
    <section aria-labelledby={CODE_HEADING} class="grid min-w-0 content-start gap-4">
      <div class="grid gap-1">
        <h2 id={CODE_HEADING} class="text-step-2 font-semibold">
          Código equivalente
        </h2>
        <p class="text-step--1 text-muted">
          La misma petición, con tu sandbox, para tu terminal (bash, zsh o Git Bash) o tu código.
        </p>
      </div>
      <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-line">
        <div role="tablist" aria-labelledby={CODE_HEADING} class="flex flex-wrap gap-x-2">
          {TABS.map((tab, index) => {
            const selected = active.value === tab.id
            return (
              <button
                key={tab.id}
                ref={(element) => {
                  buttons.current[index] = element
                }}
                type="button"
                role="tab"
                id={`playground-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls="playground-code-panel"
                tabIndex={selected ? 0 : -1}
                class={`-mb-px border-b-2 px-3 py-2 font-semibold transition-colors ${
                  selected ? 'border-brand text-text' : 'border-transparent text-muted hover:text-text'
                }`}
                onClick={() => {
                  active.value = tab.id
                }}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          class="btn btn-quiet mb-2 min-h-9 px-3 py-1 text-step--1"
          onClick={() => void copyCode()}
        >
          {copy.value === 'copied' ? (
            <Check size={16} class="shrink-0 text-live" aria-hidden="true" />
          ) : (
            <Copy size={16} class="shrink-0" aria-hidden="true" />
          )}
          {copy.value === 'copied' ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <p role="status" class="sr-only">
        {copy.value === 'copied' ? `Copiaste el código de ${active.value}.` : ''}
      </p>
      {copy.value === 'failed' && (
        <p class="text-step--1 text-danger">No se pudo copiar. Selecciona el código y cópialo a mano.</p>
      )}
      <div
        role="tabpanel"
        id="playground-code-panel"
        aria-labelledby={`playground-tab-${active.value}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: tab panels take the focus after their tab list
        tabIndex={0}
      >
        <pre class={codeBlock}>
          <code>{code}</code>
        </pre>
      </div>
    </section>
  )
}
