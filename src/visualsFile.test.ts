import { describe, it, expect } from 'vitest'
import {
  parseVisualsFile,
  activeModeFor,
  doubledShapeLines,
  modeCondition,
  shapeModeId,
  songAssetFor,
  songIsCarried,
  songVideoAssets,
  resolveShapesForType,
  shapeFrame,
  shapeIsVisible,
  shapeOutline,
  shapeOutlineIsFrame,
  shapeTypeOf,
  type Point,
  type VisualsFile,
} from './visualsFile'

const GIG = 'k3f9x2abcd'

function doc(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    visualsVersion: 1,
    gigId: GIG,
    shapes: [
      { id: 's1', name: 'Left wall', layer: { type: 'song-lyrics' } },
      { id: 's2', name: 'Right wall', layer: { type: 'song-lyrics' } },
      { id: 'v1', name: 'Screen', layer: { type: 'song-video' } },
      { id: 'logo', name: 'Logo', layer: { type: 'image' } },
    ],
    songVisuals: {
      defaults: { 'song-lyrics': ['s1'] },
      songs: { duelo: { 'song-lyrics': ['s2'] } },
    },
    ...overrides,
  })
}

describe('parseVisualsFile', () => {
  it('reads Muralista’s own field names', () => {
    const v = parseVisualsFile(doc(), GIG)
    expect(v.gigId).toBe(GIG)
    expect(v.shapes).toHaveLength(4)
    expect(v.songVisuals.defaults['song-lyrics']).toEqual(['s1'])
  })

  it('refuses a version it does not know, loudly and by number', () => {
    expect(() => parseVisualsFile(doc({ visualsVersion: 7 }), GIG)).toThrow(/version 7/)
  })

  it('refuses a file that declares no version', () => {
    expect(() => parseVisualsFile(JSON.stringify({ gigId: GIG }), GIG)).toThrow(
      /no visualsVersion/
    )
  })

  it('refuses a mapping of a different room, and names both gigs', () => {
    expect(() => parseVisualsFile(doc({ gigId: 'last-month' }), GIG)).toThrow(
      /belongs to gig "last-month"/
    )
  })

  it('refuses a file that names no gig rather than stamping one', () => {
    const text = doc()
    const withoutGig = JSON.parse(text) as Record<string, unknown>
    delete withoutGig.gigId
    expect(() => parseVisualsFile(JSON.stringify(withoutGig), GIG)).toThrow(/names no gig/)
  })

  it('refuses malformed JSON by name', () => {
    expect(() => parseVisualsFile('{', GIG)).toThrow(/not valid JSON/)
  })

  it('drops a per-song gig-contact entry, which is a gig-level fact', () => {
    const v = parseVisualsFile(
      doc({ songVisuals: { defaults: {}, songs: { duelo: { 'gig-contact': ['c1'] } } } }),
      GIG
    )
    expect(v.songVisuals.songs.duelo).toBeUndefined()
  })

  it('survives a file with no songVisuals at all — absence is the empty state', () => {
    const v = parseVisualsFile(JSON.stringify({ visualsVersion: 1, gigId: GIG, shapes: [] }), GIG)
    expect(v.songVisuals).toEqual({ defaults: {}, songs: {}, assets: {} })
  })
})

/**
 * **What a song puts in a shape** — the field that made *the song holds no media* buildable
 * (Jorge, 2026-09-03/04). A song carries words and timing; **what plays on the wall is the
 * visuals**, and this is where the pairing lives.
 *
 * **It is not the map beside it.** `songs` answers *which shape does this song use*, which is
 * reassignment; `assets` answers *what does this song put in it*. Two questions that look alike.
 */
describe('song assets', () => {
  const QUAD: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  const withAssets = (assets: unknown) =>
    parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: GIG,
        shapes: [
          { id: 'v1', name: 'Frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
          { id: 'v2', name: 'Pillar', layer: { type: 'song-video' }, corners: QUAD, visible: true },
        ],
        songVisuals: { defaults: { 'song-video': ['v1', 'v2'] }, assets },
      }),
      GIG
    )

  it('reads song → shape → name', () => {
    const v = withAssets({ duelo: { v1: 'cerdo.mp4' } })
    expect(songAssetFor(v, 'duelo', 'v1')).toBe('cerdo.mp4')
    expect(songAssetFor(v, 'duelo', 'v2')).toBeNull()
    expect(songAssetFor(v, 'vidas', 'v1')).toBeNull()
    expect(songAssetFor(v, null, 'v1')).toBeNull()
  })

  /**
   * **A NAME MAY BE A RELATIVE PATH INSIDE THE FOLDER, AND REFUSING ONE WAS SILENTLY UNASSIGNING
   * EVERY VIDEO IN THE CATALOGUE** (found on the wall, 2026-09-06).
   *
   * A video was assigned for `tragedia`, walked through to sign-off, and `video` drive mode was
   * then unavailable *because the song had no video*. **`songVisuals.assets` in the real gig's
   * `visuals.json` is `{}`** while `defaults` beside it is populated — so the file was written and
   * the assignment was not in it.
   *
   * **Both repos refused any value containing a separator**, on a rule that was right when it was
   * written: *a path here would be a fact about one machine written into a file built to travel.*
   * **The listing stopped being flat on 2026-09-04 and this did not follow.** That change's own
   * argument was that the constraint that mattered was *not absolute*, never *one segment* —
   * `tragedia/pig.mov` leaks no more about where the folder lives than `pig.mov` does — and it was
   * made because the real visuals folder holds **every animation one level down in a per-song
   * directory**. So the picker offered a nested path, the row showed it as assigned, and the
   * serialiser dropped it. **Every assignment in that folder was silently unassigned.**
   *
   * **What is refused is what was always the point**: absolute, escaping, or a fact about one
   * machine. `assetNameIsRelative` is that rule and Muralista's `sanitizeSongAssets` is its mirror.
   */
  it('keeps a relative path inside the folder, because the listing offers them', () => {
    expect(songAssetFor(withAssets({ duelo: { v1: 'tragedia/pig.mov' } }), 'duelo', 'v1')).toBe(
      'tragedia/pig.mov'
    )
    expect(songAssetFor(withAssets({ duelo: { v1: 'a/b/c/d.mp4' } }), 'duelo', 'v1')).toBe('a/b/c/d.mp4')
  })

  it('refuses what a path here was ever a problem for', () => {
    const refused = [
      '/Users/x/a.mp4', // absolute: a fact about one machine
      '../secret.mp4', // escaping the folder
      'a/../../b.mp4',
      'a\\b.mp4', // a Windows separator is a fact about one machine too
      'a//b.mp4', // an empty segment
      'a/b/', // a trailing separator names a directory
      './a.mp4', // a no-op segment the listing never emits
      'a/b/c/d/e.mp4', // deeper than the listing walks
      '   ',
    ]
    for (const name of refused) {
      expect(
        songAssetFor(withAssets({ duelo: { v1: name } }), 'duelo', 'v1'),
        `${JSON.stringify(name)} was kept`
      ).toBeNull()
    }
  })

  /** **A set, not a shape.** Two video shapes is how a corner gets spanned, and each carries its own. */
  it('gathers every name a song’s video shapes ask for, and names the ones asking for none', () => {
    const v = withAssets({ duelo: { v1: 'cerdo.mp4' } })
    expect(songVideoAssets(v, 'duelo')).toEqual({ named: ['cerdo.mp4'], unassigned: ['Pillar'] })
  })

  it('says a song with nothing assigned needs nothing and lights nothing', () => {
    const v = withAssets({})
    expect(songVideoAssets(v, 'duelo')).toEqual({ named: [], unassigned: ['Frame', 'Pillar'] })
  })
})

describe('shapeTypeOf', () => {
  it('reads the type off the layer, where Muralista keeps it', () => {
    expect(shapeTypeOf({ id: 'x', layer: { type: 'song-video' } })).toBe('song-video')
  })

  it('defaults an untyped shape to pattern, as Muralista does', () => {
    expect(shapeTypeOf({ id: 'x' })).toBe('pattern')
  })
})

describe('resolveShapesForType', () => {
  const visuals = parseVisualsFile(doc(), GIG)

  it('gives a song with no reassignment the gig-level shape', () => {
    expect(resolveShapesForType(visuals, 'song-lyrics', 'vidas').map((s) => s.id)).toEqual(['s1'])
  })

  it('gives a deviating song its own', () => {
    expect(resolveShapesForType(visuals, 'song-lyrics', 'duelo').map((s) => s.id)).toEqual(['s2'])
  })

  it('returns a set, not a shape — two shapes span a corner', () => {
    const two = parseVisualsFile(
      doc({ songVisuals: { defaults: { 'song-lyrics': ['s1', 's2'] }, songs: {} } }),
      GIG
    )
    expect(resolveShapesForType(two, 'song-lyrics', 'vidas').map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('resolves nothing for a type the gig has not assigned', () => {
    expect(resolveShapesForType(visuals, 'song-video', 'vidas')).toEqual([])
  })

  it('drops an id whose shape was retyped since the assignment was made', () => {
    const retyped = parseVisualsFile(
      doc({
        shapes: [{ id: 's1', layer: { type: 'image' } }],
        songVisuals: { defaults: { 'song-lyrics': ['s1'] }, songs: {} },
      }),
      GIG
    )
    expect(resolveShapesForType(retyped, 'song-lyrics', 'vidas')).toEqual([])
  })

  it('drops an id whose shape was deleted', () => {
    const gone = parseVisualsFile(
      doc({ shapes: [], songVisuals: { defaults: { 'song-lyrics': ['s1'] }, songs: {} } }),
      GIG
    )
    expect(resolveShapesForType(gone, 'song-lyrics', 'vidas')).toEqual([])
  })
})

describe('a shape’s geometry, read out of Muralista’s file', () => {
  const FRAME: Point[] = [
    [0.1, 0.1],
    [0.9, 0.2],
    [0.85, 0.8],
    [0.15, 0.7],
  ]

  it('takes the outline as the frame while it has exactly four points', () => {
    // Not a copy of the frame and not synchronised with it — the same four points. That is what
    // makes one set of handles enough in Muralista, and it is Muralista's rule, not ours.
    expect(shapeFrame({ id: 'a', outline: FRAME, corners: null })).toBe(FRAME)
  })

  it('falls back to `corners` past four outline points, which is the pinned quad', () => {
    const ring: Point[] = [...FRAME, [0.5, 0.95]]
    expect(shapeFrame({ id: 'a', outline: ring, corners: FRAME })).toBe(FRAME)
  })

  it('has no frame when there is none to be had, rather than inventing one', () => {
    expect(shapeFrame({ id: 'a' })).toBeNull()
    expect(shapeFrame({ id: 'a', corners: [[0, 0]] as Point[] })).toBeNull()
    expect(shapeFrame(null)).toBeNull()
  })

  it('reads an outline of three or more points, and nothing shorter', () => {
    const triangle: Point[] = [
      [0, 0],
      [1, 0],
      [0.5, 1],
    ]
    expect(shapeOutline({ id: 'a', outline: triangle })).toBe(triangle)
    // Two points is not a polygon: it would paint nothing while sitting in the list looking live.
    expect(shapeOutline({ id: 'a', outline: [[0, 0], [1, 1]] as Point[], corners: FRAME })).toBe(FRAME)
  })

  it('knows when the outline is the frame, which is when it clips nothing', () => {
    expect(shapeOutlineIsFrame({ id: 'a', outline: FRAME })).toBe(true)
    expect(shapeOutlineIsFrame({ id: 'a', outline: [...FRAME, [0.5, 0.95]] as Point[] })).toBe(false)
  })

  it('treats an absent `visible` as visible, the way Muralista does', () => {
    expect(shapeIsVisible({ id: 'a' })).toBe(true)
    expect(shapeIsVisible({ id: 'a', visible: true })).toBe(true)
    expect(shapeIsVisible({ id: 'a', visible: false })).toBe(false)
  })
})

describe('a hidden shape', () => {
  it('does not resolve, so the gate and the wall cannot disagree about it', () => {
    // Muralista's own output filters on `shape.visible`. Filtering it here, in the one lookup,
    // is what stops a hidden shape passing the arm gate and then painting nothing.
    const visuals = parseVisualsFile(
      doc({
        shapes: [
          { id: 's1', name: 'Left wall', layer: { type: 'song-lyrics' }, visible: false },
          { id: 's2', name: 'Right wall', layer: { type: 'song-lyrics' } },
        ],
      }),
      GIG
    )
    expect(resolveShapesForType(visuals, 'song-lyrics', null)).toEqual([])
    expect(resolveShapesForType(visuals, 'song-lyrics', 'duelo').map((s) => s.id)).toEqual(['s2'])
  })
})

/**
 * **NAMED MODES** (Jorge, 2026-09-05, `project-context.md`).
 *
 * Cowork proposed a flag saying *for songs with video / without*; **Jorge rejected it as domain
 * knowledge Muralista does not have** — whether a song has a video lives below its line. His
 * replacement asks about **another shape**, which is Muralista's own vocabulary: **it declares the
 * relationship, this app evaluates it**, because this app is the one that knows what content landed.
 * That split is unchanged; what moved on 2026-09-05 is where the condition lives.
 *
 * **A mode is a condition plus a set of shapes.** Exclusivity used to be an unwritten assumption
 * that the two conditions partition, which nothing enforced. **Now it comes from the rule:** an
 * ordered list, first true condition wins, and when none matches no mode is live.
 *
 * **It is about content, never existence.** Shapes always exist; what varies per song is whether
 * they got something. Filled means an asset is assigned for that song.
 */
describe('named modes', () => {
  const QUAD: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  /** The designed default: a video frame in no mode, and one lyrics shape in each of the two. */
  const room = (assets: Record<string, Record<string, string>> = {}) =>
    parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: GIG,
        modes: [
          { id: 'm-plain', name: 'Song with lyrics', when: { shape: 'frame', is: 'empty' } },
          {
            id: 'm-video',
            name: 'Song with video and lyrics',
            when: { shape: 'frame', is: 'filled' },
          },
        ],
        shapes: [
          { id: 'frame', name: 'Frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
          {
            id: 'foot',
            name: 'Foot',
            layer: { type: 'song-lyrics' },
            corners: QUAD,
            visible: true,
            mode: 'm-video',
          },
          {
            id: 'across',
            name: 'Across',
            layer: { type: 'song-lyrics' },
            corners: QUAD,
            visible: true,
            mode: 'm-plain',
          },
        ],
        songVisuals: {
          defaults: { 'song-video': ['frame'], 'song-lyrics': ['foot', 'across'] },
          assets,
        },
      }),
      GIG
    )

  const lyricsFor = (v: VisualsFile, songId: string | null) =>
    resolveShapesForType(v, 'song-lyrics', songId).map((s) => s.id)

  it('reads the condition off the mode, and membership off the shape', () => {
    const v = room()
    expect(v.modes.map((m) => m.name)).toEqual(['Song with lyrics', 'Song with video and lyrics'])
    expect(modeCondition(v.modes[1]!)).toEqual({ shape: 'frame', is: 'filled' })
    expect(shapeModeId(v.shapes[1]!)).toBe('m-video')
    expect(shapeModeId(v.shapes[0]!)).toBeNull()
  })

  /** **The whole point of the round**, in one assertion per branch. */
  it('gives a song with an animation words at the foot, and one without words across the frame', () => {
    expect(lyricsFor(room({ duelo: { frame: 'cerdo.mp4' } }), 'duelo')).toEqual(['foot'])
    expect(lyricsFor(room(), 'duelo')).toEqual(['across'])
  })

  it('leaves the no-mode shape alone in both cases', () => {
    expect(resolveShapesForType(room({ duelo: { frame: 'x.mp4' } }), 'song-video', 'duelo')).toHaveLength(1)
    expect(resolveShapesForType(room(), 'song-video', 'duelo')).toHaveLength(1)
  })

  /** Each song answers for itself: the mode is resolved per song, like the asset it reads. */
  it('answers per song, not per gig', () => {
    const v = room({ duelo: { frame: 'cerdo.mp4' } })
    expect(lyricsFor(v, 'duelo')).toEqual(['foot'])
    expect(lyricsFor(v, 'vidas')).toEqual(['across'])
  })

  /**
   * **With no song at all nothing is assigned to anything**, so a target reads *empty*. That is the
   * honest answer rather than a special case — an asset is a per-song fact and there is no song.
   */
  it('treats a target as empty when there is no song', () => {
    expect(lyricsFor(room({ duelo: { frame: 'cerdo.mp4' } }), null)).toEqual(['across'])
  })

  /**
   * **THE LIST IS HONEST OR IT IS NOT A LIST.** Muralista's authoring surface seeds exactly two
   * modes and offers no way to make a third — **and the file format says list.** A reader that
   * quietly assumed two would be the half of a contract mismatch that refuses what the other side
   * wrote, which is the exact shape of the five mismatches of 02/09 and of `countInBars`.
   *
   * So this is the same hand-written three-mode room Muralista's `modes.test.mjs` renders, read by
   * the consumer. **The third assertion is the one with teeth:** both conditions are true at once,
   * and **order decides** — which two hand-written branches have no answer for at all.
   */
  it('renders a hand-written THREE-MODE room, and order decides when two conditions are true', () => {
    const threeModes = (assets: Record<string, Record<string, string>>) =>
      parseVisualsFile(
        JSON.stringify({
          visualsVersion: 1,
          gigId: GIG,
          modes: [
            { id: 'm-both', name: 'Video and translation', when: { shape: 'trans', is: 'filled' } },
            { id: 'm-video', name: 'Video and lyrics', when: { shape: 'video', is: 'filled' } },
            { id: 'm-plain', name: 'Lyrics only', when: { shape: 'video', is: 'empty' } },
          ],
          shapes: [
            { id: 'video', layer: { type: 'song-video' }, corners: QUAD, visible: true },
            { id: 'trans', layer: { type: 'song-video' }, corners: QUAD, visible: true },
            { id: 'wide', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-plain' },
            { id: 'foot', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-video' },
            { id: 'left', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-both' },
            { id: 'right', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-both' },
          ],
          songVisuals: {
            defaults: { 'song-lyrics': ['wide', 'foot', 'left', 'right'] },
            assets,
          },
        }),
        GIG
      )

    expect(lyricsFor(threeModes({}), 'duelo')).toEqual(['wide'])
    expect(lyricsFor(threeModes({ duelo: { video: 'a.mp4' } }), 'duelo')).toEqual(['foot'])
    expect(
      lyricsFor(threeModes({ duelo: { video: 'a.mp4', trans: 'b.mp4' } }), 'duelo')
    ).toEqual(['left', 'right'])
  })

  /**
   * **WHAT HAPPENS WHEN NO CONDITION MATCHES IS STATED, NOT LEFT TO FALL OUT.** No mode is live and
   * only the no-mode shapes paint. Two complementary conditions never reach that case; a list has
   * to answer it anyway, and the answer being *nothing* is what makes `songIsCarried` report it.
   */
  it('lights no mode at all when nothing matches, and says so through songIsCarried', () => {
    const v = parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: GIG,
        modes: [{ id: 'm-a', name: 'Only with video', when: { shape: 'frame', is: 'filled' } }],
        shapes: [
          { id: 'frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
          { id: 'words', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-a' },
        ],
        songVisuals: { defaults: { 'song-video': ['frame'], 'song-lyrics': ['words'] } },
      }),
      GIG
    )
    expect(activeModeFor(v, 'duelo')).toBeNull()
    expect(lyricsFor(v, 'duelo')).toEqual([])
    expect(songIsCarried(v, 'duelo')).toBe(false)
  })

  /** A mode with no usable condition is never live. There is nothing left for it to ask. */
  it('never lights a mode whose condition is malformed', () => {
    const v = parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: GIG,
        modes: [{ id: 'm-a', name: 'Broken', when: { shape: 'frame', is: 'sometimes' } }],
        shapes: [
          { id: 'frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
          { id: 'words', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-a' },
        ],
        songVisuals: { defaults: { 'song-lyrics': ['words'] } },
      }),
      GIG
    )
    expect(v.modes[0]!.when).toBeNull()
    expect(activeModeFor(v, 'duelo')).toBeNull()
  })

  /**
   * **A file this app did not write is arbitrary JSON.** An entry with no id cannot be pointed at
   * and is not a mode; a duplicate id would make membership ambiguous. Both are dropped, and
   * **membership pointing at a mode the file does not hold makes the shape always-on** — the safe
   * direction and the visible one, where *live in no mode at all* paints nothing with nothing
   * anywhere saying why.
   */
  it('rebuilds the mode list rather than trusting it, and frees an orphaned shape', () => {
    const v = parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: GIG,
        modes: [
          { id: 'm-a', when: { shape: 'frame', is: 'empty' } },
          { id: 'm-a', name: 'Duplicate' },
          { name: 'No id' },
          'not an object',
        ],
        shapes: [
          { id: 'frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
          { id: 'orphan', layer: { type: 'song-lyrics' }, corners: QUAD, visible: true, mode: 'm-gone' },
        ],
        songVisuals: { defaults: { 'song-lyrics': ['orphan'] } },
      }),
      GIG
    )
    expect(v.modes).toEqual([{ id: 'm-a', name: 'Mode', when: { shape: 'frame', is: 'empty' } }])
    expect(shapeModeId(v.shapes[1]!)).toBeNull()
    expect(lyricsFor(v, 'duelo')).toEqual(['orphan'])
  })

  /** A hidden shape stays hidden whatever mode it is in: two gates, both in the one lookup. */
  it('still honours the author’s hidden flag', () => {
    const v = room()
    v.shapes[2]!.visible = false
    expect(lyricsFor(v, null)).toEqual([])
  })
})

/**
 * **PER MODE, HOW MANY SHAPES OF EACH KIND ARE LIVE** (Jorge, 2026-09-05).
 *
 * **The failure named modes did NOT close.** They made the room exclusive between themselves by
 * construction; the always group is not a mode and is deliberately not exclusive with anything —
 * a backdrop, a logo and a video frame all belong there. So **a no-mode lyrics shape and a mode's
 * lyrics shape are both live at once**, stacked, and that is authorable by accident.
 */
describe('the per-mode census', () => {
  const QUAD: Point[] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]
  /**
   * **The gig-level defaults are derived from the shapes**, which is what Muralista's
   * `syncGigDefaultsFromShapes` writes: every shape of a song-aware type is that type's default.
   * The census reads the defaults rather than the whole shape list — a room may hold a second
   * lyrics shape that only a reassigned song uses, and that is reassignment working.
   */
  const build = (shapes: { id: string; layer: { type: string }; visible: boolean; corners?: Point[] }[]) => {
    const defaults: Record<string, string[]> = {}
    for (const shape of shapes) (defaults[shape.layer.type] ??= []).push(shape.id)
    return parseVisualsFile(
      JSON.stringify({
        visualsVersion: 1,
        gigId: GIG,
        modes: [
          { id: 'm-plain', name: 'Song with lyrics', when: { shape: 'frame', is: 'empty' } },
          { id: 'm-video', name: 'Song with video and lyrics', when: { shape: 'frame', is: 'filled' } },
        ],
        shapes,
        songVisuals: { defaults },
      }),
      GIG
    )
  }
  const lyrics = (id: string, mode?: string) => ({
    id,
    layer: { type: 'song-lyrics' },
    corners: QUAD,
    visible: true,
    ...(mode ? { mode } : {}),
  })

  it('says nothing about a room that says each thing once', () => {
    const v = build([
      { id: 'frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
      lyrics('foot', 'm-video'),
      lyrics('across', 'm-plain'),
    ])
    expect(doubledShapeLines(v)).toEqual([])
  })

  /** The accident: a shape dragged out of a group to look at something and not dragged back. */
  it('catches a no-mode lyrics shape stacked on a mode’s lyrics shape', () => {
    const v = build([
      { id: 'frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
      lyrics('stray'),
      lyrics('foot', 'm-video'),
      lyrics('across', 'm-plain'),
    ])
    expect(doubledShapeLines(v)).toEqual([
      'Song with lyrics: 2 song-lyrics shapes live at once.',
      'Song with video and lyrics: 2 song-lyrics shapes live at once.',
    ])
  })

  /** **Two shapes inside ONE mode are the same fault**, and it is reported against that mode only. */
  it('catches two lyrics shapes inside one mode', () => {
    const v = build([
      { id: 'frame', layer: { type: 'song-video' }, corners: QUAD, visible: true },
      lyrics('foot', 'm-video'),
      lyrics('also', 'm-video'),
      lyrics('across', 'm-plain'),
    ])
    expect(doubledShapeLines(v)).toEqual([
      'Song with video and lyrics: 2 song-lyrics shapes live at once.',
    ])
  })

  /**
   * **The no-mode room is a row too**, because *no mode matched* is a state the list has to answer
   * and a song can land in it. Here it is clean while a mode is not, which is exactly the case a
   * census over modes alone would miss going the other way.
   */
  it('counts the room a song matching no mode would get', () => {
    const v = build([lyrics('stray'), lyrics('also-stray')])
    expect(doubledShapeLines(v)).toContain('When no mode matches: 2 song-lyrics shapes live at once.')
  })

  /** A hidden shape is not live, so it is not counted. Same gate as everywhere else. */
  it('does not count a hidden shape', () => {
    const v = build([
      lyrics('stray'),
      { id: 'off', layer: { type: 'song-lyrics' }, corners: QUAD, visible: false },
    ])
    expect(doubledShapeLines(v)).toEqual([])
  })

  /**
   * **Only the song-aware kinds.** Two fills, two logos or two text cards stacked is composition;
   * two lyrics shapes live at once is the wall saying the same thing twice.
   */
  it('says nothing about two fills or two text cards', () => {
    const v = build([
      { id: 'a', layer: { type: 'fill' }, corners: QUAD, visible: true },
      { id: 'b', layer: { type: 'fill' }, corners: QUAD, visible: true },
      { id: 'c', layer: { type: 'text' }, corners: QUAD, visible: true },
      { id: 'd', layer: { type: 'text' }, corners: QUAD, visible: true },
    ])
    expect(doubledShapeLines(v)).toEqual([])
  })
})
