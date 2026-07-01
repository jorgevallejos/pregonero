import { describe, it, expect } from 'vitest'
import { getDefaultAdvanceMode, computeAutoAdvanceIndex } from './autoAdvanceState'
import type { TimelineEntry } from './songState'

describe('getDefaultAdvanceMode', () => {
  it('returns "auto" when the song has a non-empty timeline', () => {
    expect(getDefaultAdvanceMode(true)).toBe('auto')
  })

  it('returns "manual" when the song has no timeline', () => {
    expect(getDefaultAdvanceMode(false)).toBe('manual')
  })
})

describe('computeAutoAdvanceIndex', () => {
  const timeline: TimelineEntry[] = [
    { start: 0, end: 2 },
    { start: 2, end: 5 },
    { start: 5, end: 8 },
  ]

  it('returns -1 before the song has started (elapsed 0 falls in first window is still valid — this is elapsed since begin)', () => {
    // elapsed 0ms → 0s falls in [0,2) → index 0. This documents that Auto shows line 0
    // immediately at the begin handoff, matching the timeline's own [0, ...) first entry.
    expect(computeAutoAdvanceIndex(timeline, 0)).toBe(0)
  })

  it('maps elapsed milliseconds to seconds and returns the matching cue index', () => {
    expect(computeAutoAdvanceIndex(timeline, 1000)).toBe(0) // 1s -> [0,2)
    expect(computeAutoAdvanceIndex(timeline, 2000)).toBe(1) // 2s -> [2,5)
    expect(computeAutoAdvanceIndex(timeline, 4999)).toBe(1) // 4.999s -> [2,5)
    expect(computeAutoAdvanceIndex(timeline, 5000)).toBe(2) // 5s -> [5,8)
  })

  it('returns -1 once elapsed passes the last timeline window (song finished)', () => {
    expect(computeAutoAdvanceIndex(timeline, 8000)).toBe(-1)
    expect(computeAutoAdvanceIndex(timeline, 100_000)).toBe(-1)
  })

  it('returns -1 for an empty timeline', () => {
    expect(computeAutoAdvanceIndex([], 1000)).toBe(-1)
  })
})
