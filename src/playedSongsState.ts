/**
 * Played song indicator state (session-only).
 * A song is marked as played only when the performer unarms at end-of-song.
 */

const KEY_PLAYED_SONG_IDS = 'liveLyricPlayedSongIds'

function getStorage(): Storage | undefined {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
}

/**
 * Returns the set of song IDs that have been marked as played this session.
 */
export function getPlayedSongIds(): string[] {
  const storage = getStorage()
  if (!storage) return []
  const raw = storage.getItem(KEY_PLAYED_SONG_IDS)
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

/**
 * Marks a song as played for this session. Idempotent (adding the same id again is safe).
 */
export function addPlayedSong(songId: string): void {
  const storage = getStorage()
  if (!storage) return
  const ids = getPlayedSongIds()
  if (ids.includes(songId)) return
  storage.setItem(KEY_PLAYED_SONG_IDS, JSON.stringify([...ids, songId]))
}
