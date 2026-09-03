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

const GIG_ID = 'k3f9x2abcd'

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
    // **A gig's folder is `<gigs>/setup/<gig>`** (2026-09-02): the tools own one `setup/` inside
    // the gigs folder and touch nothing else.
    folderPath: `/gigs/setup/${GIG_ID}`,
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

  it('reports every step as not yet, never as broken', () => {
    const r = computeGigReadiness(input({ folderPath: null }))
    expect(r.steps.map((s) => s.status)).toEqual(['not-yet', 'not-yet', 'not-yet', 'not-yet'])
  })

  it('has nothing to say about songs here, because every step is about the gig now', () => {
    // The library step that used to be real with no gig open is gone: song preparation is the
    // song door's, reached from Setup home without a gig at all.
    const r = computeGigReadiness(input({ folderPath: null }))
    expect(r.steps.map((s) => s.step)).toEqual([1, 2, 3, 4])
    for (const step of r.steps) expect(step.missing).toEqual(['No gig folder is open.'])
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
    expect(r.steps.filter((s) => s.step < 4).map((s) => s.status)).toEqual([
      'complete',
      'complete',
      'complete',
    ])
    // Step 4 is the one thing that is stored rather than derived: nothing here can confirm setup
    // on the person's behalf, and the screen says so instead of pretending.
    expect(r.steps.find((s) => s.step === 4)!.status).toBe('not-yet')
    expect(r.steps.find((s) => s.step === 4)!.missing[0]).toMatch(/Confirm setup/)
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

  /**
   * **The trap this round exists to not rebuild.**
   *
   * The six-step flow pushed every `bombista:` finding into the setlist step's `missing`, so a
   * setlist holding `libertad` — which fails `bombista validate` today — greyed the forward button
   * on a screen with no way to repair it. Porting that one loop into the new step 2 would have
   * rebuilt the dead end one step later.
   */
  it('the finding is a note on the setlist step, and never greys the forward button', () => {
    const r = computeGigReadiness(
      input({ validation: { duelo: { status: 'failed', messages: ['timeline is missing'] } } })
    )
    const setlistStep = r.steps.find((s) => s.step === 2)!
    expect(setlistStep.status).toBe('complete')
    expect(setlistStep.missing).toEqual([])
    expect(setlistStep.notes.join(' ')).toMatch(/timeline is missing/)
  })

  it('a reference that will not read is a note there too, not a blocker', () => {
    const r = computeGigReadiness(
      input({ setlist: [row(song('duelo')), brokenRow('libertad', '20 against 24')] })
    )
    const setlistStep = r.steps.find((s) => s.step === 2)!
    expect(setlistStep.status).toBe('complete')
    expect(setlistStep.notes.join(' ')).toMatch(/20 against 24/)
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
    expect(r.steps.find((s) => s.step === 2)!.notes).toEqual([])
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
    expect(r.steps.map((s) => s.status)).toEqual(['not-yet', 'not-yet', 'not-yet', 'not-yet'])
    expect(r.refusals).toEqual([])
  })

  it('step 1 is the gig itself: its date and its venue, and nothing else', () => {
    const r = computeGigReadiness(
      input({ gig: { gigVersion: GIG_VERSION, id: GIG_ID }, setlist: [] })
    )
    expect(r.steps.find((s) => s.step === 1)!.missing).toEqual([
      'The gig has no date.',
      'The gig has no venue.',
    ])
  })

  it('step 2 is the setlist, and the empty one is what holds it', () => {
    const r = computeGigReadiness(input({ setlist: [] }))
    const setlistStep = r.steps.find((s) => s.step === 2)!
    expect(setlistStep.status).toBe('not-yet')
    expect(setlistStep.missing).toEqual(['The gig has no setlist.'])
  })

  it('a named id with no file here blocks the setlist step, because nothing else can name it', () => {
    const r = computeGigReadiness(
      input({ adoption: { direction: 'adopted', now: [], displaced: [], unresolved: ['perdido'] } })
    )
    const setlistStep = r.steps.find((s) => s.step === 2)!
    expect(setlistStep.status).toBe('not-yet')
    expect(setlistStep.missing.join(' ')).toMatch(/perdido/)
  })

  it('a missing visuals.json is step 3 not yet, and says where to go', () => {
    const r = computeGigReadiness(input({ visualsPresent: false, visuals: null }))
    const visualsStep = r.steps.find((s) => s.step === 3)!
    expect(visualsStep.status).toBe('not-yet')
    expect(visualsStep.missing[0]).toMatch(/map the room in Muralista/)
  })

  it('a gig with visuals but no lyrics shape is step 3 not yet', () => {
    const r = computeGigReadiness(input({ visuals: visuals({}) }))
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('not-yet')
  })

  it('a refused visuals.json is broken, and the refusal is carried verbatim', () => {
    const refusal = 'visuals.json belongs to gig "last-month", not "k3f9x2abcd".'
    const r = computeGigReadiness(input({ visuals: null, visualsProblem: refusal }))
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('broken')
    expect(r.refusals).toEqual([refusal])
    // A refusal above the confirmation is a refusal at it: a milestone about an unreadable file
    // would be peace of mind about nothing.
    expect(r.steps.find((s) => s.step === 4)!.status).toBe('broken')
  })

  it('an unparseable gig.json is broken at the first two steps', () => {
    const r = computeGigReadiness(
      input({ gig: null, gigProblem: 'gig.json is not valid JSON: Unexpected end of input' })
    )
    expect(r.steps.find((s) => s.step === 1)!.status).toBe('broken')
    expect(r.steps.find((s) => s.step === 2)!.status).toBe('broken')
  })
})

/**
 * **Optionality moved inside a step**, and step 3 is where it landed. The gig's own shapes are
 * required; the songs that deviate are not. The old shape said this with a step number in a list
 * in `setupFlow.ts`, which cannot express half a step.
 */
describe('step 3: two halves, and only one of them holds the flow', () => {
  it('is complete on the gig-level shape alone, which is the common case', () => {
    // A gig where no song deviates is fully set up here having done nothing at all.
    expect(computeGigReadiness(input()).steps.find((s) => s.step === 3)!.status).toBe('complete')
  })

  it('names the song no shape carries — as a note, so the common case is not held by the rare one', () => {
    const r = computeGigReadiness(
      input({ visuals: visuals({ 'song-lyrics': ['lyr'] }, { duelo: { 'song-lyrics': ['gone'] } }) })
    )
    const visualsStep = r.steps.find((s) => s.step === 3)!
    expect(visualsStep.status).toBe('complete')
    expect(visualsStep.missing).toEqual([])
    expect(visualsStep.notes.join(' ')).toMatch(/duelo/)
  })

  it('still keeps that song out of the playable setlist, because the hard gate is elsewhere', () => {
    const r = computeGigReadiness(
      input({ visuals: visuals({ 'song-lyrics': ['lyr'] }, { duelo: { 'song-lyrics': ['gone'] } }) })
    )
    expect(isSongReadyToArm(r, 'duelo')).toBe(false)
  })

  it('the required half still holds it: no room mapped is not yet, whatever the songs say', () => {
    const r = computeGigReadiness(input({ visualsPresent: false, visuals: null }))
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('not-yet')
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

describe('step 4: the setup confirmation, a milestone and not a lock', () => {
  const FP = { songs: { duelo: 'aaa', vidas: 'bbb' }, visuals: 'ccc', display: 'ddd' }
  const confirmedGig = { ...gig, setup: { confirmedAt: '2026-09-12T19:04:11.000Z', against: FP } }

  function confirmStep(overrides: Partial<GigReadinessInput> = {}) {
    return computeGigReadiness(input(overrides)).steps.find((s) => s.step === 4)!
  }

  it('is not yet until someone confirms it — nothing derives a confirmation', () => {
    const s = confirmStep({ fingerprints: FP })
    expect(s.status).toBe('not-yet')
    expect(s.missing[0]).toMatch(/Confirm setup when you are standing in the room/)
  })

  it('is complete once it is recorded and everything it names is unchanged', () => {
    expect(confirmStep({ gig: confirmedGig, fingerprints: FP }).status).toBe('complete')
  })

  it('says the checks have not passed yet rather than asking to confirm them', () => {
    const s = confirmStep({ visualsPresent: false, visuals: null, fingerprints: FP })
    expect(s.missing[0]).toMatch(/Everything above has to be true/)
  })

  /**
   * *Readiness at the venue* was a step of its own and is not one now. It discovered nothing —
   * everything it re-checked had been checked by the step that could act on it — and its only
   * content was that everything above had to be true, which is what a confirmation says anyway.
   */
  it('absorbed the venue check rather than keeping it as a step that owned no work', () => {
    const r = computeGigReadiness(input({ fingerprints: FP }))
    expect(r.steps.map((s) => s.name)).toEqual([
      'The gig',
      'The setlist',
      'Visuals',
      'Setup confirmed',
    ])
  })

  describe('going stale, which is the part that earns its keep', () => {
    it('lapses when a song has been edited, and names it', () => {
      const r = computeGigReadiness(
        input({ gig: confirmedGig, fingerprints: { ...FP, songs: { duelo: 'zzz', vidas: 'bbb' } } })
      )
      expect(r.confirmation!.stale).toBe(true)
      expect(r.confirmation!.moved).toEqual(['duelo has been edited since setup was confirmed.'])
      expect(r.steps.find((s) => s.step === 4)!.status).toBe('not-yet')
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

/**
 * **Valid is not ready, and step 9's whole shape rests on that split.**
 *
 * `gig.json` is written the moment identity is complete, before there is a setlist — so the file
 * has to *parse* while the gig is plainly not finished, and the finishing is readiness's question
 * and only readiness's. `journey-setup.md` recorded the parser half as checked and this half as
 * unverified; this is that half, checked.
 *
 * **`parseGigFile` throws on three things only** — not valid JSON, no `gigVersion`, no `id` — and
 * `setlist` is optional. **`computeGigReadiness` is what says the gig is not done**, at step 2, in
 * the words the screen shows.
 */
describe('a gig with identity and no setlist: valid, and not ready', () => {
  const noSetlist: GigFile = {
    gigVersion: GIG_VERSION,
    id: GIG_ID,
    date: '2026-09-12',
    venue: { name: 'Bar Eduard', city: 'Ghent' },
    visuals: './visuals.json',
  }

  it('passes step 1: the gig knows what it is', () => {
    const r = computeGigReadiness(input({ gig: noSetlist, setlist: [] }))
    const step1 = r.steps.find((s) => s.step === 1)!
    expect(step1.status).toBe('complete')
    expect(step1.missing).toEqual([])
  })

  it('fails step 2, and says a gig with no setlist is not a gig', () => {
    const r = computeGigReadiness(input({ gig: noSetlist, setlist: [] }))
    const step2 = r.steps.find((s) => s.step === 2)!
    expect(step2.status).toBe('not-yet')
    expect(step2.missing).toContain('The gig has no setlist.')
  })

  /**
   * **Not yet is not broken.** The file exists from the end of step 1 and is incomplete for most of
   * its life; `broken` is for the loud refusals, and a gig that could not be opened because it was
   * unfinished would be a gig that could never be finished.
   */
  it('is a gap and never a refusal', () => {
    const r = computeGigReadiness(input({ gig: noSetlist, setlist: [] }))
    expect(r.refusals).toEqual([])
    expect(r.steps.map((s) => s.status)).not.toContain('broken')
    expect(r.gate).toBe('on')
  })
})

/**
 * **Every designed check is its own structured field** (Jorge, 2026-09-03).
 *
 * `v0.47.0` shipped the check screen reporting that it could not draw the design's three checks as
 * three lines: two of them lived inside `songs[].missing` prose and the third shared a verdict
 * with a bad `visualsVersion` and a bad parse. **Reading strings to decide anything is the trap
 * step 9 already fell into**, where a predicate matched a substring against a rendered message and
 * blocked silently while never naming the real reason.
 *
 * These are the fields that replaced that, and the point of each is that **nothing reads a
 * sentence to know it**.
 */
describe('the checks as fields', () => {
  const readable = song('duelo')

  it('says which songs resolved to a file, without anybody reading the message', () => {
    const r = computeGigReadiness(
      input({
        setlist: [row(readable), brokenRow('libertad', '20 timeline entries, 24 lyric lines')],
      })
    )
    expect(r.songs.map((s) => [s.songId, s.fileResolves])).toEqual([
      ['duelo', true],
      ['libertad', false],
    ])
  })

  it('says which songs name a file that does not resolve, separately from that', () => {
    // A song whose own file read perfectly and whose media is not linked on this machine. Before
    // the split these were one verdict and one sentence.
    const withVideo = song('tragedia', {
      media: { type: 'video', src: 'tragedia.mp4' },
      timeline: [{ start: 0, end: 1 }],
    } as Partial<LibrarySong>)
    const r = computeGigReadiness(
      input({
        visuals: visuals({ 'song-lyrics': ['lyr'], 'song-video': ['vid'] }),
        setlist: [row(withVideo)],
        mediaResolution: {},
      })
    )
    const s = r.songs[0]!
    expect(s.fileResolves).toBe(true)
    expect(s.contentResolves).toBe(false)
  })

  it('calls a song that names no file resolved, because it names none', () => {
    // A lyrics-only song. `true` is the honest answer: there is nothing that failed to resolve.
    const r = computeGigReadiness(input({ setlist: [row(readable)] }))
    expect(r.songs[0]!.contentResolves).toBe(true)
  })

  it('does not blame a song whose own file did not read for files it never named', () => {
    // Nothing got as far as reading what it names, so there is no failed resolution to report.
    // The file line above it is what fails.
    const r = computeGigReadiness(input({ setlist: [brokenRow('libertad', 'nope')] }))
    expect(r.songs[0]!.fileResolves).toBe(false)
    expect(r.songs[0]!.contentResolves).toBe(true)
  })

  it('does not disagree with the sentences it sits beside', () => {
    // One computation, two answers: `contentResolves` cannot say *fine* while `missing` names a
    // file that is not there, because both are written by the same branch.
    const withVideo = song('tragedia', {
      media: { type: 'video', src: 'tragedia.mp4' },
      timeline: [{ start: 0, end: 1 }],
    } as Partial<LibrarySong>)
    const r = computeGigReadiness(
      input({
        visuals: visuals({ 'song-lyrics': ['lyr'], 'song-video': ['vid'] }),
        setlist: [row(withVideo)],
        mediaResolution: { 'tragedia.mp4': { linked: true, exists: false } },
      })
    )
    const s = r.songs[0]!
    expect(s.contentResolves).toBe(false)
    expect(s.missing.join(' ')).toContain('is not there')
  })

  it('names which refusal the room was, rather than only that it was one', () => {
    // **A mapping of a different room renders perfectly and reports nothing**, and it used to be
    // indistinguishable here from a file that will not parse.
    const r = computeGigReadiness(
      input({
        visuals: null,
        visualsProblem: 'visuals.json belongs to gig "last-month", not "k3f9x2abcd".',
        visualsRefusal: 'other-gig',
      })
    )
    expect(r.visualsRefusal).toBe('other-gig')
  })

  it('reports no refusal when there is simply no room yet', () => {
    // *Not mapped* and *mapped wrong* are different answers; `steps[3].status` tells them apart.
    const r = computeGigReadiness(input({ visuals: null, visualsPresent: false }))
    expect(r.visualsRefusal).toBeNull()
    expect(r.steps.find((s) => s.step === 3)!.status).toBe('not-yet')
  })

  it('falls back to unparseable for a refusal whose kind was not carried', () => {
    // Defensive: a caller that sets the sentence and forgets the kind gets the least specific
    // answer rather than a null that would read as *no refusal*.
    const r = computeGigReadiness(input({ visuals: null, visualsProblem: 'something went wrong' }))
    expect(r.visualsRefusal).toBe('unparseable')
  })
})

/**
 * **A song whose file will not read is a note at step 2 and a failure at step 4** (Jorge,
 * 2026-09-03). The two are not in conflict, and the principle is the whole of it: **a problem you
 * can still route around while composing becomes a blocker at the moment you assert readiness.**
 *
 * At step 2 such a song cannot be repaired from inside the flow — Bombista cannot take a file it
 * will not parse — so blocking there would make a guided path nobody can finish, and `libertad` is
 * the standing example. At step 4 you are asserting the gig is ready, and a song changed outside
 * the app is not.
 */
describe('an unreadable song: routed around while composing, blocking at the assertion', () => {
  const withBroken = () =>
    computeGigReadiness(
      input({
        setlist: [row(song('duelo')), brokenRow('libertad', '20 timeline entries, 24 lyric lines')],
      })
    )

  it('leaves step 2 complete, and keeps it as a note there', () => {
    const step2 = withBroken().steps.find((s) => s.step === 2)!
    expect(step2.status).toBe('complete')
    expect(step2.missing).toEqual([])
    expect(step2.notes.join(' ')).toContain('24 lyric lines')
  })

  it('fails step 4 and names the song', () => {
    const step4 = withBroken().steps.find((s) => s.step === 4)!
    expect(step4.status).toBe('not-yet')
    expect(step4.missing[0]).toContain('will not read')
    expect(step4.missing.join(' ')).toContain('libertad')
  })

  it('refuses the confirmation', () => {
    expect(withBroken().canConfirm).toBe(false)
  })

  it('says so in the plural when more than one will not read', () => {
    const r = computeGigReadiness(
      input({ setlist: [brokenRow('a', 'nope'), brokenRow('b', 'nope')] })
    )
    expect(r.steps.find((s) => s.step === 4)!.missing[0]).toContain('2 songs')
  })

  it('allows the confirmation when every file reads', () => {
    expect(computeGigReadiness(input()).canConfirm).toBe(true)
  })

  it('does not block the confirmation for a file the song NAMES not resolving', () => {
    // The ruling widened the gate for an unreadable song file and named nothing else. That song
    // still cannot be armed, which is a gate on the night rather than on the gig.
    const withVideo = song('tragedia', {
      media: { type: 'video', src: 'tragedia.mp4' },
      timeline: [{ start: 0, end: 1 }],
    } as Partial<LibrarySong>)
    const r = computeGigReadiness(
      input({
        visuals: visuals({ 'song-lyrics': ['lyr'], 'song-video': ['vid'] }),
        setlist: [row(withVideo)],
        mediaResolution: {},
      })
    )
    expect(r.songs[0]!.ready).toBe(false)
    expect(r.canConfirm).toBe(true)
  })

  it('refuses the confirmation while an earlier step is not done', () => {
    const r = computeGigReadiness(input({ visuals: null, visualsPresent: false }))
    expect(r.canConfirm).toBe(false)
  })

  it('refuses the confirmation with no gig folder open', () => {
    expect(computeGigReadiness(input({ folderPath: null })).canConfirm).toBe(false)
  })
})
