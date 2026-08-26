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

export const GIG_VERSION = 1

/** One repertoire entry. `title` is what Muralista names the song by; `file` is Pregonero's. */
export type GigSong = {
  id: string
  /** The song's display title. Muralista falls back to the id when it is absent. */
  title?: string
  /** Path to the song's JSON file in `songs/`. Muralista must not read it. */
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
}

export const DEFAULT_VISUALS_POINTER = './visuals.json'

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** The gig's id is its folder's name — the convention `concerts/2026-05-16-bom-festival` already uses. */
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
  return gig
}

/** Two-space JSON with a trailing newline — the form every other file in the suite is written in. */
export function serializeGigFile(gig: GigFile): string {
  const ordered: Record<string, unknown> = { gigVersion: GIG_VERSION, id: gig.id }
  if (gig.date !== undefined) ordered.date = gig.date
  if (gig.venue !== undefined) ordered.venue = gig.venue
  if (gig.visuals !== undefined) ordered.visuals = gig.visuals
  if (gig.songs !== undefined) ordered.songs = gig.songs
  if (gig.setlist !== undefined) ordered.setlist = gig.setlist
  return `${JSON.stringify(ordered, null, 2)}\n`
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

/** One repertoire entry per setlist song, in setlist order. */
export type SetlistProjection = { id: string; title: string; path: string }

/**
 * Projects Pregonero's setlist onto the gig file's `songs` and `setlist`.
 *
 * One direction only. Pregonero authors the running order and `gig.json` is where it is written
 * down for Muralista to read; nothing reads the order back out of the file into the app, so the
 * two cannot drift the way `concerts/<gig>/setlist.md` and the app did.
 */
export function withSetlist(gig: GigFile, songs: readonly SetlistProjection[]): GigFile {
  return {
    ...gig,
    songs: songs.map((s) => ({ id: s.id, title: s.title, file: s.path })),
    setlist: songs.map((s) => s.id),
  }
}

/** Whether `withSetlist` would change anything — the test that keeps writes off the hot path. */
export function setlistMatches(gig: GigFile, songs: readonly SetlistProjection[]): boolean {
  return serializeGigFile(withSetlist(gig, songs)) === serializeGigFile(gig)
}
