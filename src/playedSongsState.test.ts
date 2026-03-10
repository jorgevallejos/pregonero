import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import { getPlayedSongIds, addPlayedSong } from './playedSongsState'

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

describe('playedSongsState', () => {
  beforeAll(() => {
    if (typeof globalThis.sessionStorage === 'undefined' || typeof globalThis.sessionStorage.setItem !== 'function') {
      vi.stubGlobal('sessionStorage', createStorage())
    }
  })

  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('getPlayedSongIds', () => {
    it('returns empty array when none stored', () => {
      expect(getPlayedSongIds()).toEqual([])
    })

    it('returns stored ids after addPlayedSong', () => {
      addPlayedSong('duelo')
      expect(getPlayedSongIds()).toEqual(['duelo'])
    })

    it('returns all stored ids when multiple added', () => {
      addPlayedSong('duelo')
      addPlayedSong('luz-y-sal')
      expect(getPlayedSongIds()).toEqual(['duelo', 'luz-y-sal'])
    })

    it('returns empty array after sessionStorage is cleared', () => {
      addPlayedSong('duelo')
      sessionStorage.clear()
      expect(getPlayedSongIds()).toEqual([])
    })
  })

  describe('addPlayedSong', () => {
    it('is idempotent: adding same id again does not duplicate', () => {
      addPlayedSong('duelo')
      addPlayedSong('duelo')
      expect(getPlayedSongIds()).toEqual(['duelo'])
    })
  })
})
