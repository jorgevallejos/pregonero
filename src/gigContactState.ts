/**
 * **When the message home is lit**, and the whole of it is one condition read off the gig's phase.
 *
 * > Lit **outside the setlist** — `before` it or `after` it — **unless a song is being presented
 * > and the gig is armed**, which is a repeat.
 *
 * **The phase is `gigPhase.ts` and it is the named thing this used to assemble by hand** (2026-09-06).
 * The condition itself is unchanged, and deliberately so: it was written as a condition rather than
 * as a list of events, and one condition covers all four moments with no special case:
 *
 * | Moment | Why the condition answers it |
 * |---|---|
 * | Power-up | `before`, and outside the setlist. |
 * | Through the setlist, gaps included | `during`. A gap is inside the setlist — **and so is a mid-setlist unarm**, since 2026-09-06. |
 * | While a repeat plays | `after`, armed, and a song is presenting. |
 * | The instant that repeat ends | `after`, nothing presenting — the room is being asked to leave with his details again. |
 *
 * **If an implementation needs a special case for any of those four, the condition is wrong.** Go
 * back to it rather than adding the branch.
 *
 * **`!armed` lights it in both outside states**, and that is one rule rather than two: nothing is
 * being performed, so there is nothing for the wall's attention to belong to. It is why unarming
 * mid-song after the setlist has closed lights the shape rather than leaving a stranded lyric under
 * a dark one. **Inside the setlist it lights nothing**, because the phase is `during` there
 * whatever the arm is doing.
 *
 * ## Where it is evaluated, and why it travels as one boolean
 *
 * Every input is the Control window's: `armed` is its session, the played log is its session, and
 * the playable setlist is its readiness snapshot. The Projection window has none of them and is
 * not given a copy of any of them — it is given **the answer**, which keeps one implementation of
 * the condition and no second opinion about it. Same reason `computeGigReadiness` has one home.
 *
 * The value is read at mount and on every `storage` event, so the missed-event problem the nonce
 * rule in `CLAUDE.md` exists for does not arise.
 *
 * ## The channel is `cardBroadcast.ts`, and it is not this module's
 *
 * **The condition is the player's; the wire between two windows is neither product's.** They were
 * one file until 2026-09-06, and the moment the gig flow's Cards step put a card on the wall
 * `productBoundary.test.ts` went red on a second shell → player edge. **A wrong classification
 * rather than a wrong import**, so the channel moved and this stayed.
 */

import { getLastLyricIndex, type SongItem } from './songState'
import { gigPhase, isOutsideSetlist, type GigPhase } from './gigPhase'

export type ContactConditionInput = {
  armed: boolean
  /** The setlist has been entered — the first arm, and nothing takes it back. See `gigPhase`. */
  setlistEntered: boolean
  /** The setlist is played once, and this is round D's predicate, against the *playable* setlist. */
  setlistDone: boolean
  /** A loaded song that has not yet reached its end. */
  presenting: boolean
}

/**
 * The condition. Nothing anywhere else may decide this.
 *
 * **Outside the setlist, and not over a song that is actually being performed.** The second clause
 * is the repeat: `after` is where a requested song is played from, and the wall belongs to that
 * song while it runs.
 *
 * **It is no longer equivalent to the `!armed || (setlistDone && !presenting)` it once replaced,
 * and that is the ruling of 2026-09-06**: a mid-setlist unarm used to light this and now leaves the
 * wall black. *Arming and unarming move Jorge between rooms; they never move the gig between
 * states.* Cowork proposed the old behaviour and Jorge overruled it — see `gigPhase`.
 */
export function isContactLit({
  armed,
  setlistEntered,
  setlistDone,
  presenting,
}: ContactConditionInput): boolean {
  return isOutsideSetlist(gigPhase({ setlistEntered, setlistDone })) && (!armed || !presenting)
}

/**
 * **The gig's phase, for a caller that has the same two inputs.** Re-exported here because this is
 * where the rest of the app already looks for the question *what is the gig doing* — the same
 * reason `gigSession` re-exports the folder memory.
 */
export function contactGigPhase(input: {
  setlistEntered: boolean
  setlistDone: boolean
}): GigPhase {
  return gigPhase(input)
}

/**
 * **Presenting: a loaded song that has not yet reached its end.**
 *
 * A song is loaded from the moment its lines are, which is before the first line shows — the wall's
 * attention has already moved to the song by then. **It has reached its end when it has ended**, and
 * `songEnded` is the one fact that says so.
 *
 * ## Why the lyric index is not asked, and was two faults (walk 5, 2026-09-06)
 *
 * It used to be `index < last`. That is a proxy for the end of a song, and it was wrong at both
 * edges of the same clause:
 *
 * **It never became true in video** (stage 2). `ControlView`'s auto-advance effect returns at its
 * first line while the video panel is up, and the arm left the index at `-1`, so `index < last`
 * held from the arm to the final frame and past it. The last song of a setlist finished, the
 * setlist closed, and this still said a song was being presented — so `isContactLit` withheld the
 * message home until the unarm released it on `!armed`.
 *
 * **It became true one phrase too early in clock and manual** (stage 3). The index reaches `last`
 * when the last phrase is *put on the wall*, not when it is over. In a repeat — `after`, where the
 * message home is otherwise lit — that handed the wall back on top of a line that had not been read
 * yet, and the last phrase of a replayed song was never seen. **Jorge's rule: a phrase that is due
 * gets its full duration; the wall returns after the song ends, not during its last line.**
 *
 * `songEnded` has neither edge. All three drive modes call `ControlView.endCurrentSong` only once
 * the last phrase is actually over — clock past the last cue, video on the media `ended` event,
 * manual on the press after the last line — and `setCurrentSong` clears it for the next song.
 *
 * **This is the third condition in three stages to have been written at the point of use in terms
 * of something that merely correlates, rather than at the point where the fact is decided.** The
 * beat indicator and the wall's own gate were the other two.
 */
export function isPresenting(lines: readonly SongItem[], songEnded: boolean): boolean {
  if (lines.length === 0) return false
  if (songEnded) return false
  // A song with no lyric lines has no end to reach and never holds the wall.
  return getLastLyricIndex(lines as SongItem[]) >= 0
}
