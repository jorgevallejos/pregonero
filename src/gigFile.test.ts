import { describe, it, expect } from 'vitest'
import {
  GIG_VERSION,
  createGigFile,
  gigDateFromFolderPath,
  gigIdFrom,
  gigIdFromFolderPath,
  hasAuthoredSetlist,
  parseGigFile,
  readGigSetlist,
  serializeGigFile,
  setlistMatches,
  withIdentity,
  withSetlist,
  withSetup,
  venueSlug,
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
        songs: [{ id: 'luz-y-sal', title: 'Luz y sal', file: '../../../songs/song-performance/luz-y-sal.json' }],
        setlist: ['luz-y-sal'],
      })
    )
    expect(gig.venue).toEqual({ name: 'Bar Eduard', city: 'Ghent' })
    expect(gig.songs).toEqual([
      { id: 'luz-y-sal', title: 'Luz y sal', file: '../../../songs/song-performance/luz-y-sal.json' },
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
  // **A gig's folder is `<gigs>/setup/<gig>`** (2026-09-02): the tools own one `setup/` inside the
  // gigs folder and touch nothing else, so this is both the gig's folder and where its two files
  // are. `gig.json` sits in it directly.
  const folder = '/vault/gigs/setup/2026-09-04-de-poel'
  const songs = [
    { id: 'a', title: 'A', path: '/vault/songs/song-performance/a.json' },
    { id: 'b', title: 'B', path: '/vault/songs/song-performance/b.json' },
  ]

  it('writes the repertoire and the order as two fields', () => {
    const next = withSetlist(gig, songs, folder)
    expect(next.songs).toEqual([
      { id: 'a', title: 'A', file: '../../../songs/song-performance/a.json' },
      { id: 'b', title: 'B', file: '../../../songs/song-performance/b.json' },
    ])
    expect(next.setlist).toEqual(['a', 'b'])
  })

  // **The reference is relative to `gig.json` itself**, which is what lets the folder travel on a
  // stick: an absolute path is a fact about one machine, and the two-file split exists so the pair
  // can be handed over. Nothing on disk carries an older form.
  it('writes `file` from where gig.json sits', () => {
    const inside = [
      { id: 'c', title: 'C', path: '/vault/gigs/setup/2026-09-04-de-poel/songs/c.json' },
    ]
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
  const folder = '/vault/gigs/setup/2026-09-04-de-poel'

  it('reads the order the file states, resolving each file against the gig’s own folder', () => {
    // `gig.json`'s relative paths are relative to `gig.json`, which sits in that folder.
    const gig = parseGigFile(
      JSON.stringify({
        gigVersion: GIG_VERSION,
        id: 'g',
        songs: [
          { id: 'a', title: 'A', file: '../../../songs/song-performance/a.json' },
          { id: 'b', title: 'B', file: '../../../songs/song-performance/b.json' },
        ],
        setlist: ['b', 'a'],
      })
    )
    expect(readGigSetlist(gig, folder)).toEqual([
      { id: 'b', title: 'B', path: '/vault/songs/song-performance/b.json' },
      { id: 'a', title: 'A', path: '/vault/songs/song-performance/a.json' },
    ])
  })

  it('round-trips what withSetlist writes', () => {
    const written = withSetlist({ gigVersion: GIG_VERSION, id: 'g' }, [
      { id: 'a', title: 'A', path: '/vault/songs/song-performance/a.json' },
    ], folder)
    expect(readGigSetlist(written, folder)[0]?.path).toBe(
      '/vault/songs/song-performance/a.json'
    )
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

/**
 * **The identity is derived, not typed** (2026-09-02, journey step 9.1).
 *
 * `New gig` asked for a name whose answer was a folder name — the folder question in different
 * clothes. A gig is named by its date and its venue now, in the shape of the night folders Jorge
 * already keeps, so a gig row and its night read as the same thing even though they sit apart.
 */
describe('gigIdFrom — the gig names itself', () => {
  it('is the date, then the venue', () => {
    expect(gigIdFrom({ date: '2026-05-16', venue: 'BOM Festival' })).toBe('2026-05-16-bom-festival')
  })

  it('matches the folders Jorge already keeps', () => {
    // `context/concerts/` holds exactly these two. The shape is not invented here; it is read off
    // what is already on his disk.
    expect(gigIdFrom({ date: '2026-05-29', venue: 'PC Hoegaarden' })).toBe('2026-05-29-pc-hoegaarden')
  })

  /**
   * **Null is the gate on writing anything at all.** Nothing reaches disk until a gig can be
   * named, so there is never a half-made folder in a list nothing shows.
   */
  it('is null until both halves are there', () => {
    expect(gigIdFrom({ date: '', venue: 'BOM Festival' })).toBeNull()
    expect(gigIdFrom({ date: '2026-05-16', venue: '' })).toBeNull()
    expect(gigIdFrom({ date: '2026-05-16', venue: '   ' })).toBeNull()
  })

  it('is null for a date that is not a date', () => {
    expect(gigIdFrom({ date: '16/05/2026', venue: 'BOM Festival' })).toBeNull()
    expect(gigIdFrom({ date: '2026-5-16', venue: 'BOM Festival' })).toBeNull()
  })

  it('is null for a venue with no letters or digits in it', () => {
    // It would otherwise name the folder after the date alone, and two nights would collide.
    expect(gigIdFrom({ date: '2026-05-16', venue: '—' })).toBeNull()
  })
})

describe('venueSlug', () => {
  /**
   * **Accents are folded, never dropped.** Jorge's venues are Spanish, French and Dutch, and a name
   * that loses its letters is a folder nobody recognises in Finder.
   */
  it('folds accents rather than eating the letters', () => {
    expect(venueSlug('Café Central')).toBe('cafe-central')
    expect(venueSlug('Écurie Saint-Éloi')).toBe('ecurie-saint-eloi')
  })

  it('collapses everything that is not a letter or a digit into one hyphen', () => {
    expect(venueSlug('  De  Poel / zaal 2 ')).toBe('de-poel-zaal-2')
  })

  it('never leads or trails with a hyphen', () => {
    expect(venueSlug("'t Ey!")).toBe('t-ey')
  })
})
