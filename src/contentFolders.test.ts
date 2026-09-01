/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { joinPath } from './paths'
import {
  getMediaFolder,
  getSongFilesFolder,
  getSongsFolder,
  resolveSongPath,
  setMediaFolder,
  setSongsFolder,
  songRefPathFor,
  MEDIA_FOLDER_KEY,
  SONGS_FOLDER_KEY,
} from './contentFolders'

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

describe('the configured folders', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage())
  })

  it('remembers each folder on its own key, and forgets on null', () => {
    setSongsFolder('/Users/j/Chango Pepper/songs')
    setMediaFolder('/Users/j/Chango Pepper/songs/video')
    expect(localStorage.getItem(SONGS_FOLDER_KEY)).toBe('/Users/j/Chango Pepper/songs')
    expect(localStorage.getItem(MEDIA_FOLDER_KEY)).toBe('/Users/j/Chango Pepper/songs/video')
    expect(getSongsFolder()).toBe('/Users/j/Chango Pepper/songs')
    expect(getMediaFolder()).toBe('/Users/j/Chango Pepper/songs/video')

    setSongsFolder(null)
    expect(getSongsFolder()).toBeNull()
    expect(getMediaFolder()).not.toBeNull()
  })

  it('reads an unset folder as none rather than as an empty path', () => {
    expect(getSongsFolder()).toBeNull()
    localStorage.setItem(SONGS_FOLDER_KEY, '')
    expect(getSongsFolder()).toBeNull()
  })

  it('joins a folder and a name, tolerating a trailing slash and a leading ./', () => {
    expect(joinPath('/a/b', 'c.mp4')).toBe('/a/b/c.mp4')
    expect(joinPath('/a/b/', 'c.mp4')).toBe('/a/b/c.mp4')
    expect(joinPath('/a/b', './c.mp4')).toBe('/a/b/c.mp4')
    expect(joinPath('/a/b', 'clips/c.mp4')).toBe('/a/b/clips/c.mp4')
  })

  describe('a song reference', () => {
    it('is returned untouched when it is already absolute — nothing migrates', () => {
      setSongsFolder('/songs')
      expect(resolveSongPath('/elsewhere/libertad.json')).toBe('/elsewhere/libertad.json')
    })

    it('resolves a bare name against <songs>/song-performance, not the songs root', () => {
      setSongsFolder('/songs')
      expect(resolveSongPath('libertad.json')).toBe('/songs/song-performance/libertad.json')
    })

    it('hands a bare name back unchanged with no songs folder — nothing that worked stops working', () => {
      expect(resolveSongPath('libertad.json')).toBe('libertad.json')
    })
  })

  describe('remembering a chosen song file', () => {
    it('keeps only the name when the file sits inside <songs>/song-performance', () => {
      setSongsFolder('/songs')
      expect(songRefPathFor('/songs/song-performance/libertad.json')).toBe('libertad.json')
      expect(songRefPathFor('/songs/song-performance/old/libertad.json')).toBe(
        'old/libertad.json'
      )
    })

    it('keeps the whole path when it does not, and when no folder is chosen', () => {
      setSongsFolder('/songs')
      expect(songRefPathFor('/elsewhere/libertad.json')).toBe('/elsewhere/libertad.json')
      // The songs root itself is not where song files live any more: a file sitting there is
      // outside the folder the suite reads, and is remembered by its whole path.
      expect(songRefPathFor('/songs/libertad.json')).toBe('/songs/libertad.json')
      setSongsFolder(null)
      expect(songRefPathFor('/songs/song-performance/libertad.json')).toBe(
        '/songs/song-performance/libertad.json'
      )
    })

    it('does not mistake a sibling folder with the same prefix for the song files folder', () => {
      setSongsFolder('/songs')
      expect(songRefPathFor('/songs/song-performance-old/libertad.json')).toBe(
        '/songs/song-performance-old/libertad.json'
      )
    })
  })

  describe('the song files folder', () => {
    it('is song-performance inside the catalogue', () => {
      setSongsFolder('/Users/j/Chango Pepper/songs')
      expect(getSongFilesFolder()).toBe('/Users/j/Chango Pepper/songs/song-performance')
    })

    it('is null when there is no catalogue yet', () => {
      expect(getSongFilesFolder()).toBeNull()
    })
  })
})

describe('the media folder has no default', () => {
  beforeEach(() => localStorage.clear())

  // **The `<songs>/audio` default is gone** (2026-09-01). Audio and video are not one thing called
  // media: alignment audio is consumed once at setup and never needed again, while performance
  // media must resolve at arming. Defaulting to the audio folder quietly made the catalogue
  // load-bearing for media, so a machine keeping video elsewhere got a resolution failure it never
  // agreed to.
  it('is null when nothing has been chosen, songs folder or not', () => {
    expect(getMediaFolder()).toBeNull()
    localStorage.setItem(SONGS_FOLDER_KEY, '/Users/j/songs')
    expect(getMediaFolder()).toBeNull()
  })

  it('is exactly what was chosen', () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/Users/j/songs')
    setMediaFolder('/Volumes/Passport/media')
    expect(getMediaFolder()).toBe('/Volumes/Passport/media')
  })

  it('clearing a choice returns to nothing, and absence is reported rather than guessed at', () => {
    localStorage.setItem(SONGS_FOLDER_KEY, '/Users/j/songs')
    setMediaFolder('/elsewhere')
    setMediaFolder(null)
    expect(getMediaFolder()).toBeNull()
    expect(localStorage.getItem(MEDIA_FOLDER_KEY)).toBeNull()
  })
})
