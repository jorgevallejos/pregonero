/**
 * **Where each picker was last open.** A convenience, and deliberately not a setting.
 *
 * Nothing in Preferences, nothing to configure, nothing to clear: a dialog that opens where you
 * last were saves the walk from the home folder down to the recordings every single time, and it is
 * the kind of thing an app is expected to do without being asked.
 *
 * **It is safe for the reason stored answers are not: remembering where a dialog opened is not
 * remembering an answer.** The dialog shows you where you are and you can walk away from it, so it
 * cannot quietly be wrong the way stored progress can. If it is stale you see that it is stale, in
 * the one place where seeing it costs nothing.
 *
 * **Per picker.** The words picker and the recording picker are different questions asked of
 * different folders, and one shared memory would send each of them to the other's answer.
 *
 * What is remembered is the **folder the dialog was in**, not what was chosen in it — so picking
 * `…/audio/libertad.m4a` reopens in `…/audio`, and choosing the folder `…/Chango Pepper/songs`
 * reopens beside it rather than inside it.
 */

const KEY = 'pregoneroPickerFolders'

/** One key per picker. A new picker gets a new name here rather than borrowing one. */
export type PickerName =
  | 'lyrics'
  | 'audio'
  | 'video'
  | 'json'
  | 'songs-folder'
  | 'gigs-folder'
  | 'media-folder'
  | 'gig-folder'

function readMap(): Record<string, string> {
  try {
    if (typeof localStorage === 'undefined') return {}
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** The folder that picker was last open in, or null when it has never been opened. */
export function lastPickerFolder(picker: PickerName): string | null {
  return readMap()[picker] ?? null
}

/**
 * Records where the picker was, from what came back out of it. A cancelled dialog says nothing and
 * is not recorded — where you nearly went is not where you were.
 */
export function rememberPickerFolder(picker: PickerName, chosenPath: string | null): void {
  if (!chosenPath) return
  const folder = parentFolder(chosenPath)
  if (folder === null) return
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY, JSON.stringify({ ...readMap(), [picker]: folder }))
  } catch {
    /* unavailable in some environments */
  }
}

/** `/a/b/c` → `/a/b`. Null for a path with nothing above it, which is not a place to reopen. */
function parentFolder(path: string): string | null {
  const cut = path.lastIndexOf('/')
  if (cut <= 0) return null
  return path.slice(0, cut)
}
