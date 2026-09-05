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
  gigIdentityIsAnswered,
  newGigId,
  hasAuthoredSetlist,
  parseGigFile,
  readGigSetlist,
  serializeGigFile,
  setlistMatches,
  withIdentity,
  withSetlist,
  withSetup,
  type GigFile,
  type GigVenue,
  type SetlistProjection,
  type SetupFingerprints,
} from './gigFile'
import {
  computeGigReadiness,
  type GigReadiness,
  type MediaResolution,
  type SetlistSongInput,
  type SongValidation,
} from './gigReadiness'
import {
  parseVisualsFile,
  songVideoAssets,
  visualsRefusalKind,
  type VisualsFile,
  type VisualsRefusalKind,
} from './visualsFile'
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
import { getGigsFolder, resolveSongPath } from './contentFolders'
import { resolveMediaPath } from './mediaPathStore'
import { collectMediaSources } from './mediaSources'
import { digest } from './fingerprint'
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

/** The setlist as library rows, which is where the digests live. */
function orderedSetlistEntries(): LibraryEntry[] {
  try {
    return getOrderedEntriesForActiveSetlist()
  } catch {
    return []
  }
}

/** Test seam: forget the folder and the snapshot without touching the listeners' contract. */
export function resetGigSession(): void {
  current = null
  lastFingerprints = null
  rememberGigFolder(null)
  broadcastVisuals(null, null)
}

// ── Gathering ────────────────────────────────────────────────────────────────────────────────

/**
 * **The fingerprints as they are right now** — each setlist song's file, `visuals.json`, and the
 * display configuration. The setup confirmation records these so it can notice one of them moved;
 * they are compared and never read back, and nothing renders from them.
 */
async function currentFingerprints(
  setlist: readonly LibraryEntry[],
  visualsText: string | null
): Promise<SetupFingerprints> {
  const songs: Record<string, string> = {}
  for (const entry of setlist) {
    if (entry.digest) songs[entry.ref.id] = entry.digest
  }
  const displays = await platform.describeDisplays()
  return {
    songs,
    visuals: visualsText === null ? null : digest(visualsText),
    display: displays.fingerprint,
  }
}

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

/**
 * **Every name the room asks for, resolved on this machine.**
 *
 * **It used to gather `song.media.src` off each song.** Under *the song holds no media* a song names
 * nothing, and what plays on the wall is named by `visuals.json` — so the names come from
 * `songVisuals.assets`, per song, for the shapes that song actually lights.
 *
 * **Resolution itself is unchanged**: `resolveMediaPath` is still the one answer to *where is the
 * file called X*, and the file still travels as a name.
 */
/**
 * **EVERY NAME THE NIGHT WILL ASK FOR, WHICH IS NOT ONLY THE SONGS'** (2026-09-06).
 *
 * It walked the setlist's video assets and stopped, so **a static shape naming a file that resolves
 * to nothing was checked by nothing** — the gig signed off clean with a logo that was never going
 * to paint. `collectMediaSources` already gathers exactly these names; it had one caller, and that
 * caller was Preferences. **The machine knew and the sign-off did not ask.**
 */
async function resolveMedia(
  setlist: readonly SetlistSongInput[],
  visuals: VisualsFile | null
): Promise<Record<string, MediaResolution>> {
  const out: Record<string, MediaResolution> = {}
  if (visuals === null) return out

  const resolveOne = async (src: string): Promise<void> => {
    if (out[src]) return
    const linkedPath = resolveMediaPath(src)
    if (!linkedPath) {
      out[src] = { linked: false, exists: false }
      return
    }
    out[src] = { linked: true, exists: await platform.fileExists(linkedPath) }
  }

  for (const entry of setlist) {
    for (const src of songVideoAssets(visuals, entry.id).named) await resolveOne(src)
  }
  // **The room's own names**, from the one reader that already knew about them. The library is not
  // consulted here — a song's declared media is the setlist's question, answered above.
  for (const source of collectMediaSources([], visuals)) await resolveOne(source.src)
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

/**
 * The fingerprints from the last read of the gig folder.
 *
 * Held so that confirming records exactly what the screen was showing when the person said yes,
 * rather than a second read that could have moved between the two. Session-only: nothing is derived
 * from it, and the recorded copy in `gig.json` is the one that lasts.
 */
let lastFingerprints: SetupFingerprints | null = null

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
 * **Re-read on open. One write can still happen here**, and it is Pregonero writing the file it
 * owns: a `gig.json` that has not reached the step where it carries a running order gets the app's
 * written in. That is accretion, not an overwrite — `docs/gig-file.md`, "The file exists before it
 * is finished". **A file that already states a setlist is read, never rewritten here**; changing
 * the running order is `publishSetlistToGig`, which is an explicit act with a screen behind it.
 *
 * **A folder with no `gig.json` no longer gets one written into it** (2026-09-03). It used to,
 * carrying an id and today's date — which is how a folder nobody had called a gig became one with
 * an invented date. Under *the gigs list is the folder*, such a folder is not a gig and is not
 * listed, so there is nothing to date; reading a folder must not create a file in it. The state it
 * lands in is the one readiness already had a name for: **no gig.json in this folder yet**.
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
        mediaResolution: {},
        validation: {},
      })
    )
  }

  let read = await platform.readGigFolder(folderPath)

  let gig: GigFile | null = null
  let gigProblem: string | null = read.gigError

  if (read.gigText !== null) {
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
      // **The field accretes EMPTY, because a gig that has not stated a running order has none.**
      //
      // This wrote `readSetlist()` — the app's currently active setlist — into the file, which is
      // the E1 direction that `adoptSetlistFromGig` exists to have reversed, surviving in the one
      // branch the reversal did not touch. A gig made from Backstage therefore arrived carrying
      // whatever setlist happened to be active when it was created, and step 2 opened on a
      // catalogue reading *Every song you have is in this gig's setlist*. Walked 2026-09-04.
      //
      // **A NEW GIG'S SETLIST IS EMPTY**, and the only thing that fills it is a person on step 2.
      // Writing the field at all is still right — it is what makes the running order exist, and
      // the adoption below is what gives `Add →` an active setlist to write into, which is the
      // `v0.39.0` fix and is unchanged. What changed is what goes in it.
      const next = withSetlist(gig, [], folderPath)
      const written = await platform.writeGigFile(folderPath, serializeGigFile(next))
      if (written.ok) {
        gig = next
        // **And then it is adopted, exactly as a file that already had one is.** Writing the field
        // is what makes the gig's running order exist, so the app has to come away holding the
        // gig's own setlist — `gig-<id>`, active — and not the setlist it happened to have before.
        //
        // **Missing this is what made `Add →` do nothing** (walked 2026-09-03). On a machine that
        // has never made a setlist there is no active one, `addSongToSetlist` is handed `''` and
        // refuses, and screen 2 draws an empty running order with nothing anywhere saying why. The
        // branch above never bit because a file with a setlist adopts one on the way in; this one
        // is the path every new gig takes, and it left the store with nothing to write into.
        await adoptSetlistFromGig(gig, folderPath)
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
 * One read of the gig folder, parsed. The shape every write path starts from: read what is on
 * disk, change one thing, write it back — rather than writing from what a screen was holding.
 */
async function readGig(folderPath: string): Promise<{
  read: Awaited<ReturnType<typeof platform.readGigFolder>>
  gig: GigFile | null
  gigProblem: string | null
}> {
  const read = await platform.readGigFolder(folderPath)
  if (read.gigText === null || read.gigError !== null) {
    return { read, gig: null, gigProblem: read.gigError }
  }
  try {
    return { read, gig: parseGigFile(read.gigText), gigProblem: null }
  } catch (e) {
    return { read, gig: null, gigProblem: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * **The gig's date and venue, written down.** Setup step 1, and the only step that writes anything
 * a person typed — every other step is derived from files somebody else's tool owns.
 *
 * `id` is not writable here on purpose: it is the folder's name, born with the gig, and
 * `visuals.json`'s `gigId` is compared against it.
 */
export async function saveGigIdentity(identity: {
  date: string
  venue: GigVenue
}): Promise<GigReadiness> {
  const folderPath = getRememberedGigFolder()
  if (folderPath === null) return refreshGigReadiness()

  const state = await readGig(folderPath)
  let read = state.read
  const gig = state.gig
  const gigProblem = state.gigProblem
  if (gig === null) return publishFromFolder(folderPath, gig, gigProblem, read)

  const next = withIdentity(gig, identity)
  const written = await platform.writeGigFile(folderPath, serializeGigFile(next))
  if (!written.ok) return publishFromFolder(folderPath, gig, written.error, read)

  if (next.visuals && next.visuals !== './visuals.json') {
    read = await platform.readGigFolder(folderPath, next.visuals)
  }
  return publishFromFolder(folderPath, next, gigProblem, read)
}

/**
 * **A gig is made by saying what it is.** The folder is created inside `<gigs>/setup` under an
 * opaque id, `gig.json` is written whole, and the gig is opened.
 *
 * **Nothing is asked about where it goes, and nothing is typed that is not a fact about the
 * night.** `New gig` used to open a directory picker, and then — briefly — a `Name it` field whose
 * answer was a folder name. Both were the same mistake in different clothes: a filesystem decision
 * standing in front of a gig that did not yet have a venue or a date.
 *
 * ## The write gate, and why it is a line of code rather than a consequence
 *
 * **Nothing reaches disk until the date and the venue are both answered.** Until 2026-09-03 that
 * was true without anybody writing it: the folder was named `2026-05-16-bom-festival`, so a missing
 * half meant no name and there was nothing to create. **The opaque id repeals that for free** —
 * `newGigId` answers at any moment, about a gig that is nothing yet — so the rule is now
 * `gigIdentityIsAnswered`, checked here, before the folder and before the file. Leaving during
 * step 1 discards the fields and no folder was ever made, so there is never a half-made thing on
 * disk that is in no list. That shape is what produced a phantom popup on 2026-09-02.
 *
 * **The gate is checked before `createGigFolder`, which is the only ordering that means anything**:
 * a folder made and then judged is a folder on disk.
 */
export async function createGig(identity: {
  date: string
  venue: GigVenue
}): Promise<{ ok: true; folderPath: string } | { ok: false; error: string }> {
  const gigsRoot = getGigsFolder()
  if (gigsRoot === null) {
    return {
      ok: false,
      error: 'There is no gigs folder yet, so there is nowhere for a gig to be created.',
    }
  }

  if (!gigIdentityIsAnswered({ date: identity.date, venue: identity.venue.name ?? '' })) {
    return {
      ok: false,
      error: 'A gig is a date and a place, and one of them is missing. Nothing has been written.',
    }
  }

  // Minted here and never again: the folder is this id for the rest of the gig's life, and
  // `gig.json`'s own `id` is read back off the folder name by `createGigFile`.
  const made = await platform.createGigFolder(gigsRoot, newGigId())
  if (!made.ok) return made

  // **Written whole, once, before it is opened.** Creating the folder and then letting the on-open
  // path write an identity-only file — and writing the venue over it afterwards — would be three
  // writes and one read-back, and would leave a gig that briefly exists without the venue that
  // named it.
  const base = createGigFile(made.folderPath)
  const gig = withIdentity(base, { date: identity.date, venue: identity.venue })
  const written = await platform.writeGigFile(made.folderPath, serializeGigFile(gig))
  if (!written.ok) return { ok: false, error: written.error }

  await openGigFolder(made.folderPath)
  return { ok: true, folderPath: made.folderPath }
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

  const state = await readGig(folderPath)
  let read = state.read
  let gig = state.gig
  const gigProblem = state.gigProblem
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
  // **Which refusal it was, carried beside the sentence** (2026-09-03), so the check screen can
  // tell *this mapping is another room's* from *this file will not parse* without reading prose.
  // A folder read that failed before the parse is `unreadable`, so callers have one vocabulary.
  let visualsRefusal: VisualsRefusalKind | null = read.visualsError ? 'unreadable' : null
  if (read.visualsText !== null && gig !== null && visualsProblem === null) {
    try {
      visuals = parseVisualsFile(read.visualsText, gig.id)
    } catch (e) {
      visualsProblem = e instanceof Error ? e.message : String(e)
      visualsRefusal = visualsRefusalKind(e)
    }
  }

  // Write-through on every read of the gig folder, not only when something changed: the
  // Projection window's mount-time read is only correct if this key is never behind the folder.
  broadcastVisuals(folderPath, visuals)

  const [mediaResolution, validation, fingerprints] = await Promise.all([
    resolveMedia(setlist, visuals),
    validateSetlist(setlist),
    currentFingerprints(orderedSetlistEntries(), read.visualsText),
  ])
  // Held for the moment the confirmation is made, so confirming records exactly what the screen
  // was showing rather than a second read that could disagree with it.
  lastFingerprints = fingerprints

  return publish(
    computeGigReadiness({
      folderPath,
      gig,
      gigProblem,
      visualsPresent: read.visualsPresent,
      visuals,
      visualsProblem,
      visualsRefusal,
      setlist,
      mediaResolution,
      validation,
      fingerprints,
      adoption: lastAdoption,
    })
  )
}

/**
 * **Confirming setup.** The one thing this app deliberately stores, and it is a **milestone, not a
 * lock**: it blocks nothing, freezes nothing, and can be made again at any time.
 *
 * It records that the checks passed and **what they passed against**, so it can notice it has
 * stopped being true. It never records a warp matrix, a layout or a pixel size — save the recipe,
 * not the cake.
 */
export async function confirmSetup(): Promise<GigReadiness> {
  const folderPath = getRememberedGigFolder()
  if (folderPath === null) return refreshGigReadiness()

  const state = await readGig(folderPath)
  let read = state.read
  const gig = state.gig
  const gigProblem = state.gigProblem
  if (gig === null) return publishFromFolder(folderPath, gig, gigProblem, read)

  if (gig.visuals && gig.visuals !== './visuals.json') {
    read = await platform.readGigFolder(folderPath, gig.visuals)
  }

  const against =
    lastFingerprints ?? (await currentFingerprints(orderedSetlistEntries(), read.visualsText))
  const next = withSetup(gig, { confirmedAt: new Date().toISOString(), against })
  const written = await platform.writeGigFile(folderPath, serializeGigFile(next))
  if (!written.ok) return publishFromFolder(folderPath, gig, written.error, read)

  return publishFromFolder(folderPath, next, gigProblem, read)
}

/**
 * Opens a gig folder this app already has a path for — a row on Setup home.
 *
 * **One memory, and it is *which gig is open***: one path, read by the Projection window. There is
 * no second list to keep in step — since 2026-09-03 the gigs list is `<gigs>/setup/` itself, read
 * on arrival, so opening a gig records nothing about which gigs exist.
 */
export async function openGigFolder(folderPath: string): Promise<GigReadiness> {
  rememberGigFolder(folderPath)
  return refreshGigReadiness()
}

/** Closes the gig. The folder is left exactly as it is; only Pregonero forgets where it was. */
export async function closeGig(): Promise<GigReadiness> {
  rememberGigFolder(null)
  return refreshGigReadiness()
}
