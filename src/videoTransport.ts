/**
 * The Video-mode transport channel between the Control window and the Projection window.
 *
 * **Two video elements, transport-synced — not a shared clock.** Each window renders its own
 * `<video>`, so they cannot share a media clock; the Control window broadcasts transport *intent*
 * over `localStorage` and the Projection window applies it to its element. Drift is corrected by
 * a manual seek rather than a periodic resync, which is a known trade-off.
 *
 * Both payloads carry a **changing nonce**, and that is load-bearing: browsers fire a cross-window
 * `storage` event only when a key's value actually changes, so a repeated same-value write would
 * be silently dropped — and every consumer here is reacting to a transition, not reading a current
 * value. See the storage-event gotcha in `CLAUDE.md`.
 *
 * This lived in `VideoProjectionRegion.tsx` until the projection became a compositor and that
 * full-frame renderer was replaced. The channel outlived the renderer, so it is its own module.
 */

export const VIDEO_SEEK_TARGET_KEY = 'videoSeekTarget'
export const VIDEO_TRANSPORT_KEY = 'videoTransport'

export interface VideoSeekTarget {
  time: number
  nonce: number
}

export interface VideoTransportCommand {
  action: 'play' | 'pause' | 'stop'
  time?: number
  nonce: number
}

/** Writes a seek target to localStorage so the projection window can pick it up. */
export function setVideoSeekTarget(time: number): void {
  const payload: VideoSeekTarget = { time, nonce: Date.now() }
  localStorage.setItem(VIDEO_SEEK_TARGET_KEY, JSON.stringify(payload))
}

/** Broadcasts a transport command to the projection window via localStorage. */
export function setVideoTransportCommand(action: 'play' | 'pause' | 'stop'): void {
  const payload: VideoTransportCommand = { action, nonce: Date.now() }
  localStorage.setItem(VIDEO_TRANSPORT_KEY, JSON.stringify(payload))
}
