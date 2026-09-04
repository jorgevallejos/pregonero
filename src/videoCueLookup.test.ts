/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { videoCueLookup, resolveVideoSongTime, resolveVideoCueIndex } from './videoCueLookup'
import type { TimelineEntry } from './songState'
import { GOLDEN_TIMELINE_ENTRIES, GOLDEN_LEAD_IN } from './fixtures/timelineV2'

describe('videoCueLookup', () => {
  const timeline: TimelineEntry[] = [
    { start: 2, end: 5 },   // index 0
    { start: 5, end: 9 },   // index 1
    { start: 12, end: 17 }, // index 2 — gap before this one
  ]

  it('returns -1 for empty timeline', () => {
    expect(videoCueLookup([], 3)).toBe(-1)
  })

  it('returns -1 when songTime is negative', () => {
    expect(videoCueLookup(timeline, -0.5)).toBe(-1)
  })

  it('returns -1 when songTime is before first entry start', () => {
    expect(videoCueLookup(timeline, 1.9)).toBe(-1)
  })

  it('returns 0 at exact start of first entry', () => {
    expect(videoCueLookup(timeline, 2)).toBe(0)
  })

  it('returns 0 when songTime is within first entry', () => {
    expect(videoCueLookup(timeline, 3.5)).toBe(0)
  })

  it('returns -1 at exact end of first entry (end is exclusive)', () => {
    expect(videoCueLookup(timeline, 5)).toBe(1) // 5 is start of entry[1]
  })

  it('returns 1 at exact start of second entry', () => {
    expect(videoCueLookup(timeline, 5)).toBe(1)
  })

  it('returns 1 within second entry', () => {
    expect(videoCueLookup(timeline, 7)).toBe(1)
  })

  it('returns -1 in a gap between consecutive entries', () => {
    expect(videoCueLookup(timeline, 10)).toBe(-1)
  })

  it('returns 2 at start of third entry', () => {
    expect(videoCueLookup(timeline, 12)).toBe(2)
  })

  it('returns 2 within third entry', () => {
    expect(videoCueLookup(timeline, 14)).toBe(2)
  })

  it('returns -1 at exact end of last entry', () => {
    expect(videoCueLookup(timeline, 17)).toBe(-1)
  })

  it('returns -1 past the last entry', () => {
    expect(videoCueLookup(timeline, 100)).toBe(-1)
  })

  it('handles single-entry timeline inside the window', () => {
    const single: TimelineEntry[] = [{ start: 0, end: 10 }]
    expect(videoCueLookup(single, 5)).toBe(0)
  })

  it('handles single-entry timeline before the window', () => {
    const single: TimelineEntry[] = [{ start: 3, end: 10 }]
    expect(videoCueLookup(single, 1)).toBe(-1)
  })

  it('handles adjacent entries with no gap (end of one == start of next)', () => {
    const adjacent: TimelineEntry[] = [
      { start: 0, end: 4 },
      { start: 4, end: 8 },
    ]
    expect(videoCueLookup(adjacent, 3.99)).toBe(0)
    expect(videoCueLookup(adjacent, 4)).toBe(1)
  })

  it('returns -1 for zero-length entry (start === end)', () => {
    const zeroLen: TimelineEntry[] = [{ start: 5, end: 5 }]
    expect(videoCueLookup(zeroLen, 5)).toBe(-1)
  })
})

// ── P2: leadIn composition in Video mode (docs/timeline-v2-contract.md) ────

/**
 * The 21 raw (pre-normalisation) boundary values from the contract's golden fixture, listed
 * independently of `GOLDEN_TIMELINE_ENTRIES` so the round-trip assertion below is not
 * tautological. `raw[i]` corresponds to entry[i].start for i < 20, and raw[20] is the last
 * entry's end. Source: docs/timeline-v2-contract.md, "Golden fixture — Libertad, 20 lines".
 */
const RAW_BOUNDARIES = [
  7.26, 13.1, 16.9, 20.58, 24.26, 27.98, 31.92, 35.48, 40.14, 44.76, 46.84, 51.26, 55.88, 59.52,
  63.38, 67.08, 70.88, 74.52, 79.92, 83.9, 106.1,
]

/** normalised[i] for i in [0, 21): entry starts, then the final entry's end. */
const NORMALISED_BOUNDARIES = [
  ...GOLDEN_TIMELINE_ENTRIES.map((e) => e.start),
  GOLDEN_TIMELINE_ENTRIES[GOLDEN_TIMELINE_ENTRIES.length - 1].end,
]

/**
 * **WHETHER THE LEAD-IN APPLIES IS THE CALLER'S ANSWER, NOT THE FILE'S** (Jorge, 2026-09-04).
 *
 * `leadIn.apply` was Bombista's, derived from `media.type == "video"` — and once no song declares
 * media that default silently flips, so **every video song would have lost its lead-in correction
 * with nothing reporting it.** The measured VALUE stays with the timeline; the DECISION moved to
 * the party that knows a video is playing. The fixture is the same lead-in either way now, and the
 * mode is the last argument.
 */
const APPLY = true
const DO_NOT_APPLY = false

describe('resolveVideoSongTime — leadIn composition', () => {
  it('proves losslessness against the golden Libertad fixture (tolerance 0.005)', () => {
    expect(RAW_BOUNDARIES).toHaveLength(21)
    expect(NORMALISED_BOUNDARIES).toHaveLength(21)
    for (let i = 0; i < RAW_BOUNDARIES.length; i++) {
      // resolveVideoSongTime inverts Bombista's `round(raw - leadIn, 2)`: feeding the raw
      // boundary in as "video time" (offset 0) should reproduce the normalised boundary.
      const recovered = resolveVideoSongTime(RAW_BOUNDARIES[i], 0, GOLDEN_LEAD_IN, APPLY)
      expect(Math.abs(recovered - NORMALISED_BOUNDARIES[i])).toBeLessThan(0.005)
    }
  })

  it('applies no offset when leadIn is undefined (legacy / no timelineVersion)', () => {
    expect(resolveVideoSongTime(42.5, 0, undefined)).toBe(42.5)
    expect(resolveVideoSongTime(42.5, 1.2, undefined)).toBe(42.5 + 1.2)
  })

  it('applies no lead-in in Auto mode, even with a nonzero durationSec', () => {
    expect(resolveVideoSongTime(42.5, 0, GOLDEN_LEAD_IN, DO_NOT_APPLY)).toBe(42.5)
    expect(GOLDEN_LEAD_IN.durationSec).toBeGreaterThan(0) // sanity: the field is nonzero
  })

  /** **The default is Auto**, so a caller that says nothing gets the pre-P2 formula. */
  it('applies no lead-in when the caller does not say a video is playing', () => {
    expect(resolveVideoSongTime(42.5, 0, GOLDEN_LEAD_IN)).toBe(42.5)
  })

  it('subtracts leadIn.durationSec in Video mode', () => {
    expect(resolveVideoSongTime(10, 0, GOLDEN_LEAD_IN, APPLY)).toBeCloseTo(10 - 7.26, 10)
  })

  it('composes leadIn and offset additively (independent corrections)', () => {
    // offset = -0.2 (manual alignment nudge), leadIn = 7.26 (structural). Both apply.
    const result = resolveVideoSongTime(20, -0.2, GOLDEN_LEAD_IN, APPLY)
    expect(result).toBeCloseTo(20 + -0.2 - 7.26, 10)
  })
})

describe('resolveVideoCueIndex — integration with videoCueLookup', () => {
  it('resolves the correct cue when video time = leadIn.durationSec + timeline[i].start', () => {
    // Line 1 (index 1) spans normalised [5.84, 9.64). Video time = 7.26 + 5.84 = 13.10.
    const videoTime = GOLDEN_LEAD_IN.durationSec + GOLDEN_TIMELINE_ENTRIES[1].start
    const idx = resolveVideoCueIndex(GOLDEN_TIMELINE_ENTRIES, videoTime, 0, GOLDEN_LEAD_IN, APPLY)
    expect(idx).toBe(1)
  })

  it('returns -1 before the lead-in has elapsed, even though timeline[0].start is 0', () => {
    // Without the leadIn offset this would resolve to line 0; with it, the video is still
    // inside the lead-in and no line should be active yet.
    const idx = resolveVideoCueIndex(GOLDEN_TIMELINE_ENTRIES, 3.0, 0, GOLDEN_LEAD_IN, APPLY)
    expect(idx).toBe(-1)
  })

  it('matches the pre-P2 behavior exactly when leadIn is undefined', () => {
    const timeline: TimelineEntry[] = [{ start: 2, end: 5 }]
    expect(resolveVideoCueIndex(timeline, 3.5, 0, undefined)).toBe(
      videoCueLookup(timeline, 3.5),
    )
  })

  it('matches the pre-P2 behavior exactly when leadIn.apply is false', () => {
    const timeline: TimelineEntry[] = [{ start: 2, end: 5 }]
    expect(resolveVideoCueIndex(timeline, 3.5, 0.1, GOLDEN_LEAD_IN, DO_NOT_APPLY)).toBe(
      videoCueLookup(timeline, 3.5 + 0.1),
    )
  })
})
