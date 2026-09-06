import { useEffect, useState } from 'react'
import { resolveMediaPath, absolutePathToMediaUrl } from './mediaPathStore'
import { ShapeText } from './ShapeText'
import { readTextFields, textLayoutBoxWidth } from './shapeTextLayout'
import { shapeFrame, type VisualShape } from './visualsFile'

/**
 * A shape Pregonero does **not** coordinate.
 *
 * A logo, a picture, a line of text — authored wholly in `visuals.json` and up from power-up to
 * teardown. Pregonero does not start it, stop it, or decide when it appears; there is no state
 * behind it and no case for any particular one of them. **A `logo` case here would be the
 * mistake**: the test for being coordinated is not "is it on the wall" but "does Pregonero decide
 * when it appears", and for these the answer is no. They are on because the projector is on.
 *
 * They are rendered here because Pregonero is the only thing running on stage, so if it painted
 * nothing for them nothing would — and the practical consequence the design names, that the wall is
 * never fully black between songs without anything arranging it, would not hold. Painting them
 * unconditionally is the absence of a rule rather than a rule.
 *
 * **A source that does not arrive paints nothing**, whether this machine has no answer for the
 * name at all or the answer turns out to be a file that is not there. A broken image on a wall
 * says less than an empty shape does, and the fix is in the media folder, not on the wall.
 *
 * **`pattern` is deliberately not painted.** It is Muralista's test pattern — the default type for
 * a new shape and the fallback for a layer this build does not recognise — so it is an authoring
 * aid, not content. Putting one on a wall at a gig would be a bug that looks like a feature.
 */

type Props = {
  shape: VisualShape
  type: string
  /** The output size in real pixels, for the text layout box. Never remembered. */
  width: number
  height: number
}

/** A media name resolved through this machine's link table, as every other source is. */
function mediaUrlFor(layer: Record<string, unknown> | undefined): string | null {
  const src = typeof layer?.src === 'string' ? layer.src : ''
  if (!src) return null
  const absolute = resolveMediaPath(src)
  return absolute ? absolutePathToMediaUrl(absolute) : null
}

export function ShapeStatic({ shape, type, width, height }: Props) {
  const layer = shape.layer
  const url = mediaUrlFor(layer)
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  // A new source is a new question: a name that failed last time may resolve now that the folder
  // has been chosen, and the shape must not stay dark because of an answer it has stopped giving.
  useEffect(() => {
    setFailedUrl(null)
  }, [url])

  if (type === 'text') {
    const fields = readTextFields(layer)
    const text = typeof layer?.text === 'string' ? layer.text : ''
    if (text === '') return null
    return (
      <ShapeText
        text={text}
        boxWidth={textLayoutBoxWidth(shapeFrame(shape), fields.aspect, width, height)}
        fields={fields}
        opacity={1}
        testId={`shape-static-${shape.id}`}
      />
    )
  }

  if (!url || url === failedUrl) return null

  const fill = {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'fill' as const,
    display: 'block' as const,
    opacity: typeof layer?.opacity === 'number' ? layer.opacity : 1,
  }

  if (type === 'video') {
    return (
      <video
        data-testid={`shape-static-${shape.id}`}
        src={url}
        muted
        loop
        autoPlay
        playsInline
        onError={() => setFailedUrl(url)}
        style={fill}
      />
    )
  }

  return (
    <img
      data-testid={`shape-static-${shape.id}`}
      src={url}
      alt=""
      aria-hidden="true"
      onError={() => setFailedUrl(url)}
      style={fill}
    />
  )
}
