import { useLayoutEffect, useRef, useState } from 'react'
import { UNIT_SIZE } from './vendor/warp.js'
import {
  textLayoutInsetX,
  TEXT_INSET_Y,
  type TextFields,
} from './shapeTextLayout'

const FIT_ITERATIONS = 14
const MIN_PX = 8

type Props = {
  text: string
  /** The layout box's width in whole pixels — `textLayoutBoxWidth`, computed from the live size. */
  boxWidth: number
  fields: TextFields
  opacity: number
  transitionMs?: number
  className?: string
  testId?: string
}

/**
 * A string laid out inside a shape's unit box, with the quad's stretch taken back out.
 *
 * The box is `boxWidth` by `UNIT_SIZE` and is counter-scaled by `UNIT_SIZE / boxWidth`, which maps
 * it exactly onto the unit square the homography consumes — so fitting here is still fitting the
 * quad, however the quad is shaped, and **nothing in this component reads a window dimension**.
 *
 * That has a consequence worth stating: rescaling a quad does not change its proportions, so the
 * fit survives a resize untouched and the transform rescales already-fitted text with it. Only a
 * change of *shape* re-fits. This is not a cache of a matrix — it is a layout in the unwarped box,
 * and the matrix above it is still recomputed on every render.
 *
 * **Auto-fit shrinks, never grows past the maximum.** A binary search over the size range, checking
 * both axes: wrapping handles the ordinary case, and `scrollWidth` catches the single word longer
 * than the box, which cannot wrap at all. Where the box has not been measured — jsdom, or an
 * element not yet in the document — the maximum stands rather than collapsing to the floor.
 */
export function ShapeText({
  text,
  boxWidth,
  fields,
  opacity,
  transitionMs,
  className,
  testId,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const innerRef = useRef<HTMLDivElement | null>(null)
  const maxPx = fields.maxSize * UNIT_SIZE
  const [fontSize, setFontSize] = useState(maxPx)

  useLayoutEffect(() => {
    const box = boxRef.current
    const inner = innerRef.current
    if (!box || !inner || text === '') {
      setFontSize(maxPx)
      return
    }
    const insetX = textLayoutInsetX(boxWidth)
    const availW = box.clientWidth - 2 * insetX
    const availH = box.clientHeight - 2 * TEXT_INSET_Y
    if (!(availW > 0) || !(availH > 0)) {
      // Nothing has been measured — the element is not laid out, which is the ordinary state in
      // jsdom. A fit against a zero-width box collapses straight to the floor, so do not fit.
      setFontSize(maxPx)
      return
    }
    const fits = (px: number) => {
      inner.style.fontSize = `${px}px`
      return inner.scrollWidth <= availW && inner.scrollHeight <= availH
    }
    if (fits(maxPx)) {
      setFontSize(maxPx)
      return
    }
    let lo = MIN_PX
    let hi = maxPx
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) lo = mid
      else hi = mid
    }
    setFontSize(lo)
  }, [text, boxWidth, maxPx])

  const strokeStyle = fields.outline && fields.outlineWidth > 0
    ? {
        WebkitTextStrokeWidth: `${fields.outlineWidth}em`,
        WebkitTextStrokeColor: '#000',
        paintOrder: 'stroke fill',
        textShadow: '0 0.03em 0.06em rgba(0, 0, 0, 0.75)',
      }
    : { WebkitTextStrokeWidth: '0', textShadow: 'none' }

  const justify =
    fields.align === 'left' ? 'flex-start' : fields.align === 'right' ? 'flex-end' : 'center'

  return (
    <div
      ref={boxRef}
      className={className ?? 'shape-text'}
      data-testid={testId}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: `${boxWidth}px`,
        height: `${UNIT_SIZE}px`,
        padding: `${TEXT_INSET_Y}px ${textLayoutInsetX(boxWidth)}px`,
        boxSizing: 'border-box',
        transformOrigin: '0 0',
        transform: `scaleX(${UNIT_SIZE / boxWidth})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: justify,
        opacity,
        ...(transitionMs ? { transition: `opacity ${transitionMs}ms ease` } : {}),
      }}
    >
      <div
        ref={innerRef}
        className="shape-text-inner"
        style={{
          fontSize: `${fontSize}px`,
          lineHeight: 1.15,
          textAlign: fields.align,
          color: fields.color,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'break-word',
          width: '100%',
          ...strokeStyle,
        }}
      >
        {text}
      </div>
    </div>
  )
}
