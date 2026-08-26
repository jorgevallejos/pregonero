/**
 * Laying a string out inside a shape's unit box.
 *
 * **This is Pregonero drawing its own content**, which the round is explicit about: what goes
 * inside the unit square is Pregonero's — live lyrics on a clock — and the warp neither knows nor
 * cares. The numbers below are not taken from `mapper.js` and nothing here is imported from it.
 *
 * **It is nonetheless a second implementation of rules Muralista also implements, and that is
 * worth saying out loud rather than discovering later.** A `song-lyrics` shape carries full text
 * formatting *because* legibility is tuned at the wall, against Muralista's dummy line; that
 * tuning only reaches the audience if Pregonero lays the real line out the same way. So the two
 * agree by both following the written rule, which is exactly the situation `warp-contract.md`
 * describes as one understanding too many. The clean answer is the one round B2 already took for
 * the warp — a small pure module exported from Muralista and vendored — and it is not this round's
 * to take.
 *
 * ## The two rules
 *
 * **Everything is a fraction of the unit box, never a screen pixel** (`warp-contract.md`, caller
 * obligation 2). A font size in screen pixels breaks every tuned layout the moment the quad is
 * redrawn in another room; a fraction travels with the shape.
 *
 * **The quad's stretch is taken back out of the glyphs.** Mapping a square box onto a wide quad
 * fattens every letter. The layout box is made wider by the same factor and counter-scaled back
 * onto the unit square, so the text fills the quad exactly and the letters keep their proportions.
 * A quad on an angled wall is a trapezoid on purpose, so opposite edges genuinely differ and there
 * is no single true width: the mean of the two horizontals against the mean of the two verticals
 * is a summary and claims no more precision than that. The shape's own `aspect` field is the
 * manual judgement on top of it.
 */

import type { Point } from './visualsFile'
import { UNIT_SIZE } from './vendor/warp.js'

/** The margin inside a lyric box, as a fraction of it. */
export const TEXT_INSET = 0.06

const WIDTH_FACTOR_MIN = 0.05
const WIDTH_FACTOR_MAX = 20

/** Muralista's clamps, so a hand-edited file cannot ask for a size or a stretch that is not one. */
export const MAX_SIZE_MIN = 0.02
export const MAX_SIZE_MAX = 0.6
export const ASPECT_MIN = 0.5
export const ASPECT_MAX = 2
export const OUTLINE_WIDTH_MAX = 0.25

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number]

/** The fields a `song-lyrics` shape carries, fully defaulted. Muralista writes them; we read them. */
export type TextFields = {
  maxSize: number
  aspect: number
  align: TextAlignment
  color: string
  outline: boolean
  outlineWidth: number
}

export const TEXT_DEFAULTS: TextFields = {
  maxSize: 0.2,
  aspect: 1,
  align: 'center',
  color: '#ffffff',
  outline: true,
  outlineWidth: 0.08,
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
}

/** Reads a shape's text fields. Never throws: an arbitrary file gets the defaults, field by field. */
export function readTextFields(layer: Record<string, unknown> | undefined): TextFields {
  const src = layer ?? {}
  return {
    maxSize: clamp(src.maxSize, MAX_SIZE_MIN, MAX_SIZE_MAX, TEXT_DEFAULTS.maxSize),
    aspect: clamp(src.aspect, ASPECT_MIN, ASPECT_MAX, TEXT_DEFAULTS.aspect),
    align: (TEXT_ALIGNMENTS as readonly string[]).includes(src.align as string)
      ? (src.align as TextAlignment)
      : TEXT_DEFAULTS.align,
    color: isHexColor(src.color) ? src.color : TEXT_DEFAULTS.color,
    outline: src.outline !== false,
    outlineWidth: clamp(src.outlineWidth, 0, OUTLINE_WIDTH_MAX, TEXT_DEFAULTS.outlineWidth),
  }
}

function edgeLength([ax, ay]: Point, [bx, by]: Point, w: number, h: number): number {
  return Math.hypot((bx - ax) * w, (by - ay) * h)
}

/** How much wider than tall the quad is, in real pixels. 1 when it cannot be told. */
export function quadStretch(corners: readonly Point[] | null, w: number, h: number): number {
  if (!corners || corners.length !== 4) return 1
  const [tl, tr, br, bl] = corners as [Point, Point, Point, Point]
  const horizontal = (edgeLength(tl, tr, w, h) + edgeLength(bl, br, w, h)) / 2
  const vertical = (edgeLength(tl, bl, w, h) + edgeLength(tr, br, w, h)) / 2
  if (!(horizontal > 0) || !(vertical > 0)) return 1
  return horizontal / vertical
}

/**
 * The layout box's width in **whole pixels**: the automatic correction divided by the manual one,
 * times `UNIT_SIZE`.
 *
 * Whole, and that is not cosmetic. `scrollWidth` and `clientWidth` are integers, so a fit
 * comparing an integer against a fractional available width fails by a fraction of a pixel at
 * every size and collapses the line to the floor in a box with room to spare — a silent failure
 * whose only symptom is that the text is tiny.
 */
export function textLayoutBoxWidth(
  corners: readonly Point[] | null,
  aspect: number,
  w: number,
  h: number
): number {
  const raw = quadStretch(corners, w, h) / aspect
  const k = !isFinite(raw) || raw <= 0 ? 1 : Math.min(WIDTH_FACTOR_MAX, Math.max(WIDTH_FACTOR_MIN, raw))
  return Math.max(1, Math.round(UNIT_SIZE * k))
}

/** The horizontal inset in whole pixels. The vertical one never moves: the box is always as tall. */
export function textLayoutInsetX(boxWidth: number): number {
  return Math.round(TEXT_INSET * boxWidth)
}

export const TEXT_INSET_Y = Math.round(TEXT_INSET * UNIT_SIZE)
