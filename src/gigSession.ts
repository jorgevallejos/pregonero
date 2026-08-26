/**
 * The open gig: which folder it is, and the readiness delta as of the last time it was read.
 *
 * **Re-read on open, never watched.** The reload boundary — right before doors, wrong mid-song —
 * is real, and re-reading when a gig is opened is trivially not mid-song. There is no file watcher
 * here and none is coming in this stage.
 *
 * **Nothing here decides what "ready" means.** It gathers what is on disk and hands it to
 * `computeGigReadiness`, which is the only place that has an opinion.
 */

import {
  createGigFile,
  parseGigFile,
  serializeGigFile,
  setlistMatches,
  withSetlist,
  type GigFile,
  type SetlistProjection,
} from './gigFile'
import {
  computeGigReadiness,
  type GigReadiness,
  type MediaResolution,
  type SetlistSongInput,
  type SongValidation,
} from './gigReadiness'
import { parseVisualsFile, type VisualsFile } from './visualsFile'
import { broadcastVisuals } from './visualsBroadcast'
import { getRememberedGigFolder, rememberGigFolder } from './gigFolderStore'
import { getOrderedEntriesForActiveSetlist, type LibraryEntry } from './setlistStore'
import { getMediaPath } from './mediaPathStore'
import * as platform from './platform'

// The folder memory itself lives in `gigFolderStore`, so the Projection window can ask whether a
// gig is open without importing everything below. Re-exported here because this is where the rest
// of the app already looks for it.
export { GIG_FOLDER_KEY, getRememberedGigFolder, rememberGigFolder } from './gigFolderStore'

// ── The snapshot, and who is listening ───────────────────────────────────────────────────────

let current: GigReadiness | null = null
const listeners = new Set<() => void>()

/**
 * With no gig folder the delta needs no disk at all — it is a pure function of the library — so it
 * is computed fresh on every read and is never stale. With a gig open it is as of the last read,
 * which is the design: re-read on open, never watch.
 *
 * **Before the first read of a gig folder has come back, this is the no-gig delta**, not an empty
 * one. The gate is off for that tick and the app behaves exactly as it did before this stage —
 * where an empty delta would briefly block every song and empty the running order, which is a
 * flash of a lie on the screen the performer is looking at.
 */
export function getGigReadiness(): GigReadiness {
  if (current !== null && getRememberedGigFolder() !== null) return current
  return computeGigReadiness({
    folderPath: null,
    gig: null,
    gigProblem: null,
    visualsPresent: false,
    visuals: null,
    visualsProblem: null,
    setlist: readSetlist(),
    mediaResolution: {},
    validation: {},
  })
}

export function subscribeGigReadiness(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The active setlist as readiness input. An unhydrated library is an empty setlist, not a throw. */
function readSetlist(): SetlistSongInput[] {
  try {
    return getOrderedEntriesForActiveSetlist().map(toSetlistInput)
  } catch {
    return []
  }
}

function publish(next: GigReadiness): GigReadiness {
  current = next
  for (const listener of [...listeners]) listener()
  return next
}

/** Test seam: forget the folder and the snapshot without touching the listeners' contract. */
export function resetGigSession(): void {
  current = null
  rememberGigFolder(null)
  broadcastVisuals(null, null)
}

// ── Gathering ────────────────────────────────────────────────────────────────────────────────

function toSetlistInput(entry: LibraryEntry): SetlistSongInput {
  return {
    id: entry.ref.id,
    title: entry.song?.title ?? entry.ref.id,
    path: entry.ref.path,
    song: entry.song ?? null,
    ...(entry.song ? {} : { error: entry.error ?? `${entry.ref.path} could not be read.` }),
  }
}

function toProjection(entry: SetlistSongInput): SetlistProjection {
  return { id: entry.id, title: entry.title, path: entry.path }
}

async function resolveMedia(
  setlist: readonly SetlistSongInput[]
): Promise<Record<string, MediaResolution>> {
  const out: Record<string, MediaResolution> = {}
  for (const entry of setlist) {
    const src = entry.song?.media?.src
    if (!src || out[src]) continue
    const linkedPath = getMediaPath(src)
    if (!linkedPath) {
      out[src] = { linked: false, exists: false }
      continue
    }
    out[src] = { linked: true, exists: await platform.fileExists(linkedPath) }
  }
  return out
}

/**
 * Asks `bombista` about every setlist song — but stops after the first answer that says the binary
 * is not there, rather than spawning a process per song to be told the same thing fourteen times.
 */
async function validateSetlist(
  setlist: readonly SetlistSongInput[]
): Promise<Record<string, SongValidation>> {
  const out: Record<string, SongValidation> = {}
  let skipReason: string | null = null
  for (const entry of setlist) {
    if (skipReason !== null) {
      out[entry.id] = { status: 'skipped', reason: skipReason }
      continue
    }
    const result = await platform.validateSongForPerformance(entry.path)
    out[entry.id] = result
    if (result.status === 'skipped') skipReason = result.reason
  }
  return out
}

/**
 * Reads the gig folder and recomputes the delta.
 *
 * Two writes can happen here, and both are Pregonero writing the file it owns: a folder with no
 * `gig.json` gets one carrying identity and nothing else, and a `gig.json` whose repertoire no
 * longer matches the setlist gets the setlist written into it. **One direction only** — the app
 * authors the running order and the file is where it is written down for Muralista to read, so
 * the two cannot drift the way the app and `concerts/<gig>/setlist.md` did.
 */
export async function refreshGigReadiness(): Promise<GigReadiness> {
  const setlist = readSetlist()
  const folderPath = getRememberedGigFolder()

  if (folderPath === null) {
    // No gig folder open means there is nothing to project. The Projection window goes dark, and
    // that is the answer rather than a fallback — the same empty-state model as a shape whose song
    // is not playing.
    broadcastVisuals(null, null)
    return publish(
      computeGigReadiness({
        folderPath: null,
        gig: null,
        gigProblem: null,
        visualsPresent: false,
        visuals: null,
        visualsProblem: null,
        setlist,
        mediaResolution: {},
        validation: {},
      })
    )
  }

  let read = await platform.readGigFolder(folderPath)

  let gig: GigFile | null = null
  let gigProblem: string | null = read.gigError

  if (!read.gigPresent && gigProblem === null) {
    // Existence is settled in seconds: gigVersion, id, date. Venue and setlist accrete later.
    const created = createGigFile(folderPath, new Date().toISOString().slice(0, 10))
    const written = await platform.writeGigFile(folderPath, serializeGigFile(created))
    if (written.ok) gig = created
    else gigProblem = written.error
  } else if (read.gigText !== null) {
    try {
      gig = parseGigFile(read.gigText)
    } catch (e) {
      gigProblem = e instanceof Error ? e.message : String(e)
    }
  }

  if (gig !== null) {
    const projection = setlist.map(toProjection)
    if (!setlistMatches(gig, projection)) {
      const next = withSetlist(gig, projection)
      const written = await platform.writeGigFile(folderPath, serializeGigFile(next))
      if (written.ok) gig = next
      else gigProblem = written.error
    }
    // The gig may point somewhere other than ./visuals.json; the first read used the default.
    if (gig.visuals && gig.visuals !== './visuals.json') {
      read = await platform.readGigFolder(folderPath, gig.visuals)
    }
  }

  let visuals: VisualsFile | null = null
  let visualsProblem: string | null = read.visualsError
  if (read.visualsText !== null && gig !== null && visualsProblem === null) {
    try {
      visuals = parseVisualsFile(read.visualsText, gig.id)
    } catch (e) {
      visualsProblem = e instanceof Error ? e.message : String(e)
    }
  }

  // Write-through on every read of the gig folder, not only when something changed: the
  // Projection window's mount-time read is only correct if this key is never behind the folder.
  broadcastVisuals(folderPath, visuals)

  const [mediaResolution, validation] = await Promise.all([
    resolveMedia(setlist),
    validateSetlist(setlist),
  ])

  return publish(
    computeGigReadiness({
      folderPath,
      gig,
      gigProblem,
      visualsPresent: read.visualsPresent,
      visuals,
      visualsProblem,
      setlist,
      mediaResolution,
      validation,
    })
  )
}

/** Opens the picker, remembers what was chosen, and reports the delta. */
export async function chooseGigFolder(): Promise<GigReadiness> {
  const chosen = await platform.chooseGigFolderPath()
  if (chosen === null) return getGigReadiness()
  rememberGigFolder(chosen)
  return refreshGigReadiness()
}

/** Closes the gig. The folder is left exactly as it is; only Pregonero forgets where it was. */
export async function closeGig(): Promise<GigReadiness> {
  rememberGigFolder(null)
  return refreshGigReadiness()
}
