import { useLayoutEffect, useRef, useState } from 'react'
import { UNIT_SIZE } from './vendor/warp.js'
import { fitInBox } from './shapeTextLayout'
import { CARD_INSET, CARD_INSET_Y, cardDesignBox, cardInsetX } from './cardBox'

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
 *
 * ## The translated title, and the number that was wrong (Jorge, 2026-09-06)
 *
 * **Too small to read at wall distance**, found at moment 6. Measured at the real quad in headless
 * Chrome, on the gig's own video frame at 1920x1080: **14.8px tall on a 590px shape — 2.5% of it —
 * against a lyric line in the shape beside it at 272px.** One eighteenth.
 *
 * **And it contradicted this file's own doc.** *The tagline is the fragile part, smallest on the
 * wall* — the annotation was `0.2t` and the tagline `0.28t`, so the smallest thing on the card was
 * the one the doc did not name. **A proportion nobody could see was wrong until the card was on a
 * wall**, which is what the Cards step now puts it on.
 *
 * **It is `0.4t`**: twice the tagline, and still a quarter of the title, so it stays an annotation.
 * The colour is untouched — dim is what makes it an annotation rather than a second title — and
 * the wall is where that is judged now.
 */

/**
 * Of **the card's** height, not the shape's (2026-09-06). Auto-fit only goes below it.
 *
 * It was a fraction of the unit box, which is the shape — so a tall shape gave a huge title and a
 * wide one a small title, and the card was a different card in every room. `cardBox.ts` is the lock;
 * this is a proportion inside it.
 */
export const INTRO_TITLE_MAX_SIZE = 0.16
/**
 * Of the shape, left and right — the margin between the card and the shape's edge.
 *
 * **The name stays, the number moved house.** It is `cardBox.CARD_INSET` now, because the message
 * home was importing it from this file: one inset for both cards, owned where the box is.
 */
export const INTRO_INSET = CARD_INSET

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
  const partsRef = useRef<HTMLDivElement | null>(null)
  // **The card's own box, and the title is a fraction of ITS height rather than the shape's** —
  // see `cardBox.ts`. This is what stops the card taking the quad's proportions.
  const card = cardDesignBox(boxWidth)
  const maxPx = INTRO_TITLE_MAX_SIZE * card.height
  const [t, setT] = useState(maxPx)

  useLayoutEffect(() => {
    const block = blockRef.current
    const partsEl = partsRef.current
    if (!block || !partsEl) return
    // One number for the whole card: everything inside is a multiple of it, so searching over it
    // keeps every proportion exactly where the mock put it. **The box is the card now, not the
    // shape** — a long title shrinks to stay inside the card rather than growing to fill the room.
    setT(
      fitInBox(block, partsEl, (px) => block.style.setProperty('--t', `${px}px`), maxPx, 0, 0)
    )
  }, [parts.title, parts.annotation, parts.tagline, maxPx])

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
        padding: `${CARD_INSET_Y}px ${cardInsetX(boxWidth)}px`,
        boxSizing: 'border-box',
        display: 'flex',
        // The card is centred in the shape on both axes: what is left over is ground.
        alignItems: 'center',
        justifyContent: 'center',
        transformOrigin: '0 0',
        transform: `scaleX(${UNIT_SIZE / boxWidth})`,
        background: INK,
        fontFamily: MONO,
        // Left-aligned, never centred.
        textAlign: 'left',
      }}
    >
      {/* **`--t` IS THE ONE NUMBER, AND THE FIT MOVES IT DIRECTLY** (2026-09-06). See
          `ShapeContact` and `cardAutoFit.test.tsx`: writing these measures from the React state
          made `fitInBox`'s `apply` a no-op, so the search evaluated one unchanging layout and
          returned the floor. **This card was not visibly broken only because its content fits at
          the maximum, where the search never begins** — one long title away from the message
          home's 8px. */}
      <div
        ref={blockRef}
        className="intro-block"
        style={{
          ['--t' as string]: `${t}px`,
          ['--card-w' as string]: `${card.width}px`,
          ['--card-h' as string]: `${card.height}px`,
          width: 'var(--card-w)',
          height: 'var(--card-h)',
          display: 'flex',
          flexDirection: 'column',
          // The three parts are vertically centred in the card, always.
          justifyContent: 'center',
        }}
      >
        {/* The measured element. It is what the fit shrinks until the three parts sit inside the
            card — **inside the card, not inside the shape**, which is what keeps a long title from
            growing the card out of its own proportions. */}
        <div ref={partsRef} className="intro-parts">
        {parts.annotation && (
          <div
            className="intro-head"
            style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--t) * 0.1)' }}
          >
            <span
              className="intro-rule"
              data-testid="intro-rule"
              style={{
                flex: '0 0 auto',
                width: 'calc(var(--t) * 0.4)',
                height: 'calc(var(--t) * 0.04)',
                background: CLAY,
              }}
            />
            <span
              className="intro-annotation"
              style={{
                fontSize: 'calc(var(--t) * 0.4)',
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
            marginTop: parts.annotation ? 'calc(var(--t) * 0.17)' : 0,
            fontSize: 'var(--t)',
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
              marginTop: 'calc(var(--t) * 0.3)',
              fontSize: 'calc(var(--t) * 0.28)',
              lineHeight: 1.25,
              color: DIM,
            }}
          >
            {parts.tagline}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
