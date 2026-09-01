/**
 * Test-only helpers for standing up a library.
 *
 * The persisted store holds references; the songs live in a cache built by reading `songs/`.
 * Tests have no `songs/` and no Electron bridge, so they install both halves directly: the
 * references that survive a restart, and the resolved songs hydration would have produced.
 * This is the same seam hydration uses, not a back door around it.
 */
import { getSongsFolder, setSongsFolder } from '../contentFolders'
import {
  DEFAULT_SETLIST_ID,
  SETLIST_STORE_VERSION,
  dropLibraryCache,
  ensureSongLibraryHydrated,
  saveSetlistStore,
  setLibraryEntries,
  type LibraryEntry,
  type LibrarySong,
  type Setlist,
  type SetlistStoreSnapshot,
} from '../setlistStore'

/** The path a song's reference points at. Test songs are named after their file. */
export function pathForSong(id: string): string {
  return `${id}.json`
}

export function entriesFor(songs: readonly LibrarySong[]): LibraryEntry[] {
  return songs.map((song) => ({ ref: { id: song.id, path: pathForSong(song.id) }, song }))
}

export function snapshotFor(
  songs: readonly LibrarySong[],
  setlists?: readonly Setlist[],
  activeSetlistId?: string
): SetlistStoreSnapshot {
  const resolvedSetlists: Setlist[] =
    setlists !== undefined
      ? setlists.map((sl) => ({ ...sl, songIds: [...sl.songIds] }))
      : [{ id: DEFAULT_SETLIST_ID, name: 'Default', songIds: songs.map((s) => s.id) }]
  return {
    version: SETLIST_STORE_VERSION,
    library: songs.map((s) => ({ id: s.id, path: pathForSong(s.id) })),
    setlists: resolvedSetlists,
    activeSetlistId:
      activeSetlistId !== undefined ? activeSetlistId : (resolvedSetlists[0]?.id ?? ''),
  }
}

/** Persists references for `songs` and fills the resolved cache, as hydration would. */
export function installLibrary(
  songs: readonly LibrarySong[],
  setlists?: readonly Setlist[],
  activeSetlistId?: string
): SetlistStoreSnapshot {
  const snap = snapshotFor(songs, setlists, activeSetlistId)
  saveSetlistStore(snap)
  setLibraryEntries(entriesFor(songs))
  return snap
}

/**
 * `installLibrary`, plus **a catalogue**: the file names `<songs>/song-performance` is holding.
 *
 * The catalogue is what every list saying *you can use this* draws, and only hydration sets one —
 * so this goes through hydration rather than around it. A song in `songs` but not in `inFolder` is
 * a song the app is still holding a reference to whose file has left the catalogue, which is the
 * case worth testing.
 *
 * Sets a songs folder if the test has not, because hydration does not look at a folder that has
 * not been chosen.
 */
export async function installCatalogue(
  songs: readonly LibrarySong[],
  inFolder: readonly string[],
  setlists?: readonly Setlist[],
  activeSetlistId?: string
): Promise<void> {
  if (getSongsFolder() === null) setSongsFolder('/songs')
  installLibrary(songs, setlists, activeSetlistId)
  dropLibraryCache()
  await ensureSongLibraryHydrated({
    listFolder: () => Promise.resolve({ files: [...inFolder], problem: null, answered: true }),
    readSongFile: (path: string) => Promise.reject(new Error(`ENOENT: no such file, open '${path}'`)),
  })
  // Hydration is here for the catalogue it records, not for the reading: these tests have no song
  // files. The resolved entries go back to what `installLibrary` put there, which is what reading
  // them would have produced.
  setLibraryEntries(entriesFor(songs))
}
