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
    expect(isPresenting(SONG, -1)).toBe(true)
  })

  it('stays true through the song', () => {
    expect(isPresenting(SONG, 0)).toBe(true)
  })

  it('is false once the last lyric line has been shown', () => {
    // Index 2 is the last lyric; the section marker at 1 is not one.
    expect(isPresenting(SONG, 2)).toBe(false)
  })

  it('is false with no song loaded at all', () => {
    expect(isPresenting([], -1)).toBe(false)
  })

  it('is false for a loaded song with no lyric lines to reach the end of', () => {
    expect(isPresenting([{ type: 'section', label: 'Intro' }], -1)).toBe(false)
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
