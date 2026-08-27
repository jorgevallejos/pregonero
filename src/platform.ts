/**
 * **The one module that knows Electron exists**, for everything this round introduces: the gig
 * folder, reading and writing files in it, and shelling out to `bombista`.
 *
 * This is bookkeeping, not architecture. There is no interface here, no abstraction layer, no
 * second implementation and nothing configurable — one file that reaches for `window.electronAPI`,
 * and the rest of the app calling it. The justification is testability and the fact that these
 * calls otherwise scatter irreversibly across every feature that happens to need one.
 *
 * Every function answers rather than throwing, and every one has an answer for "there is no
 * Electron here" — the Vite dev server in a plain browser, and jsdom in tests.
 */

import type {
  BombistaResult,
  DisplayDescription,
  GigFolderRead,
  SongValidationResult,
} from './electronApi'

function api() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
}

/** Whether a native folder picker can be reached at all. False in a browser and in tests. */
export function hasFolderPicker(): boolean {
  const a = api()
  return !!a && typeof a.openFolderDialog === 'function'
}

/** Whether the gig folder can be reached at all. False in a browser and in tests. */
export function hasGigFolderAccess(): boolean {
  const a = api()
  return !!a && typeof a.readGigFolder === 'function'
}

/** Opens the native directory picker. Null when cancelled, or when there is no Electron. */
export async function chooseGigFolderPath(): Promise<string | null> {
  const a = api()
  if (!a || typeof a.openGigFolderDialog !== 'function') return null
  return a.openGigFolderDialog()
}

/**
 * Opens the native directory picker for a folder this machine remembers — the songs root, the
 * media folder. Null when cancelled, or when there is no Electron.
 */
export async function chooseFolderPath(title: string): Promise<string | null> {
  const a = api()
  if (!a || typeof a.openFolderDialog !== 'function') return null
  return a.openFolderDialog(title)
}

const ABSENT: Omit<GigFolderRead, 'folderPath'> = {
  gigText: null,
  gigError: null,
  gigPresent: false,
  visualsText: null,
  visualsError: null,
  visualsPresent: false,
}

/** One read of the gig folder. Outside Electron it reports an empty folder, not a failure. */
export async function readGigFolder(
  folderPath: string,
  visualsPointer?: string
): Promise<GigFolderRead> {
  const a = api()
  if (!a || typeof a.readGigFolder !== 'function') return { folderPath, ...ABSENT }
  try {
    return await a.readGigFolder(folderPath, visualsPointer)
  } catch (e) {
    return {
      folderPath,
      ...ABSENT,
      gigError: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function writeGigFile(
  folderPath: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = api()
  if (!a || typeof a.writeGigFile !== 'function') {
    return { ok: false, error: 'The gig folder can only be written from the desktop app.' }
  }
  try {
    return await a.writeGigFile(folderPath, text)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Writes `debrief.md` into the gig folder. */
export async function writeDebriefFile(
  folderPath: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = api()
  if (!a || typeof a.writeDebriefFile !== 'function') {
    return { ok: false, error: 'The gig folder can only be written from the desktop app.' }
  }
  try {
    return await a.writeDebriefFile(folderPath, text)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Reads a song file's text. The library's own reader goes through here rather than reaching for
 * `window.electronAPI` itself — this is the one module that knows Electron exists, and a song file
 * is as much a file on this machine as `gig.json` is.
 */
export async function readSongFileText(
  filePath: string
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const a = api()
  if (!a || typeof a.readSongFile !== 'function') {
    return { ok: false, error: 'Song files can only be read from the desktop app.' }
  }
  try {
    return await a.readSongFile(filePath)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** `bombista validate --for-performance`. Never fails closed: no binary means `skipped`. */
export async function validateSongForPerformance(
  songPath: string
): Promise<SongValidationResult> {
  const a = api()
  if (!a || typeof a.validateSongForPerformance !== 'function') {
    return { status: 'skipped', reason: 'bombista can only be run from the desktop app' }
  }
  try {
    return await a.validateSongForPerformance(songPath)
  } catch (e) {
    return { status: 'skipped', reason: e instanceof Error ? e.message : String(e) }
  }
}

const NO_DISPLAYS: DisplayDescription = { count: 0, displays: [], fingerprint: '' }

/**
 * What displays this machine has. **Read-only, and compared rather than rendered from.**
 *
 * Outside Electron there is no answer, and an empty fingerprint is the honest one: a confirmation
 * recorded without an answer and compared without one does not lapse, because nothing was learned
 * either time.
 */
export async function describeDisplays(): Promise<DisplayDescription> {
  const a = api()
  if (!a || typeof a.describeDisplays !== 'function') return NO_DISPLAYS
  try {
    return await a.describeDisplays()
  } catch {
    return NO_DISPLAYS
  }
}

// ── Hosting the other two tools. Packaging, not architecture ─────────────────────────────────
//
// **Nothing here passes data between running processes.** Bombista is handed a song file path and
// an exit code comes back; Muralista is a page in a window that reads and writes files. The file
// is the only channel, and hosting a tool's UI changes where the window is, not who writes what.
//
// **Every one of these is absent outside Electron**, and that is the designed degraded mode: each
// tool is fully usable on its own, so a missing bridge means the button is not there and the
// escape hatch is.

const NOT_HOSTED: BombistaResult = {
  status: 'skipped',
  output: 'bombista can only be run from the desktop app',
  code: null,
}

/** Whether Bombista can be run at all from here. */
export function canRunBombista(): boolean {
  const a = api()
  return !!a && typeof a.runBombista === 'function'
}

/**
 * Runs one Bombista subcommand. **A song file path, never a gig.**
 *
 * If anything ever wants to hand Bombista gig context, that is the boundary breaking: Bombista does
 * not know Pregonero exists and does not know gigs exist.
 */
export async function runBombista(subcommand: string, args: string[]): Promise<BombistaResult> {
  const a = api()
  if (!a || typeof a.runBombista !== 'function') return NOT_HOSTED
  try {
    return await a.runBombista(subcommand, args)
  } catch (e) {
    return { status: 'skipped', output: e instanceof Error ? e.message : String(e), code: null }
  }
}

export async function bombistaVersion(): Promise<{ present: boolean; version: string | null }> {
  const a = api()
  if (!a || typeof a.bombistaVersion !== 'function') return { present: false, version: null }
  try {
    return await a.bombistaVersion()
  } catch {
    return { present: false, version: null }
  }
}

/** The directory `align` writes into for a song. Pregonero names it and never reaches into it. */
export async function bombistaStagingDir(songId: string): Promise<string | null> {
  const a = api()
  if (!a || typeof a.bombistaStagingDir !== 'function') return null
  try {
    const result = await a.bombistaStagingDir(songId)
    return result.ok ? result.path : null
  } catch {
    return null
  }
}

/**
 * **Bombista's review page, which Bombista serves itself.**
 *
 * Not hosted from Pregonero's own server, and the reason is concrete rather than stylistic: the
 * static `--emit html` review page names its audio with a path relative to the staging directory,
 * so serving it from a mount rooted there produces a review page **with no audio** — and hearing
 * the doubtful lines is the whole of what that page is for. `bombista serve` has `/api/audio`
 * precisely so the page needs no relative src, and it is where tempo editing lives.
 */
export async function openBombistaReview(
  args: string[]
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const a = api()
  if (!a || typeof a.openBombistaReview !== 'function') {
    return { ok: false, error: 'Bombista can only be opened from the desktop app.' }
  }
  try {
    return await a.openBombistaReview(args)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Whether a tool's page can be hosted from here. False in a browser and in tests. */
export function canHostTools(): boolean {
  const a = api()
  return !!a && typeof a.openTool === 'function'
}

/**
 * Opens a tool's page in a window of its own, **over `http://127.0.0.1`, never `file://`** —
 * Muralista's File System Access API needs a secure context, and `file://` also hits the
 * `webSecurity` block on media this repo already solved once with `media://`.
 */
export async function openTool(
  key: string,
  folder: string,
  page: string,
  title: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const a = api()
  if (!a || typeof a.openTool !== 'function') {
    return { ok: false, error: 'Tools can only be hosted from the desktop app.' }
  }
  try {
    return await a.openTool(key, folder, page, title)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Closes a hosted tool window and brings Pregonero forward.
 *
 * **Courtesy, not architecture.** The reload already happened because the file changed; this only
 * saves a click. If the bridge is absent the button is absent, and you close the window yourself.
 */
export async function closeTool(key: string): Promise<void> {
  const a = api()
  if (!a || typeof a.closeTool !== 'function') return
  try {
    await a.closeTool(key)
  } catch {
    /* the window is already gone, which is the outcome asked for */
  }
}

/** The native file picker, filtered. Null when cancelled, or when there is no Electron. */
export async function chooseFilePath(kind: 'video' | 'audio' | 'json'): Promise<string | null> {
  const a = api()
  if (!a || typeof a.openFileDialog !== 'function') return null
  return a.openFileDialog(kind)
}

/** Whether the file at an absolute path is there. Unknown outside Electron, which reads as absent. */
export async function fileExists(absolutePath: string): Promise<boolean> {
  const a = api()
  if (!a || typeof a.getFileStats !== 'function') return false
  try {
    const stats = await a.getFileStats(absolutePath)
    return stats.exists
  } catch {
    return false
  }
}
