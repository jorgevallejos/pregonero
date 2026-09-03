/**
 * **What each gig on Backstage is called, read from its own `gig.json` every time the list draws.**
 *
 * **Live, never stored** (Jorge, 2026-09-03). The gig list holds paths and nothing else, on purpose:
 * a label written down would go stale the moment a venue is corrected, which is exactly the defect
 * this exists to fix. The rule for turning a file into a label is `gigFile.gigLabel`, in one place,
 * and this is only the reading.
 *
 * **It writes nothing and it decides nothing.** `gigFolderRead` makes the same promise for
 * readiness and for the same reason: a screen being drawn must not create a `gig.json` in every
 * folder it draws. This is the smaller of the two reads — the label needs the date and the venue,
 * so it never touches `visuals.json`, the library or the setlist.
 *
 * **A folder that cannot be read is not an error here.** A gig on a drive that is not plugged in
 * keeps its row, named by its folder, because a row that vanished would erase the evidence that
 * something moved.
 */

import { gigLabel, parseGigFile } from './gigFile'
import { readGigFolder } from './platform'

/**
 * A label per path, in a map keyed by path. Reading is injected so the tests do not need a
 * filesystem — the same seam every other reader in this app uses.
 */
export async function readGigLabels(
  paths: readonly string[],
  options: { read?: (folderPath: string) => Promise<{ gigText: string | null }> } = {}
): Promise<Map<string, string>> {
  const read = options.read ?? readGigFolder
  const labels = new Map<string, string>()
  for (const path of paths) {
    let text: string | null = null
    try {
      text = (await read(path)).gigText
    } catch {
      text = null
    }
    let parsed = null
    if (text !== null) {
      try {
        parsed = parseGigFile(text)
      } catch {
        parsed = null
      }
    }
    labels.set(path, gigLabel(parsed, path))
  }
  return labels
}
