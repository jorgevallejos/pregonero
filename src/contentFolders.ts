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
export const GIGS_FOLDER_KEY = 'pregoneroGigsFolder'
export const MURALISTA_FOLDER_KEY = 'pregoneroMuralistaFolder'
export const BOMBISTA_PATH_KEY = 'pregoneroBombistaPath'

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

/**
 * **The gigs folder — where gigs live on this machine.** Null when none has been chosen.
 *
 * Asked for once, on first run, alongside the songs folder. A per-machine fact like the others:
 * the files stay portable, and the folder is where this machine keeps them.
 */
export function getGigsFolder(): string | null {
  return read(GIGS_FOLDER_KEY)
}

export function setGigsFolder(folderPath: string | null): void {
  write(GIGS_FOLDER_KEY, folderPath)
}

/**
 * **Whether the app has been told where its two folders are** — the one predicate first run turns
 * on. Both, or the app asks.
 */
export function hasRequiredFolders(): boolean {
  return getSongsFolder() !== null && getGigsFolder() !== null
}

/**
 * **Where a `src` name is looked for**, and it is normally not a setting at all.
 *
 * It **defaults to `<songs>/audio`**, which is where the audio already lives — one fewer thing to
 * configure before anything works, and one fewer place to discover a precondition at the moment it
 * blocks you. **A per-source link still wins** for a song naming a file somewhere else, so nothing
 * is lost by the default being right most of the time.
 *
 * An explicit choice always beats the default, and clearing one returns to the default rather than
 * to nothing.
 */
export function getMediaFolder(): string | null {
  const chosen = read(MEDIA_FOLDER_KEY)
  if (chosen !== null) return chosen
  return defaultMediaFolder()
}

/** `<songs>/audio`, or null when there is no songs folder to hang it off yet. */
export function defaultMediaFolder(): string | null {
  const songs = getSongsFolder()
  return songs === null ? null : joinPath(songs, 'audio')
}

/** What is explicitly stored, ignoring the default. For a screen that shows both. */
export function getChosenMediaFolder(): string | null {
  return read(MEDIA_FOLDER_KEY)
}

export function setMediaFolder(folderPath: string | null): void {
  write(MEDIA_FOLDER_KEY, folderPath)
}

/**
 * **There is no Muralista folder setting, and that is deliberate** (2026-08-31).
 *
 * Its page is vendored — `src/vendor/mapper.html` and the three files beside it, byte for byte at
 * the tag in `muralista-page.source.json`, with a hash test. **A copy is not a fork when a test
 * proves it current**, which is how `warp.js` and the stand-ins were already carried. What it
 * removes is a setting that had to be discovered before the visuals door did anything, which is
 * the dead-end shape the setup redesign exists to remove.
 *
 * The key `pregoneroMuralistaFolder` is left unread rather than migrated: a stale value in browser
 * storage costs nothing and nothing looks at it.
 */

/**
 * **Where `bombista` is on this machine, when the answer is not obvious.**
 *
 * Normally there is nothing to set: `electron/bombistaBinary.cjs` looks on `PATH` and then in the
 * places a Python CLI actually installs. This is the override for a machine where neither answer
 * is the right one — a virtualenv, a checkout, a second install.
 *
 * **It is used verbatim and never checked**, so a path typed here that is wrong fails naming
 * itself. Falling back to a working binary would leave a dead setting looking alive.
 *
 * It is a per-machine fact, like the folders either side of it, and it travels to the main process
 * on every call rather than being read there — the main process stays stateless about settings.
 */
export function getBombistaPath(): string | null {
  return read(BOMBISTA_PATH_KEY)
}

export function setBombistaPath(binaryPath: string | null): void {
  write(BOMBISTA_PATH_KEY, binaryPath)
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
