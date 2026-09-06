/**
 * **THE HOST SEAM'S PREDICATE, AND IT BELONGS TO NEITHER PRODUCT.**
 *
 * Which hashes are the player's. The shell's router asks so it knows when to draw the frame rather
 * than take the route itself; the player's own router asks so it knows what to mount.
 *
 * **It lives here because it is the one fact both sides of the frame need, and it is not code
 * either side owns.** It used to live in `PlayerApp.tsx`, and that single import was enough to pull
 * the entire player — every view, the whole compositor, 255 KB of it — into the shell's bundle. A
 * predicate over strings dragged a product across the boundary because an import is all-or-nothing
 * and a bundler cannot see intent.
 *
 * **That is the extraction's lesson in one file:** the frame was drawn in `v0.102.0` and the code
 * was never severed. Nothing went red, because nothing was watching the shape of the graph — which
 * `shellBundle.test.ts` now is.
 */

/** Whether this hash is the player's. The shell's router asks before taking a route itself. */
export function isPlayerRoute(hash: string): boolean {
  return (
    hash === '#/' ||
    hash === '' ||
    hash === '#/songs' ||
    hash === '#/gigs' ||
    hash === '#/languages' ||
    hash === '#/projection'
  )
}
