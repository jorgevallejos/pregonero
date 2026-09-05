/**
 * **Everything first run asks for, pre-set**: the three folders and the artist's name.
 *
 * `App` shows the app's deal and then the first-run screen instead of the main screen while any of
 * them is unset, so a test about anything else has to start past both — the same way a real second
 * launch does. Call this wherever the test clears storage.
 *
 * **It became three on 2026-09-04**, when the visuals folder joined the other two. Everything that
 * renders `App` needed it on the same day: a helper is what made that one edit rather than eight.
 *
 * **And it gained the artist's name on 2026-09-05**, which is the same story a second time and is
 * why the helper's name stayed general: first run is a sequence of screens, not a list of folders,
 * and what a test needs is *past all of it*.
 *
 * `FirstRunView.test.tsx` and `AppDealView.test.tsx` deliberately do not use it: they are the two
 * files that want the gate.
 */
import {
  ARTIST_NAME_KEY,
  GIGS_FOLDER_KEY,
  SONGS_FOLDER_KEY,
  VISUALS_FOLDER_KEY,
} from '../contentFolders'

export function installRequiredFolders(
  songs = '/vault/songs',
  gigs = '/vault/gigs',
  visuals = '/vault/visuals'
): void {
  try {
    localStorage.setItem(SONGS_FOLDER_KEY, songs)
    localStorage.setItem(GIGS_FOLDER_KEY, gigs)
    localStorage.setItem(VISUALS_FOLDER_KEY, visuals)
    localStorage.setItem(ARTIST_NAME_KEY, 'Chango Pepper')
  } catch {
    /* unavailable in some environments */
  }
}
