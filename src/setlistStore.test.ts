import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import {
  SETLIST_STORE_KEY,
  SETLIST_STORE_VERSION,
  DEFAULT_SETLIST_ID,
  bootstrapSetlistStore,
  loadSetlistStore,
  saveSetlistStore,
  getActiveSetlistId,
  setActiveSetlistId,
  getOrderedSongsForActiveSetlist,
  type LibrarySong,
  type Setlist,
  type SetlistStoreSnapshot,
} from './setlistStore'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

const SEED: LibrarySong[] = [
  { id: 'a', title: 'Alpha', path: 'a.json' },
  { id: 'b', title: 'Bravo', path: 'b.json' },
]

describe('setlistStore', () => {
  beforeAll(() => {
    if (
      typeof globalThis.localStorage === 'undefined' ||
      typeof globalThis.localStorage.setItem !== 'function'
    ) {
      vi.stubGlobal('localStorage', createStorage())
    }
  })

  beforeEach(() => {
    localStorage.clear()
  })

  describe('first-time initialization', () => {
    it('persists a valid snapshot when storage is empty', () => {
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBeNull()

      const snap = bootstrapSetlistStore(SEED)

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs).toEqual(SEED)
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBeTruthy()

      const loaded = loadSetlistStore()
      expect(loaded).not.toBeNull()
      expect(loaded!.songLibrary.songs).toEqual(SEED)
    })

    it('does not overwrite an existing valid store on second bootstrap', () => {
      bootstrapSetlistStore(SEED)
      const first = loadSetlistStore()!

      const modified: SetlistStoreSnapshot = {
        ...first,
        activeSetlistId: first.setlists[0]!.id,
        setlists: first.setlists.map((s) =>
          s.id === DEFAULT_SETLIST_ID ? { ...s, name: 'Renamed default' } : s
        ),
      }
      saveSetlistStore(modified)

      bootstrapSetlistStore(SEED)
      const second = loadSetlistStore()!

      expect(second.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe('Renamed default')
    })
  })

  describe('default setlist creation', () => {
    it('creates a default setlist with all seed songs in order', () => {
      const snap = bootstrapSetlistStore(SEED)

      expect(snap.setlists).toHaveLength(1)
      const def = snap.setlists[0]!
      expect(def.id).toBe(DEFAULT_SETLIST_ID)
      expect(def.name).toBe('Default')
      expect(def.songIds).toEqual(['a', 'b'])
    })
  })

  describe('active setlist persistence', () => {
    it('persists activeSetlistId across save and load', () => {
      bootstrapSetlistStore(SEED)

      const otherId = 'other-setlist'
      const base = loadSetlistStore()!
      const other: Setlist = {
        id: otherId,
        name: 'Other',
        songIds: ['b', 'a'],
      }
      const withTwo: SetlistStoreSnapshot = {
        ...base,
        setlists: [...base.setlists, other],
      }
      saveSetlistStore(withTwo)

      expect(setActiveSetlistId(otherId)).toBe(true)
      expect(getActiveSetlistId()).toBe(otherId)

      const roundTrip = loadSetlistStore()
      expect(roundTrip?.activeSetlistId).toBe(otherId)
    })

    it('getOrderedSongsForActiveSetlist reflects the active setlist order', () => {
      bootstrapSetlistStore(SEED)
      const otherId = 'other-setlist'
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [
          ...base.setlists,
          { id: otherId, name: 'Other', songIds: ['b', 'a'] },
        ],
      })
      setActiveSetlistId(otherId)

      expect(getOrderedSongsForActiveSetlist().map((s) => s.id)).toEqual(['b', 'a'])
    })
  })
})
