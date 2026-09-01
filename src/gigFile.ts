/**
 * `gig.json` — the gig as a unit, written down.
 *
 * **Pregonero is its only writer** (`docs/gig-file.md`, "Four files, four writers"). Muralista
 * reads `venue` and `songs` from it and nothing else; it must never need `setlist`, and the day
 * it needs a field below that line it has been made to understand Pregonero.
 *
 * **The file exists before it is finished.** Existence is settled in seconds — `gigVersion`,
 * `id`, `date` — and completeness accretes one setup step at a time. A later step's fields being
 * absent means *not yet*, never *broken*, so parsing here is deliberately permissive about
 * everything except the identity fields. Whether a gig is finished is
 * `gigReadiness.ts`'s question, and only its question.
 */

import { gigSetupFolder } from './fileLayout'
import { isAbsolutePath, relativePath, resolveFrom } from './paths'

export const GIG_VERSION = 1

/** One repertoire entry. `title` is what Muralista names the song by; `file` is Pregonero's. */
export type GigSong = {
  id: string
  /** The song's display title. Muralista falls back to the id when it is absent. */
  title?: string
  /**
   * Path to the song's file in `<songs>/song-performance`, **relative to `gig.json` itself** — so
   * from `<gig>/setup/`, not from the gig folder. Muralista must not read it.
   */
  file?: string
}

export type GigVenue = { name?: string; city?: string }

export type GigFile = {
  gigVersion: number
  /** Born at creation, never rewritten: `visuals.json`'s `gigId` is compared against it. */
  id: string
  /** ISO `YYYY-MM-DD`. Absent until it is known. */
  date?: string
  venue?: GigVenue
  /** Relative pointer to the visual file, conventionally `./visuals.json`. */
  visuals?: string
  /** The repertoire. */
  songs?: GigSong[]
  /** The running order. Deliberately a second field: Muralista reads `songs` and ignores this. */
  setlist?: string[]
  /** The setup confirmation. Absent until setup has been confirmed at least once. */
  setup?: GigSetup
}

/**
 * **The setup confirmation: a milestone, not a lock.**
 *
 * It blocks nothing and freezes nothing. Arming an unconfirmed gig warns; it does not refuse, and
 * the hard gate stays per-song completeness, which is a different thing.
 *
 * **What it records is that the checks passed, and against what.** `against` is a set of
 * fingerprints — of each setlist song's file, of `visuals.json`, of the display configuration —
 * kept for exactly one purpose: **noticing that one of them moved.** They are compared and never
 * read back.
 *
 * **Save the recipe, not the cake.** No warp matrix, no layout and no pixel size is ever recorded
 * here. Setting up at the venue with the projector attached does not change that: the window can
 * still move, the display can still change, and `docs/warp-contract.md` is binding regardless of
 * when setup happened.
 *
 * **It must be able to go stale, and that is the part that earns its keep.** A confirmation that
 * could not lapse would hand out peace of mind that is no longer true, which is the exact opposite
 * of what it is for.
 */
export type GigSetup = {
  /** ISO timestamp. When the person stood in the room and said yes. */
  confirmedAt: string
  against: SetupFingerprints
}

export type SetupFingerprints = {
  /** Song id → a fingerprint of that song's file as it was read. */
  songs: Record<string, string>
  /** A fingerprint of `visuals.json` as it was read; null when the gig had none. */
  visuals: string | null
  /** A fingerprint of the display configuration; empty string when there was no answer. */
  display: string
}

export const DEFAULT_VISUALS_POINTER = './visuals.json'

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/**
 * The gig's id is its folder's name — the convention `concerts/2026-05-16-bom-festival` already
 * uses.
 *
 * **`folderPath` is the gig folder, and never `<gig>/setup`.** Handed the setup folder this names
 * every gig `setup`, which passes every test and only shows up the day two gigs collide. It cannot
 * be handed one: the join happens at the `platform.ts` boundary and nothing above it holds a path
 * ending in `setup/`.
 */
export function gigIdFromFolderPath(folderPath: string): string {
  const parts = folderPath.split('/').filter((p) => p.length > 0)
  return parts[parts.length - 1] ?? ''
}

/** `2026-09-12-bar-eduard` → `2026-09-12`. Null when the name does not lead with a date. */
export function gigDateFromFolderPath(folderPath: string): string | null {
  const name = gigIdFromFolderPath(folderPath)
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(name)
  return match ? match[1]! : null
}

/**
 * Reads `gig.json`. Throws with a named reason rather than returning a half-object: a gig file
 * that cannot be understood is a loud failure, not an empty gig.
 */
export function parseGigFile(text: string): GigFile {
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (e) {
    throw new Error(`gig.json is not valid JSON: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('gig.json is not an object.')
  }
  const o = raw as Record<string, unknown>
  if (typeof o.gigVersion !== 'number') {
    throw new Error('gig.json has no gigVersion.')
  }
  if (o.gigVersion !== GIG_VERSION) {
    throw new Error(
      `gig.json is version ${o.gigVersion}; this build understands version ${GIG_VERSION}.`
    )
  }
  if (!isNonEmptyString(o.id)) {
    throw new Error('gig.json has no id. A gig is identified from the moment it exists.')
  }

  const gig: GigFile = { gigVersion: GIG_VERSION, id: o.id }
  if (isNonEmptyString(o.date)) gig.date = o.date
  if (isNonEmptyString(o.visuals)) gig.visuals = o.visuals
  if (o.venue !== null && typeof o.venue === 'object' && !Array.isArray(o.venue)) {
    const v = o.venue as Record<string, unknown>
    const venue: GigVenue = {}
    if (isNonEmptyString(v.name)) venue.name = v.name
    if (isNonEmptyString(v.city)) venue.city = v.city
    if (Object.keys(venue).length > 0) gig.venue = venue
  }
  if (Array.isArray(o.songs)) {
    gig.songs = o.songs
      .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
      .filter((s) => isNonEmptyString(s.id))
      .map((s) => {
        const song: GigSong = { id: s.id as string }
        if (isNonEmptyString(s.title)) song.title = s.title
        if (isNonEmptyString(s.file)) song.file = s.file
        return song
      })
  }
  if (Array.isArray(o.setlist)) {
    gig.setlist = o.setlist.filter(isNonEmptyString)
  }
  const setup = readSetup(o.setup)
  if (setup !== null) gig.setup = setup
  return gig
}

/**
 * A `setup` block, or null when there is not one this build understands.
 *
 * **A malformed one reads as absent rather than as a refusal.** An unconfirmed gig is an ordinary
 * state — the file exists from step 2 and is unconfirmed for most of its life — so the worst a
 * damaged block can do is ask for the confirmation again, which is cheap. Refusing to open the gig
 * over it would be a lock, and this is a milestone.
 */
function readSetup(value: unknown): GigSetup | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (!isNonEmptyString(o.confirmedAt)) return null
  const against =
    o.against !== null && typeof o.against === 'object' && !Array.isArray(o.against)
      ? (o.against as Record<string, unknown>)
      : {}
  const songs: Record<string, string> = {}
  if (against.songs !== null && typeof against.songs === 'object' && !Array.isArray(against.songs)) {
    for (const [id, fingerprint] of Object.entries(against.songs as Record<string, unknown>)) {
      if (isNonEmptyString(id) && isNonEmptyString(fingerprint)) songs[id] = fingerprint
    }
  }
  return {
    confirmedAt: o.confirmedAt,
    against: {
      songs,
      visuals: isNonEmptyString(against.visuals) ? against.visuals : null,
      display: typeof against.display === 'string' ? against.display : '',
    },
  }
}

/** Two-space JSON with a trailing newline — the form every other file in the suite is written in. */
export function serializeGigFile(gig: GigFile): string {
  const ordered: Record<string, unknown> = { gigVersion: GIG_VERSION, id: gig.id }
  if (gig.date !== undefined) ordered.date = gig.date
  if (gig.venue !== undefined) ordered.venue = gig.venue
  if (gig.visuals !== undefined) ordered.visuals = gig.visuals
  if (gig.songs !== undefined) ordered.songs = gig.songs
  if (gig.setlist !== undefined) ordered.setlist = gig.setlist
  if (gig.setup !== undefined) ordered.setup = gig.setup
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/**
 * **Records the gig's own identity: its date and its venue.**
 *
 * `id` is deliberately not here. It is born with the folder and never rewritten — `visuals.json`'s
 * `gigId` is compared against it, so a gig that could be renamed is a gig whose room mapping can
 * silently stop belonging to it. Renaming a gig is renaming its folder, outside the app.
 *
 * **An emptied field is removed rather than written blank.** `date: ""` and `venue: {}` are not
 * states this file has: absent means *not yet*, which is exactly what clearing a field means, and
 * readiness already knows how to say so.
 */
export function withIdentity(
  gig: GigFile,
  identity: { date: string; venue: GigVenue }
): GigFile {
  const next: GigFile = { ...gig }

  const date = identity.date.trim()
  if (date === '') delete next.date
  else next.date = date

  const venue: GigVenue = {}
  const name = identity.venue.name?.trim() ?? ''
  const city = identity.venue.city?.trim() ?? ''
  if (name !== '') venue.name = name
  if (city !== '') venue.city = city
  if (Object.keys(venue).length > 0) next.venue = venue
  else delete next.venue

  return next
}

/** Records a confirmation. Nothing else about the gig moves. */
export function withSetup(gig: GigFile, setup: GigSetup): GigFile {
  return { ...gig, setup }
}

/**
 * The file a folder with no `gig.json` gets: identity and nothing else.
 *
 * `venue` is deliberately absent — naming it is setup step 2's own screen, which round G builds,
 * and an invented venue would read as a fact. Readiness reports it as missing, which is the
 * honest state.
 */
export function createGigFile(folderPath: string, today: string): GigFile {
  const gig: GigFile = {
    gigVersion: GIG_VERSION,
    id: gigIdFromFolderPath(folderPath),
    date: gigDateFromFolderPath(folderPath) ?? today,
    visuals: DEFAULT_VISUALS_POINTER,
  }
  return gig
}

/** One repertoire entry per setlist song, in setlist order. `path` is absolute on this machine. */
export type SetlistProjection = { id: string; title: string; path: string }

/**
 * Writes Pregonero's setlist into the gig file's `songs` and `setlist`.
 *
 * **`file` is written relative to `gig.json` itself, which is one level further down than it used
 * to be** — `../../../songs/song-performance/libertad.json` from `<gig>/setup/`, where it was
 * `../../songs/libertad.json` from `<gig>/`. That is what lets the folder be handed over on a
 * stick: an absolute path is a fact about one machine, and the two-file split exists precisely so
 * the pair can travel. An absolute path is still *read* without complaint; this is only the form
 * written out. **Nothing on disk carries the old form**, so this is about writing the new one and
 * not about reading both.
 *
 * `gigFolderPath` is the **gig folder** — every caller holds that and never `setup/`, and the join
 * is here so there is one place it happens.
 *
 * A song path that is not absolute is already a reference to somewhere and is written through
 * untouched — there is nothing to make relative, and rewriting one would invent a location.
 */
export function withSetlist(
  gig: GigFile,
  songs: readonly SetlistProjection[],
  gigFolderPath: string
): GigFile {
  const from = gigSetupFolder(gigFolderPath)
  return {
    ...gig,
    songs: songs.map((s) => ({
      id: s.id,
      title: s.title,
      file: isAbsolutePath(s.path) ? relativePath(from, s.path) : s.path,
    })),
    setlist: songs.map((s) => s.id),
  }
}

/** Whether `withSetlist` would change anything — the test that keeps writes off the hot path. */
export function setlistMatches(
  gig: GigFile,
  songs: readonly SetlistProjection[],
  gigFolderPath: string
): boolean {
  return serializeGigFile(withSetlist(gig, songs, gigFolderPath)) === serializeGigFile(gig)
}

/**
 * **The setlist the file states**, in order, with each `file` resolved against `<gig>/setup`, which
 * is where `gig.json` sits and therefore what its relative paths are relative to.
 *
 * This is the direction that changed in round G. `setlist` used to be a dump of whatever the app
 * held, written one way, so a running order edited by hand in the file was overwritten on the next
 * read with nothing said. It is the source now: what is in the file is what the app performs.
 *
 * A `setlist` id with no matching `songs` entry — or one whose entry names no `file` — comes back
 * with a null `path`. That is a real state (a half-built gig, or a hand edit that named an id and
 * not a file), and it is reported rather than dropped.
 */
export type GigSetlistEntry = { id: string; title: string | null; path: string | null }

export function readGigSetlist(gig: GigFile, gigFolderPath: string): GigSetlistEntry[] {
  const from = gigSetupFolder(gigFolderPath)
  const byId = new Map((gig.songs ?? []).map((song) => [song.id, song]))
  return (gig.setlist ?? []).map((id) => {
    const song = byId.get(id)
    return {
      id,
      title: song?.title ?? null,
      path: song?.file ? resolveFrom(from, song.file) : null,
    }
  })
}

/** Whether the file has reached the step where it carries a running order at all. */
export function hasAuthoredSetlist(gig: GigFile): boolean {
  return gig.setlist !== undefined
}
