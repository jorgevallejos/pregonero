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

/** The four song-aware types. `gig-contact` is a gig-level fact and is never reassigned per song. */
export const SONG_AWARE_TYPES = ['song-lyrics', 'song-video', 'song-intro', 'gig-contact'] as const
export const SONG_REASSIGNABLE_TYPES = ['song-lyrics', 'song-video', 'song-intro'] as const

export type SongAwareType = (typeof SONG_AWARE_TYPES)[number]
export type SongReassignableType = (typeof SONG_REASSIGNABLE_TYPES)[number]

/**
 * One mapped region. Geometry is Muralista's business and is not modelled here beyond keeping
 * it: this stage renders nothing, and E2 is where corners start mattering.
 */
export type VisualShape = {
  id: string
  name?: string
  layer?: { type?: string }
  [key: string]: unknown
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
    throw new Error(`visuals.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('visuals.json is not an object.')
  }
  const o = raw as Record<string, unknown>

  if (typeof o.visualsVersion !== 'number') {
    throw new Error('visuals.json declares no visualsVersion. Re-save it from Muralista.')
  }
  if (o.visualsVersion !== VISUALS_VERSION) {
    throw new Error(
      `visuals.json is version ${o.visualsVersion}; this build understands version ${VISUALS_VERSION}. Nothing will be projected from it.`
    )
  }
  if (!isNonEmptyString(o.gigId)) {
    throw new Error(
      'visuals.json names no gig. It cannot be used as this gig’s room — re-map it in Muralista with this gig connected.'
    )
  }
  if (o.gigId !== expectedGigId) {
    throw new Error(
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
    .filter((s): s is VisualShape => s !== undefined && shapeTypeOf(s) === type)
}
