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
 * | `before` | The setlist has not been entered | The message home |
 * | `during` | Entered, and not played through | The song — and black between songs, at the end of one, and on a mid-setlist unarm |
 * | `after` | The setlist has been played through | The message home |
 *
 * **`after` is decided by the played log alone, and that is what makes it stick.** `setlistDone` is
 * *the last song of the playable setlist appears in the played log*, and the log only ever appends
 * — so **the last song ending closes the setlist and nothing reopens it.** A repeat plays from
 * `after` and stays in `after`, which is moment 12, and it now falls out of the phase rather than
 * being a rule anybody has to hold.
 *
 * **ARMING AND UNARMING MOVE JORGE BETWEEN ROOMS; THEY NEVER MOVE THE GIG BETWEEN STATES** (Jorge,
 * 2026-09-06). This used to read `armed`, so unarming three songs in returned the gig to `before`
 * and put the message home back on the wall — **which Cowork proposed and Jorge overruled.** A
 * mid-setlist unarm leaves the wall black: the gig is still in its setlist, Jorge has simply left
 * the room.
 *
 * **So the phase only ever moves forward**, and each step has exactly one thing that takes it: the
 * first arm enters the setlist, the last song ending closes it. `setlistEntered` is
 * `performanceState`'s — set on the first arm and never taken back — and `setlistDone` is the
 * played log's.
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
  /**
   * The setlist has been entered — `performanceState.getSetlistEntered`, true from the first arm
   * of the session. **Not `armed`**: unarming leaves the room, not the setlist.
   */
  setlistEntered: boolean
  /** The setlist has been played through — `isSetlistComplete`, against the *playable* setlist. */
  setlistDone: boolean
}

/**
 * The phase. **`setlistDone` is asked first**, so once the setlist has closed nothing — arming,
 * unarming, a repeat — takes the gig back into it. And nothing takes it back out of `during`
 * either: both inputs only ever turn on.
 */
export function gigPhase({ setlistEntered, setlistDone }: GigPhaseInput): GigPhase {
  if (setlistDone) return 'after'
  return setlistEntered ? 'during' : 'before'
}

/** **Outside the setlist**: the condition 24/08 named, now read off the phase. */
export function isOutsideSetlist(phase: GigPhase): boolean {
  return phase !== 'during'
}
