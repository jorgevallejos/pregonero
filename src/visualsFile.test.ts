import { describe, it, expect } from 'vitest'
import { parseVisualsFile, resolveShapesForType, shapeTypeOf } from './visualsFile'

const GIG = '2026-09-12-bar-eduard'

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
    expect(v.songVisuals).toEqual({ defaults: {}, songs: {} })
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
