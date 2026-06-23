/** @vitest-environment jsdom */
/**
 * Tests for VideoPerformancePanel (§5 — simplified video performance screen).
 *
 * Key behaviors under test:
 *   - Only Play, Pause, Restart, Unarm are rendered; legacy controls are absent.
 *   - Play starts a count-in clock; video is held at trimStart during count-in.
 *   - Once the count-in completes (beginFired), video.play() is called.
 *   - countInBars omitted or 0 → video starts immediately on Play (no count-in).
 *   - Pause: video.pause() called, clock frozen.
 *   - Play from paused: video.play() resumed, no re-count-in.
 *   - Restart: video.currentTime = trimStart, clock resets, count-in restarts.
 *   - BeatCircle renders when tempo is provided; absent when tempo is undefined.
 *   - absolutePath=null renders a no-path message (no video controls).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import type { MediaFile, TimelineEntry, SongItem } from './songState'
import type { SongTempo } from './beatScheduler'

vi.mock('./mediaPathStore', () => ({
  absolutePathToMediaUrl: (path: string) => `media://${path}`,
  validateVideoForImport: () => [],
  setMediaPath: vi.fn(),
}))

const setVideoTransportCommandMock = vi.fn()

vi.mock('./VideoProjectionRegion', () => ({
  setVideoSeekTarget: vi.fn(),
  setVideoTransportCommand: setVideoTransportCommandMock,
}))


const TIMELINE: TimelineEntry[] = [
  { start: 0, end: 1 },
  { start: 1, end: 2 },
]
const LINES: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]
const MEDIA: MediaFile = { type: 'video', src: 'test.mp4', trimStart: 0 }

/**
 * 120bpm, 4/4, 1 bar count-in = 4 beats × 500ms = 2000ms before beginFired.
 */
const TEMPO_4_4_1BAR: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 }
/**
 * 2 bar count-in = 8 beats × 500ms = 4000ms before beginFired.
 */
const TEMPO_4_4_2BARS: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 2 }

let playSpy: ReturnType<typeof vi.fn>
let pauseSpy: ReturnType<typeof vi.fn>
let currentTimeSetter: ReturnType<typeof vi.fn>

beforeEach(async () => {
  vi.useFakeTimers()
  playSpy = vi.fn(() => Promise.resolve())
  pauseSpy = vi.fn()
  currentTimeSetter = vi.fn()
  HTMLVideoElement.prototype.play = playSpy
  HTMLVideoElement.prototype.pause = pauseSpy
  const descriptor = {
    get: vi.fn(() => 0),
    set: currentTimeSetter,
    configurable: true,
  }
  Object.defineProperty(HTMLVideoElement.prototype, 'currentTime', descriptor)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  cleanup()
})

// lazy import so mocks are in place before module load
async function importPanel() {
  const mod = await import('./VideoPerformancePanel')
  return mod.VideoPerformancePanel
}

function defaultProps(overrides: Record<string, unknown> = {}) {
  return {
    absolutePath: '/path/to/video.mp4',
    media: MEDIA,
    timeline: TIMELINE,
    lines: LINES,
    singingLang: 'es',
    tempo: TEMPO_4_4_1BAR,
    onUnarm: vi.fn(),
    onSeek: vi.fn(),
    ...overrides,
  }
}

// ── control set ─────────────────────────────────────────────────────────────

describe('VideoPerformancePanel — control set', () => {
  it('renders Play, Pause, Restart, Unarm buttons', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.getByRole('button', { name: /^play$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^pause$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^restart$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^unarm$/i })).toBeTruthy()
  })

  it('does NOT render ← Cue or Cue → buttons', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByRole('button', { name: /cue/i })).toBeNull()
    expect(screen.queryByText(/← cue/i)).toBeNull()
    expect(screen.queryByText(/cue →/i)).toBeNull()
  })

  it('does NOT render a Cue strip / Hide strip button', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByRole('button', { name: /strip/i })).toBeNull()
  })

  it('does NOT render a Locate video button', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByRole('button', { name: /locate/i })).toBeNull()
  })

  it('does NOT render an End Card button', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByRole('button', { name: /end card/i })).toBeNull()
  })
})

// ── no-path state ─────────────────────────────────────────────────────────

describe('VideoPerformancePanel — no-path state', () => {
  it('when absolutePath is null, shows no-path message and no video element', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ absolutePath: null })} />)
    expect(screen.queryByRole('video')).toBeNull()
    expect(screen.getByTestId('video-perf-no-path')).toBeTruthy()
  })
})

// ── beat circle ───────────────────────────────────────────────────────────

describe('VideoPerformancePanel — BeatCircle', () => {
  it('BeatCircle is not visible before Play is pressed (clock not started)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('BeatCircle appears after Play is pressed (tempo present)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
  })

  it('BeatCircle is never rendered when tempo is undefined', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: undefined })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })
})

// ── count-in → video handoff ─────────────────────────────────────────────

describe('VideoPerformancePanel — count-in to video handoff', () => {
  it('video.play() is NOT called during the count-in phase', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    // Advance to just before count-in ends (4 beats × 500ms = 2000ms)
    act(() => { vi.advanceTimersByTime(1999) })
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('video.play() is called once the count-in completes (beginFired)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) }) // past count-in
    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('2-bar count-in (4/4) fires 8 beats before video starts', async () => {
    const Panel = await importPanel()
    // countInBars=2 → 8 beats × 500ms = 4000ms
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_2BARS })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(3999) }) // still in count-in
    expect(playSpy).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(100) }) // crosses 4000ms
    expect(playSpy).toHaveBeenCalledTimes(1)
  })
})

// ── no-count-in fast path ─────────────────────────────────────────────────

describe('VideoPerformancePanel — no count-in (countInBars=0 or omitted)', () => {
  it('video.play() is called immediately when countInBars is 0', async () => {
    const Panel = await importPanel()
    const tempo: SongTempo = { bpm: 120, numerator: 4, denominator: 4, countInBars: 0 }
    render(<Panel {...defaultProps({ tempo })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(10) })
    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('video.play() is called immediately when tempo has no countInBars field', async () => {
    const Panel = await importPanel()
    const tempo: SongTempo = { bpm: 120, numerator: 4, denominator: 4 }
    render(<Panel {...defaultProps({ tempo })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(10) })
    expect(playSpy).toHaveBeenCalledTimes(1)
  })

  it('video.play() is called immediately when tempo is undefined (no tempo song)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: undefined })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(10) })
    expect(playSpy).toHaveBeenCalledTimes(1)
  })
})

// ── pause / resume ────────────────────────────────────────────────────────

describe('VideoPerformancePanel — pause and resume', () => {
  async function playPastCountIn(Panel: React.ComponentType<ReturnType<typeof defaultProps>>) {
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) }) // past count-in
    expect(playSpy).toHaveBeenCalledTimes(1)
  }

  it('Pause calls video.pause()', async () => {
    const Panel = await importPanel()
    await playPastCountIn(Panel)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    })
    expect(pauseSpy).toHaveBeenCalledTimes(1)
  })

  it('Play from paused calls video.play() again (no re-count-in)', async () => {
    const Panel = await importPanel()
    await playPastCountIn(Panel)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    })
    expect(pauseSpy).toHaveBeenCalledTimes(1)
    const playCallsBeforeResume = playSpy.mock.calls.length

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(50) })
    // video.play() should be called again (resume), not triggering a new count-in
    expect(playSpy.mock.calls.length).toBeGreaterThan(playCallsBeforeResume)
  })

  it('BeatCircle phase continues past count-in after a pause/resume (no clock reset)', async () => {
    const Panel = await importPanel()
    await playPastCountIn(Panel)
    // After count-in, BeatCircle should be in running mode
    expect(screen.queryByTestId('beat-circle-running')).toBeTruthy()

    // Pause then resume
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(50) })
    // Still in running mode (no count-in restart)
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    expect(screen.getByTestId('beat-circle-running')).toBeTruthy()
  })
})

// ── restart ───────────────────────────────────────────────────────────────

describe('VideoPerformancePanel — restart', () => {
  it('Restart resets video.currentTime to trimStart', async () => {
    const Panel = await importPanel()
    const media: MediaFile = { type: 'video', src: 'test.mp4', trimStart: 5.0 }
    render(<Panel {...defaultProps({ media, tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) })
    currentTimeSetter.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })
    expect(currentTimeSetter).toHaveBeenCalledWith(5.0)
  })

  it('Restart re-starts the count-in from t=0 (video.play() not called until count-in ends again)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    // First play: run through count-in
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) })
    expect(playSpy).toHaveBeenCalledTimes(1)

    // Restart
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })

    // Should be back in count-in: advance just before count-in ends
    act(() => { vi.advanceTimersByTime(1999) })
    // play() should NOT have been called again yet
    expect(playSpy).toHaveBeenCalledTimes(1)

    // Now cross the count-in boundary
    act(() => { vi.advanceTimersByTime(100) })
    expect(playSpy).toHaveBeenCalledTimes(2)
  })

  it('Restart shows count-in BeatCircle phase again', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) })
    // Should be in running phase after count-in
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })
    act(() => { vi.advanceTimersByTime(50) })
    // Should be back in count-in phase
    expect(screen.getByTestId('beat-circle-count-in')).toBeTruthy()
  })
})

// ── Unarm callback ────────────────────────────────────────────────────────

describe('VideoPerformancePanel — Unarm', () => {
  it('calls onUnarm when Unarm is clicked (hold-to-confirm)', async () => {
    const Panel = await importPanel()
    const onUnarm = vi.fn()
    render(<Panel {...defaultProps({ onUnarm })} />)
    const unarmBtn = screen.getByRole('button', { name: /^unarm$/i })
    // Hold to confirm
    await act(async () => { fireEvent.pointerDown(unarmBtn) })
    act(() => { vi.advanceTimersByTime(2000) }) // HOLD_CONFIRM_MS
    expect(onUnarm).toHaveBeenCalled()
  })
})

// ── transport broadcasts ──────────────────────────────────────────────────

describe('VideoPerformancePanel — transport broadcasts', () => {
  beforeEach(() => {
    setVideoTransportCommandMock.mockClear()
  })

  it('broadcasts play at count-in→video handoff (beginFired)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    // Before count-in ends: no play broadcast yet
    act(() => { vi.advanceTimersByTime(1999) })
    expect(setVideoTransportCommandMock).not.toHaveBeenCalledWith('play')
    // After count-in ends: play broadcast
    act(() => { vi.advanceTimersByTime(100) })
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('play')
  })

  it('broadcasts play immediately on Play when there is no count-in', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: undefined })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(10) })
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('play')
  })

  it('broadcasts pause on Pause', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) }) // past count-in
    setVideoTransportCommandMock.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^pause$/i }))
    })
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('pause')
  })

  it('broadcasts seek(trimStart) on Restart', async () => {
    const Panel = await importPanel()
    const media: MediaFile = { type: 'video', src: 'test.mp4', trimStart: 5.0 }
    render(<Panel {...defaultProps({ media, tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) })
    setVideoTransportCommandMock.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('seek', 5.0)
  })

  it('broadcasts play again after count-in following Restart', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    // First play: run through count-in
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) })
    // Restart
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })
    setVideoTransportCommandMock.mockClear()
    // Count-in runs again; play broadcast at handoff
    act(() => { vi.advanceTimersByTime(2100) })
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('play')
  })
})
