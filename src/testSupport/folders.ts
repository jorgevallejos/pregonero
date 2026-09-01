/**
 * The two folders first run asks for, pre-set.
 *
 * `App` shows the first-run screen instead of the main screen while either is unset, so a test
 * about anything else has to start past it — the same way a real second launch does. Call this
 * wherever the test clears storage.
 *
 * `FirstRunView.test.tsx` deliberately does not use this: it is the one file that wants the gate.
 */
import { GIGS_FOLDER_KEY, SONGS_FOLDER_KEY } from '../contentFolders'

export function installRequiredFolders(
  songs = '/vault/songs',
  gigs = '/vault/gigs'
): void {
  try {
    localStorage.setItem(SONGS_FOLDER_KEY, songs)
    localStorage.setItem(GIGS_FOLDER_KEY, gigs)
  } catch {
    /* unavailable in some environments */
  }
}
