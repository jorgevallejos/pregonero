/**
 * **Where the suite's files sit inside the two folders this machine is pointed at.**
 *
 * One module, because there is only one question here and it is asked twice: **is this file the
 * author's, or the machine's?** Every answer below is that question applied somewhere.
 *
 * - **A song file is the author's.** It carries his lyrics and his translations, ten declared works
 *   came out of these files, and the catalogue is versioned because they are worth versioning. So it
 *   stays in his catalogue, in a folder named after the format rather than after the tool:
 *   `audio/`, `lyrics/` and `song-performance/` all say what they hold. **Never `setup/`** — that
 *   word means the machine's bookkeeping one level down, and these files are the opposite of that.
 * - **`gig.json` and `visuals.json` are the machine's.** A gig folder is the author's — the poster,
 *   the contract, the stage plan, `debrief.md` — so the two machine files are guests in it and get
 *   their own place inside it. The ownership boundary becomes visible in Finder instead of being a
 *   rule to remember.
 *
 * **This module is the only place either name is written.** The main process is handed folders that
 * are already joined, exactly as it is already handed the songs root and the gigs root rather than
 * reading them: it stays ignorant of the suite's conventions, and there is no second definition to
 * drift from this one. It is also what closes the trap the design warned about — a gig's id is its
 * folder's name, and nothing outside `platform.ts` ever holds a path ending in `setup/` to take it
 * from.
 */

import { joinPath } from './paths'

/** The folder inside the songs root that holds the Song Performance JSON files. */
export const SONG_FILES_FOLDER = 'song-performance'

/** The folder inside a gig folder that holds the machine's two files. */
export const GIG_SETUP_FOLDER = 'setup'

/** `<songs>` → `<songs>/song-performance`. Where every song file is read from and written to. */
export function songFilesFolder(songsRoot: string): string {
  return joinPath(songsRoot, SONG_FILES_FOLDER)
}

/** `<gig>` → `<gig>/setup`. Where `gig.json` and `visuals.json` live, and nothing else. */
export function gigSetupFolder(gigFolderPath: string): string {
  return joinPath(gigFolderPath, GIG_SETUP_FOLDER)
}
