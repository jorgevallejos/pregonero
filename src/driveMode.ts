/**
 * **DRIVE MODE: `clock`, `video`, `manual`, AS ONE CONTROL.**
 *
 * **It is a new concept, not a rename** (reconnaissance, 2026-09-03). There was no single mode in
 * the code at all — two independent axes were doing the work: `isVideoMode`, read from the room's
 * assignment, and the Transitions toggle, `manual | auto`. **The three names are one control
 * assembled from two that already existed**, and what a song can offer falls out honestly: **video
 * iff the room gives it a video, clock iff it has a timeline, manual always.**
 *
 * ## The names are settled, and settling them before they reached a screen was the point
 *
 * **`clock`, `video`, `manual`** (Jorge, 2026-09-03). Moment 7 called them clock-driven,
 * animation-driven and pedal-driven; **`animation` became `video` and `pedal` became `manual`, and
 * `clock` was kept.** Jorge's working gloss for clock is *beat*, and **`beat-driven` was rejected**
 * because it reads as *press on the beat*, which is what manual actually is. **Slippage of exactly
 * this kind produced five contract mismatches in two days.**
 *
 * ## Always three, and an unavailable one refuses rather than being dead
 *
 * **Always three** (Jorge, 2026-09-04), so the control keeps the same shape song to song and can be
 * hit without looking. **Only-the-possible was rejected**: a control that changes shape per song is
 * harder to use at distance than one with a dead button in it. *(This supersedes the 03/09 wording
 * that only the possible modes are offered.)*
 *
 * **And `GatedAction`'s objection is answered by the rule Jorge made for Arm.** A disabled control
 * with nothing explaining it is forbidden, and an explanation is precisely what cannot be read
 * across a dark room. **So the button stays pressable and refuses, naming why in a popup** — *this
 * song has no video*, *this song has no timeline* — exactly as Arm does when the gig is not ready.
 * **That gives the control view one behaviour rather than two: a control that cannot act says why
 * when pressed.**
 *
 * ## The default is the most capable available
 *
 * **Video, then clock, then manual**, so the common case is that Jorge touches nothing.
 *
 * **This overturns a comment, and the comment's reason does not survive.** `getDefaultDisplayMode`
 * returned `'none'` unconditionally and recorded that *media presence no longer implies an automatic
 * video display default; the performer opts in explicitly via the Videoclip toggle*. That reason is
 * entirely about the **Videoclip** control — a size control the design has since condemned, because
 * **size was never a third thing.** The opt-in it protected survives: choosing `video` is still an
 * explicit choice, and it is now a performance one rather than a format one. **Nothing plays until
 * the cue either way**, so defaulting to video puts no motion on the wall unasked — it lights the
 * shape the gig already assigned a video to.
 */

/** The three, and there are only ever three. */
export type DriveMode = 'clock' | 'video' | 'manual'

/** What this song can be driven by, read from the room and the song file. */
export type SongDriveCapabilities = {
  /** The room assigns a video to this song for this gig. Never a fact about the song file. */
  hasVideo: boolean
  /** The song file carries a non-empty timeline. */
  hasTimeline: boolean
}

/** The order they are offered in, which is also the order of the default. */
export const DRIVE_MODES: readonly DriveMode[] = ['video', 'clock', 'manual']

/** Whether this song can be driven this way. **Manual always**, which is the point of manual. */
export function driveModeAvailable(mode: DriveMode, caps: SongDriveCapabilities): boolean {
  if (mode === 'video') return caps.hasVideo
  if (mode === 'clock') return caps.hasTimeline
  return true
}

/**
 * **Why a mode cannot act, in the words the popup says.** Null when it can.
 *
 * The sentences are about the song rather than about the app: *this song has no video* is a fact he
 * can act on — assign one in the room, or time it in Bombista — where *unavailable* is not.
 */
export function driveModeRefusal(mode: DriveMode, caps: SongDriveCapabilities): string | null {
  if (driveModeAvailable(mode, caps)) return null
  if (mode === 'video') return 'This song has no video. The room assigns one, on the gig’s visuals step.'
  return 'This song has no timeline. Bombista makes one, in the song flow.'
}

/** **The most capable available**: video, then clock, then manual. */
export function defaultDriveMode(caps: SongDriveCapabilities): DriveMode {
  return DRIVE_MODES.find((mode) => driveModeAvailable(mode, caps)) ?? 'manual'
}

/**
 * **The mode actually in force.**
 *
 * **P6 survives unchanged and is absolute**: a `Next` or `Previous` pressed while something is
 * driving the song takes the wheel for the remainder of that song, and that beats an explicit
 * choice rather than only the default. Resetting it is the caller's job — next song, next arm,
 * restart — and it is never sticky across songs.
 *
 * **A selection the song cannot honour falls back to the default** rather than to manual: pressing
 * an unavailable button refuses and stores nothing, so this only arises when the room changes under
 * a choice already made, and the honest answer there is the same one a fresh song gets.
 */
export function resolveDriveMode(params: {
  selected: DriveMode | null
  caps: SongDriveCapabilities
  manualOverrideTaken: boolean
}): DriveMode {
  if (params.manualOverrideTaken) return 'manual'
  if (params.selected !== null && driveModeAvailable(params.selected, params.caps)) {
    return params.selected
  }
  return defaultDriveMode(params.caps)
}
