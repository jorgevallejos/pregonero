import type { ReactNode } from 'react'
import { frameMatrix3d, UNIT_SIZE } from './vendor/warp.js'
import {
  shapeFrame,
  shapeOutline,
  shapeOutlineIsFrame,
  type VisualShape,
} from './visualsFile'

export { UNIT_SIZE }

type Props = {
  shape: VisualShape
  /** The output size **in real pixels**, this render. Never a remembered one. */
  width: number
  height: number
  children: ReactNode
}

/**
 * **One mapped region of the wall, with Pregonero's content warped into it.**
 *
 * This is the whole of Pregonero's contact with the warp, and it keeps the four caller obligations
 * that `docs/warp-contract.md` says no test in either repo can catch:
 *
 * 1. **Content is drawn into the unit box first.** Children are laid out in a fixed
 *    `UNIT_SIZE`-square, and the matrix maps that square onto the quad. Content that positions
 *    itself in wall coordinates is not warped, it is guessed.
 * 2. **Sizes inside are fractions of the unit box, never pixels off the screen.** A font size in
 *    screen pixels breaks every tuned layout the moment a quad is redrawn in a new room.
 * 3. **No matrix is cached.** `frameMatrix3d` is called on every render from the size passed in;
 *    there is no memo here and there must not be one. A cached matrix is the frozen-matrix bug
 *    with extra steps, and its symptom is that everything renders and is just subtly off.
 * 4. **The vendored copy is never edited.** `src/vendor/README.md`.
 *
 * A `null` matrix — no frame, or degenerate corners — **skips the render** rather than painting a
 * guess. That is the module's own contract, not a defensive flourish.
 *
 * The outline clips and does not warp, so it goes on the untransformed root, in output pixels,
 * exactly as it does in Muralista.
 */
export function ShapeRegion({ shape, width, height, children }: Props) {
  const transform = frameMatrix3d(shapeFrame(shape), width, height)
  if (!transform) return null

  const outline = shapeOutline(shape)
  const clipPath =
    outline && !shapeOutlineIsFrame(shape)
      ? `polygon(${outline.map(([x, y]) => `${x * width}px ${y * height}px`).join(', ')})`
      : undefined

  return (
    <div
      className="shape-root"
      data-shape-id={shape.id}
      data-testid={`shape-${shape.id}`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        ...(clipPath ? { clipPath } : {}),
      }}
    >
      <div
        className="shape-wrapper"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${UNIT_SIZE}px`,
          height: `${UNIT_SIZE}px`,
          transformOrigin: '0 0',
          transform,
        }}
      >
        {children}
      </div>
    </div>
  )
}
