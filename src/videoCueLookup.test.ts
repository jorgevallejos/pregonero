/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest'
import { videoCueLookup } from './videoCueLookup'
import type { TimelineEntry } from './songState'

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
