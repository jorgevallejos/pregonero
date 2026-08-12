import {
  getCurrentSongId,
  parseSongFile,
  parseSongRecordFromUnknown,
  setBlank,
  setCurrentSongId,
  setCurrentSongTitle,
  setSongIndex,
  setSongLines,
  resetLoadedSongState,
  tryParsePersistedSongItemsArray,
  type ParsedSongFile,
  type SongItem,
  type TimelineEntry,
  type MediaFile,
} from './songState'

export const SETLIST_STORE_KEY = 'liveLyricSetlistStore'
/** v6: media field is a single MediaFile (was SongMedia { big?, small? } in v5). */
export const SETLIST_STORE_VERSION = 6
/** v5 snapshots (SongMedia { big?, small? }) are migrated to v6 on load. */
export const SETLIST_STORE_VERSION_V5 = 5
/** v4 snapshots (flat media object) are migrated on load. */
export const SETLIST_STORE_VERSION_V4 = 4
/** v3 snapshots (tempo.meter) are migrated on load. */
export const SETLIST_STORE_VERSION_V3 = 3
/** v2 snapshots (full lyrics, optional intro_cues) are migrated on load. */
export const SETLIST_STORE_VERSION_V2 = 2
/** v1 snapshots (metadata + path only) are migrated on load. */
export const SETLIST_STORE_VERSION_LEGACY = 1
export const DEFAULT_SETLIST_ID = 'default-setlist'

/** Catalog entry shape (e.g. for tests or future import); runtime library is persisted v2 only. */
export type SongSeedEntry = { readonly id: string; readonly title: string; readonly path: string }

/** Tempo information for count-in and beat pulse display. All fields are in the performer view only. */
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

/** One row in the persisted internal song library (source of truth after hydration). */
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
  /** Timing entries in seconds, one per item (including sections). Written by record-timeline mode. */
  timeline?: TimelineEntry[]
  /** Optional media file (video or audio). */
  media?: MediaFile
  /** Optional tempo for count-in and beat-pulse display in the performer view. */
  tempo?: SongTempo
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

function isMediaFileShape(m: unknown): boolean {
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return false
  const f = m as Record<string, unknown>
  if (f.type !== 'video' && f.type !== 'audio') return false
  if (typeof f.src !== 'string' || (f.src as string).trim().length === 0) return false
  if (f.trimStart !== undefined && (typeof f.trimStart !== 'number' || (f.trimStart as number) < 0)) return false
  if (f.offset !== undefined && (typeof f.offset !== 'number' || (f.offset as number) < 0)) return false
  return true
}

function isLibrarySongCommonFields(o: Record<string, unknown>): boolean {
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.title)) return false
  if (tryParsePersistedSongItemsArray(o.items) === null) return false
  if (o.notes !== undefined && typeof o.notes !== 'string') return false
  if (o.title_translations !== undefined) {
    if (typeof o.title_translations !== 'object' || o.title_translations === null || Array.isArray(o.title_translations)) return false
    if (!Object.values(o.title_translations as Record<string, unknown>).every((v) => typeof v === 'string')) return false
  }
  if (o.intro !== undefined) {
    if (typeof o.intro !== 'object' || o.intro === null || Array.isArray(o.intro)) return false
    if (!Object.values(o.intro as Record<string, unknown>).every((v) => typeof v === 'string')) return false
  }
  if (o.timeline !== undefined) {
    if (!Array.isArray(o.timeline)) return false
    if (
      !(o.timeline as unknown[]).every(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).start === 'number' &&
          typeof (entry as Record<string, unknown>).end === 'number'
      )
    )
      return false
  }
  if (o.tempo !== undefined) {
    if (o.tempo === null || typeof o.tempo !== 'object' || Array.isArray(o.tempo)) return false
    const t = o.tempo as Record<string, unknown>
    if (typeof t.bpm !== 'number' || (t.bpm as number) <= 0) return false
    if (typeof t.numerator !== 'number' || !Number.isInteger(t.numerator) || (t.numerator as number) <= 0) return false
    if (typeof t.denominator !== 'number' || !Number.isInteger(t.denominator) || (t.denominator as number) <= 0) return false
    if (t.countInBars !== undefined && (typeof t.countInBars !== 'number' || !Number.isInteger(t.countInBars) || (t.countInBars as number) <= 0)) return false
  }
  return true
}

function isLibrarySong(v: unknown): v is LibrarySong {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isLibrarySongCommonFields(o)) return false
  if (o.media !== undefined && !isMediaFileShape(o.media)) return false
  return true
}

/** Validates a v5 library song (SongMedia { big?, small? } format). For migration only. */
function isLibrarySongV5(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isLibrarySongCommonFields(o)) return false
  if (o.media !== undefined) {
    if (o.media === null || typeof o.media !== 'object' || Array.isArray(o.media)) return false
    const m = o.media as Record<string, unknown>
    if (m.big !== undefined && !isMediaFileShape(m.big)) return false
    if (m.small !== undefined && !isMediaFileShape(m.small)) return false
    if (m.big === undefined && m.small === undefined) return false
  }
  return true
}

/** Validates a v3 library song (meter tempo, flat media). For migration only. */
function isLibrarySongV3(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.title)) return false
  if (tryParsePersistedSongItemsArray(o.items) === null) return false
  if (o.notes !== undefined && typeof o.notes !== 'string') return false
  if (o.title_translations !== undefined) {
    if (typeof o.title_translations !== 'object' || o.title_translations === null || Array.isArray(o.title_translations)) return false
    if (!Object.values(o.title_translations as Record<string, unknown>).every((v) => typeof v === 'string')) return false
  }
  if (o.intro !== undefined) {
    if (typeof o.intro !== 'object' || o.intro === null || Array.isArray(o.intro)) return false
    if (!Object.values(o.intro as Record<string, unknown>).every((v) => typeof v === 'string')) return false
  }
  if (o.timeline !== undefined) {
    if (!Array.isArray(o.timeline)) return false
    if (
      !(o.timeline as unknown[]).every(
        (entry) =>
          entry !== null &&
          typeof entry === 'object' &&
          typeof (entry as Record<string, unknown>).start === 'number' &&
          typeof (entry as Record<string, unknown>).end === 'number'
      )
    )
      return false
  }
  if (o.media !== undefined && !isMediaFileShape(o.media)) return false
  if (o.tempo !== undefined) {
    if (o.tempo === null || typeof o.tempo !== 'object' || Array.isArray(o.tempo)) return false
    const t = o.tempo as Record<string, unknown>
    if (typeof t.bpm !== 'number' || (t.bpm as number) <= 0) return false
    // v3 uses meter (positive integer)
    if (typeof t.meter !== 'number' || !Number.isInteger(t.meter) || (t.meter as number) <= 0) return false
    if (t.countInBars !== undefined && (typeof t.countInBars !== 'number' || !Number.isInteger(t.countInBars) || (t.countInBars as number) <= 0)) return false
  }
  return true
}

/** Validates a v4 library song (numerator/denominator tempo, flat media). For migration only. */
function isLibrarySongV4(v: unknown): boolean {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isLibrarySongCommonFields(o)) return false
  if (o.media !== undefined && !isMediaFileShape(o.media)) return false
  return true
}

function isSetlist(v: unknown): v is Setlist {
  if (v === null || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  if (!isNonEmptyString(o.id) || !isNonEmptyString(o.name)) return false
  if (!Array.isArray(o.songIds)) return false
  return o.songIds.every((id) => isNonEmptyString(id))
}

function parseSnapshotShape(
  raw: unknown,
  version: number
): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== version) return null
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLibrarySong)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version,
    songLibrary: { songs: lib.songs as LibrarySong[] },
    setlists: o.setlists as Setlist[],
    activeSetlistId: o.activeSetlistId,
  }
}

function parseSnapshotLatest(raw: unknown): SetlistStoreSnapshot | null {
  return parseSnapshotShape(raw, SETLIST_STORE_VERSION)
}

/** Reads a v5 snapshot (SongMedia { big?, small? }) for migration purposes only. */
function parseSnapshotV5ForMigration(raw: unknown): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== SETLIST_STORE_VERSION_V5) return null
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLibrarySongV5)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version: SETLIST_STORE_VERSION_V5,
    songLibrary: { songs: lib.songs as LibrarySong[] },
    setlists: o.setlists as Setlist[],
    activeSetlistId: o.activeSetlistId,
  }
}

/** Reads an old v4 snapshot (flat media) for migration purposes only. */
function parseSnapshotV4ForMigration(raw: unknown): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== SETLIST_STORE_VERSION_V4) return null
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLibrarySongV4)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version: SETLIST_STORE_VERSION_V4,
    songLibrary: { songs: lib.songs as LibrarySong[] },
    setlists: o.setlists as Setlist[],
    activeSetlistId: o.activeSetlistId,
  }
}

/** Reads an old v3 snapshot (meter tempo, flat media) for migration purposes only. */
function parseSnapshotV3ForMigration(raw: unknown): SetlistStoreSnapshot | null {
  if (raw === null || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.version !== SETLIST_STORE_VERSION_V3) return null
  if (o.songLibrary === null || typeof o.songLibrary !== 'object') return null
  const lib = o.songLibrary as Record<string, unknown>
  if (!Array.isArray(lib.songs) || !lib.songs.every(isLibrarySongV3)) return null
  if (!Array.isArray(o.setlists) || !o.setlists.every(isSetlist)) return null
  if (typeof o.activeSetlistId !== 'string') return null
  return {
    version: SETLIST_STORE_VERSION_V3,
    songLibrary: { songs: lib.songs as LibrarySong[] },
    setlists: o.setlists as Setlist[],
    activeSetlistId: o.activeSetlistId,
  }
}

function parseSnapshotV2(raw: unknown): SetlistStoreSnapshot | null {
  return parseSnapshotShape(raw, SETLIST_STORE_VERSION_V2)
}

/** Collapses a v5 SongMedia object to a single MediaFile (big preferred, else small). */
function collapseSongMediaToMediaFile(m: Record<string, unknown>): MediaFile | undefined {
  return (m.big as MediaFile | undefined) ?? (m.small as MediaFile | undefined)
}

function migrateV5ToV6(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  const songs: LibrarySong[] = snap.songLibrary.songs.map((song) => {
    if (song.media === undefined) return song
    const m = song.media as unknown as Record<string, unknown>
    const collapsed = collapseSongMediaToMediaFile(m)
    if (collapsed === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { media: _m, ...rest } = song
      return rest
    }
    return { ...song, media: collapsed }
  })
  const next: SetlistStoreSnapshot = {
    ...snap,
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs },
  }
  const repaired = repairSnapshot(next)
  writeRaw(repaired)
  return repaired
}

function migrateV4ToV6(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  // v4 already has flat media (same shape as v6) — just bump the version
  const next: SetlistStoreSnapshot = {
    ...snap,
    version: SETLIST_STORE_VERSION,
  }
  const repaired = repairSnapshot(next)
  writeRaw(repaired)
  return repaired
}

function migrateV3ToV6(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  const songs: LibrarySong[] = snap.songLibrary.songs.map((song) => {
    let updated = song
    // Migrate meter → numerator/denominator
    if (updated.tempo !== undefined) {
      const t = updated.tempo as unknown as Record<string, unknown>
      if (typeof t.meter === 'number' && t.numerator === undefined) {
        const newTempo: SongTempo = { bpm: t.bpm as number, numerator: t.meter, denominator: 4 }
        if (t.countInBars !== undefined) newTempo.countInBars = t.countInBars as number
        updated = { ...updated, tempo: newTempo }
      }
    }
    // v3 has flat media (same shape as v6) — no wrapping needed
    return updated
  })
  const next: SetlistStoreSnapshot = {
    ...snap,
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs },
  }
  const repaired = repairSnapshot(next)
  writeRaw(repaired)
  return repaired
}

function migrateV2ToV3(snap: SetlistStoreSnapshot): SetlistStoreSnapshot {
  const songs: LibrarySong[] = snap.songLibrary.songs.map((song) => {
    const clean: LibrarySong = { id: song.id, title: song.title, items: song.items }
    if (song.notes !== undefined) clean.notes = song.notes
    return clean
  })
  const next: SetlistStoreSnapshot = {
    ...snap,
    version: SETLIST_STORE_VERSION,
    songLibrary: { songs },
  }
  const repaired = repairSnapshot(next)
  writeRaw(repaired)
  return repaired
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
    ...(s.title_translations !== undefined && Object.keys(s.title_translations).length > 0 ? { title_translations: s.title_translations } : {}),
    ...(s.intro !== undefined && Object.keys(s.intro).length > 0 ? { intro: s.intro } : {}),
    ...(s.media !== undefined ? { media: { ...s.media } } : {}),
    ...(s.tempo !== undefined ? { tempo: { ...s.tempo } } : {}),
    ...(s.timeline !== undefined ? { timeline: s.timeline.map((entry) => ({ ...entry })) } : {}),
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
  const parsed = parseSnapshotLatest(readRaw())
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

/** Structural equality for draft vs entry snapshot (JSON-serializable). */
export function areSetlistStoreSnapshotsEqual(
  a: SetlistStoreSnapshot,
  b: SetlistStoreSnapshot
): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Setlist display names that include `songId` in the snapshot’s draft order. */
export function getSetlistNamesContainingSongInSnapshot(
  snap: SetlistStoreSnapshot,
  songId: string
): string[] {
  if (!songId) return []
  return snap.setlists.filter((sl) => sl.songIds.includes(songId)).map((sl) => sl.name)
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
    if (parsed.media !== undefined) {
      lib.media = parsed.media
    }
    if (parsed.tempo !== undefined) {
      lib.tempo = parsed.tempo
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
 * Loads v6 from storage, migrates older versions, or persists an empty v6 snapshot.
 * Migration chain: v1 → v6, v2 → v6, v3 → v6, v4 → v6, v5 → v6.
 * Safe to call multiple times; concurrent calls share one in-flight migration.
 */
export function ensureSongLibraryHydrated(
  options: EnsureSongLibraryOptions = {}
): Promise<SetlistStoreSnapshot> {
  const fetchSongJson = options.fetchSongJson ?? defaultFetchSongJson

  const existing = loadSetlistStore()
  if (existing) {
    return Promise.resolve(existing)
  }

  if (!hydrationInFlight) {
    hydrationInFlight = (async () => {
      const raw = readRaw()
      if (raw !== null && typeof raw === 'object') {
        const v5 = parseSnapshotV5ForMigration(raw)
        if (v5) {
          return migrateV5ToV6(v5)
        }
        const v4 = parseSnapshotV4ForMigration(raw)
        if (v4) {
          return migrateV4ToV6(v4)
        }
        const v3 = parseSnapshotV3ForMigration(raw)
        if (v3) {
          return migrateV3ToV6(v3)
        }
        const v2 = parseSnapshotV2(raw)
        if (v2) {
          return migrateV2ToV3(v2)
        }
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
    ...(song.title_translations !== undefined && Object.keys(song.title_translations).length > 0 ? { title_translations: song.title_translations } : {}),
    ...(song.intro !== undefined && Object.keys(song.intro).length > 0 ? { intro: song.intro } : {}),
    ...(song.media !== undefined ? { media: { ...song.media } } : {}),
    ...(song.tempo !== undefined ? { tempo: { ...song.tempo } } : {}),
    ...(song.timeline !== undefined ? { timeline: song.timeline.map((entry) => ({ ...entry })) } : {}),
  }
  return libSong
}

/** Returns the media file for a song (single file per song in v6 schema). */
export function getActiveMediaFile(song: LibrarySong): MediaFile | undefined {
  return song.media
}

/** Pure snapshot update: set (or clear) the media field for a library song. Returns null if songId unknown. */
export function patchSongMediaInSnapshot(
  snap: SetlistStoreSnapshot,
  songId: string,
  media: MediaFile | undefined
): SetlistStoreSnapshot | null {
  if (!snap.songLibrary.songs.some((s) => s.id === songId)) return null
  const songs = snap.songLibrary.songs.map((s) => {
    if (s.id !== songId) return s
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { media: _, ...rest } = s
    return media !== undefined ? { ...rest, media } : rest
  })
  return { ...snap, songLibrary: { songs } }
}

/** Pure snapshot update: set (or clear) the timeline field for a library song. Returns null if songId unknown. */
export function patchSongTimelineInSnapshot(
  snap: SetlistStoreSnapshot,
  songId: string,
  timeline: TimelineEntry[] | undefined
): SetlistStoreSnapshot | null {
  if (!snap.songLibrary.songs.some((s) => s.id === songId)) return null
  const songs = snap.songLibrary.songs.map((s) => {
    if (s.id !== songId) return s
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { timeline: _, ...rest } = s
    return timeline !== undefined ? { ...rest, timeline } : rest
  })
  return { ...snap, songLibrary: { songs } }
}

/**
 * Parses a standalone timeline JSON file (format: `{ "timeline": [...] }`).
 * Each entry must have numeric non-negative monotonic `start` and `end`.
 * Throws with a descriptive message on any parse or validation error.
 */
export function parseTimelineFromJsonText(text: string): TimelineEntry[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Timeline file must be a JSON object with a "timeline" key')
  }
  const obj = raw as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(obj, 'timeline') || !Array.isArray(obj.timeline)) {
    throw new Error('Timeline file must contain a "timeline" array')
  }
  const arr = obj.timeline as unknown[]
  const entries: TimelineEntry[] = []
  let previousEnd = -Infinity
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`timeline[${i}]: must be an object with "start" and "end"`)
    }
    const entry = item as Record<string, unknown>
    const { start, end } = entry
    if (typeof start !== 'number' || typeof end !== 'number') {
      throw new Error(`timeline[${i}]: "start" and "end" must be numbers`)
    }
    if (start < 0 || end < 0) {
      throw new Error(`timeline[${i}]: times must be non-negative`)
    }
    if (start < previousEnd) {
      throw new Error(`timeline[${i}]: times must be monotonic (start >= previous end)`)
    }
    entries.push({ start, end })
    previousEnd = end
  }
  return entries
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

/**
 * Loads the first song from the active setlist into setup state.
 * When there is no active setlist or it has no songs, clears the loaded song.
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
  if (parsed.title_translations !== undefined) {
    song.title_translations = parsed.title_translations
  }
  if (parsed.intro !== undefined) {
    song.intro = parsed.intro
  }
  if (parsed.media !== undefined) {
    song.media = parsed.media
  }
  if (parsed.tempo !== undefined) {
    song.tempo = parsed.tempo
  }
  if (parsed.timeline !== undefined) {
    song.timeline = parsed.timeline
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

/**
 * Writes a timeline onto the library song with the given id and persists.
 * Returns false when the store is unreadable or the id is not found.
 */
export function updateSongTimeline(songId: string, timeline: TimelineEntry[]): boolean {
  if (!songId) return false
  const snap = loadSetlistStore()
  if (!snap) return false
  const idx = snap.songLibrary.songs.findIndex((s) => s.id === songId)
  if (idx === -1) return false
  const updatedSongs = snap.songLibrary.songs.map((s, i) =>
    i === idx ? { ...s, timeline } : s
  )
  writeRaw({ ...snap, songLibrary: { songs: updatedSongs } })
  return true
}
