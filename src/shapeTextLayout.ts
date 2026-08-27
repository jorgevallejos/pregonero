/**
 * Laying a string out inside a shape's unit box.
 *
 * **This is Pregonero drawing its own content**, which the round is explicit about: what goes
 * inside the unit square is Pregonero's — live lyrics on a clock — and the warp neither knows nor
 * cares. The numbers below are not taken from `mapper.js` and nothing here is imported from it.
 *
 * ## Muralista sets the boundary; this renders inside it (Jorge, 2026-08-27)
 *
 * **The relationship with Muralista's text layout is not replication, and this is therefore not
 * debt.** Muralista never reads song content: it tunes against a deliberately nasty dummy line and
 * writes down a `maxSize` that is safe. Pregonero renders the real lyrics **within that boundary**.
 * Two different jobs, sharing a boundary rather than duplicating a computation.
 *
 * **What has to agree is narrow: the meaning of a size fraction, and the quad-stretch correction.**
 * Those two are asserted against Muralista's own numbers, over a set of known quads, in
 * `muralistaTextContract.test.ts` — **a test, deliberately, and not an extracted module.**
 *
 * **When a real line beats the boundary anyway, it shrinks — it never spills.** Muralista's v1
 * scope is that text cannot overflow, so the only answer available is a smaller line. `fitInBox`
 * hands back the maximum untouched for every line that fits, so **the size is uniform across
 * lines** and only the offending one moves: text jumping size line to line on a wall is worse than
 * text being smaller. Whether the stand-in really is the worst case is `worstCase.ts`'s question,
 * and a real line that beats it is a **Muralista finding** rather than something to fix here.
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

export const FIT_ITERATIONS = 14
export const TEXT_MIN_PX = 8

/**
 * **Auto-fit: shrink until it fits, never grow past the maximum.**
 *
 * Measured in the *unwarped* content box — the space before `matrix3d` — which is the natural
 * place for it and the reason the guarantee holds with no geometry bookkeeping. That box is
 * `boxWidth` by `UNIT_SIZE`, and the counter-scale maps it exactly onto the unit square the
 * homography consumes, so fitting here is still fitting the quad however the quad is shaped.
 * A quad redrawn at a different **size** does not change the box width at all — only its
 * proportions can — so a resize rescales already-fitted content with no refit involved.
 *
 * Fitting is monotonic (a bigger size never needs fewer lines), so a binary search converges on
 * the largest size that fits. Both axes are checked: wrapping handles the ordinary case, and
 * `scrollWidth` catches the single word longer than the box, which cannot wrap at all.
 *
 * `apply` sets whatever the caller is searching over — a font size on one element, or the custom
 * property every part of a multi-part card is a multiple of, so the card shrinks as one thing.
 *
 * Returns the maximum untouched where the box has not been measured. jsdom reports zero for every
 * dimension, and a fit against a zero-width box collapses straight to the floor: content that is
 * simply tiny is a silent, plausible-looking failure, and it cost Muralista a debugging round.
 */
export function fitInBox(
  box: HTMLElement,
  measured: HTMLElement,
  apply: (px: number) => void,
  maxPx: number,
  insetX: number,
  insetY: number
): number {
  const availW = box.clientWidth - 2 * insetX
  const availH = box.clientHeight - 2 * insetY
  if (!(availW > 0) || !(availH > 0)) {
    apply(maxPx)
    return maxPx
  }

  const fits = (px: number) => {
    apply(px)
    return measured.scrollWidth <= availW && measured.scrollHeight <= availH
  }

  if (fits(maxPx)) return maxPx

  let lo = TEXT_MIN_PX
  let hi = maxPx
  for (let i = 0; i < FIT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2
    if (fits(mid)) lo = mid
    else hi = mid
  }
  apply(lo)
  return lo
}
