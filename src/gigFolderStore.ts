/**
 * Which gig folder is open, remembered across launches the way Muralista remembers its media
 * folder.
 *
 * It is its own module for one reason: the Projection window needs to know whether a gig is open
 * at all — with none there is nothing to project and the wall is dark — and it must be able to ask
 * without pulling in `gigSession`, which reads files, writes `gig.json` and owns the readiness
 * snapshot. One `localStorage` key, two readers, no cycle.
 */

/** The key is an address and is deliberately not renamed — see `contentFolders.ts`. */
export const GIG_FOLDER_KEY = 'pregoneroGigFolder'

export function getRememberedGigFolder(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const path = localStorage.getItem(GIG_FOLDER_KEY)
    return path && path.length > 0 ? path : null
  } catch {
    return null
  }
}

export function rememberGigFolder(folderPath: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (folderPath) localStorage.setItem(GIG_FOLDER_KEY, folderPath)
    else localStorage.removeItem(GIG_FOLDER_KEY)
  } catch {
    /* unavailable in some environments */
  }
}
