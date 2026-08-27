/**
 * **Where this machine keeps the songs and the media.** Two absolute paths, remembered per
 * machine, configured on a screen of their own — never inside the song library, which is where
 * the only way to link a file used to be.
 *
 * The model is Muralista's, deliberately: a `src` in a file is a **name** (`cerdo.mp4`,
 * `clips/pig.mp4`), never a path, and a chosen folder is what turns that name into bytes. Muralista
 * holds a directory handle because a page cannot hold a path; Pregonero has Electron and holds the
 * path. The rule either side of that difference is the same — **the files stay portable and the
 * folder is a fact about this machine.**
 *
 * Two holes this closes, both left open by earlier rounds:
 *
 * - **The logo.** A static shape's `image`, a static `video` and a `gig-contact` QR all resolve
 *   through the media link table, and the only way to put anything into that table was the song
 *   library's *Locate video…* button, which only ever offers a song's own declared media. So a
 *   `visuals.json` naming `chango-pepper-logo.png` resolved to nothing and the wall lost its logo,
 *   silently, with nothing anywhere saying why.
 * - **Absolute song paths.** The library stores a path per song because there was no songs root to
 *   store one relative to. There is one now: a song file chosen from inside the configured folder
 *   is remembered by its name, so the library survives the folder moving.
 *
 * **A per-source link still wins.** The folder is the answer for everything that is where it says
 * it is; the link table stays the override for the one file that is somewhere else.
 */

import { isAbsolutePath, joinPath } from './paths'

export const SONGS_FOLDER_KEY = 'pregoneroSongsFolder'
export const MEDIA_FOLDER_KEY = 'pregoneroMediaFolder'
export const MURALISTA_FOLDER_KEY = 'pregoneroMuralistaFolder'

function read(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const value = localStorage.getItem(key)
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (value && value.length > 0) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    /* unavailable in some environments */
  }
}

/** The songs root, or null when none has been chosen. */
export function getSongsFolder(): string | null {
  return read(SONGS_FOLDER_KEY)
}

export function setSongsFolder(folderPath: string | null): void {
  write(SONGS_FOLDER_KEY, folderPath)
}

/** The media folder — where a `src` name is looked for. Null when none has been chosen. */
export function getMediaFolder(): string | null {
  return read(MEDIA_FOLDER_KEY)
}

export function setMediaFolder(folderPath: string | null): void {
  write(MEDIA_FOLDER_KEY, folderPath)
}

/**
 * **Where Muralista's page lives on this machine** — the folder holding `mapper.html`.
 *
 * Pregonero cannot guess it, and it must not vendor a copy: a copy is a fork, and the ownership
 * rule says the room is Muralista's. So it is a per-machine setting like the others, and **when it
 * is not set the button is simply absent** — which is the designed degraded mode, not a failure.
 * Muralista is fully usable on its own by requirement, and the escape hatch says so.
 */
export function getMuralistaFolder(): string | null {
  return read(MURALISTA_FOLDER_KEY)
}

export function setMuralistaFolder(folderPath: string | null): void {
  write(MURALISTA_FOLDER_KEY, folderPath)
}

/**
 * A library reference to a path on this machine.
 *
 * An absolute reference is already the answer and is returned untouched — the library is full of
 * them and **nothing migrates**. A bare name is resolved against the songs folder when there is
 * one, and handed back unchanged when there is not: that is what the app did before a songs folder
 * existed, and a reference that used to work must not stop working because a setting is unset.
 */
export function resolveSongPath(refPath: string): string {
  if (isAbsolutePath(refPath)) return refPath
  const folder = getSongsFolder()
  return folder === null ? refPath : joinPath(folder, refPath)
}

/**
 * How a chosen song file is remembered: by name when it sits inside the songs folder, by path
 * otherwise. **Only new references take the relative form** — nothing rewrites what is already
 * stored, because a stored absolute path is not wrong, only unportable.
 */
export function songRefPathFor(absolutePath: string): string {
  const folder = getSongsFolder()
  if (folder === null) return absolutePath
  const prefix = folder.endsWith('/') ? folder : `${folder}/`
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath
}
