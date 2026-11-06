import { Fragment } from 'preact'
import { useMemo } from 'preact/hooks'
import { type Inline, parseRichText, type RichTextOptions } from './richText'

interface PieceProps {
  piece: Inline
  /** False while the answer streams: its bubble is hidden from screen readers, so it holds no links yet. */
  interactive: boolean
}

function Piece({ piece, interactive }: PieceProps) {
  let content = <>{piece.text}</>
  if (piece.type === 'code') {
    content = <code class="rounded border border-line px-1 font-mono text-[0.875em]">{piece.text}</code>
  } else if (piece.type === 'link') {
    // Every link opens in another tab: following one here would lose the conversation, which lives in memory.
    content = interactive ? (
      <a
        href={piece.href}
        target="_blank"
        rel={piece.href.startsWith('/') ? 'noopener' : 'noopener noreferrer'}
        class="link"
      >
        {piece.text}
        <span class="sr-only"> (se abre en otra pestaña)</span>
      </a>
    ) : (
      <span class="text-brand underline underline-offset-[0.2em]">{piece.text}</span>
    )
  }
  return piece.strong ? <strong class="font-semibold">{content}</strong> : content
}

function Line({ pieces, interactive }: { pieces: Inline[]; interactive: boolean }) {
  return (
    <>
      {pieces.map((piece, index) => (
        <Piece key={index} piece={piece} interactive={interactive} />
      ))}
    </>
  )
}

interface RichTextProps extends RichTextOptions {
  text: string
  interactive?: boolean
}

/**
 * An answer as paragraphs, lists and bold text, built from elements (no innerHTML). With `code` and
 * `headings` (the code reviewer), also code and section headings (h3: the answer sits under an h2).
 */
export function RichText({ text, interactive = true, code = false, headings = false }: RichTextProps) {
  const blocks = useMemo(() => parseRichText(text, { code, headings }), [text, code, headings])
  return (
    <div class="grid gap-3">
      {blocks.map((block, index) => {
        if (block.type === 'paragraph') {
          return (
            <p key={index}>
              {block.lines.map((line, number) => (
                <Fragment key={number}>
                  {number > 0 && <br />}
                  <Line pieces={line} interactive={interactive} />
                </Fragment>
              ))}
            </p>
          )
        }
        if (block.type === 'heading') {
          return (
            <h3 key={index} class={`text-step-1 font-semibold ${index > 0 ? 'mt-3' : ''}`}>
              <Line pieces={block.text} interactive={interactive} />
            </h3>
          )
        }
        if (block.type === 'code') {
          // Long lines wrap instead of scrolling: no scroll region to reach with the keyboard.
          return (
            <pre
              key={index}
              class="rounded-lg border border-line bg-raised p-3 font-mono text-step--1 leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"
            >
              <code>{block.text}</code>
            </pre>
          )
        }
        const items = block.items.map((item, number) => (
          <li key={number}>
            <Line pieces={item} interactive={interactive} />
          </li>
        ))
        return block.ordered ? (
          <ol key={index} start={block.start} class="grid list-decimal gap-1 pl-6">
            {items}
          </ol>
        ) : (
          <ul key={index} class="grid list-disc gap-1 pl-6">
            {items}
          </ul>
        )
      })}
    </div>
  )
}
