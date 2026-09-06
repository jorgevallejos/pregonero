/**
 * **The design box the two locked cards are drawn in — and the reason they have one.**
 *
 * > **Both cards adjust to the size of the video frame or the song-lyrics shape, keep their
 * > proportions, and never stretch.** (Jorge, 2026-09-06.)
 *
 * **What they did instead, and it was measured on the wall.** Each card's content block was
 * `width: 100%` of whatever box the shape handed it, and `fitInBox` grew the type until the content
 * filled that box's height. So the card took **the quad's** proportions rather than its own — wide
 * on a wide quad, tall on a tall one, a different card in every room — and the logo, whose only
 * bound was a multiple of the type size, ran straight through the clay rule and into the copy.
 *
 * **The fit had no proportional lock**: one number searched against two independent dimensions can
 * only ever fill the box it is given.
 *
 * **This is the lock.** The card is laid out in a box of its own fixed aspect, sized to the largest
 * that fits inside the shape's insets, and **everything inside is a fraction of that box**. The
 * layout is then identical at every shape size and only its scale changes — which is what makes
 * *nothing crosses the rule* hold **everywhere**, rather than at the sizes someone happened to look
 * at. It is the same idea as the unit box one level up: a fixed frame, and a scale on top of it.
 *
 * **It travels as two custom properties, `--card-w` and `--card-h`**, for the same reason `--t`
 * does: a measure written any other way does not move when the box moves, and
 * `cardAutoFit.test.tsx` fails on a raw pixel anywhere inside a card's block.
 *
 * **Why one aspect for both cards.** They are the same object seen twice — the wall before the
 * first cue and the wall after the last song — and they already share their voice, their inset and
 * their clay mark. A card that changed shape between the two would read as two designs.
 */

import { UNIT_SIZE } from './vendor/warp.js'

/**
 * The card's own proportions, width : height. **Landscape**, because both cards are two things
 * side by side or a line with smaller lines under it, and because every shape a card is hosted in
 * — a video frame, a lyrics band — is landscape on a wall.
 */
export const CARD_ASPECT = 2

/** The margin between the card and the edge of the shape, as a fraction of the shape. */
export const CARD_INSET = 0.07

/** The inset in whole pixels on each axis. Whole, for the same reason `textLayoutBoxWidth` is. */
export function cardInsetX(boxWidth: number): number {
  return Math.round(CARD_INSET * boxWidth)
}
export const CARD_INSET_Y = Math.round(CARD_INSET * UNIT_SIZE)

export type CardBox = { width: number; height: number }

/**
 * **The largest box of the card's aspect that fits inside the shape**, in layout pixels.
 *
 * `boxWidth` is the quad's stretch already taken out — the same number every panel on this surface
 * is laid out at — so the box is computed in the space the card is actually drawn in, and the
 * counter-scale outside it puts the whole thing back on the quad undistorted.
 */
export function cardDesignBox(boxWidth: number): CardBox {
  const availableWidth = Math.max(1, boxWidth - 2 * cardInsetX(boxWidth))
  const availableHeight = Math.max(1, UNIT_SIZE - 2 * CARD_INSET_Y)
  const width = Math.min(availableWidth, availableHeight * CARD_ASPECT)
  return { width, height: width / CARD_ASPECT }
}
