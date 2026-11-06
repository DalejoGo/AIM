import type { ComponentChildren } from 'preact'
import { useId } from 'preact/hooks'

interface RegionProps {
  /** Accessible name, or the id of the element that names the region. */
  label?: string
  labelledBy?: string
  class?: string
  children: ComponentChildren
}

/**
 * A block that scrolls on narrow screens. It is focusable so keyboard users can scroll it too (WCAG 2.1.1),
 * and it is a named region so screen readers announce what it holds. `relative` keeps visually hidden text
 * (absolutely positioned) clipped inside it instead of widening the page.
 */
export function ScrollRegion({ label, labelledBy, class: extra = '', children }: RegionProps) {
  return (
    <section
      aria-label={label}
      aria-labelledby={labelledBy}
      class={`relative overflow-auto rounded-xl border border-line bg-raised ${extra}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable with the keyboard.
      tabIndex={0}
    >
      {children}
    </section>
  )
}

interface TableProps {
  caption: ComponentChildren
  children: ComponentChildren
}

/** A table that scrolls sideways on narrow screens, named by its caption. */
export function ScrollTable({ caption, children }: TableProps) {
  const captionId = useId()
  return (
    <ScrollRegion labelledBy={captionId}>
      <table class="w-full border-collapse text-left text-step--1">
        <caption id={captionId} class="px-4 pt-3 pb-2 text-left text-muted">
          {caption}
        </caption>
        {children}
      </table>
    </ScrollRegion>
  )
}

/** Shared cell styles so every table reads the same. */
export const th = 'border-b border-line px-4 py-2 align-bottom font-semibold'
export const td = 'border-b border-line px-4 py-2 align-top'
/** Real data from the file: monospaced and on one line, with spaces kept so stray ones are visible. */
export const data = 'font-mono whitespace-pre'
