/**
 * **WHETHER THE VIDEO RUNS TONIGHT, AS THE ONE THING THE WALL NEEDS TO BE TOLD.**
 *
 * **`DisplayMode` disappeared rather than collapsing to on-and-off** (Jorge, 2026-09-03, built
 * 2026-09-06). Three things were tangled in one control: **format and placement**, which are setup
 * and Muralista's, decided at the wall; **whether the video runs tonight**, which is the drive mode
 * and the performance concern; and **size, which was never a third thing** — it was format wearing
 * a performance control's clothes.
 *
 * **In the projection only `None` versus not-`None` ever did anything**: `videoWanted` was
 * `isVideoMode && mode !== 'none'`, and Small and Big differed only in the control view's own status
 * text and in a display-profile chain that had no readers. **So what crossed was always one
 * boolean wearing three names**, and this is the boolean.
 *
 * ## Why it has to cross at all
 *
 * The performer can choose `manual` on a song the room gives a video. **The wall cannot work that
 * out**: it knows the room's assignment and nothing about what was chosen. Without being told, it
 * would mount the clip and sit on its first frame all song — a frozen picture where the room should
 * see lyrics only.
 *
 * **It replaces the display-mode broadcast rather than joining it.** The same window writes it, the
 * same window reads it, on the same storage event — one channel, and one fewer concept on it.
 *
 * **The wall is told the answer, never the inputs**, which is the rule `gigContactState` already
 * lives under: one implementation of the decision, and no second opinion about it.
 */

import { useEffect, useState } from 'react'

/**
 * A new key, because it is a new fact. **Nothing was ever stored under it**, so there is nothing to
 * migrate and no address being repointed — the display mode's own key is deleted rather than reused.
 */
export const KEY_VIDEO_RUNS_BROADCAST = 'pregoneroVideoRuns'

export function setVideoRunsBroadcast(runs: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(KEY_VIDEO_RUNS_BROADCAST, runs ? '1' : '0')
  } catch {
    /* unavailable in some environments */
  }
}

/**
 * **Absent reads as `false`**, which is the power-up answer: nothing is armed, no drive mode has
 * been chosen, and a wall that guessed *yes* would start a clip nobody asked for.
 */
export function getVideoRunsBroadcast(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    return localStorage.getItem(KEY_VIDEO_RUNS_BROADCAST) === '1'
  } catch {
    return false
  }
}

export function useVideoRuns(): boolean {
  const [runs, setRuns] = useState(getVideoRunsBroadcast)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY_VIDEO_RUNS_BROADCAST || e.key === null) {
        setRuns(getVideoRunsBroadcast())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  return runs
}
