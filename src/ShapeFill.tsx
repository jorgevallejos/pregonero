import { shapeOutline, type VisualShape } from './visualsFile'

/**
 * A shape that holds black — or any other flat colour — over the region its outline names.
 *
 * **It carries no content and it is never warped.** A fill is a mask: it exists to stop light
 * landing where the room does not want it, so it is painted as a polygon in output pixels on the
 * untransformed root, exactly the way the outline clip is. There is no unit box here and no
 * matrix, which is also why a fill needs no content frame.
 *
 * Like every other shape that is not song-aware, Pregonero does not coordinate it: it is on
 * because the projector is on.
 *
 * Fill and stroke are the same colour, because the stroke *is* the dilation rather than an edge —
 * a second colour there would draw a halo nobody asked for.
 */

type Props = {
  shape: VisualShape
  width: number
  height: number
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
}

export function ShapeFill({ shape, width, height }: Props) {
  const outline = shapeOutline(shape)
  if (!outline || outline.length < 3) return null

  const layer = shape.layer
  const color = isHexColor(layer?.color) ? layer.color : '#000000'
  const margin = typeof layer?.margin === 'number' && isFinite(layer.margin) ? layer.margin : 0
  const points = outline.map(([x, y]) => `${x * width},${y * height}`).join(' ')

  return (
    <svg
      className="output-fill-svg"
      data-testid={`shape-fill-${shape.id}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        opacity: typeof layer?.opacity === 'number' ? layer.opacity : 1,
        pointerEvents: 'none',
      }}
    >
      <polygon
        points={points}
        style={{
          fill: color,
          stroke: color,
          // The margin dilates the mask, in the same fraction-of-the-box terms everything else is
          // measured in. It is a stroke because a stroke is what grows a polygon evenly.
          strokeWidth: margin > 0 ? margin * height : 0,
          strokeLinejoin: 'round',
        }}
      />
    </svg>
  )
}
