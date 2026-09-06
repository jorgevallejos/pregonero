import { useLayoutEffect, useRef, useState } from 'react'
import { UNIT_SIZE } from './vendor/warp.js'
import { fitInBox } from './shapeTextLayout'
import { INTRO_INSET } from './ShapeIntro'
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
 * **The logo does not match column two's height, and it cannot.** Jorge asked for it; the wordmark
 * is 2.56 : 1, so at a 508px column it would be 1300px wide — wider than the whole card. **Equal
 * heights is not available with this wordmark in a landscape shape**, so the logo fills its column's
 * width instead and is centred against column two.
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
  const maxPx = CONTACT_MAX_SIZE * UNIT_SIZE
  const [t, setT] = useState(maxPx)

  const logoPath = fields.logo ? resolveMediaPath(fields.logo) : null
  const logoUrl = logoPath ? absolutePathToMediaUrl(logoPath) : null
  // **The name resolving to nothing is not the same as no name.** A logo whose file this machine
  // cannot find leaves the column empty rather than the card broken, and the gig's sign-off is
  // where a missing file is reported — see `gigReadiness`.
  const hasLogoColumn = logoUrl !== null
  const hasTextColumn = Boolean(fields.message || fields.url || fields.handle)

  useLayoutEffect(() => {
    const panel = panelRef.current
    const block = blockRef.current
    if (!panel || !block) return
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
  }, [fields.message, fields.url, fields.handle, logoUrl, boxWidth, maxPx])

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
        padding: `${Math.round(INTRO_INSET * UNIT_SIZE)}px ${Math.round(INTRO_INSET * boxWidth)}px`,
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        transformOrigin: '0 0',
        transform: `scaleX(${UNIT_SIZE / boxWidth})`,
        background: INK,
        fontFamily: MONO,
        textAlign: 'left',
      }}
    >
      <div
        ref={blockRef}
        className="contact-block"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: `${t * 0.9}px`,
        }}
      >
        {hasLogoColumn && (
          <div
            className="contact-logo-column"
            data-testid="message-home-logo-column"
            style={{ flex: '0 1 auto', display: 'flex', alignItems: 'center', minWidth: 0 }}
          >
            <img
              className="contact-logo"
              data-testid="message-home-logo"
              src={logoUrl!}
              alt=""
              aria-hidden="true"
              style={{ width: `${t * 8}px`, height: 'auto', objectFit: 'contain' }}
            />
          </div>
        )}
        {/* **The clay rule, the full height of the content, and only when both columns exist.**
            Horizontal on the intro card, vertical here: the same mark, so the two cards read as
            one voice. */}
        {hasLogoColumn && hasTextColumn && (
          <div
            className="contact-rule"
            data-testid="message-home-rule"
            aria-hidden="true"
            style={{ flex: '0 0 auto', alignSelf: 'stretch', width: `${Math.max(1, t * 0.06)}px`, background: CLAY }}
          />
        )}
        {hasTextColumn && (
          <div
            className="contact-text-column"
            data-testid="message-home-text-column"
            style={{ flex: '1 1 auto', minWidth: 0 }}
          >
            {fields.message && (
              <div
                className="contact-line"
                data-testid="message-home-line"
                style={{
                  fontSize: `${t}px`,
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
                  marginTop: fields.message ? `${t * 0.7}px` : 0,
                  fontSize: `${t * 0.62}px`,
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
        )}
      </div>
    </div>
  )
}
