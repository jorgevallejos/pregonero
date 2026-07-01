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
