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
import type { Mock } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import type { MediaFile, TimelineEntry, SongItem } from './songState'
import type { SongTempo } from './beatScheduler'

vi.mock('./mediaPathStore', () => ({
  absolutePathToMediaUrl: (path: string) => `media://${path}`,
  validateVideoForImport: () => [],
  setMediaPath: vi.fn(),
}))

const setVideoTransportCommandMock = vi.fn()

vi.mock('./videoTransport', () => ({
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

let playSpy: Mock<() => Promise<void>>
let pauseSpy: Mock<() => void>
let currentTimeSetter: Mock<(value: number) => void>

beforeEach(async () => {
  vi.useFakeTimers()
  playSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
  pauseSpy = vi.fn<() => void>()
  currentTimeSetter = vi.fn<(value: number) => void>()
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
  it('BeatCircle is running before Play is pressed — the beat starts when the song loads', async () => {
    // **Jorge, 2026-09-05.** The beat runs through *loaded, not yet cued* — the intro card up —
    // through the press, and into *running*. His reason, in his words: **so he can get into the
    // rhythm and eventually press start.** The panel is remounted per song, so mount is load.
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    // A free-running pulse is a plain click, never a phantom count-in.
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    expect(screen.getByTestId('beat-circle-running')).toBeTruthy()
  })

  it('stops when the song finishes', async () => {
    const Panel = await importPanel()
    const { rerender } = render(<Panel {...defaultProps()} />)
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    rerender(<Panel {...defaultProps()} songFinished />)
    act(() => { vi.advanceTimersByTime(50) })
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
  /**
   * **`trimStart` IS ZERO NOW, AND NOT BECAUSE RESTART CHANGED** (2026-09-04). It lived in the
   * song's `media` block, which no longer exists — *the song holds no media*, and what plays is a
   * NAME assigned in Muralista. **The manual trim has no author any more**, so the panel restarts
   * to the top of the file. This asserts the behaviour that survives: Restart seeks, rather than
   * leaving the video where it stopped.
   */
  it('Restart seeks the video back to its start', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps({ tempo: TEMPO_4_4_1BAR })} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^play$/i }))
    })
    act(() => { vi.advanceTimersByTime(2100) })
    currentTimeSetter.mockClear()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^restart$/i }))
    })
    expect(currentTimeSetter).toHaveBeenCalledWith(0)
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

// ── layout structure ─────────────────────────────────────────────────────

describe('VideoPerformancePanel — layout structure', () => {
  it('renders video-perf-video-wrap and video-perf-bottom-bar as direct children of the panel', async () => {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps()} />)
    const panel = container.querySelector('.video-perf-panel')
    expect(panel).toBeTruthy()
    const wrap = panel!.querySelector(':scope > .video-perf-video-wrap')
    const bar = panel!.querySelector(':scope > .video-perf-bottom-bar')
    expect(wrap).toBeTruthy()
    expect(bar).toBeTruthy()
  })

  it('video-perf-bottom-bar carries its class so the spacing rule applies', async () => {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps()} />)
    const bar = container.querySelector('.video-perf-bottom-bar')
    expect(bar).toBeTruthy()
    expect(bar!.classList.contains('video-perf-bottom-bar')).toBe(true)
  })

  it('video-perf-bottom-bar appears after video-perf-video-wrap in DOM order', async () => {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps()} />)
    const panel = container.querySelector('.video-perf-panel')!
    const children = Array.from(panel.children)
    const wrapIdx = children.findIndex(el => el.classList.contains('video-perf-video-wrap'))
    const barIdx = children.findIndex(el => el.classList.contains('video-perf-bottom-bar'))
    expect(wrapIdx).toBeGreaterThanOrEqual(0)
    expect(barIdx).toBeGreaterThan(wrapIdx)
  })
})

// ── singing-language lyric overlay (A2 / B2) ─────────────────────────────

describe('VideoPerformancePanel — singing-language lyric overlay', () => {
  it('does NOT render a Cue N / M counter', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByText(/cue\s*\d+\s*\/\s*\d+/i)).toBeNull()
  })

  it('renders no lyric overlay before any cue is active (activeCueIndex -1)', async () => {
    const Panel = await importPanel()
    render(<Panel {...defaultProps()} />)
    expect(screen.queryByTestId('video-perf-lyric-overlay')).toBeNull()
  })

  it('renders the singing-language text of the active cue on timeupdate', async () => {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps()} />)
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { value: 1.2, configurable: true })
    await act(async () => {
      fireEvent(video, new Event('timeupdate'))
    })
    expect(screen.getByTestId('video-perf-lyric-overlay').textContent).toBe('Mundo')
  })

  it('renders the other singing language when singingLang differs', async () => {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps({ singingLang: 'en' })} />)
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { value: 0.2, configurable: true })
    await act(async () => {
      fireEvent(video, new Event('timeupdate'))
    })
    expect(screen.getByTestId('video-perf-lyric-overlay').textContent).toBe('Hello')
  })

  it('renders no lyric overlay for a section marker cue', async () => {
    const Panel = await importPanel()
    const linesWithSection: SongItem[] = [
      { type: 'section', label: 'Chorus' },
      { languages: { es: 'Mundo', en: 'World' } },
    ]
    const { container } = render(
      <Panel {...defaultProps({ lines: linesWithSection })} />
    )
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { value: 0.2, configurable: true })
    await act(async () => {
      fireEvent(video, new Event('timeupdate'))
    })
    expect(screen.queryByTestId('video-perf-lyric-overlay')).toBeNull()
  })

  it('renders no lyric overlay once the cue moves past the last timeline entry', async () => {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps()} />)
    const video = container.querySelector('video')!
    Object.defineProperty(video, 'currentTime', { value: 5, configurable: true })
    await act(async () => {
      fireEvent(video, new Event('timeupdate'))
    })
    expect(screen.queryByTestId('video-perf-lyric-overlay')).toBeNull()
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

  it('broadcasts stop before calling onUnarm', async () => {
    const Panel = await importPanel()
    const onUnarm = vi.fn()
    render(<Panel {...defaultProps({ onUnarm })} />)
    setVideoTransportCommandMock.mockClear()
    const unarmBtn = screen.getByRole('button', { name: /^unarm$/i })
    await act(async () => { fireEvent.pointerDown(unarmBtn) })
    act(() => { vi.advanceTimersByTime(1001) }) // past HOLD_CONFIRM_MS (1000)
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('stop')
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

  it('broadcasts stop immediately on Restart (before count-in)', async () => {
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
    expect(setVideoTransportCommandMock).toHaveBeenCalledWith('stop')
    expect(setVideoTransportCommandMock).not.toHaveBeenCalledWith('play')
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

/**
 * **A SONG ENDS IN ALL THREE DRIVE MODES, AND THIS IS THE THIRD** (Jorge, 2026-09-06).
 *
 * `v0.94.0` found one fault with two faces — **and both faces were `clock` and `manual`.** A song
 * driven by its video reached neither: the clock's ending is in an effect that returns early in
 * Video mode, and manual's is a press that Video mode does not make. **So `tragedia`'s last phrase
 * stayed on the wall, the song was never marked finished, and the setlist could never end** — the
 * same two moments blocked for three rounds.
 *
 * **Why the phrase stayed rather than clearing.** Past the last cue the lookup answers `-1`, which
 * would have cleared it — but a `<video>` that reaches its end stops firing `timeupdate`, so the
 * last index computed is the last index there is. **Nothing was wrong with the lookup; nothing
 * asked it again.**
 *
 * **The predicate is the one the clock already uses.** `isPastLastCue` is not reimplemented here:
 * what differs between the modes is which clock is read, and that difference is irreducible — each
 * mode has its own. What must not differ is the answer, or the act that follows it.
 */
describe('the end of a song, in Video mode', () => {
  async function panelWith(onSongEnded = vi.fn()) {
    const Panel = await importPanel()
    const { container } = render(<Panel {...defaultProps({ onSongEnded })} />)
    return { onSongEnded, video: container.querySelector('video')! }
  }

  async function tickAt(video: HTMLVideoElement, seconds: number) {
    Object.defineProperty(video, 'currentTime', { value: seconds, configurable: true })
    await act(async () => {
      fireEvent(video, new Event('timeupdate'))
    })
  }

  it('says nothing while a cue is still running', async () => {
    const { onSongEnded, video } = await panelWith()
    await tickAt(video, 1.2)
    expect(onSongEnded).not.toHaveBeenCalled()
  })

  /**
   * **THE CLOCK RAN OUT SHORT, AND THAT IS THE WHOLE FINDING** (measured, 2026-09-06).
   *
   * `Tragedia de Cerdo Asado.mp4` is **159.49s**; its last cue ends at **159.78s**. So *past the
   * last cue* was never true — **correctly, by its own definition** — and the phrase stayed on the
   * wall, the song was never finished and the gig never ended. **Nothing was broken.** Three
   * rounds looked for a fault in the asking and there was none in the answering.
   *
   * `TIMELINE` here ends at 2.0s; the video stops at 1.9s. **The fixture is short by a fraction,
   * because that is the case in the room.**
   */
  it('ends the song when the media ends, even with the timeline still to run', async () => {
    const { onSongEnded, video } = await panelWith()
    await tickAt(video, 1.9)
    expect(onSongEnded).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent(video, new Event('ended'))
    })
    expect(onSongEnded).toHaveBeenCalledTimes(1)
  })

  /**
   * **The other half of the same fault, and the same folder holds both.** Two of `tragedia`'s five
   * exports **outlast** its timeline by ~20s. Ending the song at the last cue would have blacked
   * the wall on the last twenty seconds of the clip. **The video is the clock; the timeline defers
   * to it.**
   */
  it('does not end the song when the timeline runs out before the media does', async () => {
    const { onSongEnded, video } = await panelWith()
    for (const t of [2.0, 5.0, 20.0]) await tickAt(video, t)
    expect(onSongEnded).not.toHaveBeenCalled()
  })

  it('says it once, however many times the element reports it', async () => {
    const { onSongEnded, video } = await panelWith()
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        fireEvent(video, new Event('ended'))
      })
    }
    expect(onSongEnded).toHaveBeenCalledTimes(1)
  })
})
