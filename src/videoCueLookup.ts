import type { TimelineEntry, TimelineLeadIn } from './songState'

/**
 * Returns the index in `timeline` whose `[start, end)` half-open window contains `songTime`,
 * or -1 when `songTime` falls outside every window (before, in a gap, or past the last entry).
 *
 * `songTime` = video.currentTime + media.offset — computed by the caller. For Video-mode
 * callers with a v2 timeline, prefer `resolveVideoCueIndex` (or `resolveVideoSongTime` if you
 * need the intermediate value), which also composes `leadIn` — see `docs/timeline-v2-contract.md`.
 * Zero-length entries (start === end) never match.
 */
export function videoCueLookup(timeline: TimelineEntry[], songTime: number): number {
  for (let i = 0; i < timeline.length; i++) {
    const { start, end } = timeline[i]
    if (songTime >= start && songTime < end) return i
  }
  return -1
}

/**
 * Composes the "song time" used for cue lookup from the video element's own `currentTime`, the
 * media's manual alignment `offset`, and — for a v2 timeline with `leadIn.apply === true` — the
 * fixed lead-in baked into the timeline's own normalisation (see
 * `docs/timeline-v2-contract.md`, "Playback semantics" and "Rounding").
 *
 * ## Why this composition
 * A v2 timeline is normalised so entry 0 always starts at `0.00`: Bombista writes
 * `round(rawStart - leadIn.durationSec, 2)` on export. In Video mode the video's own clock *is*
 * the cue, and the cue point is `video start + leadIn.durationSec` — so to compare
 * `video.currentTime` against the *normalised* timeline, the lead-in has to be subtracted back
 * out of the video's time before it's looked up:
 *
 *     songTime = video.currentTime + offset - (leadIn.apply ? leadIn.durationSec : 0)
 *
 * `offset` (`MediaFile.offset`) is a pre-existing, independent correction — a manual per-song
 * whole-track alignment nudge, unrelated to how v2 timelines are normalised. It simply adds
 * alongside the lead-in term rather than interacting with it, so the two corrections can never
 * double-apply the same shift.
 *
 * `media.trimStart` is deliberately NOT part of this formula: it only controls where the
 * `<video>` element's playback begins on the file's own absolute clock, and `video.currentTime`
 * already reflects that once the element has been seeked there — folding it in here would shift
 * the same thing twice.
 *
 * ## Whether the lead-in applies is the CALLER's answer now, not the file's
 *
 * **`leadIn` splits the way the media did** (Jorge, 2026-09-04). Its measured VALUE stays with the
 * timeline — a real measurement of the words — and **the decision to apply it belongs to whoever
 * knows a video is playing.** Bombista derived it from `media.type == "video"`; once no song
 * declares media that default silently flips, and **every video song would have lost its lead-in
 * correction with nothing reporting it.**
 *
 * So the mode arrives as an argument. It is `true` exactly in Video mode, which after this round
 * means *a video is assigned to this song for this gig in `visuals.json`* — the contract's own
 * table, read from the only party that can answer it.
 *
 * When `leadIn` is `undefined` (no v2 timeline) or `applyLeadIn` is `false` (Auto mode; a live
 * intro can run any length), the lead-in term is `0` and this is bit-for-bit identical to the
 * pre-P2 formula (`video.currentTime + offset`).
 */
export function resolveVideoSongTime(
  videoCurrentTime: number,
  offset: number,
  leadIn?: TimelineLeadIn,
  applyLeadIn = false,
): number {
  const leadInSec = applyLeadIn && leadIn ? leadIn.durationSec : 0
  return videoCurrentTime + offset - leadInSec
}

/**
 * Convenience wrapper for Video-mode components: resolves the active cue index directly from
 * the video element's `currentTime`, composing `offset` and `leadIn` via `resolveVideoSongTime`
 * before delegating to `videoCueLookup`. Prefer this over calling `videoCueLookup` with
 * hand-rolled arithmetic — it keeps the leadIn/offset composition in one tested place.
 */
export function resolveVideoCueIndex(
  timeline: TimelineEntry[],
  videoCurrentTime: number,
  offset: number,
  leadIn?: TimelineLeadIn,
  applyLeadIn = false,
): number {
  return videoCueLookup(timeline, resolveVideoSongTime(videoCurrentTime, offset, leadIn, applyLeadIn))
}
