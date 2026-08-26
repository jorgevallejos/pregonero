/**
 * Types for the vendored `warp.js`. **This file is Pregonero's; `warp.js` is Muralista's.**
 * Declaring the exports here is what lets a TypeScript caller use the module without a single
 * byte of the vendored copy moving — see `README.md` in this folder.
 */

/** Four points, `[top-left, top-right, bottom-right, bottom-left]`, in the order used throughout. */
export type Quad = [Point, Point, Point, Point]
export type Point = [number, number]

/** The 3x3 homography, defined up to scale with `h8` fixed at 1. */
export type Homography = {
  h0: number
  h1: number
  h2: number
  h3: number
  h4: number
  h5: number
  h6: number
  h7: number
}

/**
 * **The one a renderer calls.** `frame` is the four *normalised* corners; `w` and `h` are the
 * output size **in real pixels**, always passed and never remembered. Returns the `matrix3d(...)`
 * string mapping the `UNIT_SIZE` content box onto those corners, or `null` when the frame is
 * missing or the corners are degenerate — a caller that gets `null` skips the render rather than
 * painting a guess.
 */
export function frameMatrix3d(
  frame: readonly Point[] | null | undefined,
  w: number,
  h: number
): string | null

/** The 4-point solve, for callers mapping something other than the unit box. */
export function computeHomography(
  srcCorners: readonly Point[],
  dstCorners: readonly Point[]
): Homography | null

/** The 3x3 → CSS 4x4 embedding, column-major. */
export function homographyToMatrix3dString(h: Homography): string

/** One point through the transform by hand. `null` on the horizon. */
export function applyHomography(h: Homography, point: Point): Point | null

/** The side of the square every shape's content is composed into, in px. */
export const UNIT_SIZE: number

/** The normalised output frame as a quad, in the same corner order. */
export const UNIT_SQUARE_CORNERS: Quad
