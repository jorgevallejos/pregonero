/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setMediaFolder } from './contentFolders'
import {
  getMediaPath,
  resolveMediaPath,
  setMediaPath,
  removeMediaPath,
  validateVideoForImport,
  absolutePathToMediaUrl,
  MEDIA_PATH_STORE_KEY,
} from './mediaPathStore'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', createStorage())
})

describe('getMediaPath', () => {
  it('returns null when nothing is stored', () => {
    expect(getMediaPath('tragedia.mp4')).toBeNull()
  })

  it('returns null for empty src', () => {
    expect(getMediaPath('')).toBeNull()
  })

  it('returns the stored path after setMediaPath', () => {
    setMediaPath('tragedia.mp4', '/Users/jorge/videos/tragedia.mp4')
    expect(getMediaPath('tragedia.mp4')).toBe('/Users/jorge/videos/tragedia.mp4')
  })

  it('returns null for an unknown src when other paths exist', () => {
    setMediaPath('tragedia.mp4', '/Users/jorge/videos/tragedia.mp4')
    expect(getMediaPath('other.mp4')).toBeNull()
  })
})

describe('setMediaPath', () => {
  it('persists to localStorage under MEDIA_PATH_STORE_KEY', () => {
    setMediaPath('song.mp4', '/absolute/path/song.mp4')
    const raw = localStorage.getItem(MEDIA_PATH_STORE_KEY)
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw!) as Record<string, string>
    expect(parsed['song.mp4']).toBe('/absolute/path/song.mp4')
  })

  it('overwrites an existing path for the same src', () => {
    setMediaPath('song.mp4', '/old/path.mp4')
    setMediaPath('song.mp4', '/new/path.mp4')
    expect(getMediaPath('song.mp4')).toBe('/new/path.mp4')
  })

  it('stores multiple src→path mappings independently', () => {
    setMediaPath('a.mp4', '/path/a.mp4')
    setMediaPath('b.mp4', '/path/b.mp4')
    expect(getMediaPath('a.mp4')).toBe('/path/a.mp4')
    expect(getMediaPath('b.mp4')).toBe('/path/b.mp4')
  })

  it('does nothing for empty src', () => {
    setMediaPath('', '/path/file.mp4')
    expect(localStorage.getItem(MEDIA_PATH_STORE_KEY)).toBeNull()
  })

  it('does nothing for empty absolutePath', () => {
    setMediaPath('song.mp4', '')
    expect(getMediaPath('song.mp4')).toBeNull()
  })
})

describe('removeMediaPath', () => {
  it('removes an existing mapping', () => {
    setMediaPath('song.mp4', '/path/song.mp4')
    removeMediaPath('song.mp4')
    expect(getMediaPath('song.mp4')).toBeNull()
  })

  it('does not affect other mappings when removing one', () => {
    setMediaPath('a.mp4', '/path/a.mp4')
    setMediaPath('b.mp4', '/path/b.mp4')
    removeMediaPath('a.mp4')
    expect(getMediaPath('a.mp4')).toBeNull()
    expect(getMediaPath('b.mp4')).toBe('/path/b.mp4')
  })

  it('is a no-op for unknown src', () => {
    setMediaPath('a.mp4', '/path/a.mp4')
    removeMediaPath('unknown.mp4')
    expect(getMediaPath('a.mp4')).toBe('/path/a.mp4')
  })
})

describe('absolutePathToMediaUrl', () => {
  it('returns a media://local URL with the absolute path preserved', () => {
    expect(absolutePathToMediaUrl('/Users/jorge/cerdo.mp4')).toBe(
      'media://local/Users/jorge/cerdo.mp4'
    )
  })

  it('percent-encodes spaces in path segments', () => {
    expect(absolutePathToMediaUrl('/Users/jorge/My Videos/cerdo asado.mp4')).toBe(
      'media://local/Users/jorge/My%20Videos/cerdo%20asado.mp4'
    )
  })

  it('percent-encodes non-ASCII characters in path segments', () => {
    expect(absolutePathToMediaUrl('/Users/jorge/Música/niño.mp4')).toBe(
      'media://local/Users/jorge/M%C3%BAsica/ni%C3%B1o.mp4'
    )
  })
})

describe('validateVideoForImport', () => {
  it('returns no warnings for a well-formed mp4', () => {
    expect(validateVideoForImport('/path/video.mp4')).toEqual([])
  })

  it('returns no warnings for mp4 with file size below threshold', () => {
    expect(validateVideoForImport('/path/video.mp4', 89_000_000)).toEqual([])
  })

  it('warns on .mov extension', () => {
    expect(validateVideoForImport('/path/master.mov')).toContain('mov-or-prores')
  })

  it('warns on .MOV extension (case-insensitive)', () => {
    expect(validateVideoForImport('/path/master.MOV')).toContain('mov-or-prores')
  })

  it('does not warn for .webm extension', () => {
    expect(validateVideoForImport('/path/video.webm')).not.toContain('mov-or-prores')
  })

  it('warns on file larger than 500 MB', () => {
    expect(validateVideoForImport('/path/huge.mp4', 600_000_000)).toContain('large-file')
  })

  it('does not warn on file exactly at 500 MB', () => {
    expect(validateVideoForImport('/path/edge.mp4', 500_000_000)).not.toContain('large-file')
  })

  it('can produce both warnings at once', () => {
    const warnings = validateVideoForImport('/path/huge.mov', 700_000_000)
    expect(warnings).toContain('mov-or-prores')
    expect(warnings).toContain('large-file')
  })
})

describe('resolving a name to bytes on this machine', () => {
  it('has no answer with no link and no media folder', () => {
    expect(resolveMediaPath('chango-pepper-logo.png')).toBeNull()
  })

  it('finds a name in the media folder — which is what puts the logo back on the wall', () => {
    setMediaFolder('/vault/assets')
    expect(resolveMediaPath('chango-pepper-logo.png')).toBe('/vault/assets/chango-pepper-logo.png')
  })

  it('keeps a name that carries a subpath, as Muralista writes it', () => {
    setMediaFolder('/vault/assets')
    expect(resolveMediaPath('clips/pig.mp4')).toBe('/vault/assets/clips/pig.mp4')
  })

  it('lets an explicit link win over the folder — the override for the file that moved', () => {
    setMediaFolder('/vault/assets')
    setMediaPath('logo.png', '/elsewhere/logo-v2.png')
    expect(resolveMediaPath('logo.png')).toBe('/elsewhere/logo-v2.png')
  })

  it('has no answer for an empty name', () => {
    setMediaFolder('/vault/assets')
    expect(resolveMediaPath('')).toBeNull()
  })
})
