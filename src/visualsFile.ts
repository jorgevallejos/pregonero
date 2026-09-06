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

/**
 * **THE SONG-AWARE TYPES, AND THERE ARE TWO OF THEM SINCE 2026-09-04.** `song-intro` and
 * `gig-contact` were the other two. They are not types any more, in either repo.
 *
 * **THE LINE: Muralista owns WHERE THINGS ARE, Pregonero owns WHAT IS SHOWING WHEN.** An intro is
 * a *when* — before the cue — and a contact panel is a *when* — after the last song. Neither needs
 * a place of its own, because both go into a shape that already exists: the video frame or the
 * song lyrics shape. **Which of the two is Pregonero's to decide and has not been decided** — see
 * `introContactHostShapes` in `App.tsx`, the one address that question has.
 *
 * A file written by an older Muralista may still name these types. Nothing special happens to it:
 * `readAssignmentMap` keeps assignments for the types in this list and drops the rest, so the
 * entries fall away the same way any unknown type's would.
 */
export const SONG_AWARE_TYPES = ['song-lyrics', 'song-video'] as const

/**
 * The types a song may reassign. **Identical to `SONG_AWARE_TYPES` today**, since the only type
 * that was ever gig-level-only was `gig-contact`. Kept as a separate name because the question is
 * different — what a song may point somewhere else is not the same question as what a shape may
 * be — and the day a gig-level type comes back, this is the list that stops matching.
 */
export const SONG_REASSIGNABLE_TYPES = ['song-lyrics', 'song-video'] as const

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
  /** The mode this shape belongs to, if it belongs to one. See `shapeModeId`. */
  mode?: unknown
  [key: string]: unknown
}

/** The two states a condition asks about. Content, never existence — see `modeCondition`. */
export type ConditionState = 'filled' | 'empty'

export type ShapeCondition = { shape: string; is: ConditionState }

/**
 * **A NAMED MODE: a set of shapes that appear together, under a name and a condition.**
 *
 * ## Why it exists, and what it replaced
 *
 * Until 2026-09-05 each shape carried its own `visibleWhen`, and the room's exclusivity was an
 * **unwritten assumption that the two conditions partition**. Nothing enforced it: two independent
 * rules can both be true or both be false, and the room then paints twice or not at all.
 *
 * **Jorge named the two modes out loud** — `Song with lyrics`, `Song with video and lyrics` — and a
 * name with nowhere to live is the symptom of a missing concept. **Exclusivity comes from the rule
 * now:** modes are an ordered list, the first whose condition is true wins, and **when none matches
 * no mode is live and only the no-mode shapes paint.**
 *
 * ## Why the condition still asks about another SHAPE
 *
 * Cowork proposed a flag saying *for songs with video / without*, and **Jorge rejected it: that is
 * domain knowledge Muralista does not have** (2026-09-04). Whether a song has a video lives below
 * Muralista's line — it reads `gig.json` and nothing else. **Muralista declares the relationship
 * and Pregonero evaluates it**, because Pregonero is the one that knows what content landed. That
 * split is unchanged; only where the condition lives moved.
 *
 * **It is about CONTENT, never EXISTENCE.** Shapes are gig level and always exist; what varies per
 * song is whether they got content. **Filled means an asset is assigned for that song** in
 * `songVisuals.assets`.
 *
 * ## The list is honest or it is not a list
 *
 * Muralista's authoring surface seeds exactly two modes and offers no way to make a third. **The
 * format says list, and so this reads a list** — any length, resolved in order. An implementation
 * that quietly assumed two while the file promised more would be a value one side produces and the
 * other refuses, which is the exact shape of the five contract mismatches of 02/09. See
 * `visualsModes.test.ts` for the hand-written three-mode room that keeps that honest, and
 * `mapper/modes.test.mjs` in Muralista for the same room resolved by the writer.
 */
export type VisualMode = {
  id: string
  name: string
  /** `null` is a mode with nothing to ask, and **a mode with no condition is never live.** */
  when: ShapeCondition | null
}

/** A mode's condition, or null. The one reader, so there is one answer. */
export function modeCondition(mode: { when?: unknown }): ShapeCondition | null {
  const raw = mode.when
  if (!raw || typeof raw !== 'object') return null
  const target = (raw as { shape?: unknown }).shape
  const is = (raw as { is?: unknown }).is
  if (typeof target !== 'string' || target === '') return null
  if (is !== 'filled' && is !== 'empty') return null
  return { shape: target, is }
}

/** The mode a shape belongs to, or null for a no-mode shape — which is on the wall in all of them. */
export function shapeModeId(shape: VisualShape): string | null {
  const raw = shape.mode
  return typeof raw === 'string' && raw !== '' ? raw : null
}

/**
 * **The mode that is live for this song, or null when none is.**
 *
 * First in list order whose condition is true. **With no song at all** nothing is assigned to
 * anything, so every target reads *empty* — the honest answer rather than a special case, since an
 * asset is a per-song fact and there is no song. (Gig visual setup still resolves with no song.)
 */
export function activeModeFor(visuals: VisualsFile, songId: string | null): VisualMode | null {
  for (const mode of visuals.modes) {
    if (mode.when === null) continue
    const filled = songAssetFor(visuals, songId, mode.when.shape) !== null
    if (mode.when.is === 'filled' ? filled : !filled) return mode
  }
  return null
}

/**
 * **Whether this shape shows for this song.** True for every no-mode shape, which is most of them,
 * and they pay nothing for the question.
 */
export function shapeShowsForSong(
  visuals: VisualsFile,
  shape: VisualShape,
  songId: string | null
): boolean {
  const mine = shapeModeId(shape)
  if (mine === null) return true
  const active = activeModeFor(visuals, songId)
  return active !== null && active.id === mine
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
 * **How deep the listing walks, so how deep a stored name may be.** Muralista's `ASSET_MAX_DEPTH`
 * and `localhostServer.cjs`'s `LISTING_MAX_DEPTH` are the same 4, and a name the picker could not
 * have offered is not a name this file will keep.
 */
const ASSET_MAX_DEPTH = 4

/**
 * **A name is a relative path inside the folder** (2026-09-06).
 *
 * It used to be one segment, and any separator was refused — *a path here would be a fact about one
 * machine written into a file built to travel*. **That rule was right and it outlived its listing.**
 * On 2026-09-04 the mount listing was made to recurse, on the argument that the constraint that
 * mattered was *not absolute*, never *one segment*: `tragedia/pig.mov` leaks no more about where
 * the folder lives than `pig.mov` does. It was made because the real visuals folder keeps **every
 * animation one level down in a per-song directory** — so from that day the picker offered a name
 * this refused, and **every video assignment in that folder was silently dropped at save.**
 *
 * What is refused is what a path was ever a problem for: **absolute, escaping, or a separator that
 * is a fact about one machine.** Deeper than the walk goes is refused too — the picker could not
 * have offered it.
 */
export function assetNameIsRelative(name: string): boolean {
  if (name === '' || name.includes('\\')) return false
  if (name.startsWith('/')) return false
  const segments = name.split('/')
  if (segments.length > ASSET_MAX_DEPTH) return false
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

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
  /** **Ordered.** First matching condition wins; none matching means no mode is live. */
  modes: VisualMode[]
  shapes: VisualShape[]
  songVisuals: SongVisuals
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * An assignment map, **filtered to the types that still exist**. A file written by an older
 * Muralista names `song-intro` and `gig-contact`; a hand-edited one can name anything. Either way
 * the entry is dropped here rather than carried around inert, so `songVisuals` never claims an
 * assignment the app has no way to honour.
 */
function readAssignmentMap(value: unknown): AssignmentMap {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: AssignmentMap = {}
  for (const [type, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!(SONG_AWARE_TYPES as readonly string[]).includes(type)) continue
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

  // **A file this app did not write is arbitrary JSON**, so the mode list is rebuilt rather than
  // trusted: an entry with no id cannot be pointed at and is not a mode, and a `when` that is not
  // the one sentence reads as no condition, which is a mode that is never live.
  //
  // **The list is read at whatever length it comes in.** Muralista seeds two and offers no way to
  // make a third; the format says list, and a reader that assumed two would be the half of a
  // contract mismatch that refuses what the other side wrote.
  const modes: VisualMode[] = []
  const modeIds = new Set<string>()
  for (const raw of Array.isArray(o.modes) ? o.modes : []) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    if (!isNonEmptyString(entry.id) || modeIds.has(entry.id)) continue
    modeIds.add(entry.id)
    modes.push({
      id: entry.id,
      name: isNonEmptyString(entry.name) ? entry.name : 'Mode',
      when: modeCondition(entry),
    })
  }

  // **Membership pointing at a mode the file does not hold is dropped**, and the shape becomes
  // always-on. That is the safe direction and the visible one: the alternative is a shape live in
  // no mode at all, which paints nothing on the night with nothing anywhere saying why.
  for (const shape of shapes) {
    const mine = shapeModeId(shape)
    if (mine !== null && !modeIds.has(mine)) delete shape.mode
  }

  const sv = o.songVisuals !== null && typeof o.songVisuals === 'object' ? (o.songVisuals as Record<string, unknown>) : {}
  const songsSrc = sv.songs !== null && typeof sv.songs === 'object' ? (sv.songs as Record<string, unknown>) : {}
  const songs: Record<string, AssignmentMap> = {}
  for (const [songId, map] of Object.entries(songsSrc)) {
    if (!songId) continue
    const assignments = readAssignmentMap(map)
    if (Object.keys(assignments).length > 0) songs[songId] = assignments
  }

  const assetsSrc = sv.assets !== null && typeof sv.assets === 'object' ? (sv.assets as Record<string, unknown>) : {}
  const assets: SongAssets = {}
  for (const [songId, map] of Object.entries(assetsSrc)) {
    if (!songId || map === null || typeof map !== 'object') continue
    const entry: Record<string, string> = {}
    for (const [shapeId, name] of Object.entries(map as Record<string, unknown>)) {
      // **A relative path inside the folder, refused rather than repaired when it is not one.**
      // The same rule Muralista writes under — see `assetNameIsRelative`.
      if (!shapeId || !isNonEmptyString(name)) continue
      const trimmed = name.trim()
      if (!assetNameIsRelative(trimmed)) continue
      entry[shapeId] = trimmed
    }
    if (Object.keys(entry).length > 0) assets[songId] = entry
  }

  return {
    visualsVersion: VISUALS_VERSION,
    gigId: o.gigId,
    modes,
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
 * leaves it empty, which is the designed state**, not a fault — the lyrics shape in the
 * *no video* mode is what carries it.
 *
 * So: a `song-lyrics` shape always paints, because the words come from the song file at render
 * time. **A `song-video` shape paints only when this song assigned it something.**
 *
 * **UNDER MODES IT ASKS ABOUT THE MODE THAT WILL BE LIVE FOR THIS SONG**, not about a shape's own
 * condition (Jorge, 2026-09-05). The change is real and it is one level down: `resolveShapesForType`
 * filters on `shapeShowsForSong`, which now resolves the mode. **This function did not have to
 * move, and that is the design working rather than an oversight** — there has only ever been one
 * lookup, so there was only one place for the rule to change.
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

/**
 * **PER MODE, HOW MANY SHAPES OF EACH KIND ARE LIVE** (Jorge, 2026-09-05).
 *
 * ## The failure it catches, and it is the double-paint one coming back through another door
 *
 * A shape belonging to no mode is **always displayed**. So a no-mode lyrics shape and a mode's
 * lyrics shape are **both live at once**, on top of each other, and **that is authorable by
 * accident**: dragging a shape out of a group to see something and not dragging it back leaves a
 * room that looks fine in Muralista and paints twice on the wall.
 *
 * Named modes made the room exclusive *by construction* between modes. **They did nothing about the
 * always group**, because the always group is not a mode and is not meant to be exclusive with
 * anything — a backdrop, a logo and a video frame all belong there correctly.
 *
 * ## Why it is a count and not a rule
 *
 * **The sign-off screen is already one line per thing that has to be true**, so this is one more
 * line, not a new surface. And it is stated as *one of each kind* rather than as a refusal in
 * Muralista, because **two lyrics shapes live at once is how a corner or a pillar gets spanned** —
 * this repo has said that about `resolveShapesForType` since the day it was written, and capping it
 * would remove a real thing to prevent an accident. **Reporting beats refusing** where the honest
 * answer is *this is usually a mistake*.
 *
 * The count is per mode and includes the always shapes, because that is the room the wall shows:
 * **the winning mode's shapes plus every no-mode shape.**
 */
export type ModeCensusRow = {
  /** The mode, or null for the room a song matching no mode gets — the always shapes alone. */
  mode: VisualMode | null
  /** Counts by shape type, over the live room for that mode. Types with none are absent. */
  live: Partial<Record<string, number>>
  /** The types with more than one live shape, named for the report. */
  doubled: string[]
}

export function modeCensus(visuals: VisualsFile): ModeCensusRow[] {
  const rowFor = (mode: VisualMode | null): ModeCensusRow => {
    const live: Partial<Record<string, number>> = {}
    for (const type of SONG_AWARE_TYPES) {
      const n = liveDefaultShapes(visuals, type, mode).length
      if (n > 0) live[type] = n
    }
    const doubled = SONG_AWARE_TYPES.filter((type) => (live[type] ?? 0) > 1)
    return { mode, live, doubled }
  }
  // **The no-mode room is a row too**, because *no mode matched* is a state the list has to answer
  // and a song can land in it. It is last, where the fallback belongs.
  return [...visuals.modes.map(rowFor), rowFor(null)]
}

/**
 * **What a song with no reassignment gets in this mode**: the gig-level default for the type,
 * filtered to what is visible and what that mode makes live.
 *
 * **Counting MEMBERSHIP instead was wrong, and the readiness fixtures caught it.** A room may hold
 * two `song-lyrics` shapes where the gig-level default names one and a song reassigns to the other
 * — that is reassignment working, and counting every shape of the type would have called it a
 * double paint. **What is live is what `resolveShapesForType` returns**, and this is that lookup
 * with the per-song half removed.
 *
 * **Per-song reassignment is deliberately not walked here.** A reassignment that lights two shapes
 * is a fact about one song and belongs on that song's line, where `resolveShapesForType` already
 * returns the set; this line is about **the room**, which is what the sign-off screen calls it.
 */
function liveDefaultShapes(
  visuals: VisualsFile,
  type: string,
  mode: VisualMode | null
): VisualShape[] {
  const ids = visuals.songVisuals.defaults[type] ?? []
  return ids
    .map((id) => visuals.shapes.find((s) => s.id === id))
    .filter(
      (s): s is VisualShape =>
        s !== undefined &&
        shapeTypeOf(s) === type &&
        shapeIsVisible(s) &&
        shapeShowsInMode(s, mode)
    )
}

/** The live room for a mode: its own shapes plus every no-mode shape. `null` is the fallback room. */
function shapeShowsInMode(shape: VisualShape, mode: VisualMode | null): boolean {
  const mine = shapeModeId(shape)
  return mine === null || (mode !== null && mine === mode.id)
}

/** The census rows that report a doubled kind, as sentences. Empty when the room is clean. */
export function doubledShapeLines(visuals: VisualsFile): string[] {
  return modeCensus(visuals)
    .filter((row) => row.doubled.length > 0)
    .map((row) => {
      const where = row.mode === null ? 'When no mode matches' : row.mode.name
      const what = row.doubled
        .map((type) => `${row.live[type]} ${type} shapes`)
        .join(' and ')
      return `${where}: ${what} live at once.`
    })
}
