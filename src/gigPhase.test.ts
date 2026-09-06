/**
 * **THE THREE-STATE GIG** (2026-09-06).
 *
 * *Before the setlist, in it, after it.* The states were real and nameless: the app had `armed`, a
 * played log and a playable setlist, and every moment that needed the gig assembled one out of
 * them. These tests are about the two properties the name buys, both of which used to be claims
 * somebody had to hold:
 *
 * - **`after` sticks.** The last song ending closes the setlist and nothing reopens it.
 * - **The phase only ever moves forward** (Jorge, 2026-09-06). It used to read `armed` and go back
 *   on an unarm; **arming and unarming move Jorge between rooms and never move the gig between
 *   states.** Each step has exactly one thing that takes it: the first arm enters the setlist, the
 *   last song ending closes it. **Cowork proposed the old behaviour — the message home returning on
 *   a mid-gig unarm — and Jorge overruled it.**
 */
import { describe, it, expect } from 'vitest'
import { gigPhase, isOutsideSetlist, type GigPhase } from './gigPhase'
import { isContactLit } from './gigContactState'

describe('the three states', () => {
  it('is `before` at power-up: the setlist has not been entered', () => {
    expect(gigPhase({ setlistEntered: false, setlistDone: false })).toBe('before')
  })

  it('is `during` from the first arm until the setlist closes', () => {
    expect(gigPhase({ setlistEntered: true, setlistDone: false })).toBe('during')
  })

  it('is `after` once the setlist has been played through', () => {
    expect(gigPhase({ setlistEntered: true, setlistDone: true })).toBe('after')
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

describe('only the last song ending closes the setlist, and an unarm does not open or close it', () => {
  /**
   * **SUPERSEDED, 2026-09-06.** This used to assert that unarming took the gig back to `before` —
   * *which reads oddly for three songs in and is the honest answer*. **It is not the answer.**
   * Jorge: *arming and unarming move Jorge between rooms; they never move the gig between states.*
   * The wall goes black on a mid-setlist unarm; it does not go back to the message home.
   */
  it('does not take the gig back out of the setlist: unarmed mid-setlist is still `during`', () => {
    expect(gigPhase({ setlistEntered: true, setlistDone: false })).toBe('during')
  })

  it('stays `after` when the gig is unarmed once the setlist has closed', () => {
    // `setlistDone` is asked first, so nothing takes the gig back into the setlist.
    expect(gigPhase({ setlistEntered: true, setlistDone: true })).toBe('after')
  })

  it('only ever moves forward, over every input the two flags can be in', () => {
    // Both inputs only turn on, so the phase is a function of a monotone pair: there is no
    // combination that reads earlier than one that preceded it.
    const order = { before: 0, during: 1, after: 2 }
    const path: GigPhase[] = [
      gigPhase({ setlistEntered: false, setlistDone: false }),
      gigPhase({ setlistEntered: true, setlistDone: false }),
      gigPhase({ setlistEntered: true, setlistDone: true }),
    ]
    expect(path).toEqual(['before', 'during', 'after'])
    for (let i = 1; i < path.length; i++) {
      expect(order[path[i]!]).toBeGreaterThan(order[path[i - 1]!])
    }
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
    // Arming again for the requested song does not reopen anything, and neither does unarming.
    expect(gigPhase({ setlistEntered: true, setlistDone: true })).toBe('after')
  })

  it('darkens the message home only while the repeated song is actually running', () => {
    // The wall belongs to that song while it runs, and to him again the instant it ends. **This is
    // the one case that distinguishes `after` from `before`**, and it is the one place `armed`
    // still appears in this condition at all.
    const after = { armed: true, setlistEntered: true, setlistDone: true }
    expect(isContactLit({ ...after, presenting: true })).toBe(false)
    expect(isContactLit({ ...after, presenting: false })).toBe(true)
  })

  it('never darkens it in `before`, whatever the lyric state says', () => {
    // Nothing has entered the setlist, so there is nothing being performed to belong to — even if
    // a stale index and lines are still in storage, and even if a song is loaded and rewound,
    // which is what put an intro card over this card until 2026-09-06.
    const before = { armed: false, setlistEntered: false, setlistDone: false }
    expect(isContactLit({ ...before, presenting: true })).toBe(true)
    expect(isContactLit({ ...before, presenting: false })).toBe(true)
  })

  it('lights nothing inside the setlist, armed or not — the wall is black there', () => {
    // **The ruling of 2026-09-06, and the one this file used to assert the opposite of.**
    const during = { setlistEntered: true, setlistDone: false }
    expect(isContactLit({ ...during, armed: true, presenting: true })).toBe(false)
    expect(isContactLit({ ...during, armed: true, presenting: false })).toBe(false)
    expect(isContactLit({ ...during, armed: false, presenting: true })).toBe(false)
    expect(isContactLit({ ...during, armed: false, presenting: false })).toBe(false)
  })
})

/**
 * **THE CONDITION IS NO LONGER WHAT IT REPLACED, AND THAT IS THE RULING** (Jorge, 2026-09-06).
 *
 * This file used to assert `isContactLit` equal, case for case, to
 * `!armed || (setlistDone && !presenting)` — *the phase is a name for what that expression was
 * computing, not a change to it.* **It is a change to it now**, in exactly one place: **unarmed,
 * inside the setlist.** The old expression lit the message home there; the wall goes black.
 *
 * Kept as a diff rather than deleted, because *which* rows moved is the whole of the ruling, and a
 * test that only asserted the new answers would not say that only one case moved.
 */
describe('what changed against the expression this condition began as', () => {
  const old = (armed: boolean, setlistDone: boolean, presenting: boolean) =>
    !armed || (setlistDone && !presenting)

  it('differs from it in exactly one case: unarmed, inside the setlist', () => {
    const differ: string[] = []
    for (const armed of [false, true]) {
      for (const setlistEntered of [false, true]) {
        // **Armed implies entered**, because arming is what enters the setlist. The combination is
        // unreachable in the running app — `ControlView` computes `armedFlag || getSetlistEntered()`
        // — and counting it as a difference would be counting a state that cannot happen.
        if (armed && !setlistEntered) continue
        for (const setlistDone of [false, true]) {
          for (const presenting of [false, true]) {
            const now = isContactLit({ armed, setlistEntered, setlistDone, presenting })
            if (now !== old(armed, setlistDone, presenting)) {
              differ.push(
                `armed=${armed} entered=${setlistEntered} done=${setlistDone} presenting=${presenting}`
              )
            }
          }
        }
      }
    }
    // Unarmed and inside the setlist — `entered` and not `done` — for either lyric state.
    expect(differ).toEqual([
      'armed=false entered=true done=false presenting=false',
      'armed=false entered=true done=false presenting=true',
    ])
  })
})
