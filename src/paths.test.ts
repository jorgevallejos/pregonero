import { describe, it, expect } from 'vitest'
import { isAbsolutePath, joinPath, normalizePath, relativePath, resolveFrom } from './paths'

describe('posix path arithmetic', () => {
  it('knows an absolute path from a relative one', () => {
    expect(isAbsolutePath('/a/b')).toBe(true)
    expect(isAbsolutePath('a/b')).toBe(false)
    expect(isAbsolutePath('../a')).toBe(false)
  })

  it('joins, tolerating a trailing slash and a leading ./', () => {
    expect(joinPath('/a/b', 'c.mp4')).toBe('/a/b/c.mp4')
    expect(joinPath('/a/b/', 'c.mp4')).toBe('/a/b/c.mp4')
    expect(joinPath('/a/b', './c.mp4')).toBe('/a/b/c.mp4')
  })

  describe('normalising', () => {
    it('collapses . and .. inside an absolute path', () => {
      expect(normalizePath('/a/b/../c/./d')).toBe('/a/c/d')
      expect(normalizePath('/a//b')).toBe('/a/b')
    })

    it('cannot climb above the root', () => {
      expect(normalizePath('/../..')).toBe('/')
    })

    it('keeps leading .. on a relative path, because they mean up', () => {
      expect(normalizePath('../../songs/x.json')).toBe('../../songs/x.json')
      expect(normalizePath('a/../../b')).toBe('../b')
    })
  })

  describe('resolving one path from a folder', () => {
    it('walks up out of the folder when the path says to', () => {
      expect(resolveFrom('/vault/concerts/gig', '../../songs/x.json')).toBe('/vault/songs/x.json')
    })

    it('leaves an absolute path alone', () => {
      expect(resolveFrom('/vault/concerts/gig', '/elsewhere/x.json')).toBe('/elsewhere/x.json')
    })
  })

  describe('writing one path from another', () => {
    it('climbs out and back down — the form that lets a gig folder travel', () => {
      expect(relativePath('/vault/concerts/gig', '/vault/songs/x.json')).toBe('../../songs/x.json')
    })

    it('goes straight down when the target is inside', () => {
      expect(relativePath('/vault/gig', '/vault/gig/visuals.json')).toBe('visuals.json')
    })

    it('shares nothing when the roots diverge immediately', () => {
      expect(relativePath('/a/b', '/c/d')).toBe('../../c/d')
    })

    it('is "." for a folder against itself', () => {
      expect(relativePath('/a/b', '/a/b')).toBe('.')
    })
  })
})
