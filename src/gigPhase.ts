/**
 * **THE GIG EXISTS DURING PERFORMANCE, AND IT HAS THREE STATES.**
 *
 * **Before the setlist, in it, after it.** Until now those states were real and nameless: the app
 * had `armed`, a played log and a playable setlist, and every moment that needed the gig had to
 * assemble one out of them. **The gig was implicit — every ingredient existed and nothing named the
 * thing they were ingredients of** (`journey-performance.md`, *What the walk exposes*), and that
 * one absence is what moments 3, 9, 11 and 12 were all waiting on.
 *
 * ## The three, and what decides each
 *
 * | Phase | When | What the wall does |
 * |---|---|---|
 * | `before` | The setlist has not been played through, and nothing is armed | Outside the setlist |
 * | `during` | Armed, and the setlist has not been played through | Inside it |
 * | `after` | The setlist has been played through | Outside the setlist |
 *
 * **`after` is decided by the played log alone, and that is what makes it stick.** `setlistDone` is
 * *the last song of the playable setlist appears in the played log*, and the log only ever appends
 * — so **the last song ending closes the setlist and nothing reopens it.** A repeat plays from
 * `after` and stays in `after`, which is moment 12, and it now falls out of the phase rather than
 * being a rule anybody has to hold.
 *
 * **Unarming before the last song does not close the setlist. It returns the gig to `before`**,
 * which reads oddly for three songs in and is the honest answer: the setlist is not running and has
 * not been completed. **The phase can go back and it can never skip forward**, and that asymmetry
 * is the whole guarantee.
 *
 * ## What `before` and `after` share, and why they are not one state
 *
 * *Not started* and *finished* are the same condition — **outside the setlist** — which is exactly
 * what 24/08 ruled and what `isContactLit` has always encoded. They are still told apart here
 * because **the wall does different things in them**: `after` can be interrupted by a repeat, and
 * `before` cannot be interrupted by anything.
 *
 * ## What this does not do
 *
 * **It stores nothing and it decides nothing new.** Every input is already the Control window's,
 * and the answer travels to the Projection window as the one boolean it has always travelled as —
 * see `gigContactState.ts`. **A second store for the gig's state would be a second opinion about
 * it**, and the played log is the one that cannot disagree with what was actually played.
 */

/** Before the setlist, in it, after it. */
export type GigPhase = 'before' | 'during' | 'after'

export type GigPhaseInput = {
  /** The stored armed flag, never the control screen's label. */
  armed: boolean
  /** The setlist has been played through — `isSetlistComplete`, against the *playable* setlist. */
  setlistDone: boolean
}

/**
 * The phase. **`setlistDone` is asked first**, so once the setlist has closed nothing — arming,
 * unarming, a repeat — takes the gig back into it.
 */
export function gigPhase({ armed, setlistDone }: GigPhaseInput): GigPhase {
  if (setlistDone) return 'after'
  return armed ? 'during' : 'before'
}

/** **Outside the setlist**: the condition 24/08 named, now read off the phase. */
export function isOutsideSetlist(phase: GigPhase): boolean {
  return phase !== 'during'
}
