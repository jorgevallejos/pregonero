import type { TimelineEntry } from './songState'

/**
 * Returns the index in `timeline` whose `[start, end)` half-open window contains `songTime`,
 * or -1 when `songTime` falls outside every window (before, in a gap, or past the last entry).
 *
 * `songTime` = video.currentTime + media.offset — computed by the caller.
 * Zero-length entries (start === end) never match.
 */
export function videoCueLookup(timeline: TimelineEntry[], songTime: number): number {
  for (let i = 0; i < timeline.length; i++) {
    const { start, end } = timeline[i]
    if (songTime >= start && songTime < end) return i
  }
  return -1
}
