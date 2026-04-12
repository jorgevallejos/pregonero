import { SONGS, type SongSeedEntry } from './songs'
import { parseSongFile, tryParsePersistedSongItemsArray, type SongItem } from './songState'

export const SETLIST_STORE_KEY = 'liveLyricSetlistStore'
/** v2: full song records (lyrics + optional notes) in the internal library. */
export const SETLIST_STORE_VERSION = 2
/** v1 snapshots (metadata + path only) are migrated on load. */
export const SETLIST_STORE_VERSION_LEGACY = 1
export const DEFAULT_SETLIST_ID = 'default-setlist'

export type { SongSeedEntry }

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

export type FetchSongJson = (path: string) => Promise<string>

export async function defaultFetchSongJson(path: string): Promise<string> {
  const res = await fetch(path)
  if (!res.ok) {
    throw new Error(`Failed to load song file: ${path} (${res.status})`)
  }
  return res.text()
}

async function librarySongsFromSeedCatalog(
  catalog: readonly SongSeedEntry[],
  fetchSongJson: FetchSongJson
): Promise<LibrarySong[]> {
  const songs: LibrarySong[] = []
  for (const entry of catalog) {
    const text = await fetchSongJson(entry.path)
    const parsed = parseSongFile(text)
    const title = parsed.title.trim() || entry.title
    const row: LibrarySong = { id: entry.id, title, items: parsed.items }
    if (parsed.notes !== undefined) {
      row.notes = parsed.notes
    }
    songs.push(row)
  }
  return songs
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

async function createFreshFromSeed(
  catalog: readonly SongSeedEntry[],
  fetchSongJson: FetchSongJson
): Promise<SetlistStoreSnapshot> {
  const songs = await librarySongsFromSeedCatalog(catalog, fetchSongJson)
  const initial = createInitialSnapshot(songs)
  writeRaw(initial)
  return initial
}

export type EnsureSongLibraryOptions = {
  catalog?: readonly SongSeedEntry[]
  fetchSongJson?: FetchSongJson
}

let hydrationInFlight: Promise<SetlistStoreSnapshot> | null = null

/**
 * Loads v2 from storage, migrates v1, or builds a new library from the seed catalog.
 * Safe to call multiple times; concurrent calls share one in-flight migration.
 */
export function ensureSongLibraryHydrated(
  options: EnsureSongLibraryOptions = {}
): Promise<SetlistStoreSnapshot> {
  const catalog = options.catalog ?? SONGS
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
      return createFreshFromSeed(catalog, fetchSongJson)
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

/** Appends an empty setlist, sets it active, and persists. */
export function createEmptySetlist(): { id: string } {
  const snap = getSnapshot()
  const id = newSetlistId()
  const next = repairSnapshot({
    ...snap,
    setlists: [...snap.setlists, { id, name: NEW_SETLIST_DEFAULT_NAME, songIds: [] }],
    activeSetlistId: id,
  })
  writeRaw(next)
  return { id }
}

/** Updates a setlist display name (trimmed). Returns false if id is unknown or name is empty after trim. */
export function renameSetlist(id: string, name: string): boolean {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) return false
  const snap = getSnapshot()
  if (!snap.setlists.some((s) => s.id === id)) return false
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) => (s.id === id ? { ...s, name: trimmed } : s)),
  }
  writeRaw(repairSnapshot(next))
  return true
}

/** Removes a setlist. Clears activeSetlistId when the active setlist is deleted. Returns false if id is unknown. */
export function deleteSetlist(id: string): boolean {
  const snap = getSnapshot()
  if (!snap.setlists.some((s) => s.id === id)) return false
  const nextSetlists = snap.setlists.filter((s) => s.id !== id)
  let activeSetlistId = snap.activeSetlistId
  if (activeSetlistId === id) {
    activeSetlistId = ''
  }
  const next = { ...snap, setlists: nextSetlists, activeSetlistId }
  writeRaw(repairSnapshot(next))
  return true
}

/** Appends `songId` if it exists in the library and is not already in the setlist. */
export function addSongToSetlist(setlistId: string, songId: string): boolean {
  if (!setlistId || !songId) return false
  const snap = getSnapshot()
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return false
  const known = new Set(snap.songLibrary.songs.map((s) => s.id))
  if (!known.has(songId)) return false
  if (setlist.songIds.includes(songId)) return false
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) =>
      s.id === setlistId ? { ...s, songIds: [...s.songIds, songId] } : s
    ),
  }
  writeRaw(repairSnapshot(next))
  return true
}

/** Removes `songId` from the setlist’s ordered ids. Returns false if the setlist or id is missing. */
export function removeSongFromSetlist(setlistId: string, songId: string): boolean {
  if (!setlistId || !songId) return false
  const snap = getSnapshot()
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return false
  if (!setlist.songIds.includes(songId)) return false
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) =>
      s.id === setlistId ? { ...s, songIds: s.songIds.filter((id) => id !== songId) } : s
    ),
  }
  writeRaw(repairSnapshot(next))
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
  if (!setlistId) return false
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) return false
  const snap = getSnapshot()
  const setlist = snap.setlists.find((s) => s.id === setlistId)
  if (!setlist) return false
  const n = setlist.songIds.length
  if (fromIndex < 0 || fromIndex >= n) return false
  if (toIndex < 0 || toIndex >= n) return false
  if (fromIndex === toIndex) return true
  const nextIds = [...setlist.songIds]
  const [removed] = nextIds.splice(fromIndex, 1)
  nextIds.splice(toIndex, 0, removed!)
  const next = {
    ...snap,
    setlists: snap.setlists.map((s) => (s.id === setlistId ? { ...s, songIds: nextIds } : s)),
  }
  writeRaw(repairSnapshot(next))
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
