/**
 * **THE SETLIST SCREEN — the full-screen list `Setlist` opens from Standby's `SONG` column.**
 *
 * Lifted out of `App.tsx` on 2026-09-06 with the rest of the player's screens; see `ControlView`
 * for why. The gig picker (`GigsView`) is the same pattern for the `GIG` column and was already
 * its own file.
 */

import { setLoadedSong, getCurrentSongId } from './songState'
import { goToShellRoom } from './bridge'

// **One owner for what a gig is called**, shared with Backstage's rows and the gig flow's header.

import { useState } from 'react'

import {
  getActiveSetlistId,
  getLibrarySongById,
  getOrderedSongsForActiveSetlist,
  getSetlists,
  hasValidActiveSetlist,
  type LibrarySong,
} from './setlistStore'
import { getPlayedSongs, hasPlayedSong } from './playedSongsState'
import { useGigReadiness } from './useGigReadiness'

import { whySongCannotArm } from './gigReadiness'

import './control.css'

function applySelectedSongToSetup(song: LibrarySong) {
  setLoadedSong(song)
}

export function SongsView() {
  const playedSongs = getPlayedSongs()
  // **The hard gate, on the screen where a song is chosen.** A song whose visuals are not set up
  // is not selectable for performance, so the failure lands here instead of on the wall.
  const gigReadiness = useGigReadiness()

  const activeOk = hasValidActiveSetlist()
  const orderedSongs = getOrderedSongsForActiveSetlist()
  // **The fact the screen is missing is the gig, not the setlist.** `gate === 'off'` is readiness's
  // own word for *no gig folder is open*, and the folder is what a setlist hangs off.
  const noGig = gigReadiness.gate === 'off' || gigReadiness.folderPath === null
  const activeSetlistId = getActiveSetlistId()
  const activeSetlistName =
    activeOk && activeSetlistId !== ''
      ? (getSetlists().find((s) => s.id === activeSetlistId)?.name ?? '')
      : ''

  // When entering Setlist after finishing a song, do not pre-select the played song.
  const [selectedSong, setSelectedSong] = useState<LibrarySong | null>(() => {
    const id = getCurrentSongId()
    if (!id) return null
    if (hasPlayedSong(id)) return null
    const lib = getLibrarySongById(id)
    if (!lib) return null
    if (!hasValidActiveSetlist()) return null
    const ordered = getOrderedSongsForActiveSetlist()
    if (!ordered.some((s) => s.id === id)) return null
    return lib
  })

  const goBack = () => {
    window.location.hash = '#/'
  }

  const selectSong = (song: LibrarySong) => {
    setSelectedSong(song)
  }

  const confirmSelection = () => {
    if (!selectedSong) return
    // The gate again, on the way out. A song can stop being carried while this screen is open —
    // the room is re-mapped in Muralista, a song file changes — and a stale selection must not
    // walk past it.
    if (whySongCannotArm(gigReadiness, selectedSong.id).length > 0) return
    const lib = getLibrarySongById(selectedSong.id)
    if (!lib) {
      alert(`Could not load ${selectedSong.title}.`)
      return
    }
    applySelectedSongToSetup(lib)
    window.location.hash = '#/'
  }

  return (
    <div className="songs-screen">
      <header className="songs-top-bar">
        <button type="button" className="songs-back" onClick={goBack}>
          Back
        </button>
        <h1 className="songs-title">
          {activeSetlistName ? (
            <>
              Setlist:{' '}
              <span className="songs-active-setlist-name" data-testid="active-setlist-name">
                {activeSetlistName}
              </span>
            </>
          ) : (
            'Setlist'
          )}
        </h1>
      </header>
      <main className="songs-body">
        {!activeOk ? (
          noGig ? (
            /* **NO GIG MEANS NO SETLIST, AND THAT IS WHAT THIS SAYS** (Jorge, 2026-09-04, walking
               `v0.52.0`). It read *Choose a setlist to continue*, which asks for a thing that
               cannot exist yet: a setlist belongs to a gig, and no gig is open. The screen names
               the missing thing and points at the one place it is chosen.

               **That place moved on 2026-09-05** and this sentence moved with it. It named the
               play triangle on a gig's row on Backstage; the triangle is gone, and tonight's gig
               is chosen with `Choose` on Standby. **Backstage is still where a gig is made**, so
               the way there stays — for the machine that has no gigs at all, which is the one case
               `Choose` is not on the screen for.

               **The old sentence survives beside it**, for the one state it was ever true about:
               a gig is open and its running order is not readable as a setlist. */
            <div className="setlist-prompt" data-testid="setlist-no-gig">
              <p>No gig is open, so there is no setlist yet.</p>
              <p className="setlist-prompt-where">
                Choose tonight&rsquo;s gig on Standby, with <strong>Choose</strong> in the GIG
                column — or make one on Backstage.
              </p>
              <button
                type="button"
                className="ctrl-btn"
                data-testid="setlist-go-backstage"
                onClick={() => {
                  goToShellRoom('#/setup')
                }}
              >
                Backstage
              </button>
            </div>
          ) : (
            <p className="setlist-prompt" data-testid="setlist-selection-prompt">
              Choose a setlist to continue.
            </p>
          )
        ) : !noGig && orderedSongs.length === 0 ? (
          /* **A gig whose running order is empty**, which is what every new gig is: the setlist is
             the gig's own and starts empty. Same rule — name the missing thing and point at where
             it is filled, which is the gig flow's Setlist step. */
          <div className="setlist-prompt" data-testid="setlist-empty">
            <p>This gig&rsquo;s setlist is empty.</p>
            <p className="setlist-prompt-where">
              Songs are put in it on the gig&rsquo;s <strong>Setlist</strong> step.
            </p>
            <button
              type="button"
              className="ctrl-btn"
              data-testid="setlist-go-gig"
              onClick={() => {
                goToShellRoom('#/gig')
              }}
            >
              Set up the gig
            </button>
          </div>
        ) : (
          <>
            {orderedSongs.map((song) => {
              const blockedReasons = whySongCannotArm(gigReadiness, song.id)
              const blocked = blockedReasons.length > 0
              return (
                <button
                  key={song.id}
                  type="button"
                  className={`songs-song-btn ${selectedSong?.id === song.id ? 'ctrl-arm' : ''} ${playedSongs.some((e) => e.songId === song.id) ? 'songs-song-btn-played' : ''} ${blocked ? 'songs-song-btn-blocked' : ''}`}
                  aria-pressed={selectedSong?.id === song.id}
                  disabled={blocked}
                  title={blocked ? blockedReasons.join(' ') : undefined}
                  data-testid={blocked ? `songs-song-blocked-${song.id}` : undefined}
                  onClick={() => selectSong(song)}
                >
                  {playedSongs.some((e) => e.songId === song.id) ? (
                    <>
                      <span className="song-played-icon" aria-hidden />
                      <span className="songs-song-title">{song.title}</span>
                    </>
                  ) : (
                    <span className="songs-song-title">{song.title}</span>
                  )}
                  {blocked && (
                    <span className="songs-song-blocked-reason">{blockedReasons[0]}</span>
                  )}
                </button>
              )
            })}
            <div className="songs-confirm-wrap">
              <button
                type="button"
                className="ctrl-btn languages-confirm"
                disabled={
                  !selectedSong || whySongCannotArm(gigReadiness, selectedSong.id).length > 0
                }
                aria-label="Confirm"
                onClick={confirmSelection}
              >
                Confirm
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
