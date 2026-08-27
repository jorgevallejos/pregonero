import { describe, it, expect } from 'vitest'
import {
  armWarnings,
  computeGigReadiness,
  emptyGigReadiness,
  isSongReadyToArm,
  whySongCannotArm,
  type GigReadinessInput,
  type SetlistSongInput,
} from './gigReadiness'
import { GIG_VERSION, type GigFile } from './gigFile'
import { parseVisualsFile, type VisualsFile } from './visualsFile'
import type { LibrarySong } from './setlistStore'

const GIG_ID = '2026-09-12-bar-eduard'

function song(id: string, extra: Partial<LibrarySong> = {}): LibrarySong {
  return {
    id,
    title: id,
    items: [{ languages: { es: 'una línea' } }],
    ...extra,
  } as LibrarySong
}

function row(s: LibrarySong): SetlistSongInput {
  return { id: s.id, title: s.title, path: `${s.id}.json`, song: s }
}

function brokenRow(id: string, error: string): SetlistSongInput {
  return { id, title: id, path: `${id}.json`, song: null, error }
}

function visuals(
  defaults: Record<string, string[]>,
  songs: Record<string, Record<string, string[]>> = {},
  shapes = [
    { id: 'lyr', layer: { type: 'song-lyrics' } },
    { id: 'lyr2', layer: { type: 'song-lyrics' } },
    { id: 'vid', layer: { type: 'song-video' } },
    { id: 'intro', layer: { type: 'song-intro' } },
  ]
): VisualsFile {
  return parseVisualsFile(
    JSON.stringify({
      visualsVersion: 1,
      gigId: GIG_ID,
      shapes,
      songVisuals: { defaults, songs },
    }),
    GIG_ID
  )
}

const gig: GigFile = {
  gigVersion: GIG_VERSION,
  id: GIG_ID,
  date: '2026-09-12',
  venue: { name: 'Bar Eduard', city: 'Ghent' },
  visuals: './visuals.json',
}

function input(overrides: Partial<GigReadinessInput> = {}): GigReadinessInput {
  return {
    folderPath: `/gigs/${GIG_ID}`,
    gig,
    gigProblem: null,
    visualsPresent: true,
    visuals: visuals({ 'song-lyrics': ['lyr'] }),
    visualsProblem: null,
    setlist: [row(song('duelo')), row(song('vidas'))],
    mediaResolution: {},
    validation: {},
    ...overrides,
  }
}

describe('with no gig folder open', () => {
  it('turns the gate off rather than blocking everything', () => {
    const r = computeGigReadiness(input({ folderPath: null }))
    expect(r.gate).toBe('off')
    expect(isSongReadyToArm(r, 'duelo')).toBe(true)
  })

  it('still drops a reference that will not read from the playable setlist', () => {
    const r = computeGigReadiness(
      input({
        folderPath: null,
        setlist: [row(song('duelo')), brokenRow('libertad', '20 timeline entries, 24 lyric lines')],
      })
    )
    expect(r.playableSongIds).toEqual(['duelo'])
  })

  it('reports every gig step as not yet, never as broken', () => {
    const r = computeGigReadiness(input({ folderPath: null }))
    expect(r.steps.filter((s) => s.step > 1).map((s) => s.status)).toEqual([
      'not-yet',
      'not-yet',
      'not-yet',
      'not-yet',
      'not-yet',
    ])
  })

  it('still answers step 1, because songs are gig-independent', () => {
    const r = computeGigReadiness(input({ folderPath: null }))
    expect(r.steps.find((s) => s.step === 1)!.status).toBe('complete')
  })

  it('emptyGigReadiness is the same shape', () => {
    expect(emptyGigReadiness().gate).toBe('off')
    expect(emptyGigReadiness().songs).toEqual([])
  })
})

describe('the common case: a song set up by doing nothing at all', () => {
  it('is ready off the gig-level shape', () => {
    const r = computeGigReadiness(input())
    expect(r.songs.map((s) => s.ready)).toEqual([true, true])
    expect(r.playableSongIds).toEqual(['duelo', 'vidas'])
  })

  it('needs no timeline to be armable — most of the catalogue has none', () => {
    const r = computeGigReadiness(input({ setlist: [row(song('vidas'))] }))
    expect(r.songs[0]!.ready).toBe(true)
  })

  it('is ready with every step complete up to the confirmation, which is not derived', () => {
    const r = computeGigReadiness(input())
    expect(r.steps.filter((s) => s.step < 6).map((s) => s.status)).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
      'complete',
    ])
    // Step 6 is the one thing that is stored rather than derived: nothing here can confirm setup
    // on the person's behalf, and the screen says so instead of pretending.
    expect(r.steps.find((s) => s.step === 6)!.status).toBe('not-yet')
    expect(r.steps.find((s) => s.step === 6)!.missing[0]).toMatch(/Confirm setup/)
  })
})

describe('the hard gate', () => {
  it('blocks a song no shape carries', () => {
    const r = computeGigReadiness(input({ visuals: visuals({}) }))
    expect(isSongReadyToArm(r, 'duelo')).toBe(false)
    expect(whySongCannotArm(r, 'duelo')[0]).toMatch(/no shape carries this song/)
  })

  it('blocks a song whose reassignment points at a deleted shape, even when the gig has a default', () => {
    const r = computeGigReadiness(
      input({ visuals: visuals({ 'song-lyrics': ['lyr'] }, { duelo: { 'song-lyrics': ['gone'] } }) })
    )
    expect(isSongReadyToArm(r, 'duelo')).toBe(false)
    expect(isSongReadyToArm(r, 'vidas')).toBe(true)
  })

  it('blocks every song while the gig has no visuals.json', () => {
    const r = computeGigReadiness(input({ visualsPresent: false, visuals: null }))
    expect(r.playableSongIds).toEqual([])
    expect(whySongCannotArm(r, 'duelo')[0]).toMatch(/no visuals.json yet/)
  })

  it('blocks a reference that will not read', () => {
    const r = computeGigReadiness(
      input({ setlist: [brokenRow('libertad', '20 timeline entries, 24 lyric lines')] })
    )
    expect(isSongReadyToArm(r, 'libertad')).toBe(false)
    expect(whySongCannotArm(r, 'libertad')).toEqual(['20 timeline entries, 24 lyric lines'])
  })

  it('refuses a song that is not in the setlist at all', () => {
    const r = computeGigReadiness(input())
    expect(isSongReadyToArm(r, 'quien-fuera')).toBe(false)
    expect(whySongCannotArm(r, 'quien-fuera')[0]).toMatch(/not in the gig/)
  })

  it('never arms an empty song id', () => {
    expect(isSongReadyToArm(computeGigReadiness(input({ folderPath: null })), '')).toBe(false)
  })
})

describe('the content a resolved type requires', () => {
  const withVideo = visuals({ 'song-lyrics': ['lyr'], 'song-video': ['vid'] })

  it('a video shape needs media the song declares', () => {
    const r = computeGigReadiness(input({ visuals: withVideo, setlist: [row(song('vidas'))] }))
    expect(whySongCannotArm(r, 'vidas')).toContain('has a video shape but declares no media')
  })

  it('a video shape needs that media linked on this machine', () => {
    const s = song('tragedia', {
      media: { type: 'video', src: 'tragedia.mp4' },
      timeline: [{ start: 0, end: 1 }],
    })
    const r = computeGigReadiness(input({ visuals: withVideo, setlist: [row(s)] }))
    expect(whySongCannotArm(r, 'tragedia')[0]).toMatch(/not linked on this machine/)
  })

  it('a video shape needs that linked file to still be there', () => {
    const s = song('tragedia', {
      media: { type: 'video', src: 'tragedia.mp4' },
      timeline: [{ start: 0, end: 1 }],
    })
    const r = computeGigReadiness(
      input({
        visuals: withVideo,
        setlist: [row(s)],
        mediaResolution: { 'tragedia.mp4': { linked: true, exists: false } },
      })
    )
    expect(whySongCannotArm(r, 'tragedia')[0]).toMatch(/is not there/)
  })

  it('a video shape needs a timeline, because the subtitles read the video’s clock', () => {
    const s = song('tragedia', { media: { type: 'video', src: 'tragedia.mp4' } })
    const r = computeGigReadiness(
      input({
        visuals: withVideo,
        setlist: [row(s)],
        mediaResolution: { 'tragedia.mp4': { linked: true, exists: true } },
      })
    )
    expect(whySongCannotArm(r, 'tragedia')).toContain(
      'has a video shape but no timeline to bind subtitles to'
    )
  })

  it('is ready when the video shape has all three', () => {
    const s = song('tragedia', {
      media: { type: 'video', src: 'tragedia.mp4' },
      timeline: [{ start: 0, end: 1 }],
    })
    const r = computeGigReadiness(
      input({
        visuals: withVideo,
        setlist: [row(s)],
        mediaResolution: { 'tragedia.mp4': { linked: true, exists: true } },
      })
    )
    expect(isSongReadyToArm(r, 'tragedia')).toBe(true)
  })

  it('asks nothing of a song whose gig has no video shape assigned', () => {
    const s = song('vidas', { media: { type: 'video', src: 'never-linked.mp4' } })
    const r = computeGigReadiness(input({ setlist: [row(s)] }))
    expect(isSongReadyToArm(r, 'vidas')).toBe(true)
  })

  it('a lyrics shape needs lyric lines', () => {
    const empty = { id: 'hueco', title: 'Hueco', items: [] } as unknown as LibrarySong
    const r = computeGigReadiness(input({ setlist: [row(empty)] }))
    expect(whySongCannotArm(r, 'hueco')).toContain('has a lyrics shape but no lyric lines')
  })

  it('an intro-only song has nowhere to perform', () => {
    const r = computeGigReadiness(input({ visuals: visuals({ 'song-intro': ['intro'] }) }))
    expect(whySongCannotArm(r, 'duelo')[0]).toMatch(/no shape carries this song/)
  })
})

describe('bombista is reported, never a gate', () => {
  it('a failing song stays armable and carries the finding as a note', () => {
    const r = computeGigReadiness(
      input({ validation: { duelo: { status: 'failed', messages: ['timeline is missing'] } } })
    )
    expect(isSongReadyToArm(r, 'duelo')).toBe(true)
    expect(r.songs[0]!.notes).toEqual(['bombista: timeline is missing'])
  })

  it('the finding lands on step 2, which is the step that can act on it', () => {
    const r = computeGigReadiness(
      input({ validation: { duelo: { status: 'failed', messages: ['timeline is missing'] } } })
    )
    const step2 = r.steps.find((s) => s.step === 2)!
    expect(step2.status).toBe('not-yet')
    expect(step2.missing.join(' ')).toMatch(/timeline is missing/)
  })

  it('does not fail closed when bombista is not on PATH', () => {
    const r = computeGigReadiness(
      input({
        validation: {
          duelo: { status: 'skipped', reason: 'bombista is not on PATH' },
          vidas: { status: 'skipped', reason: 'bombista is not on PATH' },
        },
      })
    )
    expect(r.validationSkipped).toBe(true)
    expect(r.playableSongIds).toEqual(['duelo', 'vidas'])
    expect(r.steps.find((s) => s.step === 2)!.status).toBe('complete')
  })
})

describe('the per-step verdict', () => {
  it('a gig.json that is only identity is not yet, never broken', () => {
    const r = computeGigReadiness(
      input({
        gig: { gigVersion: GIG_VERSION, id: GIG_ID },
        visualsPresent: false,
        visuals: null,
        setlist: [],
      })
    )
    expect(r.steps.filter((s) => s.step > 1).map((s) => s.status)).toEqual([
      'not-yet',
      'not-yet',
      'not-yet',
      'not-yet',
      'not-yet',
    ])
    expect(r.refusals).toEqual([])
  })

  it('names what step 2 is still missing', () => {
    const r = computeGigReadiness(
      input({ gig: { gigVersion: GIG_VERSION, id: GIG_ID }, setlist: [] })
    )
    const step2 = r.steps.find((s) => s.step === 2)!
    expect(step2.missing).toEqual([
      'The gig has no date.',
      'The gig has no venue.',
      'The gig has no setlist.',
    ])
  })

  it('a missing visuals.json is step 3 not yet, and says where to go', () => {
    const r = computeGigReadiness(input({ visualsPresent: false, visuals: null }))
    const step3 = r.steps.find((s) => s.step === 3)!
    expect(step3.status).toBe('not-yet')
    expect(step3.missing[0]).toMatch(/map the room in Muralista/)
  })

  it('a gig with visuals but no lyrics shape is step 3 not yet', () => {
    const r = computeGigReadiness(input({ visuals: visuals({}) }))
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('not-yet')
  })

  it('a refused visuals.json is broken, and the refusal is carried verbatim', () => {
    const refusal = 'visuals.json belongs to gig "last-month", not "2026-09-12-bar-eduard".'
    const r = computeGigReadiness(
      input({ visuals: null, visualsProblem: refusal })
    )
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('broken')
    expect(r.refusals).toEqual([refusal])
    expect(r.steps.find((s) => s.step === 5)!.status).toBe('broken')
  })

  it('an unparseable gig.json is broken at step 2', () => {
    const r = computeGigReadiness(
      input({ gig: null, gigProblem: 'gig.json is not valid JSON: Unexpected end of input' })
    )
    expect(r.steps.find((s) => s.step === 2)!.status).toBe('broken')
  })

  it('step 4 waits for step 3 rather than claiming to be done', () => {
    const r = computeGigReadiness(input({ visualsPresent: false, visuals: null }))
    expect(r.steps.find((s) => s.step === 4)!.status).toBe('not-yet')
  })

  it('step 4 names the song no shape carries', () => {
    const r = computeGigReadiness(
      input({ visuals: visuals({ 'song-lyrics': ['lyr'] }, { duelo: { 'song-lyrics': ['gone'] } }) })
    )
    const step4 = r.steps.find((s) => s.step === 4)!
    expect(step4.status).toBe('not-yet')
    expect(step4.missing.join(' ')).toMatch(/duelo/)
  })
})

describe('the playable setlist', () => {
  it('keeps setlist order', () => {
    const r = computeGigReadiness(
      input({ setlist: [row(song('a')), row(song('b')), row(song('c'))] })
    )
    expect(r.playableSongIds).toEqual(['a', 'b', 'c'])
  })

  it('drops a trailing song the gate has just made unplayable', () => {
    const r = computeGigReadiness(
      input({
        setlist: [row(song('a')), row(song('libertad'))],
        visuals: visuals({ 'song-lyrics': ['lyr'] }, { libertad: { 'song-lyrics': ['gone'] } }),
      })
    )
    expect(r.playableSongIds).toEqual(['a'])
  })
})

describe('step 1: the songs, and the library is its subject', () => {
  function step1(overrides: Partial<GigReadinessInput> = {}) {
    return computeGigReadiness(input(overrides)).steps.find((s) => s.step === 1)!
  }

  it('is complete when the library holds a song that reads', () => {
    expect(step1({ library: [row(song('duelo'))] }).status).toBe('complete')
  })

  it('is not yet with no songs at all, and says what a song needs', () => {
    const s = step1({ library: [], setlist: [] })
    expect(s.status).toBe('not-yet')
    expect(s.missing[0]).toMatch(/lyrics and audio/)
  })

  it('is not yet when nothing in the library reads', () => {
    expect(step1({ library: [brokenRow('libertad', '20 against 24')] }).status).toBe('not-yet')
  })

  it('names an unreadable reference as work, not as a blocker', () => {
    const s = step1({ library: [row(song('duelo')), brokenRow('libertad', '20 against 24')] })
    expect(s.status).toBe('complete')
    expect(s.missing).toEqual([])
    expect(s.notes).toEqual(['libertad: 20 against 24'])
  })

  it('carries a bombista finding as a note, never as a block', () => {
    const s = step1({
      library: [row(song('duelo'))],
      validation: { duelo: { status: 'failed', messages: ['timeline is short'] } },
    })
    expect(s.status).toBe('complete')
    expect(s.notes).toEqual(['duelo: bombista: timeline is short'])
  })

  it('falls back to the setlist when no separate library is given', () => {
    expect(step1({ library: undefined }).status).toBe('complete')
  })

  it('holds the later steps: a gig cannot be complete while step 1 is not', () => {
    const r = computeGigReadiness(input({ library: [], setlist: [] }))
    expect(r.steps.find((s) => s.step === 5)!.status).toBe('not-yet')
    expect(r.steps.find((s) => s.step === 6)!.status).toBe('not-yet')
  })
})

describe('step 6: the setup confirmation, a milestone and not a lock', () => {
  const FP = { songs: { duelo: 'aaa', vidas: 'bbb' }, visuals: 'ccc', display: 'ddd' }
  const confirmedGig = { ...gig, setup: { confirmedAt: '2026-09-12T19:04:11.000Z', against: FP } }

  function step6(overrides: Partial<GigReadinessInput> = {}) {
    return computeGigReadiness(input(overrides)).steps.find((s) => s.step === 6)!
  }

  it('is not yet until someone confirms it — nothing derives a confirmation', () => {
    const s = step6({ fingerprints: FP })
    expect(s.status).toBe('not-yet')
    expect(s.missing[0]).toMatch(/Confirm setup when you are standing in the room/)
  })

  it('is complete once it is recorded and everything it names is unchanged', () => {
    expect(step6({ gig: confirmedGig, fingerprints: FP }).status).toBe('complete')
  })

  it('says the checks have not passed yet rather than asking to confirm them', () => {
    const s = step6({ visualsPresent: false, visuals: null, fingerprints: FP })
    expect(s.missing[0]).toMatch(/readiness check at the venue has not passed yet/)
  })

  describe('going stale, which is the part that earns its keep', () => {
    it('lapses when a song has been edited, and names it', () => {
      const r = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, songs: { duelo: 'zzz', vidas: 'bbb' } } })
      )
      expect(r.confirmation!.stale).toBe(true)
      expect(r.confirmation!.moved).toEqual(['duelo has been edited since setup was confirmed.'])
      expect(r.steps.find((s) => s.step === 6)!.status).toBe('not-yet')
    })

    it('lapses when the room has been re-mapped', () => {
      const r = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, visuals: 'zzz' } })
      )
      expect(r.confirmation!.moved).toEqual([
        'The room has been re-mapped since setup was confirmed.',
      ])
    })

    it('lapses when the displays have changed — the projector unplugged', () => {
      const r = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, display: 'laptop only' } })
      )
      expect(r.confirmation!.moved).toEqual([
        'The displays have changed since setup was confirmed.',
      ])
    })

    it('lapses when a song leaves the setlist, and when one joins it', () => {
      const gone = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, songs: { duelo: 'aaa' } } })
      )
      expect(gone.confirmation!.moved).toEqual([
        'vidas was in the setlist when setup was confirmed, and is not now.',
      ])

      const added = computeGigReadiness(
        input({
          gig: confirmedGig,
          fingerprints: { ...FP, songs: { ...FP.songs, paso: 'eee' } },
        })
      )
      expect(added.confirmation!.moved).toEqual([
        'paso was added to the setlist after setup was confirmed.',
      ])
    })

    it('names every thing that moved, not only the first', () => {
      const r = computeGigReadiness(
        input({
          gig: confirmedGig,
          fingerprints: { songs: { duelo: 'zzz', vidas: 'bbb' }, visuals: 'yyy', display: 'xxx' },
        })
      )
      expect(r.confirmation!.moved).toHaveLength(3)
    })

    it('is a lapse, not a refusal: nothing is in refusals and no step is broken', () => {
      const r = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, visuals: 'zzz' } })
      )
      expect(r.refusals).toEqual([])
      expect(r.steps.some((s) => s.status === 'broken')).toBe(false)
    })
  })

  describe('arming', () => {
    it('warns on a gig that was never confirmed, and does not refuse', () => {
      const r = computeGigReadiness(input({ fingerprints: FP }))
      expect(armWarnings(r)).toEqual(['Setup has not been confirmed for this gig.'])
      expect(isSongReadyToArm(r, 'duelo')).toBe(true)
    })

    it('warns on a lapsed confirmation, naming what moved', () => {
      const r = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, display: 'zzz' } })
      )
      expect(armWarnings(r)).toEqual([
        'Setup was confirmed and has lapsed:',
        'The displays have changed since setup was confirmed.',
      ])
      expect(isSongReadyToArm(r, 'duelo')).toBe(true)
    })

    it('is silent when setup is confirmed and still true', () => {
      expect(armWarnings(computeGigReadiness(input({ gig: confirmedGig, fingerprints: FP })))).toEqual([])
    })

    it('is silent with no gig at all, because there is nothing to confirm', () => {
      expect(armWarnings(computeGigReadiness(input({ folderPath: null })))).toEqual([])
    })
  })
})
