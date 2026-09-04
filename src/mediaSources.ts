/**
 * **Every file name the app is currently asked to turn into bytes**, gathered in one place so a
 * name that resolves to nothing can be seen instead of inferred from a dark patch of wall.
 *
 * Three kinds of name, and they were never listed together before: a song's declared `media`, a
 * static shape's `src`, and a `gig-contact`'s `qrSrc`. Only the first had a screen. The other two
 * arrived with the shapes that replaced the end card and the logo fallback, and they resolve the
 * same way, which is exactly why they were easy to miss — nothing failed, the wall was simply
 * emptier than it should have been.
 *
 * This reads; it never resolves. What a name resolves to is `resolveMediaPath`'s question and only
 * its question.
 */

import type { LibraryEntry } from './setlistStore'
import { shapeTypeOf, type VisualsFile } from './visualsFile'
import { readContactFields } from './ShapeContact'
import { isStaticType } from './ShapeStatic'

/** One name, and everything that asks for it. A name used twice is one row, not two. */
export type MediaSource = {
  src: string
  /** What refers to it, in the words the screen shows. Ordered as found, deduplicated. */
  uses: string[]
}

function add(into: Map<string, MediaSource>, src: string, use: string): void {
  if (!src) return
  const existing = into.get(src)
  if (!existing) {
    into.set(src, { src, uses: [use] })
    return
  }
  if (!existing.uses.includes(use)) existing.uses.push(use)
}

/**
 * The songs' videos first, then the room's own static sources. **Both come out of `visuals.json`
 * now**: a song names nothing, so the first loop reads what the room says each song plays.
 */
export function collectMediaSources(
  setlist: readonly LibraryEntry[],
  visuals: VisualsFile | null
): MediaSource[] {
  const found = new Map<string, MediaSource>()

  // **A song's video is named by the ROOM now, not by the song** (Jorge, 2026-09-03). This read
  // `song.media.src`; under *the song holds no media* that field has no writer, so a list built
  // from it would quietly stop naming the one thing this screen exists to resolve.
  for (const [songId, byShape] of Object.entries(visuals?.songVisuals.assets ?? {})) {
    const title = setlist.find((entry) => entry.ref.id === songId)?.song?.title ?? songId
    for (const src of Object.values(byShape)) {
      if (src) add(found, src, `${title} — video`)
    }
  }

  for (const shape of visuals?.shapes ?? []) {
    const type = shapeTypeOf(shape)
    const name = shape.name ?? shape.id
    if (isStaticType(type)) {
      const src = typeof shape.layer?.src === 'string' ? shape.layer.src : ''
      if (src) add(found, src, `${name} — ${type} shape`)
    } else if (type === 'gig-contact') {
      const qr = readContactFields(shape.layer).qrSrc
      if (qr) add(found, qr, `${name} — contact QR`)
    }
  }

  return [...found.values()]
}
