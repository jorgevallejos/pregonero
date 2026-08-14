import type { TimelineEntry } from './songState'
import { videoCueLookup } from './videoCueLookup'

export type AdvanceMode = 'manual' | 'auto'

/**
 * Default lyric-advance mode for a song: 'auto' when it has a non-empty timeline
 * (so the beat-clock-driven Auto advance has something to drive off), 'manual' otherwise.
 */
export function getDefaultAdvanceMode(hasTimeline: boolean): AdvanceMode {
  return hasTimeline ? 'auto' : 'manual'
}

/**
 * P6 — resolves the advance mode actually in force, given the performer's explicit selection,
 * the per-song default, and whether a manual override has been taken during this song.
 *
 * Pressing Next or Previous during Auto playback drops the song into Manual for the REMAINDER
 * of the song: one press to take the wheel. Before this, the auto-advance effect recomputed the
 * index from elapsed time on every tick and snapped back to it, so a manual Next reverted within
 * ~50ms — the buttons looked like a safety net and were not one, and they failed exactly when
 * drift shows up mid-song and the instinct is to tap Next.
 *
 * The override is deliberately absolute: it beats an explicit 'auto' selection, not just the
 * default. Resetting it is the caller's job (next song / next arm / restart) — it is never
 * sticky across songs.
 */
export function resolveAdvanceMode(params: {
  selected: AdvanceMode | null
  hasTimeline: boolean
  manualOverrideTaken: boolean
}): AdvanceMode {
  if (params.manualOverrideTaken) return 'manual'
  return params.selected ?? getDefaultAdvanceMode(params.hasTimeline)
}

/**
 * Maps elapsed time since the song began (see `useBeatClock`'s `songElapsedMs` — elapsed
 * since the count-in's `begin` handoff, not since the count-in started) to a lyric-line
 * index via the song's timeline, reusing the same half-open [start, end) cue lookup Video
 * mode uses against `video.currentTime`.
 *
 * Returns -1 before the first cue or after the last one (e.g. timeline finished, or empty).
 */
export function computeAutoAdvanceIndex(timeline: TimelineEntry[], elapsedMs: number): number {
  return videoCueLookup(timeline, elapsedMs / 1000)
}

/**
 * P1 — start-on-cue: whether a song should use the performer's first pedal press as the
 * timeline's start cue, instead of a Play button + count-in.
 *
 * True only when the song is armed, in Auto advance mode, has a v2 timeline
 * (`timelineVersion === 2` — never coerced, per docs/timeline-v2-contract.md), and has no
 * video media (Video mode's start cue is the video itself + `leadIn`, untouched by P1 — see
 * "Playback semantics" in the contract). A legacy timeline (`timelineVersion` absent) always
 * returns false here, keeping today's Play-then-count-in Auto behavior exactly as it is.
 */
export function isCueStartMode(params: {
  armed: boolean
  advanceMode: AdvanceMode
  timelineVersion: number | undefined
  hasVideo: boolean
}): boolean {
  return (
    params.armed &&
    params.advanceMode === 'auto' &&
    params.timelineVersion === 2 &&
    !params.hasVideo
  )
}
