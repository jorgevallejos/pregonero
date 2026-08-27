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
  hasAuthoredSetlist,
  parseGigFile,
  readGigSetlist,
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
import {
  adoptSetlistInSnapshot,
  getOrderedEntriesForActiveSetlist,
  loadSetlistStore,
  resolveSongRef,
  saveSetlistStore,
  setLibraryEntries,
  getLibraryEntries,
  defaultReadSongFile,
  type LibraryEntry,
} from './setlistStore'
import { resolveSongPath } from './contentFolders'
import { resolveMediaPath } from './mediaPathStore'
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
    library: readLibrary(),
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

/**
 * The whole library as readiness input, for step 1 — which is about the songs and not about this
 * gig, and is why songs come first in the flow.
 */
function readLibrary(): SetlistSongInput[] {
  try {
    return getLibraryEntries().map(toSetlistInput)
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
  // The resolved path, not the stored reference: `bombista` is handed a real file, and the `file`
  // written into `gig.json` is computed from one.
  const path = resolveSongPath(entry.ref.path)
  return {
    id: entry.ref.id,
    title: entry.song?.title ?? entry.ref.id,
    path,
    song: entry.song ?? null,
    ...(entry.song ? {} : { error: entry.error ?? `${path} could not be read.` }),
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
    const linkedPath = resolveMediaPath(src)
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
 * **The setlist as `gig.json` last stated it**, for this session only.
 *
 * It exists to answer one question at the moment Pregonero writes: *has the file changed since we
 * read it?* A difference means a running order edited outside the app is about to be replaced, and
 * that has to be said on screen rather than done quietly. It is not stored progress — nothing is
 * derived from it, and a fresh launch simply has no comparison to make until it has read the file.
 */
let lastAdoptedSetlist: string[] | null = null

/** What changed about the running order on the last read or write. Rendered; never inferred from. */
export type SetlistAdoption = {
  /** `adopted` when the file's order replaced the app's; `wrote` when the app's replaced the file's. */
  direction: 'adopted' | 'wrote'
  /** The order that is now in force. */
  now: string[]
  /** The order that was displaced. Empty when nothing was. */
  displaced: string[]
  /** Ids the file names that this machine cannot turn into a song. */
  unresolved: string[]
}

let lastAdoption: SetlistAdoption | null = null

/** The last thing that happened to the running order, or null when nothing has. */
export function getSetlistAdoption(): SetlistAdoption | null {
  return lastAdoption
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * **The file is the source.** Takes `gig.json`'s running order into the app: references for the
 * songs it names, a setlist of the gig's own, made active.
 *
 * Round E1 wrote this the other way — the app's setlist was dumped into the file on every read, so
 * a running order edited by hand in `gig.json` was silently overwritten. Pregonero is still the
 * file's only writer; what changed is which side of the read is authoritative.
 */
async function adoptSetlistFromGig(gig: GigFile, folderPath: string): Promise<void> {
  const before = readSetlist().map((entry) => entry.id)
  const entries = readGigSetlist(gig, folderPath)

  const snapshot = loadSetlistStore()
  if (snapshot === null) return

  const { snapshot: next, adopted, unresolved } = adoptSetlistInSnapshot(
    snapshot,
    `gig-${gig.id}`,
    gig.id,
    entries
  )
  saveSetlistStore(next)

  // Anything the file just pointed somewhere new has to be read before it can be performed.
  const known = new Map(getLibraryEntries().map((entry) => [entry.ref.id, entry]))
  const resolvedEntries: LibraryEntry[] = []
  for (const ref of next.library) {
    const cached = known.get(ref.id)
    if (cached && cached.ref.path === ref.path) resolvedEntries.push(cached)
    else resolvedEntries.push(await resolveSongRef(ref, defaultReadSongFile))
  }
  setLibraryEntries(resolvedEntries)

  lastAdoptedSetlist = [...adopted]
  lastAdoption =
    sameOrder(before, adopted) && unresolved.length === 0
      ? null
      : { direction: 'adopted', now: adopted, displaced: before, unresolved }
}

/**
 * Reads the gig folder and recomputes the delta.
 *
 * **Re-read on open.** Two writes can still happen here, and both are Pregonero writing the file it
 * owns: a folder with no `gig.json` gets one carrying identity and nothing else, and a `gig.json`
 * that has not reached the step where it carries a running order gets the app's written in. That
 * second one is accretion, not an overwrite — `docs/gig-file.md`, "The file exists before it is
 * finished". **A file that already states a setlist is read, never rewritten here**; changing the
 * running order is `publishSetlistToGig`, which is an explicit act with a screen behind it.
 */
export async function refreshGigReadiness(): Promise<GigReadiness> {
  const folderPath = getRememberedGigFolder()

  if (folderPath === null) {
    // No gig folder open means there is nothing to project. The Projection window goes dark, and
    // that is the answer rather than a fallback — the same empty-state model as a shape whose song
    // is not playing.
    broadcastVisuals(null, null)
    lastAdoptedSetlist = null
    lastAdoption = null
    return publish(
      computeGigReadiness({
        folderPath: null,
        gig: null,
        gigProblem: null,
        visualsPresent: false,
        visuals: null,
        visualsProblem: null,
        setlist: readSetlist(),
        library: readLibrary(),
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
    if (hasAuthoredSetlist(gig)) {
      await adoptSetlistFromGig(gig, folderPath)
    } else {
      // The file has not reached step 2's running order yet. Writing the app's in is the field
      // accreting for the first time, which is the normal way this file grows.
      const projection = readSetlist().map(toProjection)
      const next = withSetlist(gig, projection, folderPath)
      const written = await platform.writeGigFile(folderPath, serializeGigFile(next))
      if (written.ok) {
        gig = next
        lastAdoptedSetlist = projection.map((song) => song.id)
        lastAdoption = null
      } else {
        gigProblem = written.error
      }
    }
    // The gig may point somewhere other than ./visuals.json; the first read used the default.
    if (gig.visuals && gig.visuals !== './visuals.json') {
      read = await platform.readGigFolder(folderPath, gig.visuals)
    }
  }

  return publishFromFolder(folderPath, gig, gigProblem, read)
}

/**
 * **Pregonero writing the running order it just changed.** The only path that replaces a setlist
 * already in the file, and the reason it is a function of its own rather than a side effect of
 * reading: reading is what the app does constantly, and a write folded into it is a write nobody
 * asked for.
 *
 * If the file's order is not the one this session last read, a hand edit is being replaced. That is
 * allowed — Pregonero is the only writer and the person doing both is the same person — but it is
 * **recorded and shown**, never done quietly.
 */
export async function publishSetlistToGig(): Promise<GigReadiness> {
  const folderPath = getRememberedGigFolder()
  if (folderPath === null) return refreshGigReadiness()

  let read = await platform.readGigFolder(folderPath)
  let gigProblem: string | null = read.gigError
  let gig: GigFile | null = null
  if (read.gigText !== null && gigProblem === null) {
    try {
      gig = parseGigFile(read.gigText)
    } catch (e) {
      gigProblem = e instanceof Error ? e.message : String(e)
    }
  }
  if (gig === null) return publishFromFolder(folderPath, gig, gigProblem, read)

  const projection = readSetlist().map(toProjection)
  const onDisk = readGigSetlist(gig, folderPath).map((entry) => entry.id)
  const now = projection.map((song) => song.id)

  if (setlistMatches(gig, projection, folderPath)) {
    lastAdoptedSetlist = now
    lastAdoption = null
    return publishFromFolder(folderPath, gig, gigProblem, read)
  }

  const next = withSetlist(gig, projection, folderPath)
  const written = await platform.writeGigFile(folderPath, serializeGigFile(next))
  if (!written.ok) {
    return publishFromFolder(folderPath, gig, written.error, read)
  }
  gig = next

  const editedOutside =
    lastAdoptedSetlist !== null && !sameOrder(onDisk, lastAdoptedSetlist)
  lastAdoption = editedOutside
    ? { direction: 'wrote', now, displaced: onDisk, unresolved: [] }
    : null
  lastAdoptedSetlist = now

  if (gig.visuals && gig.visuals !== './visuals.json') {
    read = await platform.readGigFolder(folderPath, gig.visuals)
  }
  return publishFromFolder(folderPath, gig, gigProblem, read)
}

/** The tail every path above shares: parse the room, broadcast it, and compute the delta. */
async function publishFromFolder(
  folderPath: string,
  gig: GigFile | null,
  gigProblem: string | null,
  read: Awaited<ReturnType<typeof platform.readGigFolder>>
): Promise<GigReadiness> {
  const setlist = readSetlist()

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
      library: readLibrary(),
      mediaResolution,
      validation,
      adoption: lastAdoption,
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
