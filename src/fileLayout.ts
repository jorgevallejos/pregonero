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
 * - **`gig.json` and `visuals.json` are the machine's**, and they live in **one folder** inside the
 *   gigs root: `<gigs>/setup/<gig>/`. **No tool creates a folder in the artist's territory**
 *   (Jorge, 2026-09-02). This supersedes the shape used until then, where `New gig` made a folder
 *   per gig under the gigs root and put a `setup/` inside each one — which put the tools' hands
 *   into the folder the poster and the contract live in.
 *
 *   **Why, in his words: blurring the boundary between the artist's material and the tools' is
 *   misleading, and it has already cost something.** Six irreplaceable backups were deleted on
 *   2026-09-02 because files inside the catalogue were assumed to be the implementation's to clear.
 *   A rule that depends on judgement fails the way judgement fails. One folder, named, is
 *   checkable — and it is the same rule the catalogue already lives under, where the tools govern
 *   `song-performance/` and nothing more.
 *
 *   **The price, on the record:** a night's poster and contract are no longer automatically beside
 *   that night's setup data. `<gig>` is shaped like the night folders Jorge already keeps —
 *   `2026-05-16-bom-festival`, date then venue — so a gig row and its night read as the same thing
 *   even though they sit apart. They are linked by name, not by location.
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

/**
 * **The one folder inside the gigs root that any tool here owns**, and the whole of what they
 * touch. Every gig is a directory inside it; nothing is ever created beside it.
 */
export const GIGS_SETUP_FOLDER = 'setup'

/** `<songs>` → `<songs>/song-performance`. Where every song file is read from and written to. */
export function songFilesFolder(songsRoot: string): string {
  return joinPath(songsRoot, SONG_FILES_FOLDER)
}

/** `<gigs>` → `<gigs>/setup`. The only directory the tools create in the gigs root. */
export function gigsSetupFolder(gigsRoot: string): string {
  return joinPath(gigsRoot, GIGS_SETUP_FOLDER)
}

/**
 * `<gigs>` and `2026-05-16-bom-festival` → `<gigs>/setup/2026-05-16-bom-festival`.
 *
 * **One gig, one directory, and it is the gig's whole footprint on disk** — `gig.json` beside
 * `visuals.json`, which is what keeps the guard the code already enforces: a `visuals` pointer
 * leaving `gig.json`'s own folder is refused rather than followed. It is one directory to copy,
 * archive or delete, and no meaning is parsed out of a filename, which is where implicit rules
 * fail silently.
 */
export function gigFolderIn(gigsRoot: string, gigId: string): string {
  return joinPath(gigsSetupFolder(gigsRoot), gigId)
}
