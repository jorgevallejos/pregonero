/**
 * The played log (session-only).
 *
 * One entry per performance, in performance order, duplicates preserved: a song played twice
 * appears twice. A song is appended when it **finishes** — either at the concert transition to
 * the next song, or at the end-of-song Unarm tap. It is never appended when a song starts.
 *
 * This is what prefills the debrief and SABAM MyPlaylist, both of which need the order and the
 * times, not a set of ids.
 */

const KEY_PLAYED_SONGS = 'liveLyricPlayedSongIds'

/** One performance. Times are ISO 8601, or `null` when the real time is not known. */
export type PlayedSongEntry = {
  songId: string
  startedAt: string | null
  endedAt: string | null
}

function getStorage(): Storage | undefined {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
}

/**
 * Reads one stored element. A bare string is the pre-v0.13 format — a deduplicated array of song
 * ids with no order that meant anything and no times — and migrates to an entry with both times
 * unknown. An invented time would be worse than an admitted gap.
 */
function toEntry(value: unknown): PlayedSongEntry | null {
  if (typeof value === 'string') return { songId: value, startedAt: null, endedAt: null }
  if (typeof value !== 'object' || value === null) return null
  const { songId, startedAt, endedAt } = value as Record<string, unknown>
  if (typeof songId !== 'string') return null
  return {
    songId,
    startedAt: typeof startedAt === 'string' ? startedAt : null,
    endedAt: typeof endedAt === 'string' ? endedAt : null,
  }
}

/** The performances of this session, in the order they happened. */
export function getPlayedSongs(): PlayedSongEntry[] {
  const storage = getStorage()
  if (!storage) return []
  const raw = storage.getItem(KEY_PLAYED_SONGS)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(toEntry).filter((e): e is PlayedSongEntry => e !== null)
  } catch {
    return []
  }
}

/** Whether this song has been performed at least once this session. */
export function hasPlayedSong(songId: string): boolean {
  return getPlayedSongs().some((e) => e.songId === songId)
}

/**
 * Records a finished performance. **Not idempotent, deliberately**: a repeat is a second
 * performance and must appear twice, or the debrief cannot say what actually happened.
 *
 * `endedAt` defaults to now, which is always real because every call site fires at song end.
 * `startedAt` is the moment the song was loaded, and is `null` when that is not known.
 */
export function addPlayedSong(
  songId: string,
  times: { startedAt?: string | null; endedAt?: string | null } = {}
): void {
  const storage = getStorage()
  if (!storage) return
  const entry: PlayedSongEntry = {
    songId,
    startedAt: times.startedAt ?? null,
    endedAt: times.endedAt ?? new Date().toISOString(),
  }
  storage.setItem(KEY_PLAYED_SONGS, JSON.stringify([...getPlayedSongs(), entry]))
}

/**
 * The setlist is played once, and it is over as soon as its last song has been performed.
 *
 * Derived from the played log rather than stored alongside `armed`, so the two cannot disagree.
 * `orderedSongIds` is the *readable* setlist: `getOrderedSongsForActiveSetlist` already drops
 * references whose file could not be read, so a trailing unreadable reference — `libertad.json`
 * is the live example — cannot wedge a gig in a state that never completes.
 *
 * An empty setlist is not done; there is nothing to have finished.
 */
export function isSetlistComplete(
  orderedSongIds: readonly string[],
  played: readonly PlayedSongEntry[] = getPlayedSongs()
): boolean {
  const last = orderedSongIds[orderedSongIds.length - 1]
  if (last === undefined) return false
  return played.some((e) => e.songId === last)
}
