import { describe, it, expect } from 'vitest'
import {
  parseVisualsFile,
  songAssetFor,
  songVideoAssets,
  resolveShapesForType,
  shapeFrame,
  shapeIsVisible,
  shapeOutline,
  shapeOutlineIsFrame,
  shapeTypeOf,
  type Point,
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

  it('refuses a path, because a name is what travels', () => {
    expect(songAssetFor(withAssets({ duelo: { v1: '../secret.mp4' } }), 'duelo', 'v1')).toBeNull()
    expect(songAssetFor(withAssets({ duelo: { v1: '/Users/x/a.mp4' } }), 'duelo', 'v1')).toBeNull()
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
