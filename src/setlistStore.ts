import { SONGS } from './songs'

export const SETLIST_STORE_KEY = 'liveLyricSetlistStore'
export const SETLIST_STORE_VERSION = 1
export const DEFAULT_SETLIST_ID = 'default-setlist'

export type LibrarySong = { id: string; title: string; path: string }

/** Canonical song catalog persisted for the app (subset of “library” in the snapshot). */
export type SongLibrary = { songs: LibrarySong[] }

export type Setlist = { id: string; name: string; songIds: string[] }

export type SetlistStoreSnapshot = {
  version: number
  songLibrary: SongLibrary
  setlists: Setlist[]
  activeSetlistId: string
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function isLibrarySong(v: unknown): v is LibrarySong {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return isNonEmptyString(o.id) && isNonEmptyString(o.title) && isNonEmptyString(o.path)
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
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLibrarySong)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (!isNonEmptyString(o.activeSetlistId)) return null
  return {
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs: lib.songs as LibrarySong[] },
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

/** Drop unknown song ids; ensure active setlist id exists. */
function repairSnapshot(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  const known = new Set(snap.songLibrary.songs.map((s) => s.id))
  const setlists = snap.setlists.map((sl) => ({
    ...sl,
    songIds: sl.songIds.filter((id) => known.has(id)),
  }))
  let activeSetlistId = snap.activeSetlistId
  if (!setlists.some((s) => s.id === activeSetlistId)) {
    activeSetlistId = setlists[0]?.id ?? DEFAULT_SETLIST_ID
  }
  return { ...snap, setlists, activeSetlistId }
}

export function createInitialSnapshot(seed: readonly LibrarySong[]): SetlistStoreSnapshot {
  const songs = seed.map((s) => ({ ...s }))
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
  const parsed = parseSnapshot(readRaw())
  if (!parsed) return null
  return repairSnapshot(parsed)
}

export function saveSetlistStore(snapshot: SetlistStoreSnapshot): void {
  const repaired = repairSnapshot(snapshot)
  writeRaw(repaired)
}

/**
 * Ensures local storage has a setlist snapshot: loads a valid one or seeds from `seed`.
 * Idempotent when storage already holds a valid snapshot.
 */
export function bootstrapSetlistStore(
  seed: readonly LibrarySong[] = SONGS
): SetlistStoreSnapshot {
  const existing = loadSetlistStore()
  if (existing) return existing
  const initial = createInitialSnapshot(seed)
  writeRaw(initial)
  return initial
}

function getSnapshot(): SetlistStoreSnapshot {
  return bootstrapSetlistStore(SONGS)
}

export function getActiveSetlistId(): string {
  return getSnapshot().activeSetlistId
}

export function setActiveSetlistId(id: string): boolean {
  const snap = getSnapshot()
  if (!snap.setlists.some((s) => s.id === id)) return false
  if (snap.activeSetlistId === id) return true
  const next = { ...snap, activeSetlistId: id }
  writeRaw(next)
  return true
}

export function getOrderedSongsForActiveSetlist(): LibrarySong[] {
  const snap = getSnapshot()
  const byId = new Map(snap.songLibrary.songs.map((s) => [s.id, s]))
  const list = snap.setlists.find((s) => s.id === snap.activeSetlistId)
  if (!list) return []
  return list.songIds.map((id) => byId.get(id)).filter((s): s is LibrarySong => s !== undefined)
}

export function getLibrarySongById(id: string): LibrarySong | undefined {
  if (!id) return undefined
  return getSnapshot().songLibrary.songs.find((s) => s.id === id)
}
