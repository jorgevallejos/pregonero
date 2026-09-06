import { describe, it, expect } from 'vitest'
import {
  getDefaultAdvanceMode,
  computeAutoAdvanceIndex,
  isCueStartMode,
  isPastLastCue,
  resolveAdvanceMode,
} from './autoAdvanceState'
import type { TimelineEntry } from './songState'

describe('getDefaultAdvanceMode', () => {
  it('returns "auto" when the song has a non-empty timeline', () => {
    expect(getDefaultAdvanceMode(true)).toBe('auto')
  })

  it('returns "manual" when the song has no timeline', () => {
    expect(getDefaultAdvanceMode(false)).toBe('manual')
  })
})

describe('resolveAdvanceMode (P6: Next/Previous takes the wheel for the rest of the song)', () => {
  const noOverride = { manualOverrideTaken: false }

  it('defers to the per-song default when nothing is selected', () => {
    expect(resolveAdvanceMode({ selected: null, hasTimeline: true, ...noOverride })).toBe('auto')
    expect(resolveAdvanceMode({ selected: null, hasTimeline: false, ...noOverride })).toBe('manual')
  })

  it('honours an explicit selection over the default', () => {
    expect(resolveAdvanceMode({ selected: 'manual', hasTimeline: true, ...noOverride })).toBe('manual')
    expect(resolveAdvanceMode({ selected: 'auto', hasTimeline: false, ...noOverride })).toBe('auto')
  })

  it('forces manual once the override is taken, beating the auto default', () => {
    expect(resolveAdvanceMode({ selected: null, hasTimeline: true, manualOverrideTaken: true })).toBe('manual')
  })

  it('forces manual once the override is taken, beating an EXPLICIT auto selection', () => {
    // One press takes the wheel. It is not a suggestion the toggle can outrank mid-song.
    expect(resolveAdvanceMode({ selected: 'auto', hasTimeline: true, manualOverrideTaken: true })).toBe('manual')
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

describe('isCueStartMode (P1: start-on-cue for Auto, v2 timeline, no video)', () => {
  const base = { armed: true, advanceMode: 'auto' as const, timelineVersion: 2, hasVideo: false }

  it('is true when armed, Auto, timelineVersion 2, and no video', () => {
    expect(isCueStartMode(base)).toBe(true)
  })

  it('is false when not armed', () => {
    expect(isCueStartMode({ ...base, armed: false })).toBe(false)
  })

  it('is false in Manual advance mode', () => {
    expect(isCueStartMode({ ...base, advanceMode: 'manual' })).toBe(false)
  })

  it('is false when timelineVersion is absent (legacy timeline) — legacy Auto keeps today\'s behavior', () => {
    expect(isCueStartMode({ ...base, timelineVersion: undefined })).toBe(false)
  })

  it('is false for any timelineVersion other than 2 — never coerce', () => {
    expect(isCueStartMode({ ...base, timelineVersion: 1 })).toBe(false)
    expect(isCueStartMode({ ...base, timelineVersion: 3 })).toBe(false)
  })

  it('is false when the song has video media — Video mode is untouched (P2)', () => {
    expect(isCueStartMode({ ...base, hasVideo: true })).toBe(false)
  })
})

/**
 * **`-1` MEANS TWO DIFFERENT THINGS AND THE APP COULD ONLY READ ONE OF THEM** (found on the wall,
 * 2026-09-06).
 *
 * `computeAutoAdvanceIndex` returns `-1` *before the first cue* **and** *after the last one* — its
 * own doc says so — and the auto-advance drive treated both as *no line showing*. So a song on the
 * clock, having played its last cue, snapped to index `-1`: on the wall that is **the intro card**,
 * because index `-1` and armed is *loaded, not yet cued*; on the control screen `isEndOfSong` went
 * false and **the next-song tile vanished.** Jorge saw the song appear to start again. **Two
 * symptoms, one line.**
 *
 * **This is the question `-1` cannot answer**, and the song's third state — *finished* — is what
 * hangs off it. Kept pure and out of the drive so it can be asserted against the cue table rather
 * than against a rendered clock.
 */
describe('isPastLastCue: the end of a song, which -1 cannot tell you about', () => {
  const TIMELINE = [
    { start: 0, end: 2 },
    { start: 2, end: 5 },
  ]

  it('is false before the first cue, where the index is also -1', () => {
    expect(computeAutoAdvanceIndex(TIMELINE, -1)).toBe(-1)
    expect(isPastLastCue(TIMELINE, -1)).toBe(false)
    expect(isPastLastCue(TIMELINE, 0)).toBe(false)
  })

  it('is false while a cue is running', () => {
    expect(isPastLastCue(TIMELINE, 1_500)).toBe(false)
    expect(isPastLastCue(TIMELINE, 4_999)).toBe(false)
  })

  it('is true from the instant the last cue ends — the same instant the index goes back to -1', () => {
    expect(computeAutoAdvanceIndex(TIMELINE, 5_000)).toBe(-1)
    expect(isPastLastCue(TIMELINE, 5_000)).toBe(true)
    expect(isPastLastCue(TIMELINE, 60_000)).toBe(true)
  })

  it('reads the latest end, not the last entry, so an unsorted table cannot end a song early', () => {
    expect(isPastLastCue([{ start: 2, end: 5 }, { start: 0, end: 2 }], 3_000)).toBe(false)
    expect(isPastLastCue([{ start: 2, end: 5 }, { start: 0, end: 2 }], 5_000)).toBe(true)
  })

  it('never ends a song that has no timeline at all', () => {
    // A manual song is ended by a press, never by time — there is no cue table to be past.
    expect(isPastLastCue([], 999_999)).toBe(false)
  })
})
