/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { collectMediaSources } from './mediaSources'
import type { LibraryEntry } from './setlistStore'
import type { VisualsFile, VisualShape } from './visualsFile'
import { VISUALS_VERSION } from './visualsFile'

function entry(id: string, title: string): LibraryEntry {
  return { ref: { id, path: `/songs/${id}.json` }, song: { id, title, items: [] } }
}

function visuals(
  shapes: VisualShape[],
  assets: Record<string, Record<string, string>> = {}
): VisualsFile {
  return {
    visualsVersion: VISUALS_VERSION,
    gigId: 'g',
    modes: [],
    shapes,
    songVisuals: { defaults: {}, songs: {}, assets },
  }
}

describe('the names the app has to turn into bytes', () => {
  /**
   * **The song's video, named by the ROOM** (Jorge, 2026-09-03). It used to be `song.media.src`;
   * under *the song holds no media* that field has no writer, and a list built from it would
   * quietly stop naming the one thing this screen exists to resolve.
   */
  it('lists the video the room says a song plays', () => {
    const found = collectMediaSources(
      [entry('tragedia', 'Tragedia')],
      visuals([], { tragedia: { 'v-1': 'tragedia.mp4' } })
    )
    expect(found).toEqual([{ src: 'tragedia.mp4', uses: ['Tragedia — video'] }])
  })

  it('lists a static image — the logo, which had no screen at all before', () => {
    const found = collectMediaSources(
      [],
      visuals([{ id: 's1', name: 'Logo', layer: { type: 'image', src: 'chango-pepper-logo.png' } }])
    )
    expect(found).toEqual([{ src: 'chango-pepper-logo.png', uses: ['Logo — image shape'] }])
  })

  /**
   * **THE CONTACT QR WAS THE SECOND HALF OF THIS TEST AND IS GONE** (2026-09-04). `gig-contact`
   * stopped being a shape type, so no layer holds a `qrSrc` for this to find. What is asserted now
   * is that a shape of that name contributes NOTHING — an old `visuals.json` still on disk names
   * one, and a stale row pointing at a file nothing can use would be worse than no row.
   */
  it('lists a static video, and nothing for a retired contact shape', () => {
    const found = collectMediaSources(
      [],
      visuals([
        { id: 's1', name: 'Loop', layer: { type: 'video', src: 'loop.mp4' } },
        { id: 's2', name: 'Contact', layer: { type: 'gig-contact', text: 'hi', qrSrc: 'qr.png' } },
      ])
    )
    expect(found.map((f) => f.src)).toEqual(['loop.mp4'])
  })

  it('is one row per name, however many things ask for it', () => {
    const found = collectMediaSources(
      [entry('a', 'A'), entry('b', 'B')],
      visuals([{ id: 's1', name: 'Wall', layer: { type: 'video', src: 'shared.mp4' } }], {
        a: { 'v-1': 'shared.mp4' },
        b: { 'v-1': 'shared.mp4' },
      })
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
