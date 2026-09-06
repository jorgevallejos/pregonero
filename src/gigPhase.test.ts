/**
 * **THE THREE-STATE GIG** (2026-09-06).
 *
 * *Before the setlist, in it, after it.* The states were real and nameless: the app had `armed`, a
 * played log and a playable setlist, and every moment that needed the gig assembled one out of
 * them. These tests are about the two properties the name buys, both of which used to be claims
 * somebody had to hold:
 *
 * - **`after` sticks.** The last song ending closes the setlist and nothing reopens it.
 * - **Unarming goes back, never forward.** It cannot close the setlist and cannot skip a state.
 */
import { describe, it, expect } from 'vitest'
import { gigPhase, isOutsideSetlist } from './gigPhase'
import { isContactLit } from './gigContactState'

describe('the three states', () => {
  it('is `before` at power-up: nothing armed, nothing played', () => {
    expect(gigPhase({ armed: false, setlistDone: false })).toBe('before')
  })

  it('is `during` from the moment of arming until the setlist closes', () => {
    expect(gigPhase({ armed: true, setlistDone: false })).toBe('during')
  })

  it('is `after` once the setlist has been played through', () => {
    expect(gigPhase({ armed: true, setlistDone: true })).toBe('after')
  })

  it('reads `before` and `after` as one condition — outside the setlist', () => {
    // *Not started* and *finished* are the same condition, which is what 24/08 ruled. They are
    // still told apart because the wall does different things in them: `after` can be interrupted
    // by a repeat and `before` cannot be interrupted by anything.
    expect(isOutsideSetlist('before')).toBe(true)
    expect(isOutsideSetlist('after')).toBe(true)
    expect(isOutsideSetlist('during')).toBe(false)
  })
})

describe('the last song ending closes the setlist, and unarming before that does not', () => {
  it('does not close it by unarming: the gig goes back to `before`', () => {
    // **Back, never forward.** Three songs in and unarmed reads oddly as `before` and is the
    // honest answer: the setlist is not running and has not been completed. Re-arming returns to
    // `during` with the played log intact.
    expect(gigPhase({ armed: false, setlistDone: false })).toBe('before')
    expect(gigPhase({ armed: true, setlistDone: false })).toBe('during')
  })

  it('stays `after` when the gig is unarmed once the setlist has closed', () => {
    // `setlistDone` is asked first, so arming state cannot take the gig back into the setlist.
    expect(gigPhase({ armed: false, setlistDone: true })).toBe('after')
  })
})

/**
 * **MOMENT 12, RE-CHECKED UNDER THE MODEL RATHER THAN REBUILT.**
 *
 * The code was found correct on 2026-09-04: `isSetlistComplete` is monotonic, so replaying a song
 * can never take its entry out of the played log, and `nextSongForTile` is gated on `!setlistDone`
 * so the running order cannot resume from the repeated song's position.
 *
 * **What the phase adds is that it is now one line instead of four call sites.** A repeat plays
 * from `after` and stays in `after` because `setlistDone` decides `after` on its own.
 */
describe('a repeat plays from `after` and stays in `after`', () => {
  it('is `after` before the repeat, during it, and once it ends', () => {
    expect(gigPhase({ armed: true, setlistDone: true })).toBe('after')
    // Arming again for the requested song does not reopen anything.
    expect(gigPhase({ armed: true, setlistDone: true })).toBe('after')
    expect(gigPhase({ armed: false, setlistDone: true })).toBe('after')
  })

  it('darkens the message home only while the repeated song is actually running', () => {
    // The wall belongs to that song while it runs, and to him again the instant it ends. **This is
    // the one case that distinguishes `after` from `before`.**
    const after = { armed: true, setlistDone: true }
    expect(isContactLit({ ...after, presenting: true })).toBe(false)
    expect(isContactLit({ ...after, presenting: false })).toBe(true)
  })

  it('never darkens it in `before`, whatever the lyric state says', () => {
    // Nothing is armed, so there is nothing being performed to belong to — even if a stale index
    // and lines are still in storage from a previous session.
    const before = { armed: false, setlistDone: false }
    expect(isContactLit({ ...before, presenting: true })).toBe(true)
    expect(isContactLit({ ...before, presenting: false })).toBe(true)
  })
})

/**
 * **The condition is a name for what the old expression computed, not a change to it.**
 *
 * Asserted over the whole input space, because *equivalent* is the claim and eight rows is the
 * whole of it. **The old expression is written out here rather than imported**: a test that called
 * the same function twice would prove nothing.
 */
describe('the rewritten condition is case-for-case what it replaced', () => {
  const old = (armed: boolean, setlistDone: boolean, presenting: boolean) =>
    !armed || (setlistDone && !presenting)

  it('agrees on all eight combinations', () => {
    for (const armed of [false, true]) {
      for (const setlistDone of [false, true]) {
        for (const presenting of [false, true]) {
          expect({ armed, setlistDone, presenting, lit: isContactLit({ armed, setlistDone, presenting }) }).toEqual({
            armed,
            setlistDone,
            presenting,
            lit: old(armed, setlistDone, presenting),
          })
        }
      }
    }
  })
})
