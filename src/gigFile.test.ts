import { describe, it, expect } from 'vitest'
import {
  GIG_VERSION,
  createGigFile,
  gigDateFromFolderPath,
  gigIdFromFolderPath,
  parseGigFile,
  serializeGigFile,
  setlistMatches,
  withSetlist,
} from './gigFile'

describe('gigIdFromFolderPath', () => {
  it('is the folder name', () => {
    expect(gigIdFromFolderPath('/Users/j/gigs/2026-09-12-bar-eduard')).toBe('2026-09-12-bar-eduard')
  })

  it('ignores a trailing slash', () => {
    expect(gigIdFromFolderPath('/Users/j/gigs/2026-09-12-bar-eduard/')).toBe(
      '2026-09-12-bar-eduard'
    )
  })
})

describe('gigDateFromFolderPath', () => {
  it('reads a leading ISO date', () => {
    expect(gigDateFromFolderPath('/gigs/2026-09-12-bar-eduard')).toBe('2026-09-12')
  })

  it('is null when the folder does not lead with one', () => {
    expect(gigDateFromFolderPath('/gigs/bar-eduard')).toBeNull()
  })
})

describe('parseGigFile', () => {
  const minimal = JSON.stringify({ gigVersion: 1, id: '2026-09-12-bar-eduard' })

  it('accepts a file carrying only identity — the state it is in from step 2', () => {
    const gig = parseGigFile(minimal)
    expect(gig.id).toBe('2026-09-12-bar-eduard')
    expect(gig.songs).toBeUndefined()
    expect(gig.setlist).toBeUndefined()
  })

  it('reads the whole shape when it is there', () => {
    const gig = parseGigFile(
      JSON.stringify({
        gigVersion: 1,
        id: 'g',
        date: '2026-09-12',
        venue: { name: 'Bar Eduard', city: 'Ghent' },
        visuals: './visuals.json',
        songs: [{ id: 'luz-y-sal', title: 'Luz y sal', file: '../../songs/luz-y-sal.json' }],
        setlist: ['luz-y-sal'],
      })
    )
    expect(gig.venue).toEqual({ name: 'Bar Eduard', city: 'Ghent' })
    expect(gig.songs).toEqual([
      { id: 'luz-y-sal', title: 'Luz y sal', file: '../../songs/luz-y-sal.json' },
    ])
    expect(gig.setlist).toEqual(['luz-y-sal'])
  })

  it('refuses a version it does not understand rather than guessing', () => {
    expect(() => parseGigFile(JSON.stringify({ gigVersion: 99, id: 'g' }))).toThrow(/version 99/)
  })

  it('refuses a file with no id, because visuals.json is checked against it', () => {
    expect(() => parseGigFile(JSON.stringify({ gigVersion: 1 }))).toThrow(/no id/)
  })

  it('refuses malformed JSON by name', () => {
    expect(() => parseGigFile('{')).toThrow(/not valid JSON/)
  })

  it('drops song entries with no id instead of failing the whole file', () => {
    const gig = parseGigFile(
      JSON.stringify({ gigVersion: 1, id: 'g', songs: [{ id: 'a' }, { title: 'no id' }] })
    )
    expect(gig.songs).toEqual([{ id: 'a' }])
  })
})

describe('serializeGigFile', () => {
  it('round-trips', () => {
    const gig = parseGigFile(
      JSON.stringify({ gigVersion: 1, id: 'g', date: '2026-09-12', setlist: ['a'] })
    )
    expect(parseGigFile(serializeGigFile(gig))).toEqual(gig)
  })

  it('omits fields that are not there yet rather than writing nulls', () => {
    const text = serializeGigFile({ gigVersion: GIG_VERSION, id: 'g' })
    expect(text).not.toContain('venue')
    expect(text).not.toContain('setlist')
    expect(text.endsWith('\n')).toBe(true)
  })
})

describe('createGigFile', () => {
  it('takes its identity from the folder and its date from the folder name', () => {
    const gig = createGigFile('/gigs/2026-09-12-bar-eduard', '2026-08-26')
    expect(gig).toEqual({
      gigVersion: 1,
      id: '2026-09-12-bar-eduard',
      date: '2026-09-12',
      visuals: './visuals.json',
    })
  })

  it('falls back to today when the folder name carries no date', () => {
    expect(createGigFile('/gigs/bar-eduard', '2026-08-26').date).toBe('2026-08-26')
  })

  it('invents no venue', () => {
    expect(createGigFile('/gigs/bar-eduard', '2026-08-26').venue).toBeUndefined()
  })
})

describe('withSetlist', () => {
  const gig = { gigVersion: GIG_VERSION, id: 'g' }
  const songs = [
    { id: 'a', title: 'A', path: '/songs/a.json' },
    { id: 'b', title: 'B', path: '/songs/b.json' },
  ]

  it('writes the repertoire and the order as two fields', () => {
    const next = withSetlist(gig, songs)
    expect(next.songs).toEqual([
      { id: 'a', title: 'A', file: '/songs/a.json' },
      { id: 'b', title: 'B', file: '/songs/b.json' },
    ])
    expect(next.setlist).toEqual(['a', 'b'])
  })

  it('carries the title Muralista names the song by', () => {
    expect(withSetlist(gig, songs).songs?.[0]?.title).toBe('A')
  })

  it('leaves everything else alone', () => {
    const withVenue = { ...gig, venue: { name: 'Bar Eduard' } }
    expect(withSetlist(withVenue, songs).venue).toEqual({ name: 'Bar Eduard' })
  })

  it('setlistMatches says when a write would change nothing', () => {
    expect(setlistMatches(gig, songs)).toBe(false)
    expect(setlistMatches(withSetlist(gig, songs), songs)).toBe(true)
  })

  it('notices a reorder', () => {
    const reordered = [songs[1]!, songs[0]!]
    expect(setlistMatches(withSetlist(gig, songs), reordered)).toBe(false)
  })
})
