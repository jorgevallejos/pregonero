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
 * The songs first, then the room. Both are optional: a gig with no visuals still has song media,
 * and a room with a logo still has one before any setlist exists.
 */
export function collectMediaSources(
  setlist: readonly LibraryEntry[],
  visuals: VisualsFile | null
): MediaSource[] {
  const found = new Map<string, MediaSource>()

  for (const entry of setlist) {
    const src = entry.song?.media?.src
    if (src) add(found, src, `${entry.song?.title ?? entry.ref.id} — video`)
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
