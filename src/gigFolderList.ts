/**
 * **The gigs on this machine, read from `<gigs>/setup/` on arrival.**
 *
 * **The gigs list is the folder, like the songs list** (Jorge, 2026-09-03). The bookmark list in
 * browser storage is gone: it held paths while the data sat in folders, and the two could come
 * apart — cleared storage left every folder on disk and an empty GIGS column, so the gigs looked
 * deleted and were not. **An app-held list standing in for the world is the shape of that
 * failure**, and it is the same rule the songs list already lives under.
 *
 * **Three answers about a folder, and they are not the same answer.**
 *
 * - **No `gig.json` — not a gig, and silent.** No row and no popup. Nobody ever claimed the folder
 *   was a gig, so there is nothing to report; a folder that arrived some other way is not an error
 *   about anything.
 * - **A `gig.json` that will not parse — the unreadable-song case.** Something *was* claimed to be
 *   a gig and cannot be read, which is a fact about the person's own file. Reported once through
 *   the popup queue, and **not shown as a row**: a row is a thing you can open, and this cannot be
 *   opened.
 * - **A `gig.json` that parses — a gig.** One row, labelled from the file itself
 *   (`gigLabels.readGigLabels`), never from the folder name, which is an opaque id.
 *
 * **It writes nothing.** Reading a folder must not create a file in it: the old on-open path wrote
 * an identity-only `gig.json` into a folder that had none, dated today, which is how a folder
 * nobody called a gig became one with an invented date. Nothing here invents anything.
 *
 * **A folder that will not read is not the same as a gig that will not parse.** The gigs root
 * refusing is the whole list failing and is reported by the caller, once, as a folder problem.
 */

import { parseGigFile } from './gigFile'
import { gigFolderIn } from './fileLayout'
import { listGigsFolder, readGigFolder } from './platform'

export type GigFolderListing = {
  /** The gigs, as absolute folder paths, in the order the folder listed them. */
  gigs: string[]
  /**
   * Folders holding a `gig.json` that would not read, by folder name with the reason. Announced
   * once, never a row.
   */
  unreadable: { folder: string; reason: string }[]
  /** Why the gigs folder itself could not be read, or null. */
  problem: string | null
}

/**
 * Reads `<gigs>/setup/` and says what is a gig.
 *
 * Both reads are injected so the tests do not need a filesystem — the same seam every other reader
 * in this app uses.
 */
export async function readGigFolders(
  gigsRoot: string,
  options: {
    list?: (gigsRoot: string) => Promise<{ folders: string[]; problem: string | null }>
    read?: (
      folderPath: string
    ) => Promise<{ gigText: string | null; gigError: string | null; gigPresent: boolean }>
  } = {}
): Promise<GigFolderListing> {
  const list = options.list ?? listGigsFolder
  const read = options.read ?? readGigFolder

  const listing = await list(gigsRoot)
  if (listing.problem !== null) return { gigs: [], unreadable: [], problem: listing.problem }

  const gigs: string[] = []
  const unreadable: { folder: string; reason: string }[] = []

  for (const name of listing.folders) {
    const path = gigFolderIn(gigsRoot, name)
    let result
    try {
      result = await read(path)
    } catch (e) {
      // The listing said this folder was there and reading it failed anyway — a drive going away
      // mid-read. It was never claimed to be a gig, so it is silent, like a folder with no file.
      void e
      continue
    }
    // **Not a gig, and not news.** No `gig.json` means nobody ever said this was a gig.
    if (!result.gigPresent) continue
    if (result.gigError !== null) {
      unreadable.push({ folder: name, reason: result.gigError })
      continue
    }
    if (result.gigText === null) continue
    try {
      parseGigFile(result.gigText)
      gigs.push(path)
    } catch (e) {
      unreadable.push({ folder: name, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  return { gigs, unreadable, problem: null }
}
