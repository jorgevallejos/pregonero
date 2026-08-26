import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import {
  getPlayedSongs,
  addPlayedSong,
  hasPlayedSong,
  isSetlistComplete,
} from './playedSongsState'

const KEY = 'liveLyricPlayedSongIds'

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

function ids(): string[] {
  return getPlayedSongs().map((e) => e.songId)
}

describe('playedSongsState', () => {
  beforeAll(() => {
    if (typeof globalThis.sessionStorage === 'undefined' || typeof globalThis.sessionStorage.setItem !== 'function') {
      vi.stubGlobal('sessionStorage', createStorage())
    }
  })

  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('getPlayedSongs', () => {
    it('returns empty array when none stored', () => {
      expect(getPlayedSongs()).toEqual([])
    })

    it('returns stored entries after addPlayedSong', () => {
      addPlayedSong('duelo')
      expect(ids()).toEqual(['duelo'])
    })

    it('keeps performance order, which is not setlist order', () => {
      addPlayedSong('luz-y-sal')
      addPlayedSong('duelo')
      expect(ids()).toEqual(['luz-y-sal', 'duelo'])
    })

    it('returns empty array after sessionStorage is cleared', () => {
      addPlayedSong('duelo')
      sessionStorage.clear()
      expect(getPlayedSongs()).toEqual([])
    })

    it('degrades to an empty list on unparseable storage', () => {
      sessionStorage.setItem(KEY, '{not json')
      expect(getPlayedSongs()).toEqual([])
    })

    it('degrades to an empty list when the stored value is not an array', () => {
      sessionStorage.setItem(KEY, '{"duelo":true}')
      expect(getPlayedSongs()).toEqual([])
    })

    it('drops individual entries that carry no songId', () => {
      sessionStorage.setItem(KEY, JSON.stringify([{ startedAt: null }, { songId: 'duelo' }, 42]))
      expect(ids()).toEqual(['duelo'])
    })
  })

  describe('migration from the pre-v0.13 string array', () => {
    it('reads a stored array of ids as entries with both times unknown', () => {
      sessionStorage.setItem(KEY, JSON.stringify(['duelo', 'luz-y-sal']))
      expect(getPlayedSongs()).toEqual([
        { songId: 'duelo', startedAt: null, endedAt: null },
        { songId: 'luz-y-sal', startedAt: null, endedAt: null },
      ])
    })

    it('appends onto a migrated list without rewriting the old entries times', () => {
      sessionStorage.setItem(KEY, JSON.stringify(['duelo']))
      addPlayedSong('luz-y-sal', { startedAt: '2026-08-26T20:00:00.000Z', endedAt: '2026-08-26T20:04:00.000Z' })
      expect(getPlayedSongs()).toEqual([
        { songId: 'duelo', startedAt: null, endedAt: null },
        { songId: 'luz-y-sal', startedAt: '2026-08-26T20:00:00.000Z', endedAt: '2026-08-26T20:04:00.000Z' },
      ])
    })
  })

  describe('addPlayedSong', () => {
    it('is NOT idempotent: a repeat is a second performance and appears twice', () => {
      addPlayedSong('duelo')
      addPlayedSong('duelo')
      expect(ids()).toEqual(['duelo', 'duelo'])
    })

    it('records endedAt as a real time by default', () => {
      const before = Date.now()
      addPlayedSong('duelo')
      const entry = getPlayedSongs()[0]
      expect(entry.endedAt).not.toBeNull()
      expect(Date.parse(entry.endedAt as string)).toBeGreaterThanOrEqual(before)
    })

    it('writes startedAt as null rather than inventing one', () => {
      addPlayedSong('duelo')
      expect(getPlayedSongs()[0].startedAt).toBeNull()
    })

    it('carries a supplied startedAt through', () => {
      addPlayedSong('duelo', { startedAt: '2026-08-26T20:00:00.000Z' })
      expect(getPlayedSongs()[0].startedAt).toBe('2026-08-26T20:00:00.000Z')
    })
  })

  describe('hasPlayedSong', () => {
    it('is false for a song never played', () => {
      expect(hasPlayedSong('duelo')).toBe(false)
    })

    it('is true once, and stays true after a repeat', () => {
      addPlayedSong('duelo')
      expect(hasPlayedSong('duelo')).toBe(true)
      addPlayedSong('duelo')
      expect(hasPlayedSong('duelo')).toBe(true)
    })
  })

  describe('isSetlistComplete', () => {
    it('is false for an empty setlist: nothing has finished', () => {
      expect(isSetlistComplete([])).toBe(false)
    })

    it('is false while the setlist is still being walked', () => {
      addPlayedSong('duelo')
      expect(isSetlistComplete(['duelo', 'luz-y-sal'])).toBe(false)
    })

    it('is true once the last setlist song has been played', () => {
      addPlayedSong('duelo')
      addPlayedSong('luz-y-sal')
      expect(isSetlistComplete(['duelo', 'luz-y-sal'])).toBe(true)
    })

    it('is true even when a middle song was skipped', () => {
      addPlayedSong('luz-y-sal')
      expect(isSetlistComplete(['duelo', 'luz-y-sal'])).toBe(true)
    })

    it('stays true after a repeat is appended', () => {
      addPlayedSong('luz-y-sal')
      addPlayedSong('duelo')
      expect(isSetlistComplete(['duelo', 'luz-y-sal'])).toBe(true)
    })

    it('keys off the last readable song, so a dropped unreadable reference cannot wedge the gig', () => {
      // getOrderedSongsForActiveSetlist filters unreadable references out, so libertad never
      // reaches this predicate even when it is last in the authored setlist.
      addPlayedSong('luz-y-sal')
      expect(isSetlistComplete(['duelo', 'luz-y-sal'])).toBe(true)
    })

    it('accepts an explicit played list instead of reading storage', () => {
      expect(
        isSetlistComplete(['duelo'], [{ songId: 'duelo', startedAt: null, endedAt: null }])
      ).toBe(true)
    })
  })
})
