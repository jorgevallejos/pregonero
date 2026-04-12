import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { SongItem } from './songState'
import {
  SETLIST_STORE_KEY,
  SETLIST_STORE_VERSION,
  SETLIST_STORE_VERSION_LEGACY,
  DEFAULT_SETLIST_ID,
  createInitialSnapshot,
  ensureSongLibraryHydrated,
  loadSetlistStore,
  saveSetlistStore,
  getActiveSetlistId,
  setActiveSetlistId,
  getOrderedSongsForActiveSetlist,
  getSetlists,
  hasValidActiveSetlist,
  createEmptySetlist,
  renameSetlist,
  deleteSetlist,
  getLibrarySongs,
  getOrderedSongsForSetlist,
  addSongToSetlist,
  removeSongFromSetlist,
  moveSongInSetlist,
  reorderSongsInSetlist,
  type LibrarySong,
  type Setlist,
  type SetlistStoreSnapshot,
  type SongSeedEntry,
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

const LYRIC: SongItem = { languages: { es: 'la', en: 'lb' } }

const SEED: LibrarySong[] = [
  { id: 'a', title: 'Alpha', items: [LYRIC] },
  { id: 'b', title: 'Bravo', items: [LYRIC] },
]

function installTestStore(): void {
  saveSetlistStore(createInitialSnapshot(SEED))
}

const SEED_CATALOG: SongSeedEntry[] = [
  { id: 'a', title: 'Alpha', path: 'a.json' },
  { id: 'b', title: 'Bravo', path: 'b.json' },
]

function mockFetchForCatalog(
  notesForA?: string
): (path: string) => Promise<string> {
  return async (path: string) => {
    if (path === 'a.json') {
      return JSON.stringify({
        title: 'Alpha',
        lyrics: [{ es: 'A1', en: 'B1' }],
        ...(notesForA !== undefined ? { notes: notesForA } : {}),
      })
    }
    if (path === 'b.json') {
      return JSON.stringify({ title: 'Bravo', lyrics: [{ es: 'A2', en: 'B2' }] })
    }
    throw new Error(`unexpected path ${path}`)
  }
}

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
    it('hydration persists a v2 snapshot with full song content when storage is empty', async () => {
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBeNull()

      const snap = await ensureSongLibraryHydrated({
        catalog: SEED_CATALOG,
        fetchSongJson: mockFetchForCatalog('Capo 2'),
      })

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs).toHaveLength(2)
      expect(snap.songLibrary.songs[0]).toMatchObject({
        id: 'a',
        title: 'Alpha',
        notes: 'Capo 2',
      })
      expect(snap.songLibrary.songs[0].items).toEqual([{ languages: { es: 'A1', en: 'B1' } }])
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBeTruthy()

      const loaded = loadSetlistStore()
      expect(loaded).not.toBeNull()
      expect(loaded!.songLibrary.songs[0].notes).toBe('Capo 2')
    })

    it('does not overwrite an existing valid store on second hydration', async () => {
      const fetchSongJson = vi.fn(mockFetchForCatalog())
      await ensureSongLibraryHydrated({ catalog: SEED_CATALOG, fetchSongJson })
      expect(fetchSongJson).toHaveBeenCalledTimes(2)

      const first = loadSetlistStore()!
      const modified: SetlistStoreSnapshot = {
        ...first,
        activeSetlistId: first.setlists[0]!.id,
        setlists: first.setlists.map((s) =>
          s.id === DEFAULT_SETLIST_ID ? { ...s, name: 'Renamed default' } : s
        ),
      }
      saveSetlistStore(modified)

      await ensureSongLibraryHydrated({ catalog: SEED_CATALOG, fetchSongJson })
      expect(fetchSongJson).toHaveBeenCalledTimes(2)

      const second = loadSetlistStore()!
      expect(second.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe('Renamed default')
    })
  })

  describe('v1 migration', () => {
    it('migrates v1 metadata-only rows to v2 with lyrics and notes from fetched files', async () => {
      const v1 = {
        version: SETLIST_STORE_VERSION_LEGACY,
        songLibrary: {
          songs: [{ id: 'a', title: 'Alpha', path: 'a.json' }],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v1))

      const fetchSongJson = vi.fn(async () =>
        JSON.stringify({
          title: 'Alpha',
          lyrics: [{ es: 'm1', en: 'm2' }],
          notes: 'Bridge loud',
        })
      )

      const snap = await ensureSongLibraryHydrated({
        catalog: SEED_CATALOG,
        fetchSongJson,
      })

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs).toHaveLength(1)
      expect(snap.songLibrary.songs[0].items).toEqual([{ languages: { es: 'm1', en: 'm2' } }])
      expect(snap.songLibrary.songs[0].notes).toBe('Bridge loud')
      expect(snap.setlists[0].songIds).toEqual(['a'])
      expect(loadSetlistStore()!.version).toBe(SETLIST_STORE_VERSION)
    })
  })

  describe('invalid or missing store recovery', () => {
    it('re-seeds from the catalog when v2 JSON is invalid', async () => {
      localStorage.setItem(SETLIST_STORE_KEY, '{ not json')
      const snap = await ensureSongLibraryHydrated({
        catalog: SEED_CATALOG,
        fetchSongJson: mockFetchForCatalog(),
      })
      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs.map((s) => s.id)).toEqual(['a', 'b'])
    })

    it('re-seeds when v2 shape is invalid (missing items)', async () => {
      localStorage.setItem(
        SETLIST_STORE_KEY,
        JSON.stringify({
          version: SETLIST_STORE_VERSION,
          songLibrary: { songs: [{ id: 'x', title: 'Only meta' }] },
          setlists: [],
          activeSetlistId: '',
        })
      )
      const snap = await ensureSongLibraryHydrated({
        catalog: SEED_CATALOG,
        fetchSongJson: mockFetchForCatalog(),
      })
      expect(snap.songLibrary.songs.map((s) => s.id)).toEqual(['a', 'b'])
    })
  })

  describe('default setlist creation', () => {
    it('creates a default setlist with all seed songs in order', () => {
      const snap = createInitialSnapshot(SEED)
      expect(snap.setlists).toHaveLength(1)
      const def = snap.setlists[0]!
      expect(def.id).toBe(DEFAULT_SETLIST_ID)
      expect(def.name).toBe('Default')
      expect(def.songIds).toEqual(['a', 'b'])
    })
  })

  describe('active setlist persistence', () => {
    it('persists activeSetlistId across save and load', () => {
      installTestStore()

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
      installTestStore()
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

  describe('active setlist validity', () => {
    it('repair clears activeSetlistId when it does not match any setlist', () => {
      installTestStore()
      const base = loadSetlistStore()!
      saveSetlistStore({ ...base, activeSetlistId: 'missing-id' })
      const repaired = loadSetlistStore()
      expect(repaired?.activeSetlistId).toBe('')
    })

    it('hasValidActiveSetlist is false when active is empty', () => {
      installTestStore()
      const base = loadSetlistStore()!
      saveSetlistStore({ ...base, activeSetlistId: '' })
      expect(hasValidActiveSetlist()).toBe(false)
      expect(getOrderedSongsForActiveSetlist()).toEqual([])
    })

    it('getSetlists returns persisted setlists', () => {
      installTestStore()
      const base = loadSetlistStore()!
      const extra: Setlist = { id: 'x', name: 'Extra', songIds: ['a'] }
      saveSetlistStore({ ...base, setlists: [...base.setlists, extra] })
      expect(getSetlists().map((s) => s.name)).toContain('Extra')
    })
  })

  describe('createEmptySetlist', () => {
    it('appends an empty setlist with default name and makes it active', () => {
      installTestStore()
      const before = loadSetlistStore()!
      const beforeCount = before.setlists.length

      const { id } = createEmptySetlist()

      const after = loadSetlistStore()!
      expect(after.setlists).toHaveLength(beforeCount + 1)
      const created = after.setlists.find((s) => s.id === id)
      expect(created).toBeDefined()
      expect(created!.name).toBe('New setlist')
      expect(created!.songIds).toEqual([])
      expect(getActiveSetlistId()).toBe(id)
      expect(after.activeSetlistId).toBe(id)
    })
  })

  describe('renameSetlist', () => {
    it('updates the setlist name in persisted storage', () => {
      installTestStore()
      expect(renameSetlist(DEFAULT_SETLIST_ID, '  Main  ')).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe('Main')
      expect(getSetlists().find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe('Main')
    })

    it('returns false for empty name after trim and does not persist a change', () => {
      installTestStore()
      const before = loadSetlistStore()!
      expect(renameSetlist(DEFAULT_SETLIST_ID, '   ')).toBe(false)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.name).toBe(
        before.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!.name
      )
    })

    it('returns false for unknown id', () => {
      installTestStore()
      expect(renameSetlist('missing', 'X')).toBe(false)
    })
  })

  describe('deleteSetlist', () => {
    it('removes a non-active setlist and leaves activeSetlistId unchanged', () => {
      installTestStore()
      const otherId = 'other-setlist'
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [...base.setlists, { id: otherId, name: 'Other', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      })
      expect(deleteSetlist(otherId)).toBe(true)
      const after = loadSetlistStore()!
      expect(after.setlists.some((s) => s.id === otherId)).toBe(false)
      expect(getActiveSetlistId()).toBe(DEFAULT_SETLIST_ID)
    })

    it('removes the active setlist and clears activeSetlistId', () => {
      installTestStore()
      const otherId = 'other-setlist'
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [...base.setlists, { id: otherId, name: 'Other', songIds: ['a'] }],
        activeSetlistId: otherId,
      })
      expect(deleteSetlist(otherId)).toBe(true)
      expect(getActiveSetlistId()).toBe('')
      expect(loadSetlistStore()!.activeSetlistId).toBe('')
    })

    it('returns false for unknown id', () => {
      installTestStore()
      expect(deleteSetlist('nope')).toBe(false)
    })
  })

  describe('getLibrarySongs and getOrderedSongsForSetlist', () => {
    it('getLibrarySongs returns the persisted library', () => {
      installTestStore()
      expect(getLibrarySongs().map((s) => s.id)).toEqual(['a', 'b'])
    })

    it('getOrderedSongsForSetlist resolves song ids to library entries in order', () => {
      installTestStore()
      const otherId = 'other-setlist'
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [...base.setlists, { id: otherId, name: 'Other', songIds: ['b', 'a'] }],
      })
      expect(getOrderedSongsForSetlist(otherId).map((s) => s.id)).toEqual(['b', 'a'])
    })
  })

  describe('addSongToSetlist', () => {
    it('appends a library song and persists', () => {
      installTestStore()
      const emptyId = 'empty-sl'
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: [...base.setlists, { id: emptyId, name: 'Empty', songIds: [] }],
      })
      expect(addSongToSetlist(emptyId, 'a')).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === emptyId)?.songIds).toEqual(['a'])
    })

    it('returns false for duplicate id without changing storage', () => {
      installTestStore()
      expect(addSongToSetlist(DEFAULT_SETLIST_ID, 'a')).toBe(false)
      const snap = loadSetlistStore()!
      expect(snap.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!.songIds.filter((id) => id === 'a').length).toBe(
        1
      )
    })

    it('returns false for unknown setlist id', () => {
      installTestStore()
      expect(addSongToSetlist('missing', 'a')).toBe(false)
    })

    it('returns false for song id not in library', () => {
      installTestStore()
      expect(addSongToSetlist(DEFAULT_SETLIST_ID, 'ghost')).toBe(false)
    })
  })

  describe('removeSongFromSetlist', () => {
    it('removes a song id and persists', () => {
      installTestStore()
      expect(removeSongFromSetlist(DEFAULT_SETLIST_ID, 'a')).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual(['b'])
    })

    it('returns false when song is not in setlist', () => {
      installTestStore()
      const before = loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!.songIds
      expect(removeSongFromSetlist(DEFAULT_SETLIST_ID, 'ghost')).toBe(false)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual(before)
    })

    it('returns false for unknown setlist id', () => {
      installTestStore()
      expect(removeSongFromSetlist('nope', 'a')).toBe(false)
    })
  })

  describe('reorderSongsInSetlist', () => {
    it('moves a song from first to last index and persists', () => {
      installTestStore()
      const three: LibrarySong[] = [
        ...SEED,
        { id: 'c', title: 'Charlie', items: [LYRIC] },
      ]
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        songLibrary: { songs: three },
        setlists: base.setlists.map((s) =>
          s.id === DEFAULT_SETLIST_ID ? { ...s, songIds: ['a', 'b', 'c'] } : s
        ),
      })
      expect(reorderSongsInSetlist(DEFAULT_SETLIST_ID, 0, 2)).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual([
        'b',
        'c',
        'a',
      ])
    })

    it('moves a song from last to first index and persists', () => {
      installTestStore()
      const three: LibrarySong[] = [
        ...SEED,
        { id: 'c', title: 'Charlie', items: [LYRIC] },
      ]
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        songLibrary: { songs: three },
        setlists: base.setlists.map((s) =>
          s.id === DEFAULT_SETLIST_ID ? { ...s, songIds: ['a', 'b', 'c'] } : s
        ),
      })
      expect(reorderSongsInSetlist(DEFAULT_SETLIST_ID, 2, 0)).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual([
        'c',
        'a',
        'b',
      ])
    })

    it('returns true without changing storage when from and to are the same', () => {
      installTestStore()
      const rawBefore = localStorage.getItem(SETLIST_STORE_KEY)
      expect(reorderSongsInSetlist(DEFAULT_SETLIST_ID, 0, 0)).toBe(true)
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(rawBefore)
    })

    it('returns false for out-of-range indices', () => {
      installTestStore()
      expect(reorderSongsInSetlist(DEFAULT_SETLIST_ID, -1, 0)).toBe(false)
      expect(reorderSongsInSetlist(DEFAULT_SETLIST_ID, 0, 99)).toBe(false)
    })

    it('returns false for unknown setlist id', () => {
      installTestStore()
      expect(reorderSongsInSetlist('missing', 0, 1)).toBe(false)
    })
  })

  describe('moveSongInSetlist', () => {
    it('moving a song down persists the new order', () => {
      installTestStore()
      expect(moveSongInSetlist(DEFAULT_SETLIST_ID, 'a', 'down')).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual([
        'b',
        'a',
      ])
      expect(getOrderedSongsForSetlist(DEFAULT_SETLIST_ID).map((s) => s.id)).toEqual(['b', 'a'])
    })

    it('moving a song up persists the new order', () => {
      installTestStore()
      const base = loadSetlistStore()!
      saveSetlistStore({
        ...base,
        setlists: base.setlists.map((s) =>
          s.id === DEFAULT_SETLIST_ID ? { ...s, songIds: ['b', 'a'] } : s
        ),
      })
      expect(moveSongInSetlist(DEFAULT_SETLIST_ID, 'a', 'up')).toBe(true)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual([
        'a',
        'b',
      ])
    })

    it('returns false when moving the first song up (no persist change)', () => {
      installTestStore()
      const before = loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!.songIds
      expect(moveSongInSetlist(DEFAULT_SETLIST_ID, 'a', 'up')).toBe(false)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual(
        before
      )
    })

    it('returns false when moving the last song down (no persist change)', () => {
      installTestStore()
      const before = loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)!.songIds
      expect(moveSongInSetlist(DEFAULT_SETLIST_ID, 'b', 'down')).toBe(false)
      expect(loadSetlistStore()!.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual(
        before
      )
    })

    it('getOrderedSongsForActiveSetlist reflects order after reorder on the active setlist', () => {
      installTestStore()
      moveSongInSetlist(DEFAULT_SETLIST_ID, 'a', 'down')
      expect(getOrderedSongsForActiveSetlist().map((s) => s.id)).toEqual(['b', 'a'])
    })

    it('returns false for unknown setlist id', () => {
      installTestStore()
      expect(moveSongInSetlist('missing', 'a', 'down')).toBe(false)
    })

    it('returns false for song not in setlist', () => {
      installTestStore()
      expect(moveSongInSetlist(DEFAULT_SETLIST_ID, 'ghost', 'down')).toBe(false)
    })
  })
})
