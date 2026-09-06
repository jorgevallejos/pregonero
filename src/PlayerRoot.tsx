/**
 * **PREGONERO'S OWN DOCUMENT.**
 *
 * The player is served as its own page and framed inside Tramoya, the same shape as Bombista and
 * Muralista. **This is what `player.html` mounts**, and it is what the shell draws a frame around.
 *
 * ## What being its own document means, and none of it is optional
 *
 * - **It hydrates its own library.** A document cannot hydrate from another document's memory —
 *   the Projection window has proved that twice — so the gate moved here with it. See
 *   `useSongLibraryGate`.
 * - **It owns its own hash.** The player's rooms — Standby, the setlist, the gig picker, the
 *   languages screen, the wall — are routes inside this page and never touch the shell's address.
 * - **It reaches the machine through its embedder.** No preload of its own, no flag, no bridge:
 *   `bridge()` reads `window.parent.electronAPI`, which works because the two are same-origin and
 *   cannot leak because a cross-origin frame is refused access to its parent. See `bridge.ts`.
 *
 * ## What stays with the shell
 *
 * **First run** — the deal, the artist's name, the folders — because a machine that has answered
 * nothing has no gig to perform and the shell is what asks. And **the rooms where things are
 * made**: Backstage, the song flow, the gig flow, Preferences. The player asks for those through
 * `goToShellRoom`, which sets the embedder's hash rather than its own.
 */
import { useEffect, useState } from 'react'
import { ConcertSessionTimerRunner, PlayerApp } from './PlayerApp'
import { useSongLibraryGate } from './useSongLibraryGate'
import {
  autoSelectFirstSongForActiveSetlist,
  getOrderedSongsForActiveSetlist,
  loadSetlistStore,
} from './setlistStore'
import { getCurrentSongId, getSongLines } from './songState'
import { refreshGigReadiness } from './gigSession'
import './control.css'

export function PlayerRoot({ initialHash }: { initialHash?: string } = {}) {
  const [hash, setHash] = useState(() =>
    typeof initialHash === 'string' ? initialHash : window.location.hash
  )
  const isProjectionRoute = hash === '#/projection'
  const library = useSongLibraryGate(isProjectionRoute)

  useEffect(() => {
    if (typeof initialHash === 'string') return
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [initialHash])

  // When Standby arrives with an active setlist, auto-load its first song when none is valid.
  useEffect(() => {
    if (isProjectionRoute) return
    if (hash !== '#/' || library.state !== 'ready') return
    if (!sessionStorage.getItem('liveLyricLaunched')) {
      sessionStorage.setItem('liveLyricLaunched', '1')
    }
    const snapshot = loadSetlistStore()
    if (!snapshot || !snapshot.activeSetlistId) return
    const activeSongs = getOrderedSongsForActiveSetlist()
    const currentSongId = getCurrentSongId()
    const hasValidLoadedSong =
      currentSongId !== '' &&
      activeSongs.some((song) => song.id === currentSongId) &&
      getSongLines().length > 0
    if (!hasValidLoadedSong) {
      autoSelectFirstSongForActiveSetlist(snapshot)
    }
  }, [hash, isProjectionRoute, library.state])

  /**
   * **A gig re-checks its references whenever it is opened**, and arriving on Standby is that
   * moment: songs are edited in Bombista and the room is mapped in Muralista, independently of the
   * gigs holding them, and nothing chases those gigs. Just-in-time on open is the whole mechanism,
   * and it is trivially not mid-song — which is why there is no file watcher.
   */
  useEffect(() => {
    if (hash !== '#/' || library.state !== 'ready') return
    void refreshGigReadiness()
  }, [hash, library.state])

  if (!isProjectionRoute && library.state === 'loading') {
    return (
      <>
        <ConcertSessionTimerRunner />
        <div className="app-loading" data-testid="song-library-loading" aria-busy="true">
          Loading…
        </div>
      </>
    )
  }
  if (!isProjectionRoute && library.state === 'error') {
    return (
      <>
        <ConcertSessionTimerRunner />
        <div className="app-hydrate-error" role="alert" data-testid="song-library-error">
          <p>{library.error}</p>
          <button type="button" onClick={library.retry}>
            Retry
          </button>
        </div>
      </>
    )
  }

  return <PlayerApp hash={hash} />
}

export default PlayerRoot
