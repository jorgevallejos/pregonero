import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { SongItem } from './songState'
import {
  SETLIST_STORE_KEY,
  SETLIST_STORE_VERSION,
  DEFAULT_SETLIST_ID,
  createEmptySnapshot,
  createInitialSnapshot,
  ensureSongLibraryHydrated,
  loadSetlistStore,
  saveSetlistStore,
  getActiveSetlistId,
  setActiveSetlistId,
  getOrderedSongsForActiveSetlist,
  getOrderedEntriesForSetlistFromSnapshot,
  getSetlists,
  hasValidActiveSetlist,
  createEmptySetlist,
  renameSetlist,
  deleteSetlist,
  getLibrarySongs,
  getLibraryEntries,
  getLibrarySongById,
  getOrderedSongsForSetlist,
  addSongToSetlist,
  removeSongFromSetlist,
  moveSongInSetlist,
  reorderSongsInSetlist,
  addSongRefToSnapshot,
  deleteSongFromLibrary,
  areSetlistStoreSnapshotsEqual,
  cloneSetlistStoreSnapshot,
  getSetlistNamesContainingSongInSnapshot,
  getActiveMediaFile,
  dropLibraryCache,
  isLibraryHydrated,
  setLibraryEntries,
  songIdFromPath,
  resolveSongRef,
  type LibrarySong,
  type SongRef,
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

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
    vi.stubGlobal('localStorage', createStorage())
  }
})

const LINES: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]

function songFileJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: 'Pimiento',
    lyrics: [
      { es: 'Hola', en: 'Hello' },
      { es: 'Mundo', en: 'World' },
    ],
    ...overrides,
  })
}

/** A resolver over an in-memory `songs/` directory. */
function readerFor(files: Record<string, string>) {
  return (path: string): Promise<string> => {
    const text = files[path]
    if (text === undefined) return Promise.reject(new Error('ENOENT: no such file'))
    return Promise.resolve(text)
  }
}

function song(id: string, extra: Partial<LibrarySong> = {}): LibrarySong {
  return { id, title: id, items: LINES, ...extra }
}

/** Persist refs for `songs` and put the resolved songs in the cache, as hydration would. */
function installLibrary(songs: readonly LibrarySong[]): SetlistStoreSnapshot {
  const snap = createInitialSnapshot(songs)
  saveSetlistStore(snap)
  setLibraryEntries(
    songs.map((s) => ({ ref: { id: s.id, path: `${s.id}.json` }, song: s }))
  )
  return snap
}

beforeEach(() => {
  localStorage.clear()
  dropLibraryCache()
})

describe('songIdFromPath', () => {
  it('uses the file name without its .json extension', () => {
    expect(songIdFromPath('/Users/j/Chango Pepper/songs/pimiento.json')).toBe('pimiento')
  })

  it('is case-insensitive about the extension', () => {
    expect(songIdFromPath('/songs/Vidas.JSON')).toBe('Vidas')
  })

  it('keeps a name that has no extension', () => {
    expect(songIdFromPath('/songs/vidas')).toBe('vidas')
  })

  it('gives the same id for the same file whatever else has happened', () => {
    // Delete-then-re-add is not a trap once identity comes from the file.
    expect(songIdFromPath('/a/songs/duelo.json')).toBe(songIdFromPath('/a/songs/duelo.json'))
  })
})

describe('the persisted snapshot holds references, not songs', () => {
  it('is version 8', () => {
    expect(SETLIST_STORE_VERSION).toBe(8)
  })

  it('writes only an id and a path per library entry', () => {
    installLibrary([song('pimiento', { notes: 'capo 2', tempo: { bpm: 90, numerator: 4, denominator: 4 } })])
    const raw = JSON.parse(localStorage.getItem(SETLIST_STORE_KEY) as string) as {
      library: unknown[]
    }
    expect(raw.library).toEqual([{ id: 'pimiento', path: 'pimiento.json' }])
  })

  it('never persists lyrics, timeline, tempo or media', () => {
    installLibrary([
      song('pimiento', {
        timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
        timelineVersion: 2,
        leadIn: { durationSec: 1, source: 'measured', confidence: 'high', apply: true },
        media: { type: 'video', src: 'pimiento.mp4' },
        tempo: { bpm: 90, numerator: 4, denominator: 4 },
      }),
    ])
    const raw = localStorage.getItem(SETLIST_STORE_KEY) as string
    for (const field of ['items', 'lyrics', 'timeline', 'tempo', 'media', 'leadIn', 'Hola']) {
      expect(raw).not.toContain(field)
    }
  })

  it('createEmptySnapshot has an empty library, no setlists and no active setlist', () => {
    expect(createEmptySnapshot()).toEqual({
      version: SETLIST_STORE_VERSION,
      library: [],
      setlists: [],
      activeSetlistId: '',
    })
  })
})

describe('hydration discards anything that is not a v8 snapshot', () => {
  const OLD_SNAPSHOT_WITH_SONG_COPIES = {
    version: 7,
    songLibrary: {
      songs: [
        { id: 'pimiento', title: 'Pimiento', items: LINES, timeline: [{ start: 0, end: 1 }] },
      ],
    },
    setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['pimiento'] }],
    activeSetlistId: DEFAULT_SETLIST_ID,
  }

  it('wipes a v7 snapshot rather than migrating it', async () => {
    localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(OLD_SNAPSHOT_WITH_SONG_COPIES))
    const snap = await ensureSongLibraryHydrated({ readSongFile: readerFor({}) })
    expect(snap).toEqual(createEmptySnapshot())
  })

  it('discards the setlists too', async () => {
    localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(OLD_SNAPSHOT_WITH_SONG_COPIES))
    const snap = await ensureSongLibraryHydrated({ readSongFile: readerFor({}) })
    expect(snap.setlists).toEqual([])
    expect(snap.activeSetlistId).toBe('')
  })

  it('never reads a song file while discarding an old snapshot', async () => {
    localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(OLD_SNAPSHOT_WITH_SONG_COPIES))
    const read = vi.fn(readerFor({}))
    await ensureSongLibraryHydrated({ readSongFile: read })
    expect(read).not.toHaveBeenCalled()
  })

  it('wipes a v1 snapshot the same way, with no path-following migration', async () => {
    localStorage.setItem(
      SETLIST_STORE_KEY,
      JSON.stringify({
        version: 1,
        songLibrary: { songs: [{ id: 'vidas', title: 'Vidas', path: 'vidas.json' }] },
        setlists: [],
        activeSetlistId: '',
      })
    )
    const read = vi.fn(readerFor({ 'vidas.json': songFileJson() }))
    const snap = await ensureSongLibraryHydrated({ readSongFile: read })
    expect(snap).toEqual(createEmptySnapshot())
    expect(read).not.toHaveBeenCalled()
  })

  it('wipes a corrupt store', async () => {
    localStorage.setItem(SETLIST_STORE_KEY, 'not json at all')
    const snap = await ensureSongLibraryHydrated({ readSongFile: readerFor({}) })
    expect(snap).toEqual(createEmptySnapshot())
  })

  it('persists the empty snapshot so the wipe happens once', async () => {
    localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(OLD_SNAPSHOT_WITH_SONG_COPIES))
    await ensureSongLibraryHydrated({ readSongFile: readerFor({}) })
    expect(loadSetlistStore()).toEqual(createEmptySnapshot())
  })
})

describe('hydration reads every reference from songs/', () => {
  const FILES = {
    'pimiento.json': songFileJson({
      title: 'Pimiento',
      notes: 'capo 2',
      tempo: { bpm: 66.67, numerator: 6, denominator: 8, countInBars: 1 },
    }),
    'vidas.json': songFileJson({ title: 'Vidas' }),
  }

  function seedRefs(refs: SongRef[]): void {
    saveSetlistStore({
      version: SETLIST_STORE_VERSION,
      library: refs,
      setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: refs.map((r) => r.id) }],
      activeSetlistId: DEFAULT_SETLIST_ID,
    })
  }

  it('reads the file behind each reference', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(getLibrarySongById('pimiento')?.title).toBe('Pimiento')
  })

  it('takes every field from the file, not from storage', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    const s = getLibrarySongById('pimiento')
    expect(s?.notes).toBe('capo 2')
    expect(s?.tempo).toEqual({ bpm: 66.67, numerator: 6, denominator: 8, countInBars: 1 })
    expect(s?.items).toHaveLength(2)
  })

  it('picks up an edit made to the file between launches', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(getLibrarySongById('pimiento')?.title).toBe('Pimiento')

    dropLibraryCache()
    await ensureSongLibraryHydrated({
      readSongFile: readerFor({ 'pimiento.json': songFileJson({ title: 'Pimiento (2026)' }) }),
    })
    expect(getLibrarySongById('pimiento')?.title).toBe('Pimiento (2026)')
  })

  it('keeps the reference id, not any id inside the file', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    await ensureSongLibraryHydrated({
      readSongFile: readerFor({ 'pimiento.json': songFileJson({ id: 'something-else' }) }),
    })
    expect(getLibrarySongById('pimiento')).toBeDefined()
    expect(getLibrarySongById('something-else')).toBeUndefined()
  })

  it('keeps a reference whose file cannot be read, and records why', async () => {
    seedRefs([{ id: 'gone', path: 'gone.json' }])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    const entries = getLibraryEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.ref).toEqual({ id: 'gone', path: 'gone.json' })
    expect(entries[0]?.song).toBeUndefined()
    expect(entries[0]?.error).toMatch(/ENOENT/)
  })

  it('keeps a reference whose file is present but invalid', async () => {
    seedRefs([{ id: 'libertad', path: 'libertad.json' }])
    await ensureSongLibraryHydrated({
      readSongFile: readerFor({ 'libertad.json': '{ "title": "Libertad" }' }),
    })
    const entries = getLibraryEntries()
    expect(entries[0]?.song).toBeUndefined()
    expect(entries[0]?.error).toBeTruthy()
  })

  it('an unreadable reference does not stop the others resolving', async () => {
    seedRefs([
      { id: 'gone', path: 'gone.json' },
      { id: 'vidas', path: 'vidas.json' },
    ])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(getLibrarySongById('vidas')?.title).toBe('Vidas')
  })

  it('an unresolved reference is not a song the app can perform', async () => {
    seedRefs([
      { id: 'gone', path: 'gone.json' },
      { id: 'vidas', path: 'vidas.json' },
    ])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(getLibrarySongs().map((s) => s.id)).toEqual(['vidas'])
    expect(getOrderedSongsForActiveSetlist().map((s) => s.id)).toEqual(['vidas'])
  })

  it('does not re-read a reference already in the cache', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    const read = vi.fn(readerFor(FILES))
    await ensureSongLibraryHydrated({ readSongFile: read })
    await ensureSongLibraryHydrated({ readSongFile: read })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('forgets cache entries no reference points at any more', async () => {
    seedRefs([
      { id: 'pimiento', path: 'pimiento.json' },
      { id: 'vidas', path: 'vidas.json' },
    ])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    seedRefs([{ id: 'vidas', path: 'vidas.json' }])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(getLibraryEntries().map((e) => e.ref.id)).toEqual(['vidas'])
  })

  it('rebuilds the whole library after the cache is dropped', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    dropLibraryCache()
    expect(getLibrarySongs()).toEqual([])
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(getLibrarySongs().map((s) => s.id)).toEqual(['pimiento'])
  })

  it('reports hydration only once every reference has been resolved or failed', async () => {
    seedRefs([{ id: 'pimiento', path: 'pimiento.json' }])
    expect(isLibraryHydrated()).toBe(false)
    await ensureSongLibraryHydrated({ readSongFile: readerFor(FILES) })
    expect(isLibraryHydrated()).toBe(true)
  })
})

describe('resolveSongRef', () => {
  it('returns the parsed song under the reference id', async () => {
    const entry = await resolveSongRef(
      { id: 'pimiento', path: 'pimiento.json' },
      readerFor({ 'pimiento.json': songFileJson({ title: 'Pimiento' }) })
    )
    expect(entry.song?.id).toBe('pimiento')
    expect(entry.song?.title).toBe('Pimiento')
    expect(entry.error).toBeUndefined()
  })

  it('falls back to the id when the file has a blank title', async () => {
    const entry = await resolveSongRef(
      { id: 'pimiento', path: 'pimiento.json' },
      readerFor({ 'pimiento.json': songFileJson({ title: '   ' }) })
    )
    expect(entry.song?.title).toBe('pimiento')
  })

  it('reports a read failure without throwing', async () => {
    const entry = await resolveSongRef({ id: 'gone', path: 'gone.json' }, readerFor({}))
    expect(entry.song).toBeUndefined()
    expect(entry.error).toMatch(/ENOENT/)
  })

  it('reports a parse failure without throwing', async () => {
    const entry = await resolveSongRef(
      { id: 'bad', path: 'bad.json' },
      readerFor({ 'bad.json': 'nope' })
    )
    expect(entry.song).toBeUndefined()
    expect(entry.error).toBeTruthy()
  })
})

describe('adding a reference to the library', () => {
  it('appends the reference', () => {
    const snap = createEmptySnapshot()
    const next = addSongRefToSnapshot(snap, { id: 'vidas', path: '/songs/vidas.json' })
    expect(next?.library).toEqual([{ id: 'vidas', path: '/songs/vidas.json' }])
  })

  it('rejects a second reference with the same id', () => {
    const snap = addSongRefToSnapshot(createEmptySnapshot(), {
      id: 'vidas',
      path: '/songs/vidas.json',
    })
    expect(snap).not.toBeNull()
    expect(addSongRefToSnapshot(snap as SetlistStoreSnapshot, { id: 'vidas', path: '/elsewhere/vidas.json' })).toBeNull()
  })

  it('rejects an empty id or path', () => {
    expect(addSongRefToSnapshot(createEmptySnapshot(), { id: '', path: 'a.json' })).toBeNull()
    expect(addSongRefToSnapshot(createEmptySnapshot(), { id: 'a', path: '' })).toBeNull()
  })
})

describe('the library no longer accepts song data', () => {
  it('exposes no way to write a timeline onto a song', async () => {
    const store = await import('./setlistStore')
    expect('updateSongTimeline' in store).toBe(false)
    expect('patchSongTimelineInSnapshot' in store).toBe(false)
  })

  it('exposes no way to write media onto a song', async () => {
    const store = await import('./setlistStore')
    expect('patchSongMediaInSnapshot' in store).toBe(false)
  })

  it('exposes no way to import a song by pasting its contents in', async () => {
    const store = await import('./setlistStore')
    expect('importSongFromJsonText' in store).toBe(false)
    expect('addSongToLibrary' in store).toBe(false)
    expect('applySequentialSongImportsFromJsonTexts' in store).toBe(false)
  })
})

describe('setlists over a reference library', () => {
  beforeEach(() => {
    installLibrary([song('a'), song('b'), song('c')])
  })

  it('createInitialSnapshot puts every reference in one default setlist', () => {
    const snap = loadSetlistStore() as SetlistStoreSnapshot
    expect(snap.activeSetlistId).toBe(DEFAULT_SETLIST_ID)
    expect(snap.setlists[0]?.songIds).toEqual(['a', 'b', 'c'])
  })

  it('resolves setlist ids to songs in list order', () => {
    expect(getOrderedSongsForSetlist(DEFAULT_SETLIST_ID).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('adds, removes and reorders by id', () => {
    const list = createEmptySetlist()
    expect(addSongToSetlist(list.id, 'b')).toBe(true)
    expect(addSongToSetlist(list.id, 'a')).toBe(true)
    expect(getOrderedSongsForSetlist(list.id).map((s) => s.id)).toEqual(['b', 'a'])
    expect(reorderSongsInSetlist(list.id, 0, 1)).toBe(true)
    expect(getOrderedSongsForSetlist(list.id).map((s) => s.id)).toEqual(['a', 'b'])
    expect(moveSongInSetlist(list.id, 'b', 'up')).toBe(true)
    expect(getOrderedSongsForSetlist(list.id).map((s) => s.id)).toEqual(['b', 'a'])
    expect(removeSongFromSetlist(list.id, 'b')).toBe(true)
    expect(getOrderedSongsForSetlist(list.id).map((s) => s.id)).toEqual(['a'])
  })

  it('refuses a song id that is not in the library', () => {
    expect(addSongToSetlist(DEFAULT_SETLIST_ID, 'nope')).toBe(false)
  })

  it('deleting a reference drops it from every setlist', () => {
    expect(deleteSongFromLibrary('b')).toBe(true)
    expect(getOrderedSongsForSetlist(DEFAULT_SETLIST_ID).map((s) => s.id)).toEqual(['a', 'c'])
    expect(loadSetlistStore()?.library.map((r) => r.id)).toEqual(['a', 'c'])
  })

  it('renames and deletes setlists', () => {
    expect(renameSetlist(DEFAULT_SETLIST_ID, ' Tonight ')).toBe(true)
    expect(getSetlists()[0]?.name).toBe('Tonight')
    expect(deleteSetlist(DEFAULT_SETLIST_ID)).toBe(true)
    expect(getSetlists()).toEqual([])
    expect(getActiveSetlistId()).toBe('')
    expect(hasValidActiveSetlist()).toBe(false)
  })

  it('switches the active setlist only to one that exists', () => {
    const list = createEmptySetlist()
    expect(setActiveSetlistId(list.id)).toBe(true)
    expect(getActiveSetlistId()).toBe(list.id)
    expect(setActiveSetlistId('nope')).toBe(false)
  })

  it('drops setlist ids that no reference matches on load', () => {
    const snap = loadSetlistStore() as SetlistStoreSnapshot
    localStorage.setItem(
      SETLIST_STORE_KEY,
      JSON.stringify({
        ...snap,
        setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['a', 'ghost', 'c'] }],
      })
    )
    expect(loadSetlistStore()?.setlists[0]?.songIds).toEqual(['a', 'c'])
  })

  it('names the setlists a song appears in', () => {
    const snap = loadSetlistStore() as SetlistStoreSnapshot
    expect(getSetlistNamesContainingSongInSnapshot(snap, 'a')).toEqual(['Default'])
    expect(getSetlistNamesContainingSongInSnapshot(snap, 'ghost')).toEqual([])
  })
})

describe('setlist entries for the manage screen', () => {
  it('lists unresolved references in setlist order alongside resolved ones', () => {
    const snap: SetlistStoreSnapshot = {
      version: SETLIST_STORE_VERSION,
      library: [
        { id: 'a', path: 'a.json' },
        { id: 'gone', path: 'gone.json' },
      ],
      setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: ['gone', 'a'] }],
      activeSetlistId: DEFAULT_SETLIST_ID,
    }
    setLibraryEntries([
      { ref: { id: 'a', path: 'a.json' }, song: song('a') },
      { ref: { id: 'gone', path: 'gone.json' }, error: 'ENOENT' },
    ])
    const entries = getOrderedEntriesForSetlistFromSnapshot(snap, DEFAULT_SETLIST_ID)
    expect(entries.map((e) => e.ref.id)).toEqual(['gone', 'a'])
    expect(entries[0]?.song).toBeUndefined()
    expect(entries[1]?.song?.id).toBe('a')
  })
})

describe('draft snapshots', () => {
  it('clones deeply', () => {
    const snap = installLibrary([song('a')])
    const copy = cloneSetlistStoreSnapshot(snap)
    copy.library[0]!.path = 'changed.json'
    expect(snap.library[0]?.path).toBe('a.json')
  })

  it('compares structurally', () => {
    const snap = installLibrary([song('a')])
    expect(areSetlistStoreSnapshotsEqual(snap, cloneSetlistStoreSnapshot(snap))).toBe(true)
    const other: SetlistStoreSnapshot = { ...snap, activeSetlistId: 'x' }
    expect(areSetlistStoreSnapshotsEqual(snap, other)).toBe(false)
  })
})

describe('getActiveMediaFile', () => {
  it('returns the media the song file declares', () => {
    const s = song('t', { media: { type: 'video', src: 'tragedia.mp4' } })
    expect(getActiveMediaFile(s)).toEqual({ type: 'video', src: 'tragedia.mp4' })
  })

  it('returns undefined when the song declares none', () => {
    expect(getActiveMediaFile(song('a'))).toBeUndefined()
  })
})

describe('setlist type', () => {
  it('is still id, name and ordered song ids', () => {
    const sl: Setlist = { id: 'x', name: 'X', songIds: ['a'] }
    expect(sl.songIds).toEqual(['a'])
  })
})
