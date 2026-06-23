import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { SongItem } from './songState'
import {
  SETLIST_STORE_KEY,
  SETLIST_STORE_VERSION,
  SETLIST_STORE_VERSION_LEGACY,
  DEFAULT_SETLIST_ID,
  createEmptyV2Snapshot,
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
  addSongToLibrary,
  importSongFromJsonText,
  deleteSongFromLibrary,
  applySequentialSongImportsFromJsonTexts,
  areSetlistStoreSnapshotsEqual,
  cloneSetlistStoreSnapshot,
  getSetlistNamesContainingSongInSnapshot,
  updateSongTimeline,
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

const LYRIC: SongItem = { languages: { es: 'la', en: 'lb' } }

const SEED: LibrarySong[] = [
  { id: 'a', title: 'Alpha', items: [LYRIC] },
  { id: 'b', title: 'Bravo', items: [LYRIC] },
]

function installTestStore(): void {
  saveSetlistStore(createInitialSnapshot(SEED))
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
    it('hydration persists an empty v2 snapshot when storage is missing', async () => {
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBeNull()

      const fetchSongJson = vi.fn(async () => {
        throw new Error('fetch should not run for empty init')
      })
      const snap = await ensureSongLibraryHydrated({ fetchSongJson })

      expect(fetchSongJson).not.toHaveBeenCalled()
      expect(snap).toEqual(createEmptyV2Snapshot())
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBeTruthy()

      const loaded = loadSetlistStore()
      expect(loaded).not.toBeNull()
      expect(loaded!.songLibrary.songs).toEqual([])
      expect(loaded!.setlists).toEqual([])
      expect(loaded!.activeSetlistId).toBe('')
    })

    it('does not overwrite an existing valid store on second hydration', async () => {
      const fetchSongJson = vi.fn(async () => {
        throw new Error('fetch should not run')
      })
      await ensureSongLibraryHydrated({ fetchSongJson })
      expect(fetchSongJson).not.toHaveBeenCalled()

      const first = loadSetlistStore()!
      const modified: SetlistStoreSnapshot = {
        ...first,
        songLibrary: { songs: [{ id: 'x', title: 'X', items: [LYRIC] }] },
        setlists: [{ id: 'sl1', name: 'Main', songIds: ['x'] }],
        activeSetlistId: 'sl1',
      }
      saveSetlistStore(modified)
      const serialized = localStorage.getItem(SETLIST_STORE_KEY)

      await ensureSongLibraryHydrated({ fetchSongJson })
      expect(fetchSongJson).not.toHaveBeenCalled()
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(serialized)

      const second = loadSetlistStore()!
      expect(second.setlists.find((s) => s.id === 'sl1')?.name).toBe('Main')
      expect(second.songLibrary.songs[0]!.id).toBe('x')
    })

    it('leaves a valid persisted v2 snapshot byte-identical after hydration', async () => {
      installTestStore()
      const before = localStorage.getItem(SETLIST_STORE_KEY)
      await ensureSongLibraryHydrated()
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(before)
    })
  })

  describe('v2 migration (drop intro_cues, bump to v3)', () => {
    it('strips intro_cues from library songs and persists as v3', async () => {
      const v2Snapshot = {
        version: 2,
        songLibrary: {
          songs: [
            { id: 'a', title: 'Alpha', items: [LYRIC], intro_cues: 'Press pedal to start' },
            { id: 'b', title: 'Bravo', items: [LYRIC] },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a', 'b'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v2Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]).not.toHaveProperty('intro_cues')
      expect(snap.songLibrary.songs[0]!.title).toBe('Alpha')
      expect(snap.songLibrary.songs[1]).not.toHaveProperty('intro_cues')

      const persisted = loadSetlistStore()
      expect(persisted).not.toBeNull()
      expect(persisted!.version).toBe(SETLIST_STORE_VERSION)
      expect(persisted!.songLibrary.songs[0]).not.toHaveProperty('intro_cues')
    })

    it('migrates a v2 snapshot without intro_cues and sets version to v3', async () => {
      const v2Snapshot = {
        version: 2,
        songLibrary: {
          songs: [{ id: 'a', title: 'Alpha', items: [LYRIC], notes: 'Capo 2' }],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v2Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.notes).toBe('Capo 2')
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
    it('recovers to an empty v2 snapshot when stored JSON is invalid', async () => {
      localStorage.setItem(SETLIST_STORE_KEY, '{ not json')
      const fetchSongJson = vi.fn(async () => {
        throw new Error('fetch should not run')
      })
      const snap = await ensureSongLibraryHydrated({ fetchSongJson })
      expect(fetchSongJson).not.toHaveBeenCalled()
      expect(snap).toEqual(createEmptyV2Snapshot())
    })

    it('recovers to an empty v2 snapshot when v2 shape is invalid (missing items)', async () => {
      localStorage.setItem(
        SETLIST_STORE_KEY,
        JSON.stringify({
          version: SETLIST_STORE_VERSION,
          songLibrary: { songs: [{ id: 'x', title: 'Only meta' }] },
          setlists: [],
          activeSetlistId: '',
        })
      )
      const fetchSongJson = vi.fn(async () => {
        throw new Error('fetch should not run')
      })
      const snap = await ensureSongLibraryHydrated({ fetchSongJson })
      expect(fetchSongJson).not.toHaveBeenCalled()
      expect(snap.songLibrary.songs).toEqual([])
      expect(snap.setlists).toEqual([])
      expect(snap.activeSetlistId).toBe('')
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

  describe('title_translations and intro round-trip through library', () => {
    it('persists title_translations and intro when importing a song with those fields', async () => {
      await ensureSongLibraryHydrated()
      const json = JSON.stringify({
        id: 'song-with-extras',
        title: 'Tragedia',
        lyrics: [{ es: 'línea', en: 'line' }],
        title_translations: { en: 'Tragedy', nl: 'Tragedie' },
        intro: { es: 'Pelea con tu destino.', en: 'Fight your destiny.' },
      })
      const r = importSongFromJsonText(json)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const loaded = loadSetlistStore()!.songLibrary.songs.find((s) => s.id === 'song-with-extras')
      expect(loaded).toBeDefined()
      expect(loaded!.title_translations).toEqual({ en: 'Tragedy', nl: 'Tragedie' })
      expect(loaded!.intro).toEqual({ es: 'Pelea con tu destino.', en: 'Fight your destiny.' })
    })

    it('stores song without title_translations and intro when those fields are absent', async () => {
      await ensureSongLibraryHydrated()
      const json = JSON.stringify({
        id: 'song-minimal',
        title: 'Minimal',
        lyrics: [{ es: 'a', en: 'b' }],
      })
      const r = importSongFromJsonText(json)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const loaded = loadSetlistStore()!.songLibrary.songs.find((s) => s.id === 'song-minimal')
      expect(loaded).toBeDefined()
      expect(loaded!.title_translations).toBeUndefined()
      expect(loaded!.intro).toBeUndefined()
    })

    it('round-trips title_translations and intro through addSongToLibrary', async () => {
      await ensureSongLibraryHydrated()
      const song: LibrarySong = {
        id: 'direct-add',
        title: 'Direct',
        items: [LYRIC],
        title_translations: { en: 'Direct EN' },
        intro: { en: 'One-liner.' },
      }
      expect(addSongToLibrary(song)).toBe(true)
      const loaded = loadSetlistStore()!.songLibrary.songs.find((s) => s.id === 'direct-add')
      expect(loaded!.title_translations).toEqual({ en: 'Direct EN' })
      expect(loaded!.intro).toEqual({ en: 'One-liner.' })
    })
  })

  describe('addSongToLibrary', () => {
    it('appends a song and persists full items and optional notes', async () => {
      await ensureSongLibraryHydrated()
      const song: LibrarySong = {
        id: 'imported-1',
        title: 'Hello',
        notes: 'Capo 2',
        items: [LYRIC],
      }
      expect(addSongToLibrary(song)).toBe(true)
      const loaded = loadSetlistStore()!.songLibrary.songs.find((s) => s.id === 'imported-1')
      expect(loaded).toEqual(song)
      expect(getLibrarySongs().map((s) => s.id)).toContain('imported-1')
    })

    it('returns false for duplicate id and leaves storage unchanged', async () => {
      await ensureSongLibraryHydrated()
      const a: LibrarySong = { id: 'same', title: 'First', items: [LYRIC] }
      const b: LibrarySong = { id: 'same', title: 'Second', items: [LYRIC] }
      expect(addSongToLibrary(a)).toBe(true)
      const rawBefore = localStorage.getItem(SETLIST_STORE_KEY)
      expect(addSongToLibrary(b)).toBe(false)
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(rawBefore)
      expect(getLibrarySongs().find((s) => s.id === 'same')!.title).toBe('First')
    })

    it('returns false for invalid items shape', async () => {
      await ensureSongLibraryHydrated()
      const bad = { id: 'bad', title: 'T', items: [{}] } as unknown as LibrarySong
      expect(addSongToLibrary(bad)).toBe(false)
      expect(getLibrarySongs().some((s) => s.id === 'bad')).toBe(false)
    })
  })

  describe('importSongFromJsonText', () => {
    it('imports a valid file with explicit id and lyrics', async () => {
      await ensureSongLibraryHydrated()
      const json = JSON.stringify({
        id: 'file-id',
        title: 'My Song',
        lyrics: [{ es: 'uno', en: 'one' }],
        notes: 'Quiet',
      })
      const r = importSongFromJsonText(json)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.song).toEqual({
        id: 'file-id',
        title: 'My Song',
        items: [{ languages: { es: 'uno', en: 'one' } }],
        notes: 'Quiet',
      })
      expect(getLibrarySongs().find((s) => s.id === 'file-id')).toBeDefined()
    })

    it('imports without id by assigning a new id', async () => {
      await ensureSongLibraryHydrated()
      const json = JSON.stringify({
        title: 'No id',
        lyrics: [{ es: 'a', en: 'b' }],
      })
      const r = importSongFromJsonText(json)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.song.id.length).toBeGreaterThan(0)
      expect(getLibrarySongs().some((s) => s.id === r.song.id)).toBe(true)
    })

    it('rejects invalid JSON', async () => {
      await ensureSongLibraryHydrated()
      const r = importSongFromJsonText('{')
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error).toMatch(/not valid JSON/i)
    })

    it('rejects wrong top-level shape', async () => {
      await ensureSongLibraryHydrated()
      const r = importSongFromJsonText('[]')
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error).toMatch(/JSON object/)
    })

    it('rejects invalid song shape with parseSongFile-style message', async () => {
      await ensureSongLibraryHydrated()
      const r = importSongFromJsonText(JSON.stringify({ title: 'X' }))
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.error).toMatch(/missing "lyrics"/)
    })

    it('rejects duplicate id', async () => {
      await ensureSongLibraryHydrated()
      const json = JSON.stringify({
        id: 'dup',
        title: 'One',
        lyrics: [{ es: 'a', en: 'b' }],
      })
      expect(importSongFromJsonText(json).ok).toBe(true)
      const second = importSongFromJsonText(json)
      expect(second.ok).toBe(false)
      if (second.ok) return
      expect(second.error).toMatch(/already in your library/)
    })

    it('does not change existing library songs when import fails', async () => {
      await ensureSongLibraryHydrated()
      const okJson = JSON.stringify({
        id: 'keep',
        title: 'Kept',
        lyrics: [{ es: 'x', en: 'y' }],
      })
      expect(importSongFromJsonText(okJson).ok).toBe(true)
      const before = localStorage.getItem(SETLIST_STORE_KEY)
      const bad = importSongFromJsonText('{')
      expect(bad.ok).toBe(false)
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(before)
    })
  })

  describe('applySequentialSongImportsFromJsonTexts', () => {
    const valid = (id: string, title: string) =>
      JSON.stringify({ id, title, lyrics: [{ es: 'a', en: 'b' }] })

    it('imports multiple valid JSON texts in order', () => {
      const snap = createInitialSnapshot([])
      const r = applySequentialSongImportsFromJsonTexts(snap, [
        valid('s1', 'One'),
        valid('s2', 'Two'),
      ])
      expect(r.importedCount).toBe(2)
      expect(r.duplicatesSkipped).toBe(0)
      expect(r.invalidSkipped).toBe(0)
      expect(r.snapshot.songLibrary.songs.map((s) => s.id)).toEqual(['s1', 's2'])
    })

    it('counts duplicate ids against the evolving snapshot (library and same batch)', () => {
      const snap = createInitialSnapshot([
        { id: 'existing', title: 'Old', items: [LYRIC] },
      ])
      const dupLibrary = valid('existing', 'Dup Lib')
      const firstNew = valid('n1', 'New one')
      const dupBatch = valid('n1', 'Dup batch')
      const r = applySequentialSongImportsFromJsonTexts(snap, [
        dupLibrary,
        firstNew,
        dupBatch,
        valid('n2', 'New two'),
      ])
      expect(r.importedCount).toBe(2)
      expect(r.duplicatesSkipped).toBe(2)
      expect(r.invalidSkipped).toBe(0)
      expect(r.snapshot.songLibrary.songs.map((s) => s.id)).toEqual([
        'existing',
        'n1',
        'n2',
      ])
    })

    it('counts invalid JSON and invalid song shape as invalidSkipped', () => {
      const snap = createInitialSnapshot([])
      const r = applySequentialSongImportsFromJsonTexts(snap, ['{', JSON.stringify({ title: 'X' })])
      expect(r.importedCount).toBe(0)
      expect(r.duplicatesSkipped).toBe(0)
      expect(r.invalidSkipped).toBe(2)
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

  describe('deleteSongFromLibrary', () => {
    it('removes the song from the library and from every setlist', () => {
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
      expect(deleteSongFromLibrary('a')).toBe(true)
      const loaded = loadSetlistStore()!
      expect(loaded.songLibrary.songs.map((s) => s.id)).toEqual(['b'])
      expect(loaded.setlists.find((s) => s.id === DEFAULT_SETLIST_ID)?.songIds).toEqual(['b'])
      expect(loaded.setlists.find((s) => s.id === otherId)?.songIds).toEqual(['b'])
    })

    it('returns false for an unknown song id without changing storage', () => {
      installTestStore()
      const rawBefore = localStorage.getItem(SETLIST_STORE_KEY)
      expect(deleteSongFromLibrary('ghost')).toBe(false)
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(rawBefore)
    })

    it('returns false for empty id', () => {
      installTestStore()
      const rawBefore = localStorage.getItem(SETLIST_STORE_KEY)
      expect(deleteSongFromLibrary('')).toBe(false)
      expect(localStorage.getItem(SETLIST_STORE_KEY)).toBe(rawBefore)
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

  describe('areSetlistStoreSnapshotsEqual and getSetlistNamesContainingSongInSnapshot', () => {
    it('detects equal snapshots after clone', () => {
      installTestStore()
      const snap = loadSetlistStore()!
      expect(areSetlistStoreSnapshotsEqual(snap, cloneSetlistStoreSnapshot(snap))).toBe(true)
    })

    it('detects inequality when a setlist changes', () => {
      installTestStore()
      const snap = loadSetlistStore()!
      const other: SetlistStoreSnapshot = {
        ...snap,
        setlists: snap.setlists.map((s) =>
          s.id === DEFAULT_SETLIST_ID ? { ...s, songIds: ['b', 'a'] } : s
        ),
      }
      expect(areSetlistStoreSnapshotsEqual(snap, other)).toBe(false)
    })

    it('lists setlist names that reference a song id', () => {
      installTestStore()
      const base = loadSetlistStore()!
      const snap: SetlistStoreSnapshot = {
        ...base,
        setlists: [
          { id: 'x', name: 'First', songIds: ['a'] },
          { id: 'y', name: 'Second', songIds: ['a', 'b'] },
        ],
      }
      expect(getSetlistNamesContainingSongInSnapshot(snap, 'a')).toEqual(['First', 'Second'])
      expect(getSetlistNamesContainingSongInSnapshot(snap, 'b')).toEqual(['Second'])
      expect(getSetlistNamesContainingSongInSnapshot(snap, 'ghost')).toEqual([])
    })
  })

  describe('updateSongTimeline', () => {
    it('saves a timeline onto the matching library song and persists', () => {
      installTestStore()
      const timeline = [
        { start: 0, end: 2 },
        { start: 2, end: 5 },
      ]
      const result = updateSongTimeline('a', timeline)
      expect(result).toBe(true)
      const stored = loadSetlistStore()!
      const song = stored.songLibrary.songs.find((s) => s.id === 'a')!
      expect(song.timeline).toEqual(timeline)
    })

    it('returns false when the song id is not in the library', () => {
      installTestStore()
      expect(updateSongTimeline('ghost', [{ start: 0, end: 1 }])).toBe(false)
    })

    it('returns false when the store is empty', () => {
      // no installTestStore → store is empty
      expect(updateSongTimeline('a', [{ start: 0, end: 1 }])).toBe(false)
    })

    it('does not alter other songs when updating one', () => {
      installTestStore()
      updateSongTimeline('a', [{ start: 0, end: 3 }])
      const stored = loadSetlistStore()!
      const songB = stored.songLibrary.songs.find((s) => s.id === 'b')!
      expect(songB.timeline).toBeUndefined()
    })

    it('replaces an existing timeline when called again', () => {
      installTestStore()
      updateSongTimeline('a', [{ start: 0, end: 2 }])
      const newTimeline = [{ start: 0, end: 10 }]
      updateSongTimeline('a', newTimeline)
      const stored = loadSetlistStore()!
      const song = stored.songLibrary.songs.find((s) => s.id === 'a')!
      expect(song.timeline).toEqual(newTimeline)
    })
  })

  describe('SongTempo schema field', () => {
    it('song with full tempo round-trips through createInitialSnapshot and loadSetlistStore', () => {
      const seed: LibrarySong[] = [
        { id: 'a', title: 'Alpha', items: [LYRIC], tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 2 } },
      ]
      saveSetlistStore(createInitialSnapshot(seed))
      const loaded = loadSetlistStore()!
      expect(loaded.songLibrary.songs[0]!.tempo).toEqual({ bpm: 120, numerator: 4, denominator: 4, countInBars: 2 })
    })

    it('song with minimal tempo (no countInBars) round-trips', () => {
      const seed: LibrarySong[] = [
        { id: 'a', title: 'Alpha', items: [LYRIC], tempo: { bpm: 80, numerator: 3, denominator: 4 } },
      ]
      saveSetlistStore(createInitialSnapshot(seed))
      const loaded = loadSetlistStore()!
      expect(loaded.songLibrary.songs[0]!.tempo).toEqual({ bpm: 80, numerator: 3, denominator: 4 })
    })

    it('song without tempo field loads fine (back-compat)', () => {
      installTestStore()
      const loaded = loadSetlistStore()!
      expect(loaded.songLibrary.songs[0]!.tempo).toBeUndefined()
    })

    it('tempo is preserved through saveSetlistStore/loadSetlistStore cycle', () => {
      installTestStore()
      const snap = loadSetlistStore()!
      const updated = {
        ...snap,
        songLibrary: {
          songs: snap.songLibrary.songs.map((s) =>
            s.id === 'a' ? { ...s, tempo: { bpm: 100, numerator: 4, denominator: 4, countInBars: 1 } } : s
          ),
        },
      }
      saveSetlistStore(updated)
      const loaded = loadSetlistStore()!
      expect(loaded.songLibrary.songs.find((s) => s.id === 'a')!.tempo).toEqual({
        bpm: 100,
        numerator: 4,
        denominator: 4,
        countInBars: 1,
      })
    })

    it('tempo from JSON import (new numerator/denominator format) is preserved', () => {
      installTestStore()
      const json = JSON.stringify({
        id: 'tempo-song',
        title: 'Rhythm',
        lyrics: [{ es: 'Hola', en: 'Hello' }],
        tempo: { bpm: 140, numerator: 4, denominator: 4, countInBars: 2 },
      })
      const result = importSongFromJsonText(json)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.song.tempo).toEqual({ bpm: 140, numerator: 4, denominator: 4, countInBars: 2 })
      const stored = loadSetlistStore()!
      expect(stored.songLibrary.songs.find((s) => s.id === 'tempo-song')!.tempo).toEqual({
        bpm: 140,
        numerator: 4,
        denominator: 4,
        countInBars: 2,
      })
    })

    it('tempo from JSON import (old meter format) is accepted and converted', () => {
      installTestStore()
      const json = JSON.stringify({
        id: 'tempo-song-old',
        title: 'Rhythm Old',
        lyrics: [{ es: 'Hola', en: 'Hello' }],
        tempo: { bpm: 126, meter: 4 },
      })
      const result = importSongFromJsonText(json)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.song.tempo).toEqual({ bpm: 126, numerator: 4, denominator: 4 })
    })

    it('tempo with invalid bpm is rejected on JSON import', () => {
      installTestStore()
      const json = JSON.stringify({
        id: 'bad-tempo',
        title: 'Bad',
        lyrics: [{ es: 'Hola', en: 'Hello' }],
        tempo: { bpm: -1, numerator: 4, denominator: 4 },
      })
      const result = importSongFromJsonText(json)
      expect(result.ok).toBe(false)
    })

    it('tempo with non-integer numerator is rejected on JSON import', () => {
      installTestStore()
      const json = JSON.stringify({
        id: 'bad-tempo2',
        title: 'Bad2',
        lyrics: [{ es: 'Hola', en: 'Hello' }],
        tempo: { bpm: 120, numerator: 4.5, denominator: 4 },
      })
      const result = importSongFromJsonText(json)
      expect(result.ok).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // RED: v3 → v4 migration tests.
  // These fail until SETLIST_STORE_VERSION is bumped to 4 and a v3→v4 migration
  // path (meter → numerator/denominator) is added to ensureSongLibraryHydrated.
  // ---------------------------------------------------------------------------
  describe('v3 → v4 migration (meter → numerator/denominator)', () => {
    it('migrates a v3 snapshot with tempo.meter to v4 with numerator/denominator', async () => {
      const v3Snapshot = {
        version: 3,
        songLibrary: {
          songs: [
            { id: 'a', title: 'Alpha', items: [LYRIC], tempo: { bpm: 126, meter: 4 } },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v3Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.tempo).toEqual({ bpm: 126, numerator: 4, denominator: 4 })
    })

    it('preserves countInBars when migrating meter → numerator/denominator', async () => {
      const v3Snapshot = {
        version: 3,
        songLibrary: {
          songs: [
            { id: 'a', title: 'Alpha', items: [LYRIC], tempo: { bpm: 80, meter: 3, countInBars: 2 } },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v3Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.tempo).toEqual({
        bpm: 80,
        numerator: 3,
        denominator: 4,
        countInBars: 2,
      })
    })

    it('migrates a v3 song without tempo (no tempo field added)', async () => {
      const v3Snapshot = {
        version: 3,
        songLibrary: {
          songs: [{ id: 'a', title: 'Alpha', items: [LYRIC] }],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v3Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.tempo).toBeUndefined()
    })

    it('migrates a v3 song with flat media to { small: ... }', async () => {
      const v3Snapshot = {
        version: 3,
        songLibrary: {
          songs: [
            {
              id: 'a',
              title: 'Alpha',
              items: [LYRIC],
              media: { type: 'video', src: 'cerdo.mp4' },
            },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v3Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.media).toEqual({ small: { type: 'video', src: 'cerdo.mp4' } })
    })

    it('preserves all flat media fields (trimStart, offset) when migrating v3', async () => {
      const v3Snapshot = {
        version: 3,
        songLibrary: {
          songs: [
            {
              id: 'a',
              title: 'Alpha',
              items: [LYRIC],
              media: { type: 'video', src: 'song.mp4', trimStart: 1.5, offset: 0.2 },
            },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v3Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.songLibrary.songs[0]!.media).toEqual({
        small: { type: 'video', src: 'song.mp4', trimStart: 1.5, offset: 0.2 },
      })
    })
  })

  // ---------------------------------------------------------------------------
  // v4 → v5 migration tests.
  // Fail until SETLIST_STORE_VERSION is bumped to 5 and a v4→v5 migration
  // path (flat media → SongMedia) is added to ensureSongLibraryHydrated.
  // ---------------------------------------------------------------------------
  describe('v4 → v5 migration (flat media → SongMedia)', () => {
    it('migrates a v4 snapshot with flat media to v5 with { small: ... }', async () => {
      const v4Snapshot = {
        version: 4,
        songLibrary: {
          songs: [
            {
              id: 'a',
              title: 'Alpha',
              items: [LYRIC],
              media: { type: 'video', src: 'cerdo.mp4' },
            },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v4Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.media).toEqual({ small: { type: 'video', src: 'cerdo.mp4' } })
    })

    it('preserves all flat media fields (trimStart, offset) when migrating v4', async () => {
      const v4Snapshot = {
        version: 4,
        songLibrary: {
          songs: [
            {
              id: 'a',
              title: 'Alpha',
              items: [LYRIC],
              media: { type: 'video', src: 'song.mp4', trimStart: 1.5, offset: 0.2 },
            },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v4Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.songLibrary.songs[0]!.media).toEqual({
        small: { type: 'video', src: 'song.mp4', trimStart: 1.5, offset: 0.2 },
      })
    })

    it('preserves a v4 song without media (no media field added)', async () => {
      const v4Snapshot = {
        version: 4,
        songLibrary: {
          songs: [{ id: 'a', title: 'Alpha', items: [LYRIC] }],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v4Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.version).toBe(SETLIST_STORE_VERSION)
      expect(snap.songLibrary.songs[0]!.media).toBeUndefined()
    })

    it('preserves tempo when migrating v4 (no tempo data lost)', async () => {
      const v4Snapshot = {
        version: 4,
        songLibrary: {
          songs: [
            {
              id: 'a',
              title: 'Alpha',
              items: [LYRIC],
              tempo: { bpm: 126, numerator: 4, denominator: 4 },
              media: { type: 'video', src: 'song.mp4' },
            },
          ],
        },
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a'] }],
        activeSetlistId: DEFAULT_SETLIST_ID,
      }
      localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(v4Snapshot))

      const snap = await ensureSongLibraryHydrated()

      expect(snap.songLibrary.songs[0]!.tempo).toEqual({ bpm: 126, numerator: 4, denominator: 4 })
    })
  })
})
