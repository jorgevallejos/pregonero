/** @vitest-environment jsdom */
/**
 * One condition, four moments, no special case. **If any of the four below needed a branch of its
 * own, the condition would be wrong** — that is the point of writing it as a condition rather than
 * as a list of events, and this file is where that claim is kept honest.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import {
  isContactLit,
  isPresenting,
  getContactLitBroadcast,
  setContactLitBroadcast,
  KEY_CONTACT_LIT_BROADCAST,
} from './gigContactState'
import type { SongItem } from './songState'

const SONG: SongItem[] = [
  { languages: { es: 'Uno', en: 'One' } },
  { type: 'section', label: 'Chorus' },
  { languages: { es: 'Dos', en: 'Two' } },
]

describe('the contact condition, moment by moment', () => {
  it('is lit at power-up, because nothing is armed', () => {
    expect(isContactLit({ armed: false, setlistDone: false, presenting: false })).toBe(true)
  })

  it('is dark through the setlist, gaps included — a gap is inside the setlist', () => {
    // Mid-song.
    expect(isContactLit({ armed: true, setlistDone: false, presenting: true })).toBe(false)
    // Between two songs: nothing is presenting, and it stays dark anyway, because the setlist is
    // not done. This is the case a list of events gets wrong.
    expect(isContactLit({ armed: true, setlistDone: false, presenting: false })).toBe(false)
  })

  it('is dark while a repeat plays', () => {
    expect(isContactLit({ armed: true, setlistDone: true, presenting: true })).toBe(false)
  })

  it('is lit again the moment that repeat ends', () => {
    // The wall's attention belongs to the song; the instant it finishes the room is being asked
    // to leave with his details again.
    expect(isContactLit({ armed: true, setlistDone: true, presenting: false })).toBe(true)
  })

  it('is lit once he unarms, whatever else is true', () => {
    expect(isContactLit({ armed: false, setlistDone: true, presenting: true })).toBe(true)
    expect(isContactLit({ armed: false, setlistDone: false, presenting: true })).toBe(true)
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
    expect(localStorage.getItem(KEY_CONTACT_LIT_BROADCAST)).toBe('0')
    expect(getContactLitBroadcast()).toBe(false)
    setContactLitBroadcast(true)
    expect(getContactLitBroadcast()).toBe(true)
  })
})
