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
 * - **The logo.** A static shape's `image` and a static `video` (and, until 2026-09-04, a
 *   `gig-contact` QR) all resolve
 *   through the media link table, and the only way to put anything into that table was the song
 *   library's *Locate video…* button, which only ever offers a song's own declared media. So a
 *   `visuals.json` naming `chango-pepper-logo.png` resolved to nothing and the wall lost its logo,
 *   silently, with nothing anywhere saying why.
 * - **Absolute song paths.** The library stores a path per song because there was no songs root to
 *   store one relative to. There is one now: a song file chosen from inside `<songs>/song-performance`
 *   is remembered by its name, so the library survives the catalogue moving.
 *
 * **A per-source link still wins.** The folder is the answer for everything that is where it says
 * it is; the link table stays the override for the one file that is somewhere else.
 */

import { songFilesFolder } from './fileLayout'
import { isAbsolutePath, joinPath } from './paths'

export const SONGS_FOLDER_KEY = 'pregoneroSongsFolder'
/**
 * **The visuals folder.** The stored key still says `media` and is deliberately not migrated: a
 * per-machine answer already on disk is not wrong because the screen that asks for it found a
 * better name. **`visuals` is the word everywhere a person can read one** — Muralista's assets are
 * what is in there, and *media* was the app's word for the mechanism that resolves them.
 */
export const VISUALS_FOLDER_KEY = 'pregoneroMediaFolder'
export const GIGS_FOLDER_KEY = 'pregoneroGigsFolder'
export const MURALISTA_FOLDER_KEY = 'pregoneroMuralistaFolder'
export const BOMBISTA_PATH_KEY = 'pregoneroBombistaPath'
export const ARTIST_NAME_KEY = 'pregoneroArtistName'

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

/** The songs root — the author's catalogue — or null when none has been chosen. */
export function getSongsFolder(): string | null {
  return read(SONGS_FOLDER_KEY)
}

/**
 * **`<songs>/song-performance`, the folder the song files are in**, or null when there is no
 * catalogue yet. Everything that reads, lists or writes a song file goes through here rather than
 * through the songs root: the root is the author's, and this is the one folder inside it the suite
 * has anything to do with.
 */
export function getSongFilesFolder(): string | null {
  const songs = getSongsFolder()
  return songs === null ? null : songFilesFolder(songs)
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
 * **Whether the app has been told where its three folders are** — the one predicate first run turns
 * on. All three, or the app asks.
 *
 * **The visuals folder joined the other two on 2026-09-04.** It used to be reachable only from
 * Preferences, which is the shape first run exists to remove: a setting discovered at the moment it
 * blocks you. Muralista reads the assets out of it, so a machine without it has a wall that paints
 * nothing and nothing anywhere saying why.
 */
export function hasRequiredFolders(): boolean {
  return getSongsFolder() !== null && getGigsFolder() !== null && getVisualsFolder() !== null
}

/**
 * **Whether this machine has answered any of the three.** The deal's one question, and it is read
 * from the world rather than from a remembered dismissal — the rule Bombista's deal already holds.
 *
 * False is *nothing has been said here yet*, which is the only state the app's deal is shown in. A
 * launch that answered one folder and stopped comes back to the folders, not to the deal: the offer
 * has been taken, and repeating it would be the app failing to notice.
 */
export function hasAnsweredAnyFolder(): boolean {
  return getSongsFolder() !== null || getGigsFolder() !== null || getVisualsFolder() !== null
}

/**
 * **Where a `src` name is looked for** — the visuals folder — and null until somebody says.
 *
 * **Nothing in the suite writes into it** (Jorge, 2026-09-04). Songs got `song-performance/` and
 * gigs got `setup/` because the tools write into both; this one is only ever read. Muralista takes
 * its assets from here and writes `visuals.json` into the gig's own `setup/`, so there is no
 * subfolder to carve out and no ownership boundary to defend.
 *
 * **It used to default to `<songs>/audio`, and that default is gone** (2026-09-01). Audio and video
 * are not one thing called media: the alignment audio is consumed once, at setup, to derive a
 * timeline, and is never needed again — a transient input picked at the door, needing no configured
 * home — while the performance media is played on the wall and must resolve at arming. Defaulting to
 * the audio folder quietly made the catalogue load-bearing for media, so a user keeping video
 * elsewhere got a resolution failure they never agreed to.
 *
 * **A per-source link still wins**, and absence is reported at setup validation and again at arming,
 * which is where it was already reported and is where it stays.
 */
export function getVisualsFolder(): string | null {
  return read(VISUALS_FOLDER_KEY)
}

export function setVisualsFolder(folderPath: string | null): void {
  write(VISUALS_FOLDER_KEY, folderPath)
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
 * them and **nothing migrates**. A bare name is resolved against **`<songs>/song-performance`** when
 * there is a catalogue, and handed back unchanged when there is not: that is what the app did before
 * a songs folder existed, and a reference that used to work must not stop working because a setting
 * is unset.
 */
export function resolveSongPath(refPath: string): string {
  if (isAbsolutePath(refPath)) return refPath
  const folder = getSongFilesFolder()
  return folder === null ? refPath : joinPath(folder, refPath)
}

/**
 * How a chosen song file is remembered: by name when it sits inside `<songs>/song-performance`, by
 * path otherwise. **Only new references take the relative form** — nothing rewrites what is already
 * stored, because a stored absolute path is not wrong, only unportable.
 */
export function songRefPathFor(absolutePath: string): string {
  const folder = getSongFilesFolder()
  if (folder === null) return absolutePath
  const prefix = folder.endsWith('/') ? folder : `${folder}/`
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : absolutePath
}

/**
 * **WHO THE ARTIST IS. Asked at first run, on a screen of its own, editable in Preferences.**
 *
 * **The principle is Jorge's and it settles the whole group** (2026-09-05): *each artist-level fact
 * is asked at the moment it is first needed and lives in Preferences afterwards.* The message-home
 * line and the QR file are asked at the first gig; **the name is asked at first run.**
 *
 * ## Why its own screen and not the folders screen
 *
 * **The folders screen answers *where your things are*, and a name is a different kind of
 * question.** Six rounds bought that screen's clarity — two questions, equal columns, a hard rule
 * between them, so they read as separate before either is read — and a name column would be a third
 * kind of thing inside a layout whose whole job is that its columns are the same kind of thing.
 *
 * **The earlier objection was to the folders screen, not to first run**, and Cowork over-corrected
 * from one to the other. First run is a sequence and already carries the deal ahead of the folders;
 * a short third moment asking who the artist is sits there honestly and says what it is for.
 *
 * ## Why it is NOT captured from Bombista's page 1
 *
 * That was Cowork's proposal and **Jorge rejected it**: *opportunistic and fishy — you capture
 * something for a purpose different from the one I had in mind when I filled it in.* He is right,
 * and the principle generalises: **a value collected for one purpose is not silently promoted to
 * another.** The name typed as *who wrote this song* is not consent to make it the identity of the
 * installation. **Bombista prefills FROM this preference; it does not feed it.**
 *
 * ## What absence means
 *
 * Null, and never a guess. The machine's user name, the songs folder's name and the first song's
 * artist field are all things that would be *usually right*, which is the worst kind of wrong for a
 * value that goes on a wall in front of a room.
 */
export function getArtistName(): string | null {
  return read(ARTIST_NAME_KEY)
}

export function setArtistName(name: string | null): void {
  const trimmed = name === null ? null : name.trim()
  write(ARTIST_NAME_KEY, trimmed && trimmed.length > 0 ? trimmed : null)
}

/**
 * **Whether the name has been answered.** The one predicate the first-run screen turns on, and it
 * is read from the world for the same reason the deal's is: **a remembered dismissal is state this
 * suite keeps deleting**, and after one walk nobody would see the screen again.
 */
export function hasArtistName(): boolean {
  return getArtistName() !== null
}
