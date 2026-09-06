/** @vitest-environment jsdom */
/**
 * **The beat indicator's behaviour, end to end** — not a component's tests.
 *
 * **The file is lowercase for that reason** (2026-09-06). It was `BeatIndicator.test.tsx` beside a
 * `BeatIndicator.tsx` it never imported: **that component had no consumer anywhere** and was
 * deleted in the same round. What is on screen is `BeatCircle`, and what these tests drive is the
 * whole app — arm, press, advance — so they are named for the concept rather than for a file.
 *
 * Beat indicator integration tests — performer view.
 *
 * The performer view uses BeatCircle (§7 shared component) for the non-video
 * armed screen. Per the A2.1 fix (d-wire Prompt 5), the beat clock does NOT
 * auto-start on arm and does NOT auto-advance the lyric index when count-in
 * ends — the performer explicitly presses Start, and the first lyric only
 * appears via a manual Next. Tests verify: Start begins count-in, count-in
 * phase renders correctly, transitions to running phase, and lyric index is
 * untouched by the beat clock.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { installRequiredFolders } from './testSupport/folders'
import { render, screen, act, waitFor, within, cleanup } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { PlayerRoot } from './PlayerRoot'
import {
  setSongLines,
  setSongIndex,
  setBlank,
  setCurrentSongId,
  setCurrentSongTitle,
  setProjectionLanguage,
  setSingingLanguage,
  getSongIndex,
} from './songState'
import type { SongItem } from './songState'
import { SONGS } from './songs'
import { installLibrary } from './testSupport/library'
import { standbyState } from './testSupport/standbyState'

function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
    clear: () => { store.clear() },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size },
  }
}

beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
    vi.stubGlobal('localStorage', createStorage())
  }
  if (typeof globalThis.sessionStorage === 'undefined' || typeof globalThis.sessionStorage.setItem !== 'function') {
    vi.stubGlobal('sessionStorage', createStorage())
  }
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(function () {
    return {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }
  }))
})

const VALID_LINES: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]

const WAIT_TIMEOUT = 3000

function clearStorage() {
  sessionStorage.clear()
  localStorage.clear()
  installRequiredFolders()
}

function getArmButton() {
  const main = screen.getByRole('main')
  return within(main).getByRole('button', { name: 'Arm' })
}

function setupControlViewWithReadinessPassing() {
  sessionStorage.setItem('liveLyricLaunched', '1')
  sessionStorage.removeItem('liveLyricPerformanceArmed')
  setSongLines(VALID_LINES)
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId('duelo')
  setProjectionLanguage('en')
  setSingingLanguage('es')
  window.location.hash = '#/'
  const mockApi = {
    isProjectionOpen: vi.fn().mockResolvedValue(true),
    onProjectionOpened: vi.fn(() => vi.fn()),
    onProjectionClosed: vi.fn(() => vi.fn()),
    openProjection: vi.fn().mockResolvedValue(undefined),
    closeProjection: vi.fn().mockResolvedValue(undefined),
  }
  ;(window as unknown as { electronAPI?: unknown }).electronAPI = mockApi
  return mockApi
}

/**
 * **The count-in, which lives in `clock` and nowhere else** (Jorge, 2026-09-06).
 *
 * These tests were written against a **`manual`** song — a tempo, no timeline — because until
 * 2026-09-06 `manual` had an explicit Start step that ran a count-in before the first lyric.
 * **That step is deleted and nothing beat-related exists in `manual` at all**, so the count-in's
 * own mechanics are asserted where they still happen: a legacy-timeline **Auto** song, whose
 * `Play` runs a count-in and then drives the song from the clock.
 *
 * The song is deliberately a **legacy** timeline (no `timelineVersion`): a v2 one takes the
 * cue-start path, where the first press *is* the cue and there is no count-in to watch.
 */
describe('Beat indicator (count-in + running) — performer view (BeatCircle)', () => {
  function installLibraryWithTempo(): void {
    const line: SongItem = { languages: { es: 't', en: 't' } }
    const songs = SONGS.map((s) => ({
      id: s.id,
      title: s.title,
      items: [line, line],
      ...(s.id === 'duelo'
        ? {
            tempo: { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 },
            timeline: [
              { start: 0, end: 30 },
              { start: 30, end: 60 },
            ],
          }
        : {}),
    }))
    installLibrary(songs)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
    installLibraryWithTempo()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  it('shows no beat circle when song has no tempo', async () => {
    setupControlViewWithReadinessPassing()
    setCurrentSongId('pimiento')
    setCurrentSongTitle('Pimiento')
    render(<PlayerRoot initialHash="#/" />)

    await waitFor(() => {
      expect(standbyState()).toBe('READY_TO_ARM')
    }, { timeout: WAIT_TIMEOUT })
    await act(async () => { fireEvent.click(getArmButton()) })

    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('is a plain pulse on arm and a count-in once Play is pressed', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    expect(standbyState()).toBe('READY_TO_ARM')

    await act(async () => { fireEvent.click(getArmButton()) })
    // **The beat starts when a song loads**, and arming loads the first song. A free-running
    // pulse is a plain click, never a phantom count-in the performer would read as meaning
    // something.
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('beat-circle-running')).toBeTruthy()
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()

    // Play begins the count-in, which is what establishes the downbeat.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    act(() => { vi.advanceTimersByTime(50) })

    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    expect(screen.getByTestId('beat-circle-count-in')).toBeTruthy()
  })

  it('count-in shows beat 1 at start (downbeat class applied)', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    act(() => { vi.advanceTimersByTime(50) })

    const numEl = screen.getByTestId('beat-circle-beat-number')
    expect(numEl.textContent).toBe('1')
    expect(numEl.classList.contains('beat-circle-downbeat')).toBe(true)
  })

  it('count-in advances to beat 2 after one beat duration (500ms at 120bpm)', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    act(() => { vi.advanceTimersByTime(550) })

    const numEl = screen.getByTestId('beat-circle-beat-number')
    expect(numEl.textContent).toBe('2')
    expect(numEl.classList.contains('beat-circle-downbeat')).toBe(false)
  })

  it('shows 4 dots matching the meter (4/4)', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    act(() => { vi.advanceTimersByTime(50) })

    const dotsEl = screen.getByTestId('beat-circle-dots')
    expect(dotsEl.querySelectorAll('[data-testid="beat-circle-dot"]').length).toBe(4)
    expect(dotsEl.querySelectorAll('[data-testid="beat-circle-dot"]')[0].className).toMatch(/active/)
  })

  it('after the count-in, the count-in phase goes and the running phase stays', async () => {
    // In `clock` the timeline keeps running once the count-in hands over, so the indicator
    // carries on — it stops at the end of the song, not at the end of the count-in.
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^play$/i })) })
    // Count-in is 4 beats × 500ms = 2000ms
    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
    expect(screen.getByTestId('beat-circle-running')).toBeTruthy()
  })

  it('in `manual` there is no Start, and the first press reveals the first phrase', async () => {
    // **What manual becomes, and it is simpler** (Jorge, 2026-09-06): there is no separate
    // Start, and nothing beat-related at all. A tempo the song happens to declare changes
    // nothing about how it is driven.
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    setCurrentSongId('pimiento')
    setCurrentSongTitle('Pimiento')
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.queryByRole('button', { name: /^start$/i })).toBeNull()
    expect(screen.queryByTestId('beat-circle')).toBeNull()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
    expect(getSongIndex()).toBe(0)
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('beat circle is never rendered in the projection view', async () => {
    render(<PlayerRoot initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })

    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('count-in does not appear in SETUP state (not armed)', async () => {
    vi.useFakeTimers()
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)

    await act(async () => { await Promise.resolve() })
    // Do NOT arm — remain in READY_TO_ARM
    act(() => { vi.advanceTimersByTime(2100) })

    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })
})

/**
 * **`clock` AND `video` ONLY, NEVER `manual`** (Jorge, 2026-09-05).
 *
 * **This supersedes moments 6 and 7**, which both said the indicator shows in all three drive
 * modes. **The indicator exists to keep Jorge with something running on its own** — the timeline
 * in `clock`, the animation in `video`. In `manual` nothing is running: he is the clock, so
 * there is nothing to drift from and nothing to report. And a manual-only song frequently
 * carries no tempo at all, so in the one mode where it would be drawn there is often no pulse.
 *
 * **Drive mode is not a concept in this code**, so `clock` is read off the two axes that are:
 * `isAutoArmed` — non-video, Auto advance, has a timeline.
 */
describe('the beat indicator, by drive mode', () => {
  const TEMPO = { bpm: 120, numerator: 4, denominator: 4, countInBars: 1 } as const

  /** A `clock` song: a timeline to drive off, a tempo to pulse at, no video. */
  function installClockSong(): void {
    installLibrary(
      SONGS.map((s) => ({
        id: s.id,
        title: s.title,
        items: VALID_LINES,
        ...(s.id === 'duelo'
          ? {
              tempo: { ...TEMPO },
              timelineVersion: 2 as const,
              timeline: [
                { start: 0, end: 30 },
                { start: 30, end: 60 },
              ],
            }
          : {}),
      }))
    )
  }

  /** A `manual` song: a tempo, and no timeline to drive off. */
  function installManualSong(): void {
    installLibrary(
      SONGS.map((s) => ({
        id: s.id,
        title: s.title,
        items: VALID_LINES,
        ...(s.id === 'duelo' ? { tempo: { ...TEMPO } } : {}),
      }))
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    clearStorage()
  })

  afterEach(() => {
    vi.useRealTimers()
    cleanup()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
  })

  async function armIt() {
    setupControlViewWithReadinessPassing()
    render(<PlayerRoot initialHash="#/" />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
  }

  it('in `clock`, it is there the moment the song is loaded — before any press', async () => {
    // **The beat starts when a song loads**, and arming is what loads the first song. Jorge's
    // reason, in his words: so he can get into the rhythm and eventually press start.
    vi.useFakeTimers()
    installClockSong()
    await armIt()
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    // A free-running pulse is a plain click, never a phantom count-in.
    expect(screen.queryByTestId('beat-circle-count-in')).toBeNull()
  })

  it('in `manual`, it is not there on arm', async () => {
    vi.useFakeTimers()
    installManualSong()
    await armIt()
    act(() => { vi.advanceTimersByTime(2100) })
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('is not drawn for a song with no tempo, in any mode', async () => {
    // **One condition, not an exception.** A manual-only song carries no tempo block by design,
    // so there is no pulse to draw — and that answer does not depend on the mode.
    vi.useFakeTimers()
    installClockSong()
    setupControlViewWithReadinessPassing()
    setCurrentSongId('pimiento')
    setCurrentSongTitle('Pimiento')
    render(<PlayerRoot initialHash="#/" />)
    await act(async () => { await Promise.resolve() })
    await act(async () => { fireEvent.click(getArmButton()) })
    act(() => { vi.advanceTimersByTime(2100) })
    expect(screen.queryByTestId('beat-circle')).toBeNull()
  })

  it('in `clock`, it survives the press and runs on into the song', async () => {
    // It runs through *loaded, not yet cued* — the intro card up — through the press, and into
    // *running*.
    vi.useFakeTimers()
    installClockSong()
    await armIt()
    act(() => { vi.advanceTimersByTime(50) })
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^next$/i })) })
    act(() => { vi.advanceTimersByTime(50) })
    expect(getSongIndex()).toBe(0)
    expect(screen.getByTestId('beat-circle')).toBeTruthy()
  })
})
