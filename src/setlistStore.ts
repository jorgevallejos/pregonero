import {
  getCurrentSongId,
  parseSongFile,
  setBlank,
  setCurrentSongId,
  setCurrentSongTitle,
  setSongIndex,
  setSongLines,
  resetLoadedSongState,
  type SongItem,
  type TimelineEntry,
  type TimelineLeadIn,
  type MediaFile,
} from './songState'

export const SETLIST_STORE_KEY = 'liveLyricSetlistStore'
/**
 * v8: the library holds **references** into `songs/` — an id and a path — and nothing else.
 * Song data (lyrics, translations, intro, notes, timeline, leadIn, media, tempo) is read from
 * the file on every launch. `songs/` is the source of truth for every field; the resolved
 * library is a cache that may be dropped at any time and rebuilt by reading the files again.
 *
 * There is no migration from v7 or earlier. Those snapshots held full song copies whose only
 * authority was themselves, so they are discarded rather than reconciled — setlists included,
 * which round E replaces with the gig file (Jorge, 2026-08-24).
 */
export const SETLIST_STORE_VERSION = 8
export const DEFAULT_SETLIST_ID = 'default-setlist'

/** Tempo information for count-in and beat pulse display. Read from the song file, never written. */
export type SongTempo = {
  /** Beats per minute — the felt pulse (quarter note for 4/4, dotted-quarter for 6/8). Must be > 0. */
  bpm: number
  /** Numerator of the time signature (e.g. 4 for 4/4, 6 for 6/8). Positive integer. */
  numerator: number
  /** Denominator of the time signature (e.g. 4 for 4/4, 8 for 6/8). Positive integer. */
  denominator: number
  /** Number of count-in bars before the song starts (defaults to 1 when absent). */
  countInBars?: number
}

/** One persisted library entry: the id the app refers to the song by, and the file it lives in. */
export type SongRef = {
  /** Stable and derived from the file name, so deleting and re-adding a file restores the same song. */
  id: string
  /** Path to the song's JSON file in `songs/`. */
  path: string
}

/**
 * A song as read from its file. Never persisted — this is the resolved side of a {@link SongRef},
 * held in memory for as long as the app is running.
 */
export type LibrarySong = {
  id: string
  title: string
  items: SongItem[]
  /** Performance notes (capo, cues); omitted when absent. */
  notes?: string
  /** Title translated into other languages, keyed by language code. Omitted when absent. */
  title_translations?: Record<string, string>
  /** One-line intro tagline per language shown on the intro screen. Omitted when absent. */
  intro?: Record<string, string>
  /** Timing entries in seconds, one per item. Authored in Bombista, read here. */
  timeline?: TimelineEntry[]
  /** Timeline schema version (always `2` when present). */
  timelineVersion?: number
  /** Lead-in metadata accompanying a v2 timeline. Present iff `timelineVersion` is present. */
  leadIn?: TimelineLeadIn
  /** Optional media file (video or audio) the song file declares. */
  media?: MediaFile
  /** Optional tempo for count-in and beat-pulse display. */
  tempo?: SongTempo
}

/**
 * One row of the resolved library: the reference, plus either the song read from its file or
 * the reason it could not be read. An entry with no `song` is still a real library row — the
 * reference survives a missing or broken file — but it is not a song the app can perform.
 */
export type LibraryEntry = {
  ref: SongRef
  song?: LibrarySong
  /** Why `ref.path` could not be turned into a song. Present iff `song` is absent. */
  error?: string
}

export type Setlist = { id: string; name: string; songIds: string[] }

export type SetlistStoreSnapshot = {
  version: number
  library: SongRef[]
  setlists: Setlist[]
  activeSetlistId: string
}

/** Reads the text of a song file. Injected so tests never touch the disk. */
export type ReadSongFile = (path: string) => Promise<string>

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * The id for a song file: its name without the `.json` extension. Identity comes from the file
 * so that deleting a song from the library and adding the file again restores the same song
 * rather than a stranger — the trap the copy-holding library used to set.
 */
export function songIdFromPath(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.json$/i, '')
}

function isSongRef(v: unknown): v is SongRef {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return isNonEmptyString(o.id) && isNonEmptyString(o.path)
}

function isSetlist(v: unknown): v is Setlist {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.name)) return false
  if (!Array.isArray(o.songIds)) return false
  return o.songIds.every((id) => isNonEmptyString(id))
}

function parseSnapshot(raw: unknown): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== SETLIST_STORE_VERSION) return null
  if (!Array.isArray(o.library) || !o.library.every(isSongRef)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version: SETLIST_STORE_VERSION,
    library: o.library as SongRef[],
    setlists: o.setlists as Setlist[],
    activeSetlistId: o.activeSetlistId,
  }
}

function readRaw(): unknown {
  try {
    if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
      return null
    }
    const s = localStorage.getItem(SETLIST_STORE_KEY)
    if (!s) return null
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function writeRaw(snapshot: SetlistStoreSnapshot): void {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return
  localStorage.setItem(SETLIST_STORE_KEY, JSON.stringify(snapshot))
}

/** Drop unknown song ids; clear active setlist when it does not reference a real setlist (caller must pick). */
function repairSnapshot(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  const known = new Set(snap.library.map((r) => r.id))
  const setlists = snap.setlists.map((sl) => ({
    ...sl,
    songIds: sl.songIds.filter((id) => known.has(id)),
  }))
  let activeSetlistId = typeof snap.activeSetlistId === 'string' ? snap.activeSetlistId : ''
  if (setlists.length === 0) {
    activeSetlistId = ''
  } else if (activeSetlistId !== '' && !setlists.some((s) => s.id === activeSetlistId)) {
    activeSetlistId = ''
  }
  return { ...snap, setlists, activeSetlistId }
}

/** Fresh install, or what any pre-v8 store becomes: no references, no setlists, nothing active. */
export function createEmptySnapshot(): SetlistStoreSnapshot {
  return {
    version: SETLIST_STORE_VERSION,
    library: [],
    setlists: [],
    activeSetlistId: '',
  }
}

/** References for `songs`, all in one default setlist. The songs themselves are not persisted. */
export function createInitialSnapshot(seed: readonly LibrarySong[]): SetlistStoreSnapshot {
  const library = seed.map((s) => ({ id: s.id, path: `${s.id}.json` }))
  return {
    version: SETLIST_STORE_VERSION,
    library,
    setlists: [
      {
        id: DEFAULT_SETLIST_ID,
        name: 'Default',
        songIds: library.map((r) => r.id),
      },
    ],
    activeSetlistId: DEFAULT_SETLIST_ID,
  }
}

export function loadSetlistStore(): SetlistStoreSnapshot | null {
  const parsed = parseSnapshot(readRaw())
  if (!parsed) return null
  return repairSnapshot(parsed)
}

export function saveSetlistStore(snapshot: SetlistStoreSnapshot): void {
  if (snapshot.version !== SETLIST_STORE_VERSION) return
  writeRaw(repairSnapshot(snapshot))
}

/** Deep clone for draft editing sessions (JSON-serializable snapshot). */
export function cloneSetlistStoreSnapshot(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  return JSON.parse(JSON.stringify(snap)) as SetlistStoreSnapshot
}

/** Structural equality for draft vs entry snapshot (JSON-serializable). */
export function areSetlistStoreSnapshotsEqual(
  a: SetlistStoreSnapshot,
  b: SetlistStoreSnapshot
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Setlist display names that include `songId` in the snapshot's draft order. */
export function getSetlistNamesContainingSongInSnapshot(
  snap: SetlistStoreSnapshot,
  songId: string
): string[] {
  if (!songId) return []
  return snap.setlists.filter((sl) => sl.songIds.includes(songId)).map((sl) => sl.name)
}

// ── The resolved library: a cache, never a source of truth ──────────────────────────────────
// Held in memory only. Dropping it loses nothing: every field came from a file in `songs/` and
// is read again on the next hydration.

let libraryCache = new Map<string, LibraryEntry>()

/** Throws the resolved library away. The references in storage are what survive. */
export function dropLibraryCache(): void {
  libraryCache = new Map()
}

/** Replaces the resolved library. Hydration calls this once every reference has been read. */
export function setLibraryEntries(entries: readonly LibraryEntry[]): void {
  libraryCache = new Map(entries.map((e) => [e.ref.id, e]))
}

/** Every library row in reference order, resolved or not. */
export function getLibraryEntries(): LibraryEntry[] {
  return [...libraryCache.values()]
}

/** The songs the app can actually use: references whose file was read successfully. */
export function getLibrarySongs(): LibrarySong[] {
  return getLibraryEntries()
    .map((e) => e.song)
    .filter((s): s is LibrarySong => s !== undefined)
}

export function getLibrarySongById(id: string): LibrarySong | undefined {
  if (!id) return undefined
  return libraryCache.get(id)?.song
}

export function getLibraryEntryById(id: string): LibraryEntry | undefined {
  if (!id) return undefined
  return libraryCache.get(id)
}

/** True once every reference in the persisted snapshot has been resolved or failed to resolve. */
export function isLibraryHydrated(): boolean {
  const snap = loadSetlistStore()
  if (!snap) return false
  return snap.library.every((ref) => libraryCache.has(ref.id))
}

/** Reads one reference's file and parses it. Never throws: a failure becomes `entry.error`. */
export async function resolveSongRef(ref: SongRef, read: ReadSongFile): Promise<LibraryEntry> {
  let text: string
  try {
    text = await read(ref.path)
  } catch (e) {
    return { ref, error: e instanceof Error ? e.message : `Could not read ${ref.path}` }
  }
  try {
    const parsed = parseSongFile(text)
    const song: LibrarySong = {
      id: ref.id,
      title: parsed.title.trim() || ref.id,
      items: parsed.items,
    }
    if (parsed.notes !== undefined) song.notes = parsed.notes
    if (parsed.title_translations !== undefined) song.title_translations = parsed.title_translations
    if (parsed.intro !== undefined) song.intro = parsed.intro
    if (parsed.timeline !== undefined) song.timeline = parsed.timeline
    if (parsed.timelineVersion !== undefined) song.timelineVersion = parsed.timelineVersion
    if (parsed.leadIn !== undefined) song.leadIn = parsed.leadIn
    if (parsed.media !== undefined) song.media = parsed.media
    if (parsed.tempo !== undefined) song.tempo = parsed.tempo
    return { ref, song }
  } catch (e) {
    return { ref, error: e instanceof Error ? e.message : `Could not read ${ref.path}` }
  }
}

/** Reads song files through the Electron main process. Injected in tests. */
export const defaultReadSongFile: ReadSongFile = async (path: string) => {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined
  if (!api || typeof api.readSongFile !== 'function') {
    throw new Error('Song files can only be read from the desktop app.')
  }
  const result = await api.readSongFile(path)
  if (!result.ok) throw new Error(result.error)
  return result.text
}

export type EnsureSongLibraryOptions = {
  /** Overrides how a reference's file is read. Defaults to the Electron file reader. */
  readSongFile?: ReadSongFile
}

let hydrationInFlight: Promise<SetlistStoreSnapshot> | null = null

/**
 * Loads the v8 snapshot (persisting an empty one over anything older or corrupt), then reads
 * every reference that is not already resolved and drops cache entries no reference points at.
 * Safe to call repeatedly; concurrent calls share one in-flight pass.
 */
export function ensureSongLibraryHydrated(
  options: EnsureSongLibraryOptions = {}
): Promise<SetlistStoreSnapshot> {
  if (!hydrationInFlight) {
    const read = options.readSongFile ?? defaultReadSongFile
    hydrationInFlight = (async () => {
      let snap = loadSetlistStore()
      if (!snap) {
        snap = repairSnapshot(createEmptySnapshot())
        writeRaw(snap)
      }
      const next = new Map<string, LibraryEntry>()
      for (const ref of snap.library) {
        const cached = libraryCache.get(ref.id)
        next.set(ref.id, cached ?? (await resolveSongRef(ref, read)))
      }
      libraryCache = next
      return snap
    })().finally(() => {
      hydrationInFlight = null
    })
  }
  return hydrationInFlight
}

function getSnapshot(): SetlistStoreSnapshot {
  const snap = loadSetlistStore()
  if (!snap) {
    throw new Error(
      'Song library is not ready. Await ensureSongLibraryHydrated() before using the setlist store.'
    )
  }
  return snap
}

export function getActiveSetlistId(): string {
  return getSnapshot().activeSetlistId
}

export function getSetlists(): Setlist[] {
  return [...getSnapshot().setlists]
}

function orderedEntriesForSetlistId(snap: SetlistStoreSnapshot, setlistId: string): LibraryEntry[] {
  if (!setlistId) return []
  const list = snap.setlists.find((s) => s.id === setlistId)
  if (!list) return []
  const byId = new Map(snap.library.map((r) => [r.id, r]))
  return list.songIds
    .map((id) => {
      const ref = byId.get(id)
      if (!ref) return undefined
      return libraryCache.get(id) ?? { ref, error: 'Not read yet.' }
    })
    .filter((e): e is LibraryEntry => e !== undefined)
}

function orderedSongsForSetlistId(snap: SetlistStoreSnapshot, setlistId: string): LibrarySong[] {
  return orderedEntriesForSetlistId(snap, setlistId)
    .map((e) => e.song)
    .filter((s): s is LibrarySong => s !== undefined)
}

/** Resolves a setlist's `songIds` to songs in list order. Unresolved references are omitted. */
export function getOrderedSongsForSetlist(setlistId: string): LibrarySong[] {
  return orderedSongsForSetlistId(getSnapshot(), setlistId)
}

/** Same as `getOrderedSongsForSetlist` but reads from an arbitrary snapshot (e.g. manage-setlists draft). */
export function getOrderedSongsForSetlistFromSnapshot(
  snap: SetlistStoreSnapshot,
  setlistId: string
): LibrarySong[] {
  return orderedSongsForSetlistId(snap, setlistId)
}

/**
 * Setlist rows for the manage screen, in list order, **including references whose file could
 * not be read** — those are exactly the rows the performer needs to see and fix.
 */
export function getOrderedEntriesForSetlistFromSnapshot(
  snap: SetlistStoreSnapshot,
  setlistId: string
): LibraryEntry[] {
  return orderedEntriesForSetlistId(snap, setlistId)
}

/** Library rows for a snapshot's references, in reference order, resolved where possible. */
export function getLibraryEntriesForSnapshot(snap: SetlistStoreSnapshot): LibraryEntry[] {
  return snap.library.map((ref) => libraryCache.get(ref.id) ?? { ref, error: 'Not read yet.' })
}

export function hasValidActiveSetlist(): boolean {
  const snap = getSnapshot()
  const id = snap.activeSetlistId
  if (!id) return false
  return snap.setlists.some((s) => s.id === id)
}

export function setActiveSetlistId(id: string): boolean {
  const snap = getSnapshot()
  if (!snap.setlists.some((s) => s.id === id)) return false
  if (snap.activeSetlistId === id) return true
  writeRaw({ ...snap, activeSetlistId: id })
  return true
}

const NEW_SETLIST_DEFAULT_NAME = 'New setlist'

function newSetlistId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `setlist-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

/** Returns the media file the song's own file declares (single file per song). */
export function getActiveMediaFile(song: LibrarySong): MediaFile | undefined {
  return song.media
}

/** Pure snapshot update: append one reference. Returns null on a duplicate id or an empty field. */
export function addSongRefToSnapshot(
  snap: SetlistStoreSnapshot,
  ref: SongRef
): SetlistStoreSnapshot | null {
  if (!isSongRef(ref)) return null
  if (snap.library.some((r) => r.id === ref.id)) return null
  return repairSnapshot({
    ...snap,
    library: [...snap.library, { id: ref.id, path: ref.path }],
  })
}

/** Pure snapshot update: rename a setlist. Returns null if id unknown or empty name. */
export function renameSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  id: string,
  name: string
): SetlistStoreSnapshot | null {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return null
  if (!snap.setlists.some((s) => s.id === id)) return null
  return repairSnapshot({
    ...snap,
    setlists: snap.setlists.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  })
}

/** Pure snapshot update: remove a setlist; clears `activeSetlistId` when it pointed at that list. */
export function deleteSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  id: string
): SetlistStoreSnapshot | null {
  if (!snap.setlists.some((s) => s.id === id)) return null
  const nextSetlists = snap.setlists.filter((s) => s.id !== id)
  const activeSetlistId = snap.activeSetlistId === id ? '' : snap.activeSetlistId
  return repairSnapshot({ ...snap, setlists: nextSetlists, activeSetlistId })
}

/** Pure snapshot update: append an empty setlist and set it active. */
export function appendEmptySetlistInSnapshot(
  snap: SetlistStoreSnapshot
): { snapshot: SetlistStoreSnapshot; id: string } {
  const id = newSetlistId()
  const next = repairSnapshot({
    ...snap,
    setlists: [...snap.setlists, { id, name: NEW_SETLIST_DEFAULT_NAME, songIds: [] }],
    activeSetlistId: id,
  })
  return { snapshot: next, id }
}

/** Pure snapshot update: add a library reference to a setlist by id. */
export function addSongToSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  setlistId: string,
  songId: string
): SetlistStoreSnapshot | null {
  if (!setlistId || !songId) return null
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return null
  if (!snap.library.some((r) => r.id === songId)) return null
  if (setlist.songIds.includes(songId)) return null
  return repairSnapshot({
    ...snap,
    setlists: snap.setlists.map((s) =>
      s.id === setlistId ? { ...s, songIds: [...s.songIds, songId] } : s
    ),
  })
}

/** Pure snapshot update: remove a song id from one setlist. */
export function removeSongFromSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  setlistId: string,
  songId: string
): SetlistStoreSnapshot | null {
  if (!setlistId || !songId) return null
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return null
  if (!setlist.songIds.includes(songId)) return null
  return repairSnapshot({
    ...snap,
    setlists: snap.setlists.map((s) =>
      s.id === setlistId ? { ...s, songIds: s.songIds.filter((id) => id !== songId) } : s
    ),
  })
}

/** Pure snapshot update: remove a library reference and drop its id from every setlist. */
export function deleteSongFromLibraryInSnapshot(
  snap: SetlistStoreSnapshot,
  songId: string
): SetlistStoreSnapshot | null {
  if (!songId) return null
  if (!snap.library.some((r) => r.id === songId)) return null
  return repairSnapshot({
    ...snap,
    library: snap.library.filter((r) => r.id !== songId),
    setlists: snap.setlists.map((sl) => ({
      ...sl,
      songIds: sl.songIds.filter((id) => id !== songId),
    })),
  })
}

/**
 * Pure snapshot update: reorder within one setlist (`fromIndex` → `toIndex`, @dnd-kit arrayMove semantics).
 * Returns null on invalid args; returns `snap` unchanged when indices are equal.
 */
export function reorderSongsInSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  setlistId: string,
  fromIndex: number,
  toIndex: number
): SetlistStoreSnapshot | null {
  if (!setlistId) return null
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return null
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return null
  const n = setlist.songIds.length
  if (fromIndex < 0 || fromIndex >= n) return null
  if (toIndex < 0 || toIndex >= n) return null
  if (fromIndex === toIndex) return snap
  const nextIds = [...setlist.songIds]
  const [removed] = nextIds.splice(fromIndex, 1)
  nextIds.splice(toIndex, 0, removed!)
  return repairSnapshot({
    ...snap,
    setlists: snap.setlists.map((s) => (s.id === setlistId ? { ...s, songIds: nextIds } : s)),
  })
}

/**
 * After persisting a setlist snapshot, clears loaded song session when the current song is gone from the
 * library or no longer appears in the active setlist (including when there is no active setlist).
 */
export function syncLoadedSongSessionWithSnapshot(snap: SetlistStoreSnapshot): void {
  const songId = getCurrentSongId()
  if (!songId) return
  const inLib = snap.library.some((r) => r.id === songId)
  if (!inLib) {
    resetLoadedSongState()
    return
  }
  const active = snap.activeSetlistId
  if (!active) {
    resetLoadedSongState()
    return
  }
  const sl = snap.setlists.find((s) => s.id === active)
  if (!sl || !sl.songIds.includes(songId)) {
    resetLoadedSongState()
  }
}

/**
 * Loads the first song from the active setlist into setup state.
 * When there is no active setlist or it has no readable song, clears the loaded song.
 */
export function autoSelectFirstSongForActiveSetlist(snap: SetlistStoreSnapshot): void {
  const activeSetlistId = snap.activeSetlistId
  if (!activeSetlistId) {
    resetLoadedSongState()
    return
  }
  const firstSong = orderedSongsForSetlistId(snap, activeSetlistId)[0]
  if (!firstSong) {
    resetLoadedSongState()
    return
  }
  setCurrentSongId(firstSong.id)
  setCurrentSongTitle(firstSong.title)
  setSongLines(firstSong.items)
  setSongIndex(-1)
  setBlank(true)
}

/** Appends an empty setlist, sets it active, and persists. */
export function createEmptySetlist(): { id: string } {
  const { snapshot, id } = appendEmptySetlistInSnapshot(getSnapshot())
  writeRaw(snapshot)
  return { id }
}

/** Updates a setlist display name (trimmed). Returns false if id is unknown or name is empty after trim. */
export function renameSetlist(id: string, name: string): boolean {
  const next = renameSetlistInSnapshot(getSnapshot(), id, name)
  if (!next) return false
  writeRaw(next)
  return true
}

/** Removes a setlist. Clears activeSetlistId when the active setlist is deleted. Returns false if id is unknown. */
export function deleteSetlist(id: string): boolean {
  const next = deleteSetlistInSnapshot(getSnapshot(), id)
  if (!next) return false
  writeRaw(next)
  return true
}

export function addSongToSetlist(setlistId: string, songId: string): boolean {
  const next = addSongToSetlistInSnapshot(getSnapshot(), setlistId, songId)
  if (!next) return false
  writeRaw(next)
  return true
}

/** Removes `songId` from the setlist's ordered ids. Returns false if the setlist or id is missing. */
export function removeSongFromSetlist(setlistId: string, songId: string): boolean {
  const next = removeSongFromSetlistInSnapshot(getSnapshot(), setlistId, songId)
  if (!next) return false
  writeRaw(next)
  return true
}

/**
 * Removes a library reference by id and drops that id from every setlist.
 * Returns false when the id is missing or empty.
 */
export function deleteSongFromLibrary(songId: string): boolean {
  const next = deleteSongFromLibraryInSnapshot(getSnapshot(), songId)
  if (!next) return false
  writeRaw(next)
  return true
}

export type MoveSongDirection = 'up' | 'down'

/**
 * Moves the song at `fromIndex` to `toIndex` in the setlist's `songIds` (same semantics as
 * @dnd-kit arrayMove: remove at `fromIndex`, then insert at `toIndex` in the shortened array).
 * Returns false when the setlist is missing or indices are invalid.
 */
export function reorderSongsInSetlist(
  setlistId: string,
  fromIndex: number,
  toIndex: number
): boolean {
  const snap = getSnapshot()
  const next = reorderSongsInSetlistInSnapshot(snap, setlistId, fromIndex, toIndex)
  if (next === null) return false
  if (next === snap) return true
  writeRaw(next)
  return true
}

/**
 * Swaps `songId` with its neighbor in the setlist order. Returns false when the setlist or song is
 * missing, or when the move would go past the first/last position.
 */
export function moveSongInSetlist(
  setlistId: string,
  songId: string,
  direction: MoveSongDirection
): boolean {
  if (!setlistId || !songId) return false
  const setlist = getSnapshot().setlists.find((s) => s.id === setlistId)
  if (!setlist) return false
  const idx = setlist.songIds.indexOf(songId)
  if (idx < 0) return false
  const j = direction === 'up' ? idx - 1 : idx + 1
  if (j < 0 || j >= setlist.songIds.length) return false
  return reorderSongsInSetlist(setlistId, idx, j)
}

export function getOrderedSongsForActiveSetlist(): LibrarySong[] {
  const snap = getSnapshot()
  if (!snap.activeSetlistId) return []
  return orderedSongsForSetlistId(snap, snap.activeSetlistId)
}
