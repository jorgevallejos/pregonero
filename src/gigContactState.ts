/**
 * **When the contact panel is lit**, and the whole of it is one condition.
 *
 * > Lit when **not armed**, or when the **setlist is done and no song is presenting**. Dark
 * > otherwise.
 *
 * It is written as a condition rather than as a list of events on purpose, because one condition
 * covers all four moments with no special case:
 *
 * | Moment | Why the condition answers it |
 * |---|---|
 * | Power-up | Not armed. |
 * | Through the setlist, gaps included | Armed, and the setlist is not done. A gap is inside the setlist. |
 * | While a repeat plays | Armed, setlist done, but a song is presenting. |
 * | The instant that repeat ends | Armed, setlist done, nothing presenting — the room is being asked to leave with his details again. |
 *
 * **If an implementation needs a special case for any of those four, the condition is wrong.** Go
 * back to it rather than adding the branch.
 *
 * ## Where it is evaluated, and why it travels as one boolean
 *
 * Every input is the Control window's: `armed` is its session, the played log is its session, and
 * the playable setlist is its readiness snapshot. The Projection window has none of them and is
 * not given a copy of any of them — it is given **the answer**, which keeps one implementation of
 * the condition and no second opinion about it. Same reason `computeGigReadiness` has one home.
 *
 * The value is read at mount and on every `storage` event, so the missed-event problem the nonce
 * rule in `CLAUDE.md` exists for does not arise. **An absent key reads as lit**, which is the
 * power-up answer, so the wall carries the contact details before anything has written anything.
 */

import { useEffect, useState } from 'react'
import { getLastLyricIndex, type SongItem } from './songState'

/** The key is an address and is deliberately not renamed — see `contentFolders.ts`. */
export const KEY_CONTACT_LIT_BROADCAST = 'pregoneroContactLit'

export type ContactConditionInput = {
  armed: boolean
  /** The setlist is played once, and this is round D's predicate, against the *playable* setlist. */
  setlistDone: boolean
  /** A loaded song that has not yet reached its end. */
  presenting: boolean
}

/** The condition. Nothing anywhere else may decide this. */
export function isContactLit({ armed, setlistDone, presenting }: ContactConditionInput): boolean {
  return !armed || (setlistDone && !presenting)
}

/**
 * **Presenting: a loaded song that has not yet reached its end.**
 *
 * A song is loaded from the moment its lines are, which is before the first line shows — the wall's
 * attention has already moved to the song by then. It has reached its end once its last lyric line
 * has been shown, which is the moment the room stops being an audience for it.
 */
export function isPresenting(lines: readonly SongItem[], index: number): boolean {
  if (lines.length === 0) return false
  const last = getLastLyricIndex(lines as SongItem[])
  if (last < 0) return false
  return index < last
}

export function setContactLitBroadcast(lit: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, lit ? '1' : '0')
  } catch {
    /* unavailable in some environments */
  }
}

export function getContactLitBroadcast(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true
    // Absent is lit: nothing is armed until something says so.
    return localStorage.getItem(KEY_CONTACT_LIT_BROADCAST) !== '0'
  } catch {
    return true
  }
}

export function useContactLit(): boolean {
  const [lit, setLit] = useState(getContactLitBroadcast)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_CONTACT_LIT_BROADCAST || e.key === null) {
        setLit(getContactLitBroadcast())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return lit
}
