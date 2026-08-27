/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { collectMediaSources } from './mediaSources'
import type { LibraryEntry } from './setlistStore'
import type { VisualsFile, VisualShape } from './visualsFile'

function entry(id: string, title: string, src?: string): LibraryEntry {
  return {
    ref: { id, path: `/songs/${id}.json` },
    song: {
      id,
      title,
      items: [],
      ...(src ? { media: { type: 'video' as const, src } } : {}),
    },
  }
}

function visuals(shapes: VisualShape[]): VisualsFile {
  return {
    visualsVersion: 1,
    gigId: 'g',
    shapes,
    songVisuals: { defaults: {}, songs: {} },
  }
}

describe('the names the app has to turn into bytes', () => {
  it('lists a song’s declared media', () => {
    expect(collectMediaSources([entry('tragedia', 'Tragedia', 'tragedia.mp4')], null)).toEqual([
      { src: 'tragedia.mp4', uses: ['Tragedia — video'] },
    ])
  })

  it('lists a static image — the logo, which had no screen at all before', () => {
    const found = collectMediaSources(
      [],
      visuals([{ id: 's1', name: 'Logo', layer: { type: 'image', src: 'chango-pepper-logo.png' } }])
    )
    expect(found).toEqual([{ src: 'chango-pepper-logo.png', uses: ['Logo — image shape'] }])
  })

  it('lists a static video and a contact QR', () => {
    const found = collectMediaSources(
      [],
      visuals([
        { id: 's1', name: 'Loop', layer: { type: 'video', src: 'loop.mp4' } },
        { id: 's2', name: 'Contact', layer: { type: 'gig-contact', text: 'hi', qrSrc: 'qr.png' } },
      ])
    )
    expect(found.map((f) => f.src)).toEqual(['loop.mp4', 'qr.png'])
    expect(found[1]!.uses).toEqual(['Contact — contact QR'])
  })

  it('is one row per name, however many things ask for it', () => {
    const found = collectMediaSources(
      [entry('a', 'A', 'shared.mp4'), entry('b', 'B', 'shared.mp4')],
      visuals([{ id: 's1', name: 'Wall', layer: { type: 'video', src: 'shared.mp4' } }])
    )
    expect(found).toHaveLength(1)
    expect(found[0]!.uses).toEqual(['A — video', 'B — video', 'Wall — video shape'])
  })

  it('ignores shapes that name no file, and a blank name', () => {
    const found = collectMediaSources(
      [entry('a', 'A')],
      visuals([
        { id: 's1', layer: { type: 'song-lyrics' } },
        { id: 's2', layer: { type: 'image', src: '' } },
        { id: 's3', layer: { type: 'gig-contact', text: 'hi', qrSrc: '   ' } },
        { id: 's4', layer: { type: 'pattern' } },
      ])
    )
    expect(found).toEqual([])
  })

  it('names a shape by its id when it has no name', () => {
    const found = collectMediaSources([], visuals([{ id: 'shape-7', layer: { type: 'image', src: 'x.png' } }]))
    expect(found[0]!.uses).toEqual(['shape-7 — image shape'])
  })
})
