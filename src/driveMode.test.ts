/**
 * **Drive mode: `clock`, `video`, `manual`, as one control.**
 *
 * **A new concept, not a rename** (reconnaissance, 2026-09-03). There was no single mode in the
 * code — two independent axes were doing the work, and these tests are about the one that replaced
 * them: what a song can offer, what it defaults to, and what a mode it cannot do says.
 */
import { describe, it, expect } from 'vitest'
import {
  DRIVE_MODES,
  defaultDriveMode,
  driveModeAvailable,
  driveModeRefusal,
  resolveDriveMode,
} from './driveMode'

const VIDEO_AND_TIMELINE = { hasVideo: true, hasTimeline: true }
const TIMELINE_ONLY = { hasVideo: false, hasTimeline: true }
const NEITHER = { hasVideo: false, hasTimeline: false }

describe('what a song can be driven by', () => {
  it('offers video iff the room gives it one, clock iff it has a timeline, manual always', () => {
    // **Never a fact about the song file for video**: what appears on the wall is named by
    // `visuals.json`, per song, per shape, by Muralista.
    expect(driveModeAvailable('video', VIDEO_AND_TIMELINE)).toBe(true)
    expect(driveModeAvailable('video', TIMELINE_ONLY)).toBe(false)
    expect(driveModeAvailable('clock', TIMELINE_ONLY)).toBe(true)
    expect(driveModeAvailable('clock', NEITHER)).toBe(false)
    expect(driveModeAvailable('manual', NEITHER)).toBe(true)
  })

  it('is three modes, always three', () => {
    // **Only-the-possible was rejected** (Jorge, 2026-09-04): a control that changes shape per song
    // is harder to use at distance than one with a dead button in it.
    expect([...DRIVE_MODES]).toEqual(['video', 'clock', 'manual'])
  })
})

describe('what an unavailable mode says', () => {
  it('names what the song is missing, and where it comes from', () => {
    // The sentences are about the song rather than about the app: *this song has no video* is a
    // fact he can act on, where *unavailable* is not.
    expect(driveModeRefusal('video', TIMELINE_ONLY)).toMatch(/no video/i)
    expect(driveModeRefusal('video', TIMELINE_ONLY)).toMatch(/visuals step/i)
    expect(driveModeRefusal('clock', NEITHER)).toMatch(/no timeline/i)
    expect(driveModeRefusal('clock', NEITHER)).toMatch(/Bombista/)
  })

  it('says nothing about a mode that can act', () => {
    expect(driveModeRefusal('manual', NEITHER)).toBeNull()
    expect(driveModeRefusal('video', VIDEO_AND_TIMELINE)).toBeNull()
  })
})

describe('the default is the most capable available', () => {
  it('is video, then clock, then manual', () => {
    // **So the common case is that Jorge touches nothing.**
    expect(defaultDriveMode(VIDEO_AND_TIMELINE)).toBe('video')
    expect(defaultDriveMode(TIMELINE_ONLY)).toBe('clock')
    expect(defaultDriveMode(NEITHER)).toBe('manual')
  })

  it('gives a video song video, which is what the old unconditional `none` did not', () => {
    // **`getDefaultDisplayMode` returned `'none'` for everything**, recording that media presence
    // deliberately no longer implies a video default. **That reason was about the Videoclip
    // control** — a size control the design has since condemned — and the opt-in it protected
    // survives: choosing `video` is still explicit, and it is a performance choice now rather than
    // a format one.
    expect(defaultDriveMode({ hasVideo: true, hasTimeline: false })).toBe('video')
  })
})

describe('the mode in force', () => {
  it('takes an explicit choice the song can honour', () => {
    expect(
      resolveDriveMode({ selected: 'manual', caps: VIDEO_AND_TIMELINE, manualOverrideTaken: false })
    ).toBe('manual')
  })

  it('falls back to the default when a choice stops being possible', () => {
    // Pressing an unavailable button refuses and stores nothing, so this only arises when the room
    // changes under a choice already made — and the honest answer is a fresh song's answer.
    expect(
      resolveDriveMode({ selected: 'video', caps: TIMELINE_ONLY, manualOverrideTaken: false })
    ).toBe('clock')
  })

  it('is manual once the performer has taken the wheel, and that beats an explicit choice', () => {
    // **P6 is absolute**: a Next or Previous pressed while something is driving the song takes the
    // wheel for the remainder of it.
    expect(
      resolveDriveMode({ selected: 'video', caps: VIDEO_AND_TIMELINE, manualOverrideTaken: true })
    ).toBe('manual')
  })
})
