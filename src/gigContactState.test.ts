/** @vitest-environment jsdom */
/**
 * One condition, four moments, no special case. **If any of the four below needed a branch of its
 * own, the condition would be wrong** — that is the point of writing it as a condition rather than
 * as a list of events, and this file is where that claim is kept honest.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { isContactLit, isPresenting } from './gigContactState'
import { getContactBroadcast, getContactLitBroadcast, setContactLitBroadcast, KEY_CONTACT_LIT_BROADCAST } from './cardBroadcast'
import type { SongItem } from './songState'

const SONG: SongItem[] = [
  { languages: { es: 'Uno', en: 'One' } },
  { type: 'section', label: 'Chorus' },
  { languages: { es: 'Dos', en: 'Two' } },
]

describe('the contact condition, moment by moment', () => {
  it('is lit at power-up, because the setlist has not been entered', () => {
    expect(
      isContactLit({ armed: false, setlistEntered: false, setlistDone: false, presenting: false })
    ).toBe(true)
  })

  it('is dark through the setlist, gaps included — a gap is inside the setlist', () => {
    const during = { setlistEntered: true, setlistDone: false }
    // Mid-song.
    expect(isContactLit({ ...during, armed: true, presenting: true })).toBe(false)
    // Between two songs: nothing is presenting, and it stays dark anyway, because the setlist is
    // not done. This is the case a list of events gets wrong.
    expect(isContactLit({ ...during, armed: true, presenting: false })).toBe(false)
  })

  /**
   * **AND ON A MID-SETLIST UNARM** (Jorge, 2026-09-06). *Arming and unarming move Jorge between
   * rooms; they never move the gig between states.* This used to light — **Cowork proposed it and
   * Jorge overruled it** — and the wall is black there now.
   */
  it('is dark on a mid-setlist unarm, which is the ruling of 2026-09-06', () => {
    const during = { setlistEntered: true, setlistDone: false }
    expect(isContactLit({ ...during, armed: false, presenting: true })).toBe(false)
    expect(isContactLit({ ...during, armed: false, presenting: false })).toBe(false)
  })

  it('is dark while a repeat plays', () => {
    expect(
      isContactLit({ armed: true, setlistEntered: true, setlistDone: true, presenting: true })
    ).toBe(false)
  })

  it('is lit again the moment that repeat ends', () => {
    // The wall's attention belongs to the song; the instant it finishes the room is being asked
    // to leave with his details again.
    expect(
      isContactLit({ armed: true, setlistEntered: true, setlistDone: true, presenting: false })
    ).toBe(true)
  })

  it('is lit once he unarms after the setlist has closed, whatever else is true', () => {
    const after = { setlistEntered: true, setlistDone: true, armed: false }
    expect(isContactLit({ ...after, presenting: true })).toBe(true)
    expect(isContactLit({ ...after, presenting: false })).toBe(true)
  })
})

describe('isPresenting', () => {
  it('is true from the moment a song is loaded, before its first line shows', () => {
    expect(isPresenting(SONG, false)).toBe(true)
  })

  it('stays true through the song', () => {
    expect(isPresenting(SONG, false)).toBe(true)
  })

  it('is still true while the LAST lyric line is showing, which is not over yet', () => {
    // Stage 3: the wall returns after the song ends, not during its last line.
    expect(isPresenting(SONG, false)).toBe(true)
  })

  it('is false once the song has ended', () => {
    expect(isPresenting(SONG, true)).toBe(false)
  })

  it('is false with no song loaded at all', () => {
    expect(isPresenting([], false)).toBe(false)
  })

  it('is false for a loaded song with no lyric lines to reach the end of', () => {
    expect(isPresenting([{ type: 'section', label: 'Intro' }], false)).toBe(false)
  })

  // **Walk 5, stage 2.** The index was only two of the three drive modes answer to *has this song
  // reached its end*. In video the auto-advance effect returns at its first line
  // (`ControlView.tsx`, `if (showVideoPerformance) return`), so the index never left -1 for the
  // whole song and every moment after it — and a finished song went on claiming the wall. The
  // index is no longer asked at all (stage 3); this is the moment that first proved it wrong.
  it('is false when the song has ended in video mode, where no index ever moved', () => {
    expect(isPresenting(SONG, true)).toBe(false)
  })
})

/**
 * **Stage 2 of walk 5, and the fault it is here to keep out.** `tragedia` is the last song; playing
 * it to its end closes the setlist, so the message home is the correct wall. It arrived only when
 * Jorge unarmed. **Which of the two happened was the whole of the question** — it appeared at the
 * end and he noticed at the unarm (nothing wrong), or it appeared only on the unarm (the setlist
 * closed and the wall did not follow). These pin the second, because that is what it was.
 */
describe('the last song of the setlist, played in video mode', () => {
  const lastSongEnds = (songEnded: boolean, armed: boolean) =>
    isContactLit({
      armed,
      setlistEntered: true,
      setlistDone: songEnded,
      // Video mode: the index sat at -1 from the arm to the final frame.
      presenting: isPresenting(SONG, songEnded),
    })

  it('does not light the wall while the song is still running', () => {
    expect(lastSongEnds(false, true)).toBe(false)
  })

  it('lights the wall the moment the song ends, with the arm untouched', () => {
    expect(lastSongEnds(true, true)).toBe(true)
  })

  it('was already lit before the unarm, so the unarm changes nothing', () => {
    expect(lastSongEnds(true, false)).toBe(true)
  })
})

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
    vi.stubGlobal('localStorage', createStorage())
  }
})

beforeEach(() => {
  localStorage.clear()
})

describe('the broadcast', () => {
  it('reads as lit before anything has written it', () => {
    // Which is the power-up answer, so the wall carries the details from the moment it is on.
    expect(getContactLitBroadcast()).toBe(true)
  })

  it('carries both answers across the window boundary', () => {
    setContactLitBroadcast(false)
    expect(getContactLitBroadcast()).toBe(false)
    setContactLitBroadcast(true)
    expect(getContactLitBroadcast()).toBe(true)
  })

  /**
   * **The content crosses on the same key as the condition** (2026-09-06). The Projection window
   * has no `electronAPI` and cannot read the gig folder, so the window that read it hands over the
   * four fields with the answer. **One channel, not two** — a channel is what a framed player would
   * have to carry, and there are seven.
   */
  it('carries the message home’s four fields with the answer', () => {
    setContactLitBroadcast(true, {
      logo: 'logo.png',
      url: 'changopepper.com',
      handle: '@changopepper',
      message: 'Write to me.',
    })
    expect(getContactBroadcast()).toEqual({
      lit: true,
      fields: {
        logo: 'logo.png',
        url: 'changopepper.com',
        handle: '@changopepper',
        message: 'Write to me.',
      },
      preview: null,
    })
  })

  it('reads an absent key as lit with nothing in it, which is the power-up answer', () => {
    // Outside a gig there is no card, and a lit shape with nothing pointed at it is exactly what
    // must not be reachable.
    localStorage.removeItem(KEY_CONTACT_LIT_BROADCAST)
    expect(getContactBroadcast()).toEqual({ lit: true, fields: {}, preview: null })
  })

  it('reads an older build’s bare flag as its boolean and no content', () => {
    // **Not a migration.** The writer replaces the value on the first render of a gig, so this is
    // the width of one render.
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, '0')
    expect(getContactBroadcast()).toEqual({ lit: false, fields: {}, preview: null })
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, '1')
    expect(getContactBroadcast()).toEqual({ lit: true, fields: {}, preview: null })
  })

  it('reads a damaged value as the power-up answer rather than throwing', () => {
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, 'not json')
    expect(getContactBroadcast()).toEqual({ lit: true, fields: {}, preview: null })
  })
})

/**
 * **Stage 3 of walk 5.** A song replayed after the setlist has closed — a repeat, in `after`, where
 * the message home is lit between songs. Everything played correctly except the last phrase, which
 * was never seen: the message home took the wall in its place.
 *
 * **The rule Jorge set: a phrase that is due gets its full duration, and the wall returns after the
 * song ends, not during its last line.** So these fix the moment the wall is allowed back.
 *
 * The last phrase is *due* for as long as its cue runs, and all three drive modes call
 * `endCurrentSong` only once it is over — clock past the last cue, video on the media `ended`
 * event, manual on the press after the last line. `songEnded` is therefore the whole answer, and
 * the index is not consulted at all.
 */
describe('a repeat, after the setlist has closed', () => {
  const duringTheRepeat = (songEnded: boolean) =>
    isContactLit({
      armed: true,
      setlistEntered: true,
      setlistDone: true,
      presenting: isPresenting(SONG, songEnded),
    })

  it('gives the wall to the song from the moment its lines load', () => {
    expect(duringTheRepeat(false)).toBe(false)
  })

  it('keeps the wall on the LAST phrase for its full duration', () => {
    // The last lyric line is on the wall and its cue has not run out. Under the old `index < last`
    // this was already false, and the message home took the wall on top of an unread line.
    expect(duringTheRepeat(false)).toBe(false)
  })

  it('returns the wall once the song has actually ended', () => {
    expect(duringTheRepeat(true)).toBe(true)
  })
})
