/**
 * Cross-window "audience blackout" channel for Auto lyric-advance (T2).
 *
 * In Auto mode the performance behaves like Video mode but with the beat clock as the clock
 * instead of `video.currentTime`. There is no `<video>` element, so the audience (Projection
 * window) is simply black during the count-in and between/around cues, and shows the driven
 * lyric only when a cue is due.
 *
 * The Projection window can't see the Control window's beat-clock play state directly, so the
 * Control window broadcasts a blackout flag over `localStorage` (same origin, cross-window
 * storage events) — the same pattern the Video transport uses (see `VideoProjectionRegion`).
 * When the flag is active the Projection suppresses the intro/title screen while the index is
 * still -1, rendering black instead. It has no effect once a lyric index (>= 0) is showing.
 */

export const AUTO_BLACKOUT_KEY = 'autoPerformanceBlackout'

export interface AutoBlackoutState {
  active: boolean
  nonce: number
}

/** Broadcasts the audience blackout state to the projection window. */
export function setAutoBlackout(active: boolean): void {
  const payload: AutoBlackoutState = { active, nonce: Date.now() }
  localStorage.setItem(AUTO_BLACKOUT_KEY, JSON.stringify(payload))
}

/** Reads the current audience blackout state (false when unset or malformed). */
export function getAutoBlackout(): boolean {
  try {
    const raw = localStorage.getItem(AUTO_BLACKOUT_KEY)
    if (!raw) return false
    return (JSON.parse(raw) as AutoBlackoutState).active === true
  } catch {
    return false
  }
}
