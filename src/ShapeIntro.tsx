import { useLayoutEffect, useRef, useState } from 'react'
import { UNIT_SIZE } from './vendor/warp.js'
import { fitInBox } from './shapeTextLayout'

/**
 * The song's title card, drawn into a `song-intro` shape.
 *
 * **A locked template, and that is the design rather than a shortcut.** There are no formatting
 * controls: the only handles are the shape's position and size, which move all three parts
 * together. **Pregonero fills it; it never styles it.** The three parts come from the song file —
 * translated title, title, tagline — and every proportion below was decided from a mock (variant
 * B1, 2026-08-24) and is Muralista's, matched value for value against `mapper.css`.
 *
 * **The wall speaks in the instrument's voice here.** Ink ground, paper and dim text, one clay
 * accent, monospace throughout, no radii — Pregonero's own control vocabulary, chosen deliberately
 * so the audience sees the instrument rather than the site.
 *
 * **The title is not a font size.** It is a fraction of the shape with auto-fit below it, and every
 * other measure is a multiple of it, so the whole card shrinks as one thing and the proportions
 * survive at any size the block lands on. A hardcoded line count or pixel size breaks on the first
 * title of a different length — two of the real titles run to two lines.
 *
 * A frame-filling variant was mocked and rejected: the intro shape on a real wall is often small,
 * a panel beside the main area rather than the whole wall, and a title sized to fill the frame
 * leaves the tagline microscopic once the shape shrinks.
 *
 * **The tagline is the fragile part** — smallest on the wall, carrying the sentence the room is
 * meant to leave with. It is the first thing to check at a wall.
 */

/** Of the shape's height. Auto-fit only goes below it. */
export const INTRO_TITLE_MAX_SIZE = 0.16
/** Of the shape's width, left and right. */
export const INTRO_INSET = 0.07

const INK = '#121211'
const PAPER = '#e6dfd1'
const DIM = '#8b8478'
const CLAY = '#d98b7a'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

export type IntroParts = {
  title: string
  /** The translated title, shown as an annotation above the title. Absent when there is none. */
  annotation?: string
  tagline?: string
}

type Props = {
  parts: IntroParts
  /** The layout box's width in whole pixels — the quad's stretch, taken back out. */
  boxWidth: number
  testId?: string
}

export function ShapeIntro({ parts, boxWidth, testId }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const blockRef = useRef<HTMLDivElement | null>(null)
  const maxPx = INTRO_TITLE_MAX_SIZE * UNIT_SIZE
  const [t, setT] = useState(maxPx)

  useLayoutEffect(() => {
    const panel = panelRef.current
    const block = blockRef.current
    if (!panel || !block) return
    // One number for the whole card: everything inside is a multiple of it, so searching over it
    // keeps every proportion exactly where the mock put it.
    setT(
      fitInBox(
        panel,
        block,
        (px) => block.style.setProperty('--t', `${px}px`),
        maxPx,
        Math.round(INTRO_INSET * boxWidth),
        Math.round(INTRO_INSET * UNIT_SIZE)
      )
    )
  }, [parts.title, parts.annotation, parts.tagline, boxWidth, maxPx])

  return (
    <div
      ref={panelRef}
      className="layer-intro"
      data-testid={testId ?? 'song-intro-screen'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${boxWidth}px`,
        height: `${UNIT_SIZE}px`,
        padding: `${Math.round(INTRO_INSET * UNIT_SIZE)}px ${Math.round(INTRO_INSET * boxWidth)}px`,
        boxSizing: 'border-box',
        display: 'flex',
        // The block is vertically centred, always.
        alignItems: 'center',
        transformOrigin: '0 0',
        transform: `scaleX(${UNIT_SIZE / boxWidth})`,
        background: INK,
        fontFamily: MONO,
        // Left-aligned, never centred.
        textAlign: 'left',
      }}
    >
      <div ref={blockRef} className="intro-block" style={{ width: '100%' }}>
        {parts.annotation && (
          <div
            className="intro-head"
            style={{ display: 'flex', alignItems: 'center', gap: `${t * 0.1}px` }}
          >
            <span
              className="intro-rule"
              data-testid="intro-rule"
              style={{
                flex: '0 0 auto',
                width: `${t * 0.4}px`,
                height: `${t * 0.04}px`,
                background: CLAY,
              }}
            />
            <span
              className="intro-annotation"
              style={{
                fontSize: `${t * 0.2}px`,
                lineHeight: 1.2,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: DIM,
              }}
            >
              {parts.annotation}
            </span>
          </div>
        )}
        <div
          className="intro-title"
          style={{
            marginTop: parts.annotation ? `${t * 0.17}px` : 0,
            fontSize: `${t}px`,
            lineHeight: 0.95,
            letterSpacing: '-0.035em',
            textTransform: 'uppercase',
            color: PAPER,
          }}
        >
          {parts.title}
        </div>
        {parts.tagline && (
          <div
            className="intro-tagline"
            style={{
              marginTop: `${t * 0.3}px`,
              fontSize: `${t * 0.28}px`,
              lineHeight: 1.25,
              color: DIM,
            }}
          >
            {parts.tagline}
          </div>
        )}
      </div>
    </div>
  )
}
