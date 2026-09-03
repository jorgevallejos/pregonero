import { describe, it, expect } from 'vitest'
import {
  GIG_VERSION,
  createGigFile,
  GIG_ID_LENGTH,
  gigIdentityIsAnswered,
  gigLabel,
  newGigId,
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
    expect(gigIdFromFolderPath('/Users/j/gigs/setup/k3f9x2abcd')).toBe('k3f9x2abcd')
  })

  it('ignores a trailing slash', () => {
    expect(gigIdFromFolderPath('/Users/j/gigs/setup/k3f9x2abcd/')).toBe(
      'k3f9x2abcd'
    )
  })
})

describe('parseGigFile', () => {
  const minimal = JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd' })

  it('accepts a file carrying only identity — the state it is in from step 2', () => {
    const gig = parseGigFile(minimal)
    expect(gig.id).toBe('k3f9x2abcd')
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
  it('takes its identity from the folder and its date from today', () => {
    const gig = createGigFile('/gigs/setup/k3f9x2abcd', '2026-08-26')
    expect(gig).toEqual({
      gigVersion: 1,
      id: 'k3f9x2abcd',
      date: '2026-08-26',
      visuals: './visuals.json',
    })
  })

  it('reads no date out of the folder name, whatever the name looks like', () => {
    // **The folder is an opaque id and nothing is derived from it** (2026-09-03). A folder that
    // happens to lead with a date is a coincidence, and a coincidence must not become a fact in
    // the file: an id could be minted that starts with digits, and 2026-05-16 could be a folder
    // somebody made by hand.
    expect(createGigFile('/gigs/setup/2026-09-12-bar-eduard', '2026-08-26').date).toBe('2026-08-26')
  })

  it('invents no venue', () => {
    expect(createGigFile('/gigs/setup/k3f9x2abcd', '2026-08-26').venue).toBeUndefined()
  })
})

/**
 * **The gig's date and venue, written down** — setup step 1, and the one step where anything is
 * typed rather than derived from a file another tool owns.
 */
describe('withIdentity', () => {
  const gig = { gigVersion: GIG_VERSION, id: 'k3f9x2abcd', visuals: './visuals.json' }

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
    expect(next.id).toBe('k3f9x2abcd')
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
 * **A gig's identity is an opaque id** (Jorge, 2026-09-03), superseding the 02/09 shape
 * `2026-05-16-bom-festival`. That name was derived from the date and the venue, and both of them
 * change: identity derived from data that can change is not identity.
 */
describe('newGigId — the folder means nothing', () => {
  it('is ten characters of the id alphabet', () => {
    const id = newGigId()
    expect(id).toHaveLength(GIG_ID_LENGTH)
    expect(id).toMatch(/^[0-9abcdefghjkmnpqrstvwxyz]+$/)
  })

  it('never uses a character that can be misread', () => {
    // Crockford's base32: no `i`, `l`, `o` or `u`. Jorge reads a folder name off a screen and
    // types it into a terminal, and `1` against `l` is the whole reason that alphabet exists.
    const ids = Array.from({ length: 500 }, newGigId).join('')
    expect(ids).not.toMatch(/[ilou]/)
  })

  it('is a different id every time', () => {
    const ids = new Set(Array.from({ length: 500 }, newGigId))
    expect(ids.size).toBe(500)
  })

  it('is a folder name with nothing in it a filesystem minds', () => {
    for (let i = 0; i < 100; i += 1) {
      const id = newGigId()
      expect(id).not.toMatch(/[/\\.\s]/)
    }
  })
})

/**
 * **The write gate, stated rather than emergent** (Jorge, 2026-09-03).
 *
 * Until the folder became opaque, this rule enforced itself: a gig was named by its date and its
 * venue, so a missing half meant no name and nothing to create. **An opaque id can be minted about
 * a gig that is nothing yet**, so the protection had to be written down. `createGig` is where it
 * binds — see `gigSession.test.ts` — and this is the rule it checks.
 */
describe('gigIdentityIsAnswered', () => {
  it('is true when the date and the venue are both there', () => {
    expect(gigIdentityIsAnswered({ date: '2026-05-16', venue: 'BOM Festival' })).toBe(true)
  })

  it('is false until both halves are answered', () => {
    expect(gigIdentityIsAnswered({ date: '', venue: 'BOM Festival' })).toBe(false)
    expect(gigIdentityIsAnswered({ date: '2026-05-16', venue: '' })).toBe(false)
    expect(gigIdentityIsAnswered({ date: '2026-05-16', venue: '   ' })).toBe(false)
    expect(gigIdentityIsAnswered({ date: '   ', venue: '   ' })).toBe(false)
  })

  it('is false for a date that is not a date', () => {
    expect(gigIdentityIsAnswered({ date: '16/05/2026', venue: 'BOM Festival' })).toBe(false)
    expect(gigIdentityIsAnswered({ date: '2026-5-16', venue: 'BOM Festival' })).toBe(false)
  })

  it('takes a venue with no letters in it, which the derived name could not', () => {
    // `—` used to be refused because it slugged to an empty folder name. The folder is opaque now,
    // so the only question left is whether the person answered, and they did.
    expect(gigIdentityIsAnswered({ date: '2026-05-16', venue: '—' })).toBe(true)
  })
})

/**
 * **The row is a label and the folder is machinery, and they are allowed to disagree** (Jorge,
 * 2026-09-03). Backstage rendered `basename(path)`, so a corrected venue left the old string on
 * screen; this also closes the 02/09 ruling that a gig is named by its venue where the file has
 * one and by its folder otherwise, which the code never honoured.
 */
describe('gigLabel', () => {
  const folder = '/gigs/setup/k3f9x2abcd'

  it('is the date and the venue', () => {
    const gig = parseGigFile(
      JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd', date: '2026-10-17', venue: { name: 'Geel Coffee' } })
    )
    expect(gigLabel(gig, folder)).toBe('2026-10-17 · Geel Coffee')
  })

  it('follows an edit, because it is read rather than stored', () => {
    const before = parseGigFile(
      JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd', date: '2026-10-17', venue: { name: 'Gel Coffe' } })
    )
    const after = withIdentity(before, { date: '2026-10-17', venue: { name: 'Geel Coffee' } })
    expect(gigLabel(before, folder)).toBe('2026-10-17 · Gel Coffe')
    expect(gigLabel(after, folder)).toBe('2026-10-17 · Geel Coffee')
    // And the folder did not move.
    expect(after.id).toBe('k3f9x2abcd')
  })

  it('shows whichever half the file has', () => {
    const dated = parseGigFile(JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd', date: '2026-10-17' }))
    const placed = parseGigFile(
      JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd', venue: { name: 'Geel Coffee' } })
    )
    expect(gigLabel(dated, folder)).toBe('2026-10-17')
    expect(gigLabel(placed, folder)).toBe('Geel Coffee')
  })

  it('falls back to the folder, and invents no night', () => {
    const empty = parseGigFile(JSON.stringify({ gigVersion: 1, id: 'k3f9x2abcd' }))
    expect(gigLabel(empty, folder)).toBe('k3f9x2abcd')
    // A file that will not read at all is null here, and the folder still names the row.
    expect(gigLabel(null, folder)).toBe('k3f9x2abcd')
  })
})
