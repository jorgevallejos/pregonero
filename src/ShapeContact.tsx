import { useLayoutEffect, useRef, useState } from 'react'
import { UNIT_SIZE } from './vendor/warp.js'
import { fitInBox } from './shapeTextLayout'
import { CARD_INSET_Y, cardDesignBox, cardInsetX } from './cardBox'
import { resolveMediaPath, absolutePathToMediaUrl } from './mediaPathStore'
import type { MessageHome } from './gigFile'

/**
 * **THE MESSAGE HOME: what the wall says when the setlist is over.**
 *
 * **Two columns, divided by a clay rule the full height of the content** (Jorge, 2026-09-05). That
 * device is already the suite's — it is the folders screen's `SONGS | GIGS` — and keeping it clay
 * means the two cards share a signature: **the same mark, horizontal on the intro card, vertical
 * here.**
 *
 * - **Column one: the logo**, paper on the ink ground.
 * - **Column two: the line, then the contact handles** — the address and the Instagram handle, dim,
 *   beneath it.
 *
 * **The artist-name annotation is gone. The logo says it**, and that fell out of the change rather
 * than being decided.
 *
 * ## The rule is a wall (Jorge, 2026-09-06)
 *
 * **Column one holds the logo and nothing else; column two holds the line and the handles; and
 * nothing crosses the rule, in either direction, at any card size.**
 *
 * **It did.** The logo's only bound was `8 × t`, a multiple of the type size with nothing tying it
 * to the column it was supposed to live in, so it ran through the rule and into the copy — measured
 * on the real gig's video frame at 1920x1080: the logo's box ended at x=1314 with the rule at
 * x=1028. It also drove the card's height, because a square logo at `8 × t` is `8 × t` tall.
 *
 * **And the premise the old bound was reasoned from was false.** *The wordmark is 2.56 : 1, so
 * equal heights is not available* — the file the gig actually carries,
 * `Logo Chango Pepper - black.png`, is **1327 x 1327, square**. A rule derived from an asset's
 * shape is a rule that breaks when the asset changes, which is why the logo is now bounded by its
 * column on **both** axes and keeps its own aspect inside it, whatever aspect that turns out to be.
 *
 * ## Every field is optional, and the card degrades rather than breaking
 *
 * - **All four empty means nothing is pointed at the shape, so the shape is dark** — the rule this
 *   suite already runs on. **A blank lit rectangle at the end of a gig is worse than no card**, and
 *   it must not be reachable. This component returns `null` for it; the caller does not paint an
 *   empty one.
 * - **The clay rule appears only when both columns have content.** Logo alone is just the logo, with
 *   no rule and no second column; the line alone has nothing to divide from. **The rule appears when
 *   both sides exist.**
 *
 * ## The QR came out of this version
 *
 * **It was the only piece of this card's content with no home**, and without it the card is a line
 * and two handles: all text, all artist-level, all satisfied by the Preferences ruling with nothing
 * new invented. It also retired the apparatus around the file — never generated, one per locale,
 * checked with a phone before the doors — **which is real work in service of something not yet
 * measurable.** **The trigger to bring it back:** if gig nights produce no visible arrivals on the
 * site, the funnel read says so and the QR returns.
 *
 * ## The template is locked, like the intro's
 *
 * There are no formatting controls: the only handles are the shape's position and size, which move
 * everything together. **Pregonero fills it; it never styles it.** Every measure is a multiple of one
 * number, found by auto-fit, so the whole card shrinks as one thing and the proportions survive at
 * any size the block lands on.
 */

/** Of the shape's height; the fit only goes below it. The line is what this is sized against. */
export const CONTACT_MAX_SIZE = 0.18

const INK = '#121211'
const PAPER = '#e6dfd1'
const DIM = '#8b8478'
const CLAY = '#d98b7a'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

/** The four fields, as the wall receives them. The gig file's block, resolved. */
export type ContactFields = MessageHome

/**
 * Reads the four fields off a gig's `messageHome` block.
 *
 * **Explicitly not read off the host shape's layer.** The card borrows a shape the room already
 * has — a `song-video` frame or a `song-lyrics` shape — and that layer carries the preview text
 * Muralista seeds it with. **A card that painted that would be worse than a card that does not
 * paint.**
 */
export function readContactFields(messageHome: MessageHome | null | undefined): ContactFields {
  return messageHome ?? {}
}

/** Whether either column has anything in it. Both empty is a dark shape, not an empty card. */
export function hasContactContent(fields: ContactFields): boolean {
  return Boolean(fields.logo || fields.url || fields.handle || fields.message)
}

type Props = {
  fields: ContactFields
  boxWidth: number
  testId?: string
}

export function ShapeContact({ fields, boxWidth, testId }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const blockRef = useRef<HTMLDivElement | null>(null)
  const columnRef = useRef<HTMLDivElement | null>(null)
  const textRef = useRef<HTMLDivElement | null>(null)
  // **The card's own box, and the type is a fraction of ITS height rather than the shape's.** That
  // is what makes the card the same card in a tall shape and a wide one — see `cardBox.ts`.
  const card = cardDesignBox(boxWidth)
  const maxPx = CONTACT_MAX_SIZE * card.height
  const [t, setT] = useState(maxPx)

  const logoPath = fields.logo ? resolveMediaPath(fields.logo) : null
  const logoUrl = logoPath ? absolutePathToMediaUrl(logoPath) : null
  // **The name resolving to nothing is not the same as no name.** A logo whose file this machine
  // cannot find leaves the column empty rather than the card broken, and the gig's sign-off is
  // where a missing file is reported — see `gigReadiness`.
  const hasLogoColumn = logoUrl !== null
  const hasTextColumn = Boolean(fields.message || fields.url || fields.handle)

  useLayoutEffect(() => {
    const block = blockRef.current
    const column = columnRef.current
    const text = textRef.current
    if (!block || !column || !text) return
    // **The fit is now about column two only, and it is a fallback rather than the layout.** The
    // card's size comes from the design box; the search exists for the one case the box cannot
    // answer — a message longer than the column holds at the nominal size. Measuring the column
    // rather than the whole block is what keeps the logo out of the answer: it is bounded, so it
    // can never be the thing that does not fit.
    setT(
      fitInBox(column, text, (px) => block.style.setProperty('--t', `${px}px`), maxPx, 0, 0)
    )
  }, [fields.message, fields.url, fields.handle, logoUrl, maxPx])

  // **Nothing pointed at the shape means a dark shape**, and the caller paints nothing rather than
  // an empty rectangle. Stated here as well as there, because this is the component that knows.
  if (!hasContactContent(fields)) return null

  const handles = [fields.url, fields.handle].filter((h): h is string => Boolean(h))

  return (
    <div
      ref={panelRef}
      className="layer-contact"
      data-testid={testId ?? 'gig-contact-panel'}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${boxWidth}px`,
        height: `${UNIT_SIZE}px`,
        padding: `${CARD_INSET_Y}px ${cardInsetX(boxWidth)}px`,
        boxSizing: 'border-box',
        display: 'flex',
        // The design box is centred in the shape on both axes: what is left over is ground.
        alignItems: 'center',
        justifyContent: 'center',
        transformOrigin: '0 0',
        transform: `scaleX(${UNIT_SIZE / boxWidth})`,
        background: INK,
        fontFamily: MONO,
        textAlign: 'left',
      }}
    >
      {/* **`--t` IS THE ONE NUMBER, AND THE FIT MOVES IT DIRECTLY** (2026-09-06). Every measure
          below is `calc(var(--t) * k)`, so the whole card shrinks as one thing — and, which is the
          part that was broken, so `fitInBox`'s `apply` actually changes what it then measures.
          Writing these from the React state instead made the search evaluate one unchanging layout
          fourteen times and return the floor: **the card came out at 8px on the wall.** The state
          is still what paints the first frame and what a re-render restores; it is not what the
          search moves. See `cardAutoFit.test.tsx`. */}
      <div
        ref={blockRef}
        className="contact-block"
        style={{
          ['--t' as string]: `${t}px`,
          ['--card-w' as string]: `${card.width}px`,
          ['--card-h' as string]: `${card.height}px`,
          width: 'var(--card-w)',
          height: 'var(--card-h)',
          display: 'flex',
          alignItems: 'stretch',
          gap: hasLogoColumn && hasTextColumn ? 'calc(var(--card-w) * 0.045)' : '0px',
        }}
      >
        {hasLogoColumn && (
          <div
            className="contact-logo-column"
            data-testid="message-home-logo-column"
            style={{
              // **A wall, not a preference.** A fixed share of the card when there is a second
              // column, the whole card when there is not — and `0 0 auto` so nothing it holds can
              // push it, which is how the logo got out last time.
              flex: '0 0 auto',
              width: hasTextColumn ? 'calc(var(--card-w) * 0.3)' : 'var(--card-w)',
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              className="contact-logo"
              data-testid="message-home-logo"
              src={logoUrl!}
              alt=""
              aria-hidden="true"
              // **Bounded on both axes, keeping its own aspect, whatever that aspect is.** `width`
              // and `height` are `auto` so the intrinsic ratio decides which bound binds: the
              // gig's square file fills the column's height, a wide wordmark fills its width, and
              // neither can exceed the column. The old `width: calc(var(--t) * 8)` bounded neither
              // and was reasoned from an asset that is not the one in the gig.
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
              }}
            />
          </div>
        )}
        {/* **The clay rule, the full height of the card, and only when both columns exist.**
            Horizontal on the intro card, vertical here: the same mark, so the two cards read as
            one voice. It is the wall the ruling names, and the two tests either side of it are
            what make that literal. */}
        {hasLogoColumn && hasTextColumn && (
          <div
            className="contact-rule"
            data-testid="message-home-rule"
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              alignSelf: 'stretch',
              width: 'max(1px, calc(var(--card-w) * 0.006))',
              background: CLAY,
            }}
          />
        )}
        {hasTextColumn && (
          <div
            ref={columnRef}
            className="contact-text-column"
            data-testid="message-home-text-column"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              // The column is the fit's box, so it needs a definite height to fit against; the
              // content is centred inside it rather than the column being sized by the content.
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              // **A single unbreakable run breaks rather than leaving the column.** A URL and a
              // handle are exactly that kind of string, and the rule is a wall.
              overflowWrap: 'anywhere',
            }}
          >
            <div ref={textRef} className="contact-text">
            {fields.message && (
              <div
                className="contact-line"
                data-testid="message-home-line"
                style={{
                  fontSize: 'var(--t)',
                  lineHeight: 1.25,
                  letterSpacing: '0.02em',
                  color: PAPER,
                }}
              >
                {fields.message}
              </div>
            )}
            {handles.length > 0 && (
              <div
                className="contact-handles"
                data-testid="message-home-handles"
                style={{
                  marginTop: fields.message ? 'calc(var(--t) * 0.7)' : 0,
                  fontSize: 'calc(var(--t) * 0.62)',
                  lineHeight: 1.4,
                  letterSpacing: '0.04em',
                  color: DIM,
                }}
              >
                {handles.map((handle) => (
                  <div key={handle} className="contact-handle">
                    {handle}
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
