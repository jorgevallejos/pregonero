import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest'
import type { SongItem } from './songState'
import * as setlistStoreModule from './setlistStore'
import { SONGS_FOLDER_KEY } from './contentFolders'
import {
  SETLIST_STORE_KEY,
  SETLIST_STORE_VERSION,
  DEFAULT_SETLIST_ID,
  createEmptySnapshot,
  ensureSongLibraryHydrated,
  loadSetlistStore,
  saveSetlistStore,
  getActiveSetlistId,
  setActiveSetlistId,
  getOrderedSongsForActiveSetlist,
  getLibrarySongs,
  getLibraryEntries,
  getCatalogueEntries,
  getUnreadableCatalogueEntries,
  forgetDeletedSong,
  getEntriesNotInCatalogue,
  getLibrarySongById,
  getOrderedSongsForSetlist,
  addSongToSetlist,
  removeSongFromSetlist,
  moveSongInSetlist,
  reorderSongsInSetlist,
  addSongRefToSnapshot,
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
  const library = songs.map((s) => ({ id: s.id, path: `${s.id}.json` }))
  const snap: SetlistStoreSnapshot = {
    version: SETLIST_STORE_VERSION,
    library,
    setlists: [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: library.map((r) => r.id) }],
    activeSetlistId: DEFAULT_SETLIST_ID,
  }
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

/**
 * **An extra empty setlist, written straight into the store.**
 *
 * The app has no way to make one any more: `createEmptySetlist` went with the manage-setlists
 * screen, and every setlist a person now gets is either the default or the gig's own, adopted from
 * `gig.json`. The store still has to behave when there is more than one, so the tests build the
 * second one by hand rather than through a control nobody has.
 */
function addEmptySetlist(id: string): string {
  const snap = loadSetlistStore()!
  saveSetlistStore({
    ...snap,
    setlists: [...snap.setlists, { id, name: id, songIds: [] }],
    activeSetlistId: id,
  })
  return id
}

describe('setlists over a reference library', () => {
  beforeEach(() => {
    installLibrary([song('a'), song('b'), song('c')])
  })

  it('puts every reference in one default setlist', () => {
    const snap = loadSetlistStore() as SetlistStoreSnapshot
    expect(snap.activeSetlistId).toBe(DEFAULT_SETLIST_ID)
    expect(snap.setlists[0]?.songIds).toEqual(['a', 'b', 'c'])
  })

  it('resolves setlist ids to songs in list order', () => {
    expect(getOrderedSongsForSetlist(DEFAULT_SETLIST_ID).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('adds, removes and reorders by id', () => {
    const id = addEmptySetlist('tonight')
    expect(addSongToSetlist(id, 'b')).toBe(true)
    expect(addSongToSetlist(id, 'a')).toBe(true)
    expect(getOrderedSongsForSetlist(id).map((s) => s.id)).toEqual(['b', 'a'])
    expect(reorderSongsInSetlist(id, 0, 1)).toBe(true)
    expect(getOrderedSongsForSetlist(id).map((s) => s.id)).toEqual(['a', 'b'])
    expect(moveSongInSetlist(id, 'b', 'up')).toBe(true)
    expect(getOrderedSongsForSetlist(id).map((s) => s.id)).toEqual(['b', 'a'])
    expect(removeSongFromSetlist(id, 'b')).toBe(true)
    expect(getOrderedSongsForSetlist(id).map((s) => s.id)).toEqual(['a'])
  })

  it('refuses a song id that is not in the library', () => {
    expect(addSongToSetlist(DEFAULT_SETLIST_ID, 'nope')).toBe(false)
  })

  it('offers no way to remove a song from the library, and that is the rule', () => {
    // **Removed 2026-09-01 along with the function it tested.** `songs/` is the source of truth,
    // the library is a cache of it, and hydration seeds a reference for every song file in the
    // folder — so a deleted reference came back on the next hydration. A control that silently
    // undoes itself must not remain looking functional. Retiring a song means moving the file out
    // of `songs/`. The reasoning lives in `setlistStore.ts` where the function used to be; this
    // asserts the absence, because an absence with no test is an invitation.
    const store = setlistStoreModule as Record<string, unknown>
    expect(store.deleteSongFromLibrary).toBeUndefined()
    expect(store.deleteSongFromLibraryInSnapshot).toBeUndefined()
  })

  it('still removes a song from a SETLIST, which is a different act', () => {
    // Gig-scoped and durable: a setlist is an authored running order, the removal lives in the
    // snapshot, and nothing on disk contradicts it. The two sat one trash can apart on one screen.
    expect(removeSongFromSetlist(DEFAULT_SETLIST_ID, 'b')).toBe(true)
    expect(getOrderedSongsForSetlist(DEFAULT_SETLIST_ID).map((s) => s.id)).toEqual(['a', 'c'])
    // The reference is untouched: the song still exists, it is just not in this running order.
    expect(loadSetlistStore()?.library.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('offers no way to rename or delete a setlist, and that is the rule', () => {
    // **Removed 2026-09-03 with the screen that pressed them.** Naming and deleting setlists was
    // the manage-setlists screen's whole reason to exist; a gig's setlist is now the gig's, named
    // after it and adopted from `gig.json`. The absence is asserted because an absence with no
    // test is an invitation.
    const store = setlistStoreModule as Record<string, unknown>
    expect(store.renameSetlist).toBeUndefined()
    expect(store.deleteSetlist).toBeUndefined()
    expect(store.createEmptySetlist).toBeUndefined()
  })

  it('switches the active setlist only to one that exists', () => {
    const id = addEmptySetlist('tonight')
    expect(setActiveSetlistId(id)).toBe(true)
    expect(getActiveSetlistId()).toBe(id)
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

/**
 * **The songs folder fills the library.**
 *
 * Walking R1 on 2026-08-31, the songs folder was pointed at a directory holding thirteen songs and
 * Setup home said **"No songs yet"** — the app had been shown the songs and reported none, which
 * is the dead-end shape the whole setup redesign exists to remove. The cause was structural rather
 * than a slip: hydration read the *references* in the snapshot, references only ever arrived one at
 * a time through a file dialog, and nothing in the app could list a directory at all.
 */
describe('seeding the library from the songs folder', () => {
  beforeEach(() => {
    localStorage.clear()
    setLibraryEntries([])
  })

  const read = async (path: string) =>
    JSON.stringify({ title: path.replace(/.*\//, '').replace('.json', ''), lyrics: [{ es: 'a' }] })

  /** One look at the catalogue that answered. `answered: false` is only "there was no Electron". */
  const listing = (files: string[]) => ({ files, problem: null, answered: true })

  it('lists every song in the folder, with no reference added by hand', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'pimiento.json', 'vidas.json']),
    })
    expect(getLibraryEntries().map((e) => e.ref.id).sort()).toEqual([
      'duelo',
      'pimiento',
      'vidas',
    ])
  })

  it('stores a song in the folder by name, so the library survives the folder moving', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    expect(getLibraryEntries()[0]!.ref.path).toBe('duelo.json')
  })

  it('adds, and never removes', async () => {
    // A reference to a song outside the folder — an absolute path from before the setting existed
    // — is left exactly as it is.
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    saveSetlistStore({
      version: SETLIST_STORE_VERSION,
      library: [{ id: 'elsewhere', path: '/somewhere/else/elsewhere.json' }],
      setlists: [{ id: 'default', name: 'Default', songIds: [] }],
      activeSetlistId: 'default',
    })
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    const ids = getLibraryEntries().map((e) => e.ref.id).sort()
    expect(ids).toEqual(['duelo', 'elsewhere'])
  })

  it('does not duplicate a song that is already referenced', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    saveSetlistStore({
      version: SETLIST_STORE_VERSION,
      library: [{ id: 'duelo', path: 'duelo.json' }],
      setlists: [{ id: 'default', name: 'Default', songIds: [] }],
      activeSetlistId: 'default',
    })
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    expect(getLibraryEntries()).toHaveLength(1)
  })

  it('does nothing at all when no songs folder is set', async () => {
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => {
        throw new Error('must not be asked for a folder that is not set')
      },
    })
    expect(getLibraryEntries()).toEqual([])
  })

  it('keeps a song whose file will not read, listed and visibly broken', async () => {
    // `libertad` is the live case, and hiding it would hide the problem: the fix is in `songs/`.
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: async (path: string) => {
        if (path.includes('libertad')) throw new Error('24 lines against a 20-entry timeline')
        return read(path)
      },
      listFolder: async () => listing(['duelo.json', 'libertad.json']),
    })
    const broken = getLibraryEntries().find((e) => e.ref.id === 'libertad')!
    expect(broken.song).toBeUndefined()
    expect(broken.error).toContain('24 lines')
  })

  it('corrects a reference the folder contradicts, rather than keeping both truths', async () => {
    // The song files moved into `song-performance/` on 01/09, so every reference stored before
    // that names a path that is no longer a song, with an id that still is. The folder is the
    // source of truth; its cache does not get to outvote it.
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    saveSetlistStore({
      version: SETLIST_STORE_VERSION,
      library: [{ id: 'duelo', path: '/songs/duelo.json' }],
      setlists: [{ id: 'default', name: 'Default', songIds: [] }],
      activeSetlistId: 'default',
    })
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    expect(getLibraryEntries()).toHaveLength(1)
    expect(getLibraryEntries()[0]!.ref.path).toBe('duelo.json')
  })

  it('re-reads a corrected reference instead of serving the old file’s cached row', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    saveSetlistStore({
      version: SETLIST_STORE_VERSION,
      library: [{ id: 'duelo', path: '/old/duelo.json' }],
      setlists: [{ id: 'default', name: 'Default', songIds: [] }],
      activeSetlistId: 'default',
    })
    setLibraryEntries([
      { ref: { id: 'duelo', path: '/old/duelo.json' }, error: 'ENOENT: no such file' },
    ])
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    const entry = getLibraryEntries()[0]!
    expect(entry.error).toBeUndefined()
    expect(entry.song).toBeTruthy()
  })
})

/**
 * **The catalogue is the folder, and the library is a cache of it.**
 *
 * Found by walking `v0.24.0` on 2026-09-01: twelve song files were deleted from the catalogue and
 * Setup home drew twelve rows, each with an ENOENT beside it. The list was rendered from the stored
 * library, and hydration seeds additively and never drops — so a reference outlived its file and
 * the screen answered a question about the folder out of a memory of it.
 */
describe('the catalogue, versus what the app is holding', () => {
  beforeEach(() => {
    localStorage.clear()
    setLibraryEntries([])
    dropLibraryCache()
  })

  const read = async (path: string) =>
    JSON.stringify({ title: path.replace(/.*\//, '').replace('.json', ''), lyrics: [{ es: 'a' }] })
  const listing = (files: string[]) => ({ files, problem: null, answered: true })

  it('lists what the folder holds, and not what it used to hold', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    expect(getCatalogueEntries().map((e) => e.ref.id)).toEqual(['duelo', 'vidas'])

    // The files go. Nothing else changes.
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    expect(getCatalogueEntries().map((e) => e.ref.id)).toEqual(['duelo'])
  })

  it('says what left, once, naming it — and has not forgotten it', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    expect(getEntriesNotInCatalogue().map((e) => e.ref.id)).toEqual(['vidas'])
    // The reference survives in storage: the folder may be on a drive that is not plugged in.
    expect(loadSetlistStore()!.library.map((r) => r.id).sort()).toEqual(['duelo', 'vidas'])
  })

  it('comes back when the files do', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    await ensureSongLibraryHydrated({ readSongFile: read, listFolder: async () => listing([]) })
    expect(getCatalogueEntries()).toEqual([])
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    expect(getCatalogueEntries().map((e) => e.ref.id)).toEqual(['duelo', 'vidas'])
    expect(getEntriesNotInCatalogue()).toEqual([])
  })

  it('an unmounted catalogue empties the list and says so, rather than emptying it in silence', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => ({ files: [], problem: 'ENOENT: /songs', answered: true }),
    })
    expect(getCatalogueEntries()).toEqual([])
    expect(getEntriesNotInCatalogue().map((e) => e.ref.id).sort()).toEqual(['duelo', 'vidas'])
  })

  it('falls back to the library when nobody looked at the folder', async () => {
    // Outside Electron there is no folder to read. An empty list would be a fact never learned.
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => ({ files: [], problem: null, answered: false }),
    })
    setLibraryEntries([
      { ref: { id: 'duelo', path: 'duelo.json' }, song: { id: 'duelo', title: 'Duelo', items: [] } },
    ])
    expect(getCatalogueEntries().map((e) => e.ref.id)).toEqual(['duelo'])
    expect(getEntriesNotInCatalogue()).toEqual([])
  })

  it('a song that is gone and a song that will not read are two different silences', async () => {
    // **Both drop out of the list, and they are reported by two different popups** (2026-09-02).
    // Absent is `getEntriesNotInCatalogue` — the folder stopped listing the file. Unreadable is
    // `getUnreadableCatalogueEntries` — the file is there and did not parse, so it is not a song
    // this app can offer and a row for it would be a row that does nothing but accuse.
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: async (path: string) => {
        if (path.includes('libertad')) throw new Error('24 lines against a 20-entry timeline')
        return read(path)
      },
      listFolder: async () => listing(['libertad.json', 'vidas.json']),
    })
    await ensureSongLibraryHydrated({
      readSongFile: async (path: string) => {
        if (path.includes('libertad')) throw new Error('24 lines against a 20-entry timeline')
        return read(path)
      },
      listFolder: async () => listing(['libertad.json']),
    })
    expect(getCatalogueEntries()).toEqual([])
    expect(getUnreadableCatalogueEntries().map((e) => e.ref.id)).toEqual(['libertad'])
    expect(getUnreadableCatalogueEntries()[0]!.error).toContain('24 lines')
    expect(getEntriesNotInCatalogue().map((e) => e.ref.id)).toEqual(['vidas'])
  })
})

/**
 * **A song this app deleted is forgotten, not remembered as missing.**
 *
 * Walked on `v0.35.0`, 2026-09-02: deleting `libertad` through the bin, with its confirmation, and
 * returning to Backstage announced it as no longer in the catalogue. Hydration never drops a
 * reference because an unmounted drive looks exactly like a deletion — but a deletion the app
 * performed does not look like anything, and holding a reference to a file it removed itself is
 * remembering something it knows is not true.
 */
describe('forgetting a song this app deleted', () => {
  beforeEach(() => {
    localStorage.clear()
    setLibraryEntries([])
    dropLibraryCache()
  })

  const read = async (path: string) =>
    JSON.stringify({ title: path.replace(/.*\//, '').replace('.json', ''), lyrics: [{ es: 'a' }] })
  const listing = (files: string[]) => ({ files, problem: null, answered: true })

  it('drops the reference, so nothing is left to rediscover as absent', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })

    forgetDeletedSong('duelo')

    expect(loadSetlistStore()!.library.map((r) => r.id)).toEqual(['vidas'])
    // The row goes now, without waiting for the folder to be listed again.
    expect(getCatalogueEntries().map((e) => e.ref.id)).toEqual(['vidas'])
    // And it is not absent, which is the whole point: it is not held at all.
    expect(getEntriesNotInCatalogue()).toEqual([])
  })

  it('is still not announced after the folder is read again', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    forgetDeletedSong('duelo')

    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['vidas.json']),
    })
    expect(getEntriesNotInCatalogue()).toEqual([])
  })

  it('leaves every other reference where it was', async () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json', 'vidas.json']),
    })
    forgetDeletedSong('duelo')
    expect(getCatalogueEntries()[0]!.song).toBeTruthy()
    expect(getLibraryEntries().map((e) => e.ref.id)).toEqual(['vidas'])
  })

  it('comes back if the file does, because the folder is the truth', async () => {
    // Restored from the Trash. Nothing about forgetting is a tombstone, so the next read simply
    // finds a song — and if it is really lost later, that is a genuine event and is announced.
    localStorage.setItem(SONGS_FOLDER_KEY, '/songs')
    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    forgetDeletedSong('duelo')
    expect(getCatalogueEntries()).toEqual([])

    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing(['duelo.json']),
    })
    expect(getCatalogueEntries().map((e) => e.ref.id)).toEqual(['duelo'])

    await ensureSongLibraryHydrated({
      readSongFile: read,
      listFolder: async () => listing([]),
    })
    expect(getEntriesNotInCatalogue().map((e) => e.ref.id)).toEqual(['duelo'])
  })

  it('says nothing about an id it does not hold', () => {
    expect(() => forgetDeletedSong('never-existed')).not.toThrow()
    expect(() => forgetDeletedSong('')).not.toThrow()
  })
})
