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

import type { GigFolderRead, SongValidationResult } from './electronApi'

function api() {
  return typeof window !== 'undefined' ? window.electronAPI : undefined
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
