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
 * ## The channel carries the answer, and since 2026-09-06 the answer includes the content
 *
 * **The Projection window has no `electronAPI` and cannot read the gig folder**, so the four fields
 * of the message home reach it the way the boolean always has — on this key, from the window that
 * read them. **This is the same channel and not a second one**, which matters: a channel is what a
 * framed player would have to carry, and there are seven.
 *
 * **An absent key reads as lit with nothing in it**, which is the power-up answer: outside a gig
 * there is no card, and a lit shape with nothing pointed at it is exactly what must not be
 * reachable. A value left by an older build reads as its boolean and no content, which needs no
 * migration because the writer replaces it on the first render of a gig.
 */

import { useEffect, useState } from 'react'
import { getLastLyricIndex, type SongItem } from './songState'
import { gigPhase, isOutsideSetlist, type GigPhase } from './gigPhase'
import { readMessageHome, type MessageHome } from './gigFile'

/** The key is an address and is deliberately not renamed — see `contentFolders.ts`. */
export const KEY_CONTACT_LIT_BROADCAST = 'pregoneroContactLit'

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
 * attention has already moved to the song by then. It has reached its end once its last lyric line
 * has been shown, which is the moment the room stops being an audience for it.
 */
export function isPresenting(lines: readonly SongItem[], index: number): boolean {
  if (lines.length === 0) return false
  const last = getLastLyricIndex(lines as SongItem[])
  if (last < 0) return false
  return index < last
}

/** What crosses: whether the shape is lit, and what goes in it. */
export type ContactBroadcast = { lit: boolean; fields: MessageHome }

export function setContactLitBroadcast(lit: boolean, fields: MessageHome = {}): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, JSON.stringify({ lit, fields }))
  } catch {
    /* unavailable in some environments */
  }
}

export function getContactBroadcast(): ContactBroadcast {
  const absent: ContactBroadcast = { lit: true, fields: {} }
  try {
    if (typeof localStorage === 'undefined') return absent
    const raw = localStorage.getItem(KEY_CONTACT_LIT_BROADCAST)
    if (raw === null) return absent
    // **An older build's `'1'` / `'0'` reads as its boolean and no content.** Not a migration: the
    // writer replaces the value on the first render of a gig, so this is the width of one render.
    if (raw === '0') return { lit: false, fields: {} }
    if (raw === '1') return absent
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return absent
    const o = parsed as { lit?: unknown; fields?: unknown }
    return {
      lit: o.lit !== false,
      fields: readMessageHome(o.fields) ?? {},
    }
  } catch {
    return absent
  }
}

/** Whether the shape is lit. The condition's answer, as it has always travelled. */
export function getContactLitBroadcast(): boolean {
  return getContactBroadcast().lit
}

export function useContactBroadcast(): ContactBroadcast {
  const [value, setValue] = useState(getContactBroadcast)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_CONTACT_LIT_BROADCAST || e.key === null) {
        setValue(getContactBroadcast())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return value
}

export function useContactLit(): boolean {
  return useContactBroadcast().lit
}
