/**
 * `visuals.json` — the room. **Muralista writes it; Pregonero only ever reads it.**
 *
 * The field names here are Muralista's, taken from its `visualsDocument()`: `visualsVersion`,
 * `gigId`, `shapes`, `songVisuals`, and a shape's type living at `shape.layer.type`. The kickoff
 * prompt for this stage named them `schemaVersion` and `gig`; those names appear in no writer and
 * would have refused every real file.
 *
 * Two hard refusals, and both are refusals rather than repairs:
 *
 * - **A `visualsVersion` this build does not know.** Rendering a schema you half-understand is
 *   the failure mode that reaches a wall.
 * - **A `gigId` that is missing or is not this gig's.** Copying last month's gig folder to start
 *   the next one and not re-mapping gives you a mapping of the wrong room that renders perfectly,
 *   with nothing anywhere reporting it. Do not repair it and do not stamp it — the fix is in
 *   Muralista, where the wall is.
 */

export const VISUALS_VERSION = 1

/**
 * **Why the refusal is typed** (2026-09-03).
 *
 * `parseVisualsFile` refuses three different things and used to say so only in a sentence. The
 * check screen's last line before a gig is confirmed is *the visuals belong to this gig*, and
 * telling that apart from *this file will not parse* meant matching the message — **which is the
 * trap step 9 already fell into**, where a predicate matched a substring against rendered prose
 * and blocked silently while never mentioning the real reason.
 *
 * So the kind travels with the message. Nothing reads the sentence to decide anything.
 *
 * - `unparseable` — not JSON, not an object, or declaring no `visualsVersion`.
 * - `unknown-version` — a `visualsVersion` this build does not understand.
 * - `other-gig` — a mapping of a different room. **The one this file exists to catch**: copying
 *   last month's gig folder to start the next one renders perfectly and reports nothing.
 * - `unreadable` — never thrown here. It is the kind for a folder read that failed before this
 *   function was reached, so callers have one vocabulary rather than two.
 */
export type VisualsRefusalKind = 'unparseable' | 'unknown-version' | 'other-gig' | 'unreadable'

/** A refusal that names its kind. `parseVisualsFile` throws only this. */
export class VisualsRefused extends Error {
  readonly kind: VisualsRefusalKind
  constructor(kind: VisualsRefusalKind, message: string) {
    super(message)
    this.name = 'VisualsRefused'
    this.kind = kind
  }
}

/** The kind of a caught refusal, or `unparseable` for anything that is not one of ours. */
export function visualsRefusalKind(error: unknown): VisualsRefusalKind {
  return error instanceof VisualsRefused ? error.kind : 'unparseable'
}

/** The four song-aware types. `gig-contact` is a gig-level fact and is never reassigned per song. */
export const SONG_AWARE_TYPES = ['song-lyrics', 'song-video', 'song-intro', 'gig-contact'] as const
export const SONG_REASSIGNABLE_TYPES = ['song-lyrics', 'song-video', 'song-intro'] as const

export type SongAwareType = (typeof SONG_AWARE_TYPES)[number]
export type SongReassignableType = (typeof SONG_REASSIGNABLE_TYPES)[number]

/** A normalised point. Resolution-independent by construction, which is the whole point of it. */
export type Point = [number, number]

/**
 * One mapped region.
 *
 * **Geometry is Muralista's, and none of it is interpreted here.** What this file does is *read*
 * the four corners out of the record so the warp can be evaluated at the real output size; the
 * maths that turns them into a transform is `src/vendor/warp.js`, which is Muralista's code run
 * unchanged.
 */
export type VisualShape = {
  id: string
  name?: string
  /** The content frame: four normalised corners, `[TL, TR, BR, BL]`. */
  corners?: Point[] | null
  /** The clipping ring: three or more normalised points. At exactly four it *is* the frame. */
  outline?: Point[] | null
  layer?: { type?: string } & Record<string, unknown>
  visible?: boolean
  [key: string]: unknown
}

function isPoint(p: unknown): p is Point {
  return Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && isFinite(n))
}

/** Four finite normalised points — the shape both `corners` and a four-point outline take. */
export function isQuad(q: unknown): q is Point[] {
  return Array.isArray(q) && q.length === 4 && q.every(isPoint)
}

/** Three or more finite normalised points. Fewer than three is not a polygon. */
export function isPointRing(pts: unknown): pts is Point[] {
  return Array.isArray(pts) && pts.length >= 3 && pts.every(isPoint)
}

/**
 * **The four corners the warp uses**, or null when there are none to be had.
 *
 * While the outline has exactly four points, *the outline is the frame* — the same four points,
 * not a copy of them. Past four there is no quad to read off it, so `corners` is consulted: it
 * holds the last four-corner value the shape had, and the extra points only clip. This is
 * Muralista's rule, read from Muralista's file; the only thing Pregonero does with the answer is
 * hand it to `frameMatrix3d`.
 */
export function shapeFrame(shape: VisualShape | null | undefined): Point[] | null {
  if (!shape) return null
  if (isQuad(shape.outline)) return shape.outline
  return isQuad(shape.corners) ? shape.corners : null
}

/** The clipping ring, falling back to the frame — what a shape meant before outlines existed. */
export function shapeOutline(shape: VisualShape | null | undefined): Point[] | null {
  if (!shape) return null
  if (isPointRing(shape.outline)) return shape.outline
  return isQuad(shape.corners) ? shape.corners : null
}

/** True while the outline *is* the frame, in which case it clips nothing and gets no clip at all. */
export function shapeOutlineIsFrame(shape: VisualShape | null | undefined): boolean {
  return isQuad(shape?.outline)
}

/** A shape hidden in Muralista stays hidden on the wall. Absent means visible, as it does there. */
export function shapeIsVisible(shape: VisualShape): boolean {
  return shape.visible !== false
}

/** `{ type: [shapeId] }`, as Muralista's `sanitizeAssignmentMap` writes it. */
export type AssignmentMap = Partial<Record<string, string[]>>

export type SongVisuals = {
  defaults: AssignmentMap
  songs: Record<string, AssignmentMap>
}

export type VisualsFile = {
  visualsVersion: number
  gigId: string
  shapes: VisualShape[]
  songVisuals: SongVisuals
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

function readAssignmentMap(value: unknown): AssignmentMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: AssignmentMap = {}
  for (const [type, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(ids)) continue
    const list = ids.filter(isNonEmptyString)
    if (list.length > 0) out[type] = list
  }
  return out
}

/** A shape's type, defaulted the way Muralista defaults it: an unrecognised layer is a `pattern`. */
export function shapeTypeOf(shape: VisualShape): string {
  const type = shape.layer?.type
  return isNonEmptyString(type) ? type : 'pattern'
}

/**
 * Reads `visuals.json` as this gig's. Throws on either hard refusal; `expectedGigId` is what the
 * file's `gigId` must equal.
 */
export function parseVisualsFile(text: string, expectedGigId: string): VisualsFile {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (e) {
    throw new VisualsRefused(
      'unparseable',
      `visuals.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`
    )
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new VisualsRefused('unparseable', 'visuals.json is not an object.')
  }
  const o = raw as Record<string, unknown>

  if (typeof o.visualsVersion !== 'number') {
    throw new VisualsRefused(
      'unparseable',
      'visuals.json declares no visualsVersion. Re-save it from Muralista.'
    )
  }
  if (o.visualsVersion !== VISUALS_VERSION) {
    throw new VisualsRefused(
      'unknown-version',
      `visuals.json is version ${o.visualsVersion}; this build understands version ${VISUALS_VERSION}. Nothing will be projected from it.`
    )
  }
  // **Naming no gig is `other-gig`, not `unparseable`.** The question the screen asks is *does
  // this mapping belong to this gig*, and a file that names none does not — the shape of the file
  // is fine and the answer is still no.
  if (!isNonEmptyString(o.gigId)) {
    throw new VisualsRefused(
      'other-gig',
      'visuals.json names no gig. It cannot be used as this gig’s room — re-map it in Muralista with this gig connected.'
    )
  }
  if (o.gigId !== expectedGigId) {
    throw new VisualsRefused(
      'other-gig',
      `visuals.json belongs to gig "${o.gigId}", not "${expectedGigId}". That is a mapping of a different room — re-map it in Muralista with this gig connected.`
    )
  }

  const shapes = (Array.isArray(o.shapes) ? o.shapes : [])
    .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
    .filter((s) => isNonEmptyString(s.id))
    .map((s) => s as unknown as VisualShape)

  const sv = o.songVisuals !== null && typeof o.songVisuals === 'object' ? (o.songVisuals as Record<string, unknown>) : {}
  const songsSrc = sv.songs !== null && typeof sv.songs === 'object' ? (sv.songs as Record<string, unknown>) : {}
  const songs: Record<string, AssignmentMap> = {}
  for (const [songId, map] of Object.entries(songsSrc)) {
    if (!songId) continue
    const assignments = readAssignmentMap(map)
    // Muralista drops a per-song gig-contact entry rather than honouring it: the contact panel
    // is a gig-level fact, and a file claiming otherwise is a file to correct.
    delete assignments['gig-contact']
    if (Object.keys(assignments).length > 0) songs[songId] = assignments
  }

  return {
    visualsVersion: VISUALS_VERSION,
    gigId: o.gigId,
    shapes,
    songVisuals: { defaults: readAssignmentMap(sv.defaults), songs },
  }
}

/**
 * **The lookup.** Resolving a type for a song returns the **set** of shapes it lights: the song's
 * own reassignment if it has one, otherwise the gig-level default.
 *
 * It is a set and not a shape. Two shapes showing the same lyric is how a corner or a pillar gets
 * spanned, and how an original sits beside its translation. Nothing caps it, and no caller may
 * assume size one just because that is all Muralista's authoring UI offers today.
 *
 * Ids are checked against the live shape list *and* against the type, so a shape that was deleted
 * or retyped since the assignment was made stops resolving rather than resolving to something
 * else.
 *
 * **A shape hidden in Muralista does not resolve**, which is the same answer Muralista's own
 * output window gives (`renderOutput` filters on `shape.visible`). It is filtered *here*, in the
 * one lookup, rather than at render time — a hidden shape that satisfied the arm gate and then
 * painted nothing would be exactly the disagreement between the gate and the wall that having one
 * readiness function exists to prevent.
 */
export function resolveShapesForType(
  visuals: VisualsFile,
  type: string,
  songId: string | null
): VisualShape[] {
  const perSong = songId ? visuals.songVisuals.songs[songId]?.[type] : undefined
  // An empty per-song list is not a deviation, it is no entry.
  const ids = perSong && perSong.length > 0 ? perSong : (visuals.songVisuals.defaults[type] ?? [])
  return ids
    .map((id) => visuals.shapes.find((s) => s.id === id))
    .filter((s): s is VisualShape => s !== undefined && shapeTypeOf(s) === type && shapeIsVisible(s))
}
