/**
 * **PREGONERO — THE PLAYER, AND ITS OWN ROUTER.**
 *
 * **The boundary is: the shell makes things, the player uses them** (Jorge, 2026-09-05). Backstage,
 * the song flow and the gig flow make; **Standby and the performing view use a finished gig.**
 * Arming is not the boundary — it is a state inside the player, because a player that cannot choose
 * the song, set the languages, open the projection and arm is not a player.
 *
 * **This file exists because `App.tsx` was the one place that could not be on one side of that
 * line.** It defined Standby, the performing view and the projection window while importing every
 * one of the shell's rooms to route to them. The last run measured that and pinned it as the
 * extraction's whole known cost; this pays it.
 *
 * ## What the player routes to, and it is the whole of the product
 *
 * `#/` Standby and the performing view · `#/songs` the setlist · `#/gigs` the gig picker ·
 * `#/languages` the languages · `#/projection` the audience's window. **Nothing else**, and
 * nothing here reaches into Backstage, Preferences or the catalogue's management.
 *
 * ## `Setup` is the shell's door drawn onto the player's screen
 *
 * Standby's `GIG` column carries it, and it is a hash the shell's router owns — **a link, not an
 * import.** That is deliberate: when the player becomes a framed page the link is what has to
 * change, and it is one string in one place rather than a call into the host.
 *
 * ## Still one renderer
 *
 * The player is a component the shell mounts, not a page it frames. **The frame comes next**; what
 * this stage buys is that the two products are separable before anything is separated.
 */
import { useConcertSessionTimer } from './concertSessionState'
import { ControlView } from './ControlView'
import { SongsView } from './SongsView'
import { LanguagesView } from './LanguagesView'
import { GigsView } from './GigsView'
import { ProjectionView } from './ProjectionView'

/**
 * Keeps the concert/session timer hook alive across route transitions.
 *
 * **It does not accumulate anything** — the elapsed time is derived from a start timestamp and an
 * accumulated total in `sessionStorage`, so it is correct on read whether or not this is mounted.
 * What this buys is a re-render while the number is on screen. **That is why it is the player's and
 * not the shell's:** the shell's rooms do not show it, so mounting it there drove a render of
 * nothing.
 */
export function ConcertSessionTimerRunner() {
  useConcertSessionTimer()
  return null
}

/** Whether this hash is the player's. The shell's router asks before taking a route itself. */
export function isPlayerRoute(hash: string): boolean {
  return (
    hash === '#/' ||
    hash === '' ||
    hash === '#/songs' ||
    hash === '#/gigs' ||
    hash === '#/languages' ||
    hash === '#/projection'
  )
}

export function PlayerApp({ hash }: { hash: string }) {
  return (
    <>
      <ConcertSessionTimerRunner />
      {hash === '#/projection' ? (
        <ProjectionView />
      ) : hash === '#/songs' ? (
        <SongsView />
      ) : hash === '#/gigs' ? (
        <GigsView />
      ) : hash === '#/languages' ? (
        <LanguagesView />
      ) : (
        <ControlView />
      )}
    </>
  )
}
