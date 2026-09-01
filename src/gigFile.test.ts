import { describe, it, expect } from 'vitest'
import {
  GIG_VERSION,
  createGigFile,
  gigDateFromFolderPath,
  gigIdFromFolderPath,
  hasAuthoredSetlist,
  parseGigFile,
  readGigSetlist,
  serializeGigFile,
  setlistMatches,
  withIdentity,
  withSetlist,
  withSetup,
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

/**
 * **The gig's date and venue, written down** — setup step 1, and the one step where anything is
 * typed rather than derived from a file another tool owns.
 */
describe('withIdentity', () => {
  const gig = { gigVersion: GIG_VERSION, id: '2026-09-12-bar-eduard', visuals: './visuals.json' }

  it('records the date and the venue', () => {
    const next = withIdentity(gig, {
      date: '2026-09-12',
      venue: { name: 'Bar Eduard', city: 'Ghent' },
    })
    expect(next.date).toBe('2026-09-12')
    expect(next.venue).toEqual({ name: 'Bar Eduard', city: 'Ghent' })
  })

  it('trims what was typed, so a stray space is not part of the venue’s name', () => {
    expect(withIdentity(gig, { date: ' 2026-09-12 ', venue: { name: ' Bar Eduard ' } }).venue)
      .toEqual({ name: 'Bar Eduard' })
  })

  /**
   * **Absent means *not yet*, and that is exactly what clearing a field means.** `date: ""` and
   * `venue: {}` are not states this file has, and readiness already knows how to report absence.
   */
  it('removes an emptied field rather than writing it blank', () => {
    const filled = withIdentity(gig, { date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    const cleared = withIdentity(filled, { date: '', venue: { name: '', city: '' } })
    expect('date' in cleared).toBe(false)
    expect('venue' in cleared).toBe(false)
    expect(serializeGigFile(cleared)).not.toContain('venue')
  })

  it('keeps a city with no venue name, because half an answer is still an answer', () => {
    expect(withIdentity(gig, { date: '', venue: { city: 'Ghent' } }).venue).toEqual({ city: 'Ghent' })
  })

  /**
   * **The id is born with the folder and never rewritten.** `visuals.json` records which gig it
   * maps and is checked against this, so a renamable gig is a gig whose room mapping can silently
   * stop belonging to it.
   */
  it('never touches the id, the version or the visuals pointer', () => {
    const next = withIdentity(gig, { date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(next.id).toBe('2026-09-12-bar-eduard')
    expect(next.gigVersion).toBe(GIG_VERSION)
    expect(next.visuals).toBe('./visuals.json')
  })

  it('leaves the setlist and the confirmation where they are', () => {
    const full = withSetup(
      { ...gig, songs: [{ id: 'duelo' }], setlist: ['duelo'] },
      { confirmedAt: 'then', against: { songs: {}, visuals: null, display: '' } }
    )
    const next = withIdentity(full, { date: '2026-09-12', venue: { name: 'Bar Eduard' } })
    expect(next.setlist).toEqual(['duelo'])
    expect(next.setup!.confirmedAt).toBe('then')
  })
})

describe('withSetlist', () => {
  const gig = { gigVersion: GIG_VERSION, id: 'g' }
  const folder = '/vault/concerts/g'
  const songs = [
    { id: 'a', title: 'A', path: '/vault/songs/a.json' },
    { id: 'b', title: 'B', path: '/vault/songs/b.json' },
  ]

  it('writes the repertoire and the order as two fields', () => {
    const next = withSetlist(gig, songs, folder)
    expect(next.songs).toEqual([
      { id: 'a', title: 'A', file: '../../songs/a.json' },
      { id: 'b', title: 'B', file: '../../songs/b.json' },
    ])
    expect(next.setlist).toEqual(['a', 'b'])
  })

  it('writes `file` relative to the gig folder, so the folder can travel', () => {
    const inside = [{ id: 'c', title: 'C', path: '/vault/concerts/g/songs/c.json' }]
    expect(withSetlist(gig, inside, folder).songs?.[0]?.file).toBe('songs/c.json')
  })

  it('carries the title Muralista names the song by', () => {
    expect(withSetlist(gig, songs, folder).songs?.[0]?.title).toBe('A')
  })

  it('leaves everything else alone', () => {
    const withVenue = { ...gig, venue: { name: 'Bar Eduard' } }
    expect(withSetlist(withVenue, songs, folder).venue).toEqual({ name: 'Bar Eduard' })
  })

  it('setlistMatches says when a write would change nothing', () => {
    expect(setlistMatches(gig, songs, folder)).toBe(false)
    expect(setlistMatches(withSetlist(gig, songs, folder), songs, folder)).toBe(true)
  })

  it('notices a reorder', () => {
    const reordered = [songs[1]!, songs[0]!]
    expect(setlistMatches(withSetlist(gig, songs, folder), reordered, folder)).toBe(false)
  })
})

describe('readGigSetlist — the file is the source', () => {
  const folder = '/vault/concerts/g'

  it('reads the order the file states, resolving each file against the gig folder', () => {
    const gig = parseGigFile(
      JSON.stringify({
        gigVersion: GIG_VERSION,
        id: 'g',
        songs: [
          { id: 'a', title: 'A', file: '../../songs/a.json' },
          { id: 'b', title: 'B', file: '../../songs/b.json' },
        ],
        setlist: ['b', 'a'],
      })
    )
    expect(readGigSetlist(gig, folder)).toEqual([
      { id: 'b', title: 'B', path: '/vault/songs/b.json' },
      { id: 'a', title: 'A', path: '/vault/songs/a.json' },
    ])
  })

  it('accepts an absolute file untouched — both forms are read, one is written', () => {
    const gig = parseGigFile(
      JSON.stringify({
        gigVersion: GIG_VERSION,
        id: 'g',
        songs: [{ id: 'a', file: '/elsewhere/a.json' }],
        setlist: ['a'],
      })
    )
    expect(readGigSetlist(gig, folder)[0]?.path).toBe('/elsewhere/a.json')
  })

  it('reports an id the repertoire does not carry rather than dropping it', () => {
    const gig = parseGigFile(
      JSON.stringify({ gigVersion: GIG_VERSION, id: 'g', songs: [], setlist: ['ghost'] })
    )
    expect(readGigSetlist(gig, folder)).toEqual([{ id: 'ghost', title: null, path: null }])
  })

  it('is empty for a gig that has not reached a running order', () => {
    const gig = parseGigFile(JSON.stringify({ gigVersion: GIG_VERSION, id: 'g' }))
    expect(readGigSetlist(gig, folder)).toEqual([])
    expect(hasAuthoredSetlist(gig)).toBe(false)
  })

  it('tells an authored empty setlist from an absent one — the file exists before it is finished', () => {
    const empty = parseGigFile(JSON.stringify({ gigVersion: GIG_VERSION, id: 'g', setlist: [] }))
    expect(hasAuthoredSetlist(empty)).toBe(true)
  })
})

describe('the setup confirmation in the file', () => {
  const SETUP = {
    confirmedAt: '2026-09-12T19:04:11.000Z',
    against: { songs: { duelo: 'aabbccdd' }, visuals: '11223344', display: '1920x1080@1*' },
  }

  it('round-trips through parse and serialize', () => {
    const gig = parseGigFile(
      JSON.stringify({ gigVersion: GIG_VERSION, id: 'g', setup: SETUP })
    )
    expect(gig.setup).toEqual(SETUP)
    expect(JSON.parse(serializeGigFile(gig)).setup).toEqual(SETUP)
  })

  it('is absent on a gig that has never been confirmed, which is the ordinary state', () => {
    const gig = parseGigFile(JSON.stringify({ gigVersion: GIG_VERSION, id: 'g' }))
    expect(gig.setup).toBeUndefined()
    expect(serializeGigFile(gig)).not.toContain('setup')
  })

  it('reads a damaged block as absent rather than refusing the gig — this is a milestone, not a lock', () => {
    for (const bad of [null, 42, 'yes', {}, { against: {} }, { confirmedAt: '' }]) {
      const gig = parseGigFile(JSON.stringify({ gigVersion: GIG_VERSION, id: 'g', setup: bad }))
      expect(gig.setup).toBeUndefined()
    }
  })

  it('keeps a confirmation whose against block is missing pieces, as empty ones', () => {
    const gig = parseGigFile(
      JSON.stringify({ gigVersion: GIG_VERSION, id: 'g', setup: { confirmedAt: 'then' } })
    )
    expect(gig.setup).toEqual({ confirmedAt: 'then', against: { songs: {}, visuals: null, display: '' } })
  })

  it('withSetup records the confirmation and moves nothing else', () => {
    const gig = { gigVersion: GIG_VERSION, id: 'g', venue: { name: 'Bar Eduard' }, setlist: ['a'] }
    const next = withSetup(gig, SETUP)
    expect(next.setup).toEqual(SETUP)
    expect(next.venue).toEqual({ name: 'Bar Eduard' })
    expect(next.setlist).toEqual(['a'])
  })

  it('carries no matrix, no layout and no pixel size — the recipe, not the cake', () => {
    const text = serializeGigFile(withSetup({ gigVersion: GIG_VERSION, id: 'g' }, SETUP))
    for (const forbidden of ['matrix3d', 'corners', 'outline', 'fontSize']) {
      expect(text).not.toContain(forbidden)
    }
  })
})
