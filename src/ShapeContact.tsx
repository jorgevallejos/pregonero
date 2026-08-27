import { useLayoutEffect, useRef, useState } from 'react'
import { UNIT_SIZE } from './vendor/warp.js'
import { fitInBox } from './shapeTextLayout'
import { INTRO_INSET } from './ShapeIntro'
import { resolveMediaPath, absolutePathToMediaUrl } from './mediaPathStore'

/**
 * The contact panel: **one line of text, plus a QR code when a file was named for one.**
 *
 * Defined once, at gig visual setup — which is why the type is `gig-contact` and not
 * `song-contact`, and why a per-song reassignment of it is dropped rather than honoured.
 *
 * Laid out in the same ink vocabulary as the intro card, because those two are the things the wall
 * says in its own voice rather than the song's. Like the intro it is a locked template: the QR is
 * sized off the same number as the line, so shrinking the block to fit a small panel shrinks both
 * together — a QR that outgrew its text would be the one thing here that stops being scannable.
 *
 * **The QR is a file, not a generator.** It resolves through this machine's media link table like
 * every other source. A code somebody generated and checked with a phone before the doors opened
 * is the honest version; a hand-rolled encoder's failure mode is a code that scans as the wrong URL.
 *
 * **One line, and `nowrap` is what makes that a promise rather than a description.** Without it a
 * long line wraps to two and the shape quietly stops being what was designed; with it, the fit
 * shrinks the line until it fits on one.
 */

/** Of the shape's height; the fit only goes below it. One short line, read once and acted on. */
export const CONTACT_MAX_SIZE = 0.22

const INK = '#121211'
const PAPER = '#e6dfd1'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

export type ContactFields = { text: string; qrSrc: string | null }

/** Reads the two fields. The text is collapsed to one line here, as its writer collapses it. */
export function readContactFields(layer: Record<string, unknown> | undefined): ContactFields {
  const src = layer ?? {}
  const qr = typeof src.qrSrc === 'string' ? src.qrSrc.trim() : ''
  return {
    text: typeof src.text === 'string' ? src.text.replace(/\s*\n\s*/g, ' ') : '',
    // A truthy "  " would reach the wall as a broken image with nothing saying why.
    qrSrc: qr || null,
  }
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

  const qrPath = fields.qrSrc ? resolveMediaPath(fields.qrSrc) : null
  const qrUrl = qrPath ? absolutePathToMediaUrl(qrPath) : null

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
  }, [fields.text, qrUrl, boxWidth, maxPx])

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
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: `${t * 0.6}px` }}
      >
        {qrUrl && (
          <img
            className="contact-qr"
            data-testid="gig-contact-qr"
            src={qrUrl}
            alt=""
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: `${t * 3.4}px`,
              height: `${t * 3.4}px`,
              boxSizing: 'border-box',
              // Paper ground and real padding: a QR needs its quiet zone, and a code printed
              // straight onto ink does not scan at all.
              padding: `${t * 0.18}px`,
              background: PAPER,
              objectFit: 'contain',
            }}
          />
        )}
        <div
          className="contact-line"
          style={{
            fontSize: `${t}px`,
            lineHeight: 1.2,
            letterSpacing: '0.02em',
            color: PAPER,
            whiteSpace: 'nowrap',
          }}
        >
          {fields.text}
        </div>
      </div>
    </div>
  )
}
