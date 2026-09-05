/**
 * **Whether there is at least one gig on this machine**, which is the whole of what Standby's
 * `GIG` column needs to know before it draws `Choose`.
 *
 * **From nothing there is no button and no empty picker** (Jorge, 2026-09-05). The column reads
 * `No gig`, the only control is `Setup`, and that says *go make one* without a screen to say it
 * in — the same shape as `No gigs yet.` with `New` above it.
 *
 * **It reads the folder, because the gigs list is the folder** (Jorge, 2026-09-03). Nothing is
 * stored, so nothing can disagree with the disk: cleared browser storage used to leave every gig
 * folder in place and an empty list, and the gigs looked deleted when they were not.
 *
 * **It answers `false` until the read comes back**, which is right rather than merely convenient:
 * a button that appears and then vanishes is worse in a dark room than one that arrives a frame
 * late, and the read happens on arriving at Standby rather than during a performance.
 *
 * **A gigs folder that will not read is `false` too.** This hook says *is there a gig to choose*,
 * and a folder nobody could read holds no gig anybody can choose. The folder problem itself is
 * reported on Backstage, which is the screen that owns it — **no message ever appears in a control
 * column** (Jorge, 2026-09-05).
 */
import { useEffect, useState } from 'react'
import { getGigsFolder } from './contentFolders'
import { readGigFolders } from './gigFolderList'

export function useGigsExist(): boolean {
  const [exist, setExist] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const gigsRoot = getGigsFolder()
      if (gigsRoot === null) return
      try {
        const listing = await readGigFolders(gigsRoot)
        if (!cancelled) setExist(listing.gigs.length > 0)
      } catch {
        // A read that threw is not a gig anybody can choose. Backstage owns the report.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return exist
}
