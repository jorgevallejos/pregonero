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
  /** When this shape shows, if it does not always. See `shapeCondition`. */
  visibleWhen?: { shape?: unknown; is?: unknown } | null
  [key: string]: unknown
}

/** The two states a condition asks about. Content, never existence — see `shapeCondition`. */
export type ConditionState = 'filled' | 'empty'

export type ShapeCondition = { shape: string; is: ConditionState }

/**
 * **A shape's visibility condition, or null when it always shows.**
 *
 * ## Why it asks about another SHAPE
 *
 * Cowork proposed a flag on a `song-lyrics` shape saying *for songs with video / without*, and
 * **Jorge rejected it: that is domain knowledge Muralista does not have** (2026-09-04). Whether a
 * song has a video lives below Muralista's line — it reads `gig.json` and nothing else. **His
 * replacement asks about another shape, which is entirely Muralista's own vocabulary: Muralista
 * declares the relationship and Pregonero evaluates it**, because Pregonero is the one that knows
 * what content landed. Each tool says only what it can know.
 *
 * ## It is about CONTENT, never EXISTENCE
 *
 * Shapes are gig level and always exist; what varies per song is whether they got content.
 * *Visible when that shape is empty for this song*, never *visible if that shape is not there*.
 * **Filled means an asset is assigned for that song** in `songVisuals.assets`.
 *
 * ## One level, so cycles are impossible
 *
 * A condition may only point at a shape that has none of its own — enforced in Muralista, on the
 * way into the file. **So this never recurses**: it reads the target's CONTENT, never the target's
 * visibility, and there is nothing here to detect or refuse.
 *
 * **An object rather than a string**, so a `when` or an `after` can join it later without a
 * redesign. This is the condition, not an animation system.
 */
export function shapeCondition(shape: VisualShape): ShapeCondition | null {
  const raw = shape.visibleWhen
  if (!raw || typeof raw !== 'object') return null
  const target = (raw as { shape?: unknown }).shape
  const is = (raw as { is?: unknown }).is
  if (typeof target !== 'string' || target === '') return null
  if (is !== 'filled' && is !== 'empty') return null
  return { shape: target, is }
}

/**
 * **Whether this shape shows for this song.** True for every unconditional shape, which is most of
 * them, and they pay nothing for the question.
 *
 * With **no song at all** — `gig-contact` is looked up that way — nothing is assigned to anything,
 * so a target reads *empty*. That is the honest answer rather than a special case: an asset is a
 * per-song fact, and there is no song.
 */
export function shapeShowsForSong(
  visuals: VisualsFile,
  shape: VisualShape,
  songId: string | null
): boolean {
  const condition = shapeCondition(shape)
  if (condition === null) return true
  const filled = songAssetFor(visuals, songId, condition.shape) !== null
  return condition.is === 'filled' ? filled : !filled
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

/**
 * **What a song puts in a shape** — Muralista's `songVisuals.assets`, song id → shape id → name.
 *
 * **A different question from `songs` beside it, and the two are easy to confuse.** `songs` answers
 * *which shape of this kind does this song use*, which is reassignment; this answers *what does this
 * song put in that shape*, which is content. One moves a song onto a different quad, the other fills
 * a quad it already has.
 *
 * **Keyed by shape id, never by type**, because the lookup returns a set: two shapes carrying one
 * song's video is how a corner gets spanned, and keying by type would cap that at one.
 *
 * **A name, never a path.** The folder is a fact about this machine and is resolved through
 * `resolveMediaPath` like every other name; the file travels.
 */
export type SongAssets = Record<string, Record<string, string>>

export type SongVisuals = {
  defaults: AssignmentMap
  songs: Record<string, AssignmentMap>
  assets: SongAssets
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

  // **The one-level rule is Muralista's to enforce and this repo's to survive.** A condition
  // pointing at a shape that is not there, or at one that has a condition of its own, is dropped
  // here — `shapeCondition` then reads null and the shape shows unconditionally. **A file this app
  // did not write is arbitrary JSON**, and a lookup that recursed on it would be the cycle this
  // design exists to make impossible.
  const conditioned = new Set(
    shapes.filter((shape) => shapeCondition(shape) !== null).map((shape) => shape.id)
  )
  for (const shape of shapes) {
    const condition = shapeCondition(shape)
    if (condition === null) continue
    const target = condition.shape
    const known = shapes.some((s) => s.id === target)
    if (!known || conditioned.has(target) || target === shape.id) delete shape.visibleWhen
  }

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

  const assetsSrc = sv.assets !== null && typeof sv.assets === 'object' ? (sv.assets as Record<string, unknown>) : {}
  const assets: SongAssets = {}
  for (const [songId, map] of Object.entries(assetsSrc)) {
    if (!songId || map === null || typeof map !== 'object') continue
    const entry: Record<string, string> = {}
    for (const [shapeId, name] of Object.entries(map as Record<string, unknown>)) {
      // **A name, so a path is refused rather than repaired.** The same rule Muralista writes
      // under: a separator here would be a fact about one machine in a file built to travel.
      if (!shapeId || !isNonEmptyString(name)) continue
      if (name.includes('/') || name.includes('\\')) continue
      entry[shapeId] = name
    }
    if (Object.keys(entry).length > 0) assets[songId] = entry
  }

  return {
    visualsVersion: VISUALS_VERSION,
    gigId: o.gigId,
    shapes,
    songVisuals: { defaults: readAssignmentMap(sv.defaults), songs, assets },
  }
}

/**
 * **What this song puts in this shape, or null.** The one reader, so the arm gate, the readiness
 * check and the wall cannot disagree about what is playing.
 */
export function songAssetFor(
  visuals: VisualsFile,
  songId: string | null,
  shapeId: string
): string | null {
  if (!songId) return null
  return visuals.songVisuals.assets[songId]?.[shapeId] ?? null
}

/**
 * **Every name this song's video shapes ask for, and every shape that asks for none.**
 *
 * One pass over the shapes the song actually lights, so a shape reassigned away from this song is
 * neither required nor resolved. **A shape with no asset is not an error here** — it is *dark for
 * this song*, which is the sentence this suite already has — but it IS what the sign-off reports
 * when a song has a video shape and nothing to put in it.
 */
export function songVideoAssets(
  visuals: VisualsFile,
  songId: string | null
): { named: string[]; unassigned: string[] } {
  const named: string[] = []
  const unassigned: string[] = []
  for (const shape of resolveShapesForType(visuals, 'song-video', songId)) {
    const name = songAssetFor(visuals, songId, shape.id)
    if (name === null) unassigned.push(shape.name ?? shape.id)
    else if (!named.includes(name)) named.push(name)
  }
  return { named, unassigned }
}

/**
 * **Whether anything will actually paint for this song.**
 *
 * A resolved shape is not the same as a shape with something in it, and since the default became
 * three shapes the difference matters: **a song with no animation resolves the video shape and
 * leaves it empty, which is the designed state**, not a fault — the lyrics shape conditioned on
 * *video is empty* is what carries it.
 *
 * So: a `song-lyrics` shape always paints, because the words come from the song file at render
 * time. **A `song-video` shape paints only when this song assigned it something.**
 */
export function songIsCarried(visuals: VisualsFile, songId: string): boolean {
  if (resolveShapesForType(visuals, 'song-lyrics', songId).length > 0) return true
  return songVideoAssets(visuals, songId).named.length > 0
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
    .filter(
      (s): s is VisualShape =>
        s !== undefined &&
        shapeTypeOf(s) === type &&
        shapeIsVisible(s) &&
        // **The condition is evaluated HERE, in the one lookup**, for the same reason the hidden
        // flag is: a shape that satisfied the arm gate and then painted nothing would be exactly
        // the disagreement between the gate and the wall that having one readiness function exists
        // to prevent.
        shapeShowsForSong(visuals, s, songId)
    )
}
