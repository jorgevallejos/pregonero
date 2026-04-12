import {
  getCurrentSongId,
  parseSongFile,
  parseSongRecordFromUnknown,
  resetLoadedSongState,
  tryParsePersistedSongItemsArray,
  type ParsedSongFile,
  type SongItem,
} from './songState'

export const SETLIST_STORE_KEY = 'liveLyricSetlistStore'
/** v2: full song records (lyrics + optional notes) in the internal library. */
export const SETLIST_STORE_VERSION = 2
/** v1 snapshots (metadata + path only) are migrated on load. */
export const SETLIST_STORE_VERSION_LEGACY = 1
export const DEFAULT_SETLIST_ID = 'default-setlist'

/** Catalog entry shape (e.g. for tests or future import); runtime library is persisted v2 only. */
export type SongSeedEntry = { readonly id: string; readonly title: string; readonly path: string }

/** One row in the persisted internal song library (source of truth after hydration). */
export type LibrarySong = {
  id: string
  title: string
  items: SongItem[]
  /** Performance notes (capo, cues); omitted when absent. */
  notes?: string
}

/** Canonical song catalog persisted for the app (subset of “library” in the snapshot). */
export type SongLibrary = { songs: LibrarySong[] }

export type Setlist = { id: string; name: string; songIds: string[] }

export type SetlistStoreSnapshot = {
  version: number
  songLibrary: SongLibrary
  setlists: Setlist[]
  activeSetlistId: string
}

type LegacyLibrarySong = { id: string; title: string; path: string }

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isLegacyLibrarySong(v: unknown): v is LegacyLibrarySong {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return isNonEmptyString(o.id) && isNonEmptyString(o.title) && isNonEmptyString(o.path)
}

function isLibrarySong(v: unknown): v is LibrarySong {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.title)) return false
  if (tryParsePersistedSongItemsArray(o.items) === null) return false
  if (o.notes !== undefined && typeof o.notes !== 'string') return false
  return true
}

function isSetlist(v: unknown): v is Setlist {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.name)) return false
  if (!Array.isArray(o.songIds)) return false
  return o.songIds.every((id) => isNonEmptyString(id))
}

function parseSnapshotV2(raw: unknown): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== SETLIST_STORE_VERSION) return null
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLibrarySong)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs: lib.songs as LibrarySong[] },
    setlists: o.setlists as Setlist[],
    activeSetlistId: o.activeSetlistId,
  }
}

/** Parses a v1 snapshot for migration (metadata + path only). */
function parseSnapshotV1(raw: unknown): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== SETLIST_STORE_VERSION_LEGACY) return null
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLegacyLibrarySong)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version: SETLIST_STORE_VERSION_LEGACY,
    songLibrary: { songs: lib.songs as unknown as LibrarySong[] },
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
  const known = new Set(snap.songLibrary.songs.map((s) => s.id))
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

/** Fresh install or corrupt-store recovery: empty library, no setlists, no active setlist. */
export function createEmptyV2Snapshot(): SetlistStoreSnapshot {
  return {
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs: [] },
    setlists: [],
    activeSetlistId: '',
  }
}

export function createInitialSnapshot(seed: readonly LibrarySong[]): SetlistStoreSnapshot {
  const songs = seed.map((s) => ({
    id: s.id,
    title: s.title,
    items: s.items.map((item) =>
      'type' in item && item.type === 'section'
        ? { type: 'section' as const, label: item.label }
        : { languages: { ...(item as { languages: Record<string, string> }).languages } }
    ),
    ...(s.notes !== undefined && s.notes.length > 0 ? { notes: s.notes } : {}),
  }))
  return {
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs },
    setlists: [
      {
        id: DEFAULT_SETLIST_ID,
        name: 'Default',
        songIds: songs.map((s) => s.id),
      },
    ],
    activeSetlistId: DEFAULT_SETLIST_ID,
  }
}

export function loadSetlistStore(): SetlistStoreSnapshot | null {
  const parsed = parseSnapshotV2(readRaw())
  if (!parsed) return null
  return repairSnapshot(parsed)
}

export function saveSetlistStore(snapshot: SetlistStoreSnapshot): void {
  if (snapshot.version !== SETLIST_STORE_VERSION) return
  const repaired = repairSnapshot(snapshot)
  writeRaw(repaired)
}

/** Deep clone for draft editing sessions (JSON-serializable snapshot). */
export function cloneSetlistStoreSnapshot(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  return JSON.parse(JSON.stringify(snap)) as SetlistStoreSnapshot
}

export type FetchSongJson = (path: string) => Promise<string>

export async function defaultFetchSongJson(path: string): Promise<string> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`Failed to load song file: ${path} (${res.status})`)
  }
  return res.text()
}

async function migrateV1ToV2(
  snap: SetlistStoreSnapshot,
  fetchSongJson: FetchSongJson
): Promise<SetlistStoreSnapshot> {
  const legacy = snap.songLibrary.songs as unknown as LegacyLibrarySong[]
  const songs: LibrarySong[] = []
  for (const row of legacy) {
    const text = await fetchSongJson(row.path)
    const parsed = parseSongFile(text)
    const title = parsed.title.trim() || row.title
    const lib: LibrarySong = { id: row.id, title, items: parsed.items }
    if (parsed.notes !== undefined) {
      lib.notes = parsed.notes
    }
    songs.push(lib)
  }
  const next: SetlistStoreSnapshot = {
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs },
    setlists: snap.setlists,
    activeSetlistId: snap.activeSetlistId,
  }
  const repaired = repairSnapshot(next)
  writeRaw(repaired)
  return repaired
}

export type EnsureSongLibraryOptions = {
  /** Used only when migrating a v1 snapshot (fetches each legacy `path`). */
  fetchSongJson?: FetchSongJson
}

let hydrationInFlight: Promise<SetlistStoreSnapshot> | null = null

/**
 * Loads v2 from storage, migrates v1, or persists an empty v2 snapshot (no bundled seed).
 * Safe to call multiple times; concurrent calls share one in-flight migration.
 */
export function ensureSongLibraryHydrated(
  options: EnsureSongLibraryOptions = {}
): Promise<SetlistStoreSnapshot> {
  const fetchSongJson = options.fetchSongJson ?? defaultFetchSongJson

  const existingV2 = loadSetlistStore()
  if (existingV2) {
    return Promise.resolve(existingV2)
  }

  if (!hydrationInFlight) {
    hydrationInFlight = (async () => {
      const raw = readRaw()
      if (raw !== null && typeof raw === 'object') {
        const v1 = parseSnapshotV1(raw)
        if (v1) {
          return migrateV1ToV2(v1, fetchSongJson)
        }
      }
      const empty = repairSnapshot(createEmptyV2Snapshot())
      writeRaw(empty)
      return empty
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

export function getLibrarySongs(): LibrarySong[] {
  return [...getSnapshot().songLibrary.songs]
}

function orderedSongsForSetlistId(snap: SetlistStoreSnapshot, setlistId: string): LibrarySong[] {
  const byId = new Map(snap.songLibrary.songs.map((s) => [s.id, s]))
  if (!setlistId) return []
  const list = snap.setlists.find((s) => s.id === setlistId)
  if (!list) return []
  return list.songIds.map((id) => byId.get(id)).filter((s): s is LibrarySong => s !== undefined)
}

/** Resolves a setlist’s `songIds` to library rows in list order (unknown ids omitted). */
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
  const next = { ...snap, activeSetlistId: id }
  writeRaw(next)
  return true
}

const NEW_SETLIST_DEFAULT_NAME = 'New setlist'

function newSetlistId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `setlist-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

function newLibrarySongId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `song-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

function normalizeLibrarySongForStore(song: LibrarySong): LibrarySong {
  const libSong: LibrarySong = {
    id: song.id,
    title: song.title,
    items: song.items.map((item) =>
      'type' in item && item.type === 'section'
        ? { type: 'section' as const, label: item.label }
        : { languages: { ...(item as { languages: Record<string, string> }).languages } }
    ),
    ...(song.notes !== undefined && song.notes.length > 0 ? { notes: song.notes } : {}),
  }
  return libSong
}

/** Pure snapshot update: append one library row. Returns null if duplicate id or invalid song. */
export function appendSongToLibraryInSnapshot(
  snap: SetlistStoreSnapshot,
  song: LibrarySong
): SetlistStoreSnapshot | null {
  if (!isLibrarySong(song)) return null
  if (snap.songLibrary.songs.some((s) => s.id === song.id)) return null
  const libSong = normalizeLibrarySongForStore(song)
  const next = {
    ...snap,
    songLibrary: { songs: [...snap.songLibrary.songs, libSong] },
  }
  return repairSnapshot(next)
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
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  }
  return repairSnapshot(next)
}

/** Pure snapshot update: remove a setlist; clears `activeSetlistId` when it pointed at that list. */
export function deleteSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  id: string
): SetlistStoreSnapshot | null {
  if (!snap.setlists.some((s) => s.id === id)) return null
  const nextSetlists = snap.setlists.filter((s) => s.id !== id)
  let activeSetlistId = snap.activeSetlistId
  if (activeSetlistId === id) {
    activeSetlistId = ''
  }
  const next = { ...snap, setlists: nextSetlists, activeSetlistId }
  return repairSnapshot(next)
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

/** Pure snapshot update: add a library song to a setlist by id. */
export function addSongToSetlistInSnapshot(
  snap: SetlistStoreSnapshot,
  setlistId: string,
  songId: string
): SetlistStoreSnapshot | null {
  if (!setlistId || !songId) return null
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return null
  const known = new Set(snap.songLibrary.songs.map((s) => s.id))
  if (!known.has(songId)) return null
  if (setlist.songIds.includes(songId)) return null
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) =>
      s.id === setlistId ? { ...s, songIds: [...s.songIds, songId] } : s
    ),
  }
  return repairSnapshot(next)
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
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) =>
      s.id === setlistId ? { ...s, songIds: s.songIds.filter((id) => id !== songId) } : s
    ),
  }
  return repairSnapshot(next)
}

/** Pure snapshot update: remove a library song and drop its id from every setlist. */
export function deleteSongFromLibraryInSnapshot(
  snap: SetlistStoreSnapshot,
  songId: string
): SetlistStoreSnapshot | null {
  if (!songId) return null
  if (!snap.songLibrary.songs.some((s) => s.id === songId)) return null
  const next = {
    ...snap,
    songLibrary: {
      songs: snap.songLibrary.songs.filter((s) => s.id !== songId),
    },
    setlists: snap.setlists.map((sl) => ({
      ...sl,
      songIds: sl.songIds.filter((id) => id !== songId),
    })),
  }
  return repairSnapshot(next)
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
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) => (s.id === setlistId ? { ...s, songIds: nextIds } : s)),
  }
  return repairSnapshot(next)
}

/**
 * After persisting a setlist snapshot, clears loaded song session when the current song is gone from the
 * library or no longer appears in the active setlist (including when there is no active setlist).
 */
export function syncLoadedSongSessionWithSnapshot(snap: SetlistStoreSnapshot): void {
  const songId = getCurrentSongId()
  if (!songId) return
  const inLib = snap.songLibrary.songs.some((s) => s.id === songId)
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

/** Appends an empty setlist, sets it active, and persists. */
export function createEmptySetlist(): { id: string } {
  const snap = getSnapshot()
  const { snapshot, id } = appendEmptySetlistInSnapshot(snap)
  writeRaw(snapshot)
  return { id }
}

/** Updates a setlist display name (trimmed). Returns false if id is unknown or name is empty after trim. */
export function renameSetlist(id: string, name: string): boolean {
  const snap = getSnapshot()
  const next = renameSetlistInSnapshot(snap, id, name)
  if (!next) return false
  writeRaw(next)
  return true
}

/** Removes a setlist. Clears activeSetlistId when the active setlist is deleted. Returns false if id is unknown. */
export function deleteSetlist(id: string): boolean {
  const snap = getSnapshot()
  const next = deleteSetlistInSnapshot(snap, id)
  if (!next) return false
  writeRaw(next)
  return true
}

/**
 * Appends one full library row if `song.id` is not already present. Persists on success.
 * Duplicate detection: **by `id` string** (library is a map keyed by id).
 */
export function addSongToLibrary(song: LibrarySong): boolean {
  if (!isLibrarySong(song)) return false
  const snap = getSnapshot()
  const next = appendSongToLibraryInSnapshot(snap, song)
  if (!next) return false
  writeRaw(next)
  return true
}

export type ImportSongFromJsonResult =
  | { ok: true; song: LibrarySong }
  | { ok: false; error: string }

/**
 * Parses one song JSON file (`title`, `lyrics`, optional `notes`, optional `id`). Same validation as
 * `importSongFromJsonText` but does not touch storage.
 */
export function parseSongImportFromJsonText(text: string): ImportSongFromJsonResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'The file is not valid JSON.' }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      error: 'Song file must be a JSON object with "title" and "lyrics".',
    }
  }
  const obj = raw as Record<string, unknown>
  let id: string
  if (Object.prototype.hasOwnProperty.call(obj, 'id')) {
    const idVal = obj.id
    if (typeof idVal !== 'string' || idVal.trim() === '') {
      return {
        ok: false,
        error: 'Song file "id" must be a non-empty string when present.',
      }
    }
    id = idVal.trim()
  } else {
    id = newLibrarySongId()
  }
  let parsed: ParsedSongFile
  try {
    parsed = parseSongRecordFromUnknown(obj)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid song file.'
    return { ok: false, error: msg }
  }
  const title = parsed.title.trim() || 'Untitled'
  const song: LibrarySong = { id, title, items: parsed.items }
  if (parsed.notes !== undefined) {
    song.notes = parsed.notes
  }
  return { ok: true, song }
}

export type AppendImportedSongToSnapshotResult =
  | { ok: true; song: LibrarySong; snapshot: SetlistStoreSnapshot }
  | { ok: false; error: string }

/** Message returned by {@link tryAppendImportedSongFromJsonText} when `id` is already in the library. */
export const LIBRARY_DUPLICATE_SONG_IMPORT_ERROR =
  'A song with this id is already in your library.' as const

/** Parses JSON and appends to the given snapshot’s library (no persistence). */
export function tryAppendImportedSongFromJsonText(
  snap: SetlistStoreSnapshot,
  text: string
): AppendImportedSongToSnapshotResult {
  const parsed = parseSongImportFromJsonText(text)
  if (!parsed.ok) return parsed
  const next = appendSongToLibraryInSnapshot(snap, parsed.song)
  if (!next) {
    return {
      ok: false,
      error: LIBRARY_DUPLICATE_SONG_IMPORT_ERROR,
    }
  }
  return { ok: true, song: parsed.song, snapshot: next }
}

export type ApplySequentialSongImportsResult = {
  snapshot: SetlistStoreSnapshot
  importedCount: number
  duplicatesSkipped: number
  invalidSkipped: number
}

/**
 * Applies multiple song JSON payloads in order, reusing {@link tryAppendImportedSongFromJsonText}
 * for each. Invalid entries are skipped; duplicate ids count toward `duplicatesSkipped`.
 */
export function applySequentialSongImportsFromJsonTexts(
  snap: SetlistStoreSnapshot,
  texts: readonly string[]
): ApplySequentialSongImportsResult {
  let current = snap
  let importedCount = 0
  let duplicatesSkipped = 0
  let invalidSkipped = 0
  for (const text of texts) {
    const r = tryAppendImportedSongFromJsonText(current, text)
    if (r.ok) {
      current = r.snapshot
      importedCount++
    } else if (r.error === LIBRARY_DUPLICATE_SONG_IMPORT_ERROR) {
      duplicatesSkipped++
    } else {
      invalidSkipped++
    }
  }
  return { snapshot: current, importedCount, duplicatesSkipped, invalidSkipped }
}

/**
 * Parses one song JSON file (`title`, `lyrics`, optional `notes`, optional `id`), validates with
 * the same rules as `parseSongFile`, and appends to the persisted library.
 *
 * - **Invalid JSON** → `{ ok: false }` with a short message (no throw).
 * - **Shape / lyric rules** → same validation errors as `parseSongFile` (as message text).
 * - **`id`**: optional string; if omitted, a new id is generated. If present, must be non-empty.
 * - **Duplicates**: rejected when `id` matches an existing library song (see `addSongToLibrary`).
 */
export function importSongFromJsonText(text: string): ImportSongFromJsonResult {
  const snap = getSnapshot()
  const r = tryAppendImportedSongFromJsonText(snap, text)
  if (!r.ok) return r
  writeRaw(r.snapshot)
  return { ok: true, song: r.song }
}

export function addSongToSetlist(setlistId: string, songId: string): boolean {
  const snap = getSnapshot()
  const next = addSongToSetlistInSnapshot(snap, setlistId, songId)
  if (!next) return false
  writeRaw(next)
  return true
}

/** Removes `songId` from the setlist’s ordered ids. Returns false if the setlist or id is missing. */
export function removeSongFromSetlist(setlistId: string, songId: string): boolean {
  const snap = getSnapshot()
  const next = removeSongFromSetlistInSnapshot(snap, setlistId, songId)
  if (!next) return false
  writeRaw(next)
  return true
}

/**
 * Removes a library song by id and drops that id from every setlist.
 * Returns false when the id is missing or empty.
 */
export function deleteSongFromLibrary(songId: string): boolean {
  const snap = getSnapshot()
  const next = deleteSongFromLibraryInSnapshot(snap, songId)
  if (!next) return false
  writeRaw(next)
  return true
}

export type MoveSongDirection = 'up' | 'down'

/**
 * Moves the song at `fromIndex` to `toIndex` in the setlist’s `songIds` (same semantics as
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
  const snap = getSnapshot()
  const setlist = snap.setlists.find((s) => s.id === setlistId)
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

export function getLibrarySongById(id: string): LibrarySong | undefined {
  if (!id) return undefined
  const snap = loadSetlistStore()
  if (!snap) return undefined
  return snap.songLibrary.songs.find((s) => s.id === id)
}
