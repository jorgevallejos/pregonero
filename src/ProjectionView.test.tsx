/** @vitest-environment jsdom */
/**
 * Projection screen: shows only the current translated lyric line.
 * It must NOT show a next-line preview (preview is on the performance control screen only).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { act, render, screen, waitFor, cleanup } from '@testing-library/react'
import App from './App'
import {
  setSongLines,
  setSongIndex,
  setBlank,
  setCurrentSongId,
  setProjectionLanguage,
  setSingingLanguage,
} from './songState'
import type { SongItem } from './songState'
import { installLibrary } from './testSupport/library'
import { closeRoom, installRoom, shape, FULL_FRAME } from './testSupport/room'
import { KEY_VISUALS_BROADCAST } from './visualsBroadcast'
import { KEY_ARMED_BROADCAST } from './performanceState'
import { setAutoBlackout, AUTO_BLACKOUT_KEY } from './autoBlackout'
import { KEY_DISPLAY_MODE_BROADCAST } from './screenSizeState'

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

/** Two lyric lines for projection language tests */
const TWO_LINES: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]

/** Lyric, section marker, lyric — used to confirm projection ignores section for display */
const LINES_WITH_SECTION: SongItem[] = [
  { languages: { es: 'Primero', en: 'First' } },
  { type: 'section', label: 'Chorus' },
  { languages: { es: 'Segundo', en: 'Second' } },
]

/** Single phrase with embedded newlines (JSON `\n`) — must render as multiple lines on projection */
const PHRASE_WITH_MANUAL_BREAKS: SongItem[] = [
  {
    languages: {
      es: 'Primera línea\nSegunda línea',
      en: 'First line\nSecond line',
      fr: 'Première ligne\nDeuxième ligne',
      nl: 'Eerste regel\nTweede regel',
    },
  },
]

function setupProjectionStorage(lines: SongItem[], index: number, blank: boolean) {
  sessionStorage.setItem('liveLyricLaunched', '1')
  setSongLines(lines)
  setSongIndex(index)
  setBlank(blank)
  setCurrentSongId('test')
  setProjectionLanguage('en')
  window.location.hash = '#/projection'
}

function setupSongLibraryWithNotes(song: {
  id: string
  title: string
  items: SongItem[]
  notes?: string
}) {
  installLibrary([song])
}

/** Projection must not have a next-line preview element (preview is on control screen only). */
function getProjectionNextPreview() {
  return document.querySelector('[data-testid="projection-next-preview"]')
}

/** Helper: flush React effects so the arm-transition flag registers. */
async function flushEffects() {
  await act(async () => { await Promise.resolve() })
}

/** Helper: trigger a generic storage update so useSongNavigation re-reads localStorage. */
function dispatchStorageUpdate() {
  window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))
}

/** Helper: fire the arm broadcast so ProjectionView sets hasSeenArmedSinceMount = true. */
function simulateArm() {
  window.dispatchEvent(new StorageEvent('storage', { key: KEY_ARMED_BROADCAST, newValue: '1' }))
}

describe('Projection screen', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    // The room the wall is painted into. Without a gig folder there is nothing to project and
    // the Projection window is dark, which is its own test below.
    installRoom()
  })

  it('shows only the current translated lyric line (no next-line preview)', async () => {
    setupProjectionStorage(TWO_LINES, -1, true)
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    })

    expect(getProjectionNextPreview()).toBeNull()
  })

  it('does not show control performance timer/status button UI on projection screen', async () => {
    setupProjectionStorage(TWO_LINES, -1, true)
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    })

    expect(screen.queryByTestId('performance-status-button')).toBeNull()
    expect(screen.queryByText(/^Min \d+$/)).toBeNull()
  })

  it('does not show any next-line preview when on last line', async () => {
    setupProjectionStorage(TWO_LINES, -1, true)
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(1)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(screen.getByText('World')).toBeTruthy()
    })

    expect(getProjectionNextPreview()).toBeNull()
  })

  it('shows only current lyric when a section marker follows (no preview)', async () => {
    setupProjectionStorage(LINES_WITH_SECTION, -1, true)
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy()
    })

    expect(getProjectionNextPreview()).toBeNull()
  })

  it('respects newline characters inside a single lyric phrase (manual line breaks)', async () => {
    setupProjectionStorage(PHRASE_WITH_MANUAL_BREAKS, -1, true)
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      const lyric = document.querySelector('.projection-lyric')
      expect(lyric).toBeTruthy()
      expect(lyric?.textContent).toBe('First line\nSecond line')
    })
  })

  it('projection lyric rule uses pre-line so JSON newline characters break lines', () => {
    const css = readFileSync(resolve(__dirname, 'control.css'), 'utf8')
    const block = css.match(/\.projection-screen\s+\.projection-lyric\s*\{([^}]*)\}/)
    expect(block).toBeTruthy()
    expect(block![1]).toMatch(/white-space:\s*pre-line/)
  })

  it('preserves multiple consecutive newlines inside one phrase', async () => {
    setupProjectionStorage(
      [{ languages: { en: 'Line one\n\nLine two' } }],
      -1,
      true
    )
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(document.querySelector('.projection-lyric')?.textContent).toBe('Line one\n\nLine two')
    })
  })

  /** Full-opacity dwell before auto fade-out (must match ProjectionView AUTO_FADE_MS). */
  const PHRASE_FULL_OPACITY_MS = 6000

  it('keeps the current lyric at full opacity until the phrase display duration elapses, then starts fade-out', async () => {
    vi.useFakeTimers()
    try {
      setupProjectionStorage(TWO_LINES, -1, true)
      render(<App initialHash="#/projection" />)
      simulateArm()

      // Flush arm-transition effect with real microtasks (fake timers don't block this).
      await act(async () => { await Promise.resolve() })

      // Advance to first lyric.
      setSongIndex(0)
      setBlank(false)
      dispatchStorageUpdate()
      await act(async () => { await Promise.resolve() })

      // The opacity is on the lyric box — the thing laid out inside the shape's unit square.
      // The text node inside it carries the type, not the fade.
      expect(screen.getByText('Hello')).toBeTruthy()
      const lyric = screen.getByTestId('shape-lyrics-lyrics-1')
      expect(lyric.style.opacity).toBe('1')

      await act(async () => {
        vi.advanceTimersByTime(PHRASE_FULL_OPACITY_MS - 1)
      })
      expect(lyric.style.opacity).toBe('1')

      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      expect(lyric.style.opacity).toBe('0')
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears the displayed lyric after progression is reset (e.g. translation language change with index sent to pre-start)', async () => {
    const LINES: SongItem[] = [
      { languages: { es: 'Uno', en: 'One', fr: 'Un' } },
      { languages: { es: 'Dos', en: 'Two', fr: 'Deux' } },
    ]
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'
    render(<App initialHash="#/projection" />)
    simulateArm()

    // Flush effects so hasSeenArmedSinceMount settles, then advance to first lyric.
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(screen.getByText('One')).toBeTruthy()
    })

    setProjectionLanguage('fr')
    setSongIndex(-1)
    setBlank(true)
    dispatchStorageUpdate()

    await waitFor(
      () => {
        expect(document.querySelector('.projection-lyric')?.textContent).toBe('')
      },
      { timeout: 3000 }
    )
  })

  it('stays blank before first lyric on projection even when song has notes', async () => {
    setupSongLibraryWithNotes({
      id: 'with-notes',
      title: 'With Notes',
      items: TWO_LINES,
      notes: 'Capo 2. Soft intro.',
    })
    setupProjectionStorage(TWO_LINES, -1, true)
    setCurrentSongId('with-notes')
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(document.querySelector('.projection-lyric')?.textContent).toBe('')
    })
    expect(screen.queryByText('Capo 2. Soft intro.')).toBeNull()
  })

  it('shows first lyric after first Next when song has notes', async () => {
    setupSongLibraryWithNotes({
      id: 'with-notes',
      title: 'With Notes',
      items: TWO_LINES,
      notes: 'Capo 2. Soft intro.',
    })
    setupProjectionStorage(TWO_LINES, -1, true)
    setCurrentSongId('with-notes')
    render(<App initialHash="#/projection" />)
    simulateArm()
    await act(async () => { await Promise.resolve() })

    setSongIndex(0)
    setBlank(false)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    })
  })
})

const SONG_LINES: SongItem[] = [
  { languages: { es: 'Hola', en: 'Hello' } },
  { languages: { es: 'Mundo', en: 'World' } },
]

function setupIntroScreenState(song: {
  id: string
  title: string
  items: SongItem[]
  title_translations?: Record<string, string>
  intro?: Record<string, string>
}) {
  installLibrary([song])
  sessionStorage.setItem('liveLyricLaunched', '1')
  setSongLines(song.items)
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId(song.id)
  setProjectionLanguage('en')
  setSingingLanguage('es')
  window.location.hash = '#/projection'
}

describe('Projection lifecycle: the wall shows what is playing', () => {
  const PERF_SONG = {
    id: 'perf-song',
    title: 'Performance Song',
    items: [{ languages: { es: 'Hola', en: 'Hello' } }] as SongItem[],
  }

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    // The room the wall is painted into. Without a gig folder there is nothing to project and
    // the Projection window is dark, which is its own test below.
    installRoom()
  })

  /**
   * The projection window reopened mid-song shows **the line that is playing**, immediately.
   *
   * It used to show the logo instead, and wait for the next arm transition to reveal anything —
   * which made sense while there was a logo to hold the wall. With that fallback gone, waiting
   * would mean a black wall until the performer unarmed and re-armed, in the middle of a song.
   */
  it('shows the current lyric when reopened mid-song, without waiting for an arm', async () => {
    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines([
      { languages: { es: 'L1', en: 'L1' } },
      { languages: { es: 'L2', en: 'L2' } },
      { languages: { es: 'L3', en: 'L3' } },
      { languages: { es: 'L4', en: 'L4' } },
    ])
    setSongIndex(3)
    setBlank(false)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })

    await waitFor(() => expect(screen.getByText('L4')).toBeTruthy(), { timeout: 3000 })
    // And there is no logo anywhere to have shown instead.
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull()
  })

  it('shows intro screen after arm transition (non-armed to armed)', async () => {
    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(PERF_SONG.items)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })
    simulateArm()
    await act(async () => { await Promise.resolve() })

    setSongIndex(-1)
    setBlank(true)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })
  })

  /**
   * The stale-broadcast case this replaces was the Projection window's own: it keyed off
   * `KEY_ARMED_BROADCAST` to decide when to stop showing the logo, and a value left in
   * `localStorage` by a previous launch could wedge it there. **The nonce that fixes it stays** —
   * it is not logo plumbing, it is the storage-event fix documented in `CLAUDE.md`, and
   * `performanceState.test.ts` is where it is tested. What is gone is this window's dependence on
   * it: nothing here now waits for an arm transition before showing anything.
   */
  it('does not wait on the arm broadcast for anything', async () => {
    // Exactly the leftover a previous launch leaves behind.
    localStorage.setItem(KEY_ARMED_BROADCAST, '1')

    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(PERF_SONG.items)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })

    // No arm event has been dispatched, and the title card is on the wall regardless.
    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('T2: audience is black (intro suppressed) while the Auto blackout is active at index -1', async () => {
    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(PERF_SONG.items)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })
    simulateArm()
    await act(async () => { await Promise.resolve() })

    // Reset to intro (index -1) — normally shows the intro/title screen.
    setSongIndex(-1)
    setBlank(true)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))
    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })

    // Activate the Auto blackout → intro suppressed (audience goes black).
    act(() => {
      setAutoBlackout(true)
      window.dispatchEvent(new StorageEvent('storage', { key: AUTO_BLACKOUT_KEY, newValue: 'x' }))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('song-intro-screen')).toBeNull()
    }, { timeout: 3000 })

    // Clearing the blackout restores the intro (e.g. Restart).
    act(() => {
      setAutoBlackout(false)
      window.dispatchEvent(new StorageEvent('storage', { key: AUTO_BLACKOUT_KEY, newValue: 'y' }))
    })
    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('shows first lyric after arm transition followed by advancing to index 0', async () => {
    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(PERF_SONG.items)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })
    simulateArm()
    await act(async () => { await Promise.resolve() })

    setSongIndex(-1)
    setBlank(true)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })

    setSongIndex(0)
    setBlank(false)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('R1: audience shows the driven lyric (not black) when an Auto cue arrives via storage while the blackout is active', async () => {
    // The Auto blackout blacks out the audience during the count-in / before the first cue.
    // When the first cue is due, the Control window writes index 0 / blank false to the shared
    // localStorage; the Projection re-reads it on the storage event. The lyric must appear even
    // though the blackout flag is still set (blackout only suppresses the intro at index -1, so
    // gaps between cues stay black — it must NOT suppress a real cue).
    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(PERF_SONG.items)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })
    simulateArm()
    await act(async () => { await Promise.resolve() })

    // Play pressed → blackout active, still at the pre-first-cue intro (index -1).
    act(() => {
      setAutoBlackout(true)
      window.dispatchEvent(new StorageEvent('storage', { key: AUTO_BLACKOUT_KEY, newValue: 'x' }))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('song-intro-screen')).toBeNull()
    }, { timeout: 3000 })

    // First cue due → Control writes index 0 / blank false to the shared localStorage.
    act(() => {
      setSongIndex(0)
      setBlank(false)
      window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))
    })

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    }, { timeout: 3000 })
  })

  it('comes back showing the song, not a logo, after an unmount and remount', async () => {
    installLibrary([PERF_SONG])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(PERF_SONG.items)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId(PERF_SONG.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    const { unmount } = render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })
    unmount()
    cleanup()

    render(<App initialHash="#/projection" />)
    await act(async () => { await Promise.resolve() })

    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy(), { timeout: 3000 })
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull()
  })
})

describe('Song intro screen on projection (ARMED + index === -1)', () => {
  const WAIT_TIMEOUT = 3000

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    // The room the wall is painted into. Without a gig folder there is nothing to project and
    // the Projection window is dark, which is its own test below.
    installRoom()
  })

  it('shows the song title on the intro screen when a song is loaded and not started', async () => {
    setupIntroScreenState({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Tragedia de cerdo asado')).toBeTruthy()
  })

  it('shows translated title in parentheses when projection lang differs and translation exists', async () => {
    setupIntroScreenState({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
      title_translations: { en: 'Tragedy of Roasted Pig' },
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Tragedy of Roasted Pig')).toBeTruthy()
  })

  it('shows intro tagline in projection language when intro is present', async () => {
    setupIntroScreenState({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
      intro: { es: 'Pelea con tu destino.', en: 'Fight your destiny.' },
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Fight your destiny.')).toBeTruthy()
  })

  it('shows only the title when title_translations and intro are absent', async () => {
    setupIntroScreenState({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Tragedia de cerdo asado')).toBeTruthy()
    expect(document.querySelector('.projection-intro-translated-title')).toBeNull()
    expect(document.querySelector('.projection-intro-tagline')).toBeNull()
  })

  it('intro screen is gone once index moves to 0 (first lyric)', async () => {
    setupIntroScreenState({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    setSongIndex(0)
    setBlank(false)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.queryByTestId('song-intro-screen')).toBeNull()
    }, { timeout: WAIT_TIMEOUT })
  })
})

describe('The projection is a compositor (regression guard: no full-frame renderer)', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    installRoom()
  })

  /**
   * The renderer this replaces was a single full frame with a superimposed subtitle: an
   * animation region, a subtitle band, and a centred flex screen. **None of it may come back.**
   * Leaving it in beside the compositor would mean two rendering paths, one of them never
   * exercised until the night it is.
   */
  it('renders lyrics inside a warped shape, not as a centred full frame', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines([{ languages: { es: 'Hola', en: 'Hello' } }])
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await act(async () => { await Promise.resolve() })

    setSongIndex(0)
    setBlank(false)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    }, { timeout: 3000 })

    expect(document.querySelector('.projection-animation-region')).toBeNull()
    expect(document.querySelector('.projection-subtitle-band')).toBeNull()
    expect(document.querySelector('.projection-lyric-overlay')).toBeNull()

    const root = document.querySelector('[data-shape-id="lyrics-1"]') as HTMLElement
    expect(root).toBeTruthy()
    expect(root.contains(screen.getByText('Hello'))).toBe(true)
  })

  it('draws the intro inside a shape too, with no split layout anywhere', async () => {
    installLibrary([{
      id: 'no-video-song',
      title: 'No Video Song',
      items: [{ languages: { es: 'Hola', en: 'Hello' } }],
    }])
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines([{ languages: { es: 'Hola', en: 'Hello' } }])
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('no-video-song')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await act(async () => { await Promise.resolve() })

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })

    expect(document.querySelector('.projection-animation-region')).toBeNull()
    expect(document.querySelector('.projection-subtitle-band')).toBeNull()
    // The intro has a shape of its own now: `song-intro` is a type, not a mode of the lyrics slot.
    const root = document.querySelector('[data-shape-id="intro-1"]') as HTMLElement
    expect(root.contains(screen.getByTestId('song-intro-screen'))).toBe(true)
  })
})

describe('A2.3 — intro screen shows in video mode too (over the pre-play black cover)', () => {
  const WAIT_TIMEOUT = 3000

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    // The room the wall is painted into. Without a gig folder there is nothing to project and
    // the Projection window is dark, which is its own test below.
    installRoom()
  })

  async function setupVideoSongArmed(song: {
    id: string
    title: string
    items: SongItem[]
    title_translations?: Record<string, string>
    intro?: Record<string, string>
  }) {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    installLibrary([{
      ...song,
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }])
    // **The video is the room's, not the song's** (Jorge, 2026-09-03). `installRoom` above put a
    // `song-video` shape on the wall; this is what that shape plays for this song.
    installRoom({ assets: { [song.id]: { 'video-1': 'test.mp4' } } })
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
    // Since 3bff124, video display defaults to 'none' (Videoclip: None) — the performer must
    // explicitly opt in to Small/Big before the Projection window shows the video compositor
    // at all (see getDefaultDisplayMode in screenSizeState.ts). These A2.3 tests are about the
    // *video* projection path, so an explicit Small selection is part of their premise, not an
    // incidental detail: without it the video compositor never mounts and there is nothing to
    // assert against. Before 3bff124 the tests got this for free, because a song with media
    // defaulted to 'small'.
    //
    // This suite renders the Projection window alone, so seed the broadcast the Control window
    // would have written when the performer picked Small. Note it is the *selection* being
    // simulated, not merely Control having mounted — a mounted Control with no selection
    // broadcasts 'none', and these tests would still not see a video region.
    localStorage.setItem(KEY_DISPLAY_MODE_BROADCAST, 'small')
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(song.items)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(song.id)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'
  }

  it('shows the song title intro screen on arm for a video song (small/big display mode)', async () => {
    await setupVideoSongArmed({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Tragedia de cerdo asado')).toBeTruthy()
  })

  it('shows translated title and tagline on the video intro screen', async () => {
    await setupVideoSongArmed({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
      title_translations: { en: 'Tragedy of Roasted Pig' },
      intro: { en: 'Fight your destiny.' },
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.getByText('Tragedy of Roasted Pig')).toBeTruthy()
    expect(screen.getByText('Fight your destiny.')).toBeTruthy()
  })

  it('intro screen is still rendered inside the video projection-screen (not the non-video path)', async () => {
    await setupVideoSongArmed({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    // Three shapes, not one full frame with an overlay: the media in its own, the title card in
    // its own, and the lyric slot standing by.
    expect(screen.getByTestId('shape-video')).toBeTruthy()
    expect(document.querySelector('[data-shape-id="lyrics-1"]')).toBeTruthy()
  })

  it('intro screen disappears once a play transport command arrives (video starts)', async () => {
    const { VIDEO_TRANSPORT_KEY } = await import('./videoTransport')
    await setupVideoSongArmed({
      id: 'tragedia',
      title: 'Tragedia de cerdo asado',
      items: SONG_LINES,
    })
    render(<App initialHash="#/projection" />)
    simulateArm()

    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: VIDEO_TRANSPORT_KEY,
        newValue: JSON.stringify({ action: 'play', nonce: Date.now() }),
      }))
    })

    await waitFor(() => {
      expect(screen.queryByTestId('song-intro-screen')).toBeNull()
    }, { timeout: WAIT_TIMEOUT })
  })
})

describe('The wall is dark when there is no gig', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    // Deliberately no installRoom(): no gig folder is open.
  })

  /**
   * **No gig folder open means there is nothing to project.** Every gig has a `visuals.json` and
   * there is no fallback path; the full-frame renderer that used to serve this case is gone, and
   * keeping it alive to serve it would have meant a second rendering path exercised only on the
   * night it mattered. Dark is the answer, and it is the same empty-state model as a shape whose
   * song is not playing.
   */
  it('paints no lyric at all with no gig folder open', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    dispatchStorageUpdate()
    await flushEffects()

    expect(screen.queryByText('Hello')).toBeNull()
    expect(document.querySelector('.shape-root')).toBeNull()
    expect(screen.getByTestId('projection-screen')).toBeTruthy()
  })

  it('goes dark the moment the gig is closed, without a reload', async () => {
    installRoom()
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    dispatchStorageUpdate()
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy(), { timeout: 3000 })

    closeRoom()
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: KEY_VISUALS_BROADCAST, newValue: null })
      )
    })

    expect(screen.queryByText('Hello')).toBeNull()
    expect(document.querySelector('.shape-root')).toBeNull()
  })
})

describe('The lookup lights a set of shapes, and never caps it at one', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  async function showFirstLyric() {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()
    await waitFor(() => expect(screen.getAllByText('Hello').length).toBeGreaterThan(0), {
      timeout: 3000,
    })
  }

  /**
   * Two shapes showing the same lyric is how a corner or a pillar gets spanned, and how an
   * original sits beside its translation. Muralista's authoring UI offers one shape per type
   * today, so real files contain sets of size one naturally — and **no code may depend on that**.
   */
  it('lights every lyrics shape the gig assigns, not the first one', async () => {
    installRoom({
      shapes: [
        shape('wall-left', 'song-lyrics', [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]),
        shape('wall-right', 'song-lyrics', [[0.5, 0], [1, 0], [1, 1], [0.5, 1]]),
      ],
      defaults: { 'song-lyrics': ['wall-left', 'wall-right'] },
    })
    await showFirstLyric()

    expect(screen.getAllByText('Hello')).toHaveLength(2)
    expect(document.querySelector('[data-shape-id="wall-left"]')).toBeTruthy()
    expect(document.querySelector('[data-shape-id="wall-right"]')).toBeTruthy()
  })

  it('prefers a song’s own reassignment over the gig-level shape', async () => {
    installRoom({
      shapes: [
        shape('house', 'song-lyrics'),
        shape('panel', 'song-lyrics', [[0, 0], [0.4, 0], [0.4, 0.4], [0, 0.4]]),
      ],
      defaults: { 'song-lyrics': ['house'] },
      songs: { test: { 'song-lyrics': ['panel'] } },
    })
    await showFirstLyric()

    expect(document.querySelector('[data-shape-id="panel"]')).toBeTruthy()
    // A shape the playing song does not point at is dark. Nothing declares it empty.
    expect(document.querySelector('[data-shape-id="house"]')).toBeNull()
  })

  it('paints in the file’s own order, because list order is paint order', async () => {
    installRoom({
      shapes: [
        shape('under', 'song-lyrics'),
        shape('over', 'song-lyrics'),
      ],
      defaults: { 'song-lyrics': ['over', 'under'] },
    })
    await showFirstLyric()

    const painted = [...document.querySelectorAll('[data-shape-id]')].map(
      (el) => (el as HTMLElement).dataset.shapeId
    )
    // The assignment lists `over` first; the wall's z-order is the shape list's, not the
    // assignment's, so `over` is still painted last and therefore on top.
    expect(painted).toEqual(['under', 'over'])
  })

  it('skips a shape whose corners are degenerate rather than painting a guess', async () => {
    installRoom({
      shapes: [
        shape('good', 'song-lyrics'),
        shape('collinear', 'song-lyrics', [[0, 0], [0.5, 0], [1, 0], [0.5, 0]]),
      ],
      defaults: { 'song-lyrics': ['good', 'collinear'] },
    })
    await showFirstLyric()

    expect(document.querySelector('[data-shape-id="good"]')).toBeTruthy()
    expect(document.querySelector('[data-shape-id="collinear"]')).toBeNull()
  })
})

describe('The matrix is derived at the real output size, every render', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    installRoom()
  })

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true })
  })

  /**
   * The projector at a venue is not the display the room was mapped on. A matrix cached across a
   * resize or a display change renders perfectly and lands in the wrong place, with nothing
   * crashing and nothing warning — which is why this is asserted against the real numbers rather
   * than against "it re-rendered".
   */
  it('recomputes the warp when the window changes size', async () => {
    const { frameMatrix3d } = await import('./vendor/warp.js')
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    dispatchStorageUpdate()
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy(), { timeout: 3000 })

    const wrapperOf = (id: string) =>
      (document.querySelector(`[data-shape-id="${id}"] .shape-wrapper`) as HTMLElement).style
        .transform

    expect(wrapperOf('lyrics-1')).toBe(frameMatrix3d(FULL_FRAME, 1024, 768))

    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 1080, configurable: true })
    await act(async () => {
      window.dispatchEvent(new Event('resize'))
    })

    expect(wrapperOf('lyrics-1')).toBe(frameMatrix3d(FULL_FRAME, 1920, 1080))
  })
})

describe('In Video mode the video is the clock, and the lyric is in another shape', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    // **The video is assigned by the room now**, so the default room's `song-video` shape gets
    // the name this song plays. The song itself declares nothing.
    installRoom({ assets: { tragedia: { 'video-1': 'test.mp4' } } })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * The two are separate shapes now — `song-lyrics` and `song-video` are two types, not one "main"
   * slot — so the subtitle no longer rides on the video element that produced its timing. The
   * element's own `currentTime` still decides which line is showing: it is where lyrics landing on
   * the beat lives, and putting a process boundary between the clock and the pixels is the thing
   * the whole architecture is arranged to avoid.
   */
  it('shows the cue the video’s own clock resolves to, in the lyrics shape', async () => {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    const LINES: SongItem[] = [
      { languages: { es: 'Hola', en: 'Hello' } },
      { languages: { es: 'Mundo', en: 'World' } },
    ]
    installLibrary([
      {
        id: 'tragedia',
        title: 'Tragedia',
        items: LINES,
        timeline: [
          { start: 0, end: 2 },
          { start: 2, end: 4 },
        ],
      },
    ])
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/test.mp4' }))
    localStorage.setItem(KEY_DISPLAY_MODE_BROADCAST, 'small')
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('tragedia')
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'

    let now = 2.5
    Object.defineProperty(HTMLVideoElement.prototype, 'currentTime', {
      get: () => now,
      set: () => {},
      configurable: true,
    })
    HTMLVideoElement.prototype.play = vi.fn(() => Promise.resolve())
    HTMLVideoElement.prototype.pause = vi.fn()

    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()

    const { VIDEO_TRANSPORT_KEY } = await import('./videoTransport')
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: VIDEO_TRANSPORT_KEY,
          newValue: JSON.stringify({ action: 'play', nonce: Date.now() }),
        })
      )
    })

    const video = document.querySelector('video') as HTMLVideoElement
    await act(async () => { video.dispatchEvent(new Event('timeupdate')) })

    const lyricShape = document.querySelector('[data-shape-id="lyrics-1"]') as HTMLElement
    expect(lyricShape.textContent).toBe('World')
    // The video is in its own shape, and the lyric is not inside it.
    const videoShape = document.querySelector('[data-shape-id="video-1"]') as HTMLElement
    expect(videoShape.contains(video)).toBe(true)
    expect(videoShape.textContent).toBe('')

    now = 0.5
    await act(async () => { video.dispatchEvent(new Event('timeupdate')) })
    expect(lyricShape.textContent).toBe('Hello')
  })

  it('does not mount a video at all when the gig has no shape to put it in', async () => {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    installRoom({
      shapes: [shape('lyrics-only', 'song-lyrics')],
      defaults: { 'song-lyrics': ['lyrics-only'] },
    })
    installLibrary([
      {
        id: 'tragedia',
        title: 'Tragedia',
        items: TWO_LINES,
        timeline: [{ start: 0, end: 2 }],
      },
    ])
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/test.mp4' }))
    localStorage.setItem(KEY_DISPLAY_MODE_BROADCAST, 'small')
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('tragedia')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy(), { timeout: 3000 })

    // A shape is a place that can hold content. With no `song-video` shape there is no place, so
    // there is no video — and the lyrics fall back to the performer's own navigation.
    expect(document.querySelector('video')).toBeNull()
  })
})

describe('Typed shapes drive what appears where', () => {
  const SONG = {
    id: 'tragedia',
    title: 'Tragedia de cerdo asado',
    items: TWO_LINES,
    title_translations: { en: 'Tragedy of Roasted Pig' },
    intro: { en: 'A pig, a fire, and a family.' },
  }

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  async function arm(songId = SONG.id) {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(songId)
    setProjectionLanguage('en')
    setSingingLanguage('es')
    window.location.hash = '#/projection'
    render(<App initialHash="#/projection" />)
    simulateArm()
    await flushEffects()
  }

  function inShape(shapeId: string): HTMLElement | null {
    return document.querySelector(`[data-shape-id="${shapeId}"]`)
  }

  it('puts the title card in the song-intro shapes and the lyric in the song-lyrics shapes', async () => {
    installRoom()
    installLibrary([SONG])
    await arm()

    // `song-lyrics` and `song-video` are two types, not one "main" slot, and `song-intro` is a
    // third: the intro is not a mode the lyric slot goes into.
    expect(inShape('intro-1')!.contains(screen.getByTestId('song-intro-screen'))).toBe(true)
    expect(inShape('lyrics-1')!.querySelector('.layer-intro')).toBeNull()

    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy(), { timeout: 3000 })
    expect(inShape('lyrics-1')!.textContent).toContain('Hello')
  })

  it('lights every intro shape the gig assigns, not just the first', async () => {
    installRoom({
      shapes: [
        shape('panel-a', 'song-intro'),
        shape('panel-b', 'song-intro', [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]]),
      ],
      defaults: { 'song-intro': ['panel-a', 'panel-b'] },
    })
    installLibrary([SONG])
    await arm()
    expect(screen.getAllByTestId('song-intro-screen')).toHaveLength(2)
  })

  it('shows no title card at all when the gig has no shape to put one in', async () => {
    // Absence is the empty state. Nothing is declared empty and nothing falls back to a full
    // frame — a shape is a place that can hold content, and there is no place.
    installRoom({
      shapes: [shape('lyrics-only', 'song-lyrics')],
      defaults: { 'song-lyrics': ['lyrics-only'] },
    })
    installLibrary([SONG])
    await arm()
    expect(screen.queryByTestId('song-intro-screen')).toBeNull()
  })

  it('leaves a shape dark when the playing song points at a different one', async () => {
    installRoom({
      shapes: [shape('for-tragedia', 'song-intro'), shape('for-vidas', 'song-intro')],
      defaults: {},
      songs: {
        tragedia: { 'song-intro': ['for-tragedia'] },
        vidas: { 'song-intro': ['for-vidas'] },
      },
    })
    installLibrary([SONG])
    await arm()
    expect(inShape('for-tragedia')).toBeTruthy()
    // Not blacked out, not declared empty — simply not there.
    expect(inShape('for-vidas')).toBeNull()
  })
})

describe('Shapes Pregonero does not coordinate', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  async function mountProjection() {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'
    render(<App initialHash="#/projection" />)
    await flushEffects()
  }

  /**
   * A logo, or any number of pictures, up from power-up to teardown. **There is no `logo` case in
   * Pregonero and there must not be one**: the test for being coordinated is not "is it on the
   * wall" but "does Pregonero decide when it appears", and here the answer is no. They are on
   * because the projector is on — before any arm, during a song, and after.
   */
  it('paints a static shape with nothing armed, and keeps painting it once a song starts', async () => {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'logo.png': '/media/logo.png' }))
    installRoom({
      shapes: [
        shape('corner-logo', 'image', FULL_FRAME, { layer: { type: 'image', src: 'logo.png' } }),
        shape('lyrics-1', 'song-lyrics'),
      ],
      defaults: { 'song-lyrics': ['lyrics-1'] },
    })
    await mountProjection()

    expect(screen.getByTestId('shape-static-corner-logo')).toBeTruthy()

    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy(), { timeout: 3000 })

    expect(screen.getByTestId('shape-static-corner-logo')).toBeTruthy()
  })

  it('paints a fill, which is the wall’s black and not content', async () => {
    installRoom({
      shapes: [shape('keepout', 'fill', FULL_FRAME, { layer: { type: 'fill', color: '#000000' } })],
      defaults: {},
    })
    await mountProjection()
    expect(screen.getByTestId('shape-fill-keepout')).toBeTruthy()
  })

  it('paints nothing at all for a test pattern', async () => {
    // `pattern` is Muralista's default for a new shape and its fallback for a layer this build
    // does not know. It is an authoring aid, and one on a wall at a gig would be a bug that looks
    // like a feature.
    installRoom({
      shapes: [shape('untouched', 'pattern'), shape('mystery', 'something-new')],
      defaults: {},
    })
    await mountProjection()
    expect(document.querySelector('[data-shape-id="untouched"]')).toBeNull()
    expect(document.querySelector('[data-shape-id="mystery"]')).toBeNull()
  })

  it('respects a shape hidden in Muralista', async () => {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'logo.png': '/media/logo.png' }))
    installRoom({
      shapes: [
        shape('hidden-logo', 'image', FULL_FRAME, {
          layer: { type: 'image', src: 'logo.png' },
          visible: false,
        }),
      ],
      defaults: {},
    })
    await mountProjection()
    expect(document.querySelector('[data-shape-id="hidden-logo"]')).toBeNull()
  })
})

describe('The contact panel, and what it replaced', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  const CONTACT_SHAPE = shape('contact-1', 'gig-contact', FULL_FRAME, {
    layer: { type: 'gig-contact', text: 'changopepper.be' },
  })

  async function mountProjection(songId = 'test') {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId(songId)
    setProjectionLanguage('en')
    window.location.hash = '#/projection'
    render(<App initialHash="#/projection" />)
    await flushEffects()
  }

  it('is lit when nothing is armed — the wall carries his details from power-up', async () => {
    installRoom({
      shapes: [CONTACT_SHAPE, shape('lyrics-1', 'song-lyrics')],
      defaults: { 'gig-contact': ['contact-1'], 'song-lyrics': ['lyrics-1'] },
    })
    await mountProjection()
    expect(screen.getByTestId('gig-contact-panel')).toBeTruthy()
    expect(screen.getByText('changopepper.be')).toBeTruthy()
  })

  it('goes dark when the Control window says the condition is false', async () => {
    installRoom({
      shapes: [CONTACT_SHAPE],
      defaults: { 'gig-contact': ['contact-1'] },
    })
    await mountProjection()
    expect(screen.getByTestId('gig-contact-panel')).toBeTruthy()

    const { KEY_CONTACT_LIT_BROADCAST } = await import('./gigContactState')
    localStorage.setItem(KEY_CONTACT_LIT_BROADCAST, '0')
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: KEY_CONTACT_LIT_BROADCAST, newValue: '0' })
      )
    })

    // Not blacked out and not declared empty — simply not there, like every other unlit shape.
    expect(screen.queryByTestId('gig-contact-panel')).toBeNull()
    expect(document.querySelector('[data-shape-id="contact-1"]')).toBeNull()
  })

  it('is a gig-level fact: a per-song reassignment of it is not honoured', async () => {
    installRoom({
      shapes: [CONTACT_SHAPE, shape('contact-2', 'gig-contact')],
      defaults: { 'gig-contact': ['contact-1'] },
      songs: { test: { 'gig-contact': ['contact-2'] } },
    })
    await mountProjection()
    // It is defined once at gig visual setup, which is why the type is not called `song-contact`.
    expect(document.querySelector('[data-shape-id="contact-1"]')).toBeTruthy()
    expect(document.querySelector('[data-shape-id="contact-2"]')).toBeNull()
  })

  it('lights every contact shape the gig names, not just the first', async () => {
    installRoom({
      shapes: [
        CONTACT_SHAPE,
        shape('contact-2', 'gig-contact', [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]], {
          layer: { type: 'gig-contact', text: 'changopepper.be' },
        }),
      ],
      defaults: { 'gig-contact': ['contact-1', 'contact-2'] },
    })
    await mountProjection()
    expect(screen.getAllByTestId('gig-contact-panel')).toHaveLength(2)
  })

  /**
   * The two fallbacks the contact panel replaces. Both existed to put *something* on the wall when
   * no song was presenting, which is what a `gig-contact` shape does properly — tuned to the room
   * instead of read from a text file. Neither may come back.
   */
  it('has no end card and no logo fallback left anywhere', async () => {
    installRoom({
      shapes: [CONTACT_SHAPE, shape('lyrics-1', 'song-lyrics')],
      defaults: { 'gig-contact': ['contact-1'], 'song-lyrics': ['lyrics-1'] },
    })
    // The key the end card used to watch. Nothing reads it now, and setting it changes nothing.
    localStorage.setItem('liveLyricEndCardVisible', '1')
    await mountProjection()
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'liveLyricEndCardVisible', newValue: '1' })
      )
    })

    expect(screen.queryByTestId('end-card-screen')).toBeNull()
    expect(document.querySelector('.projection-end-card-screen')).toBeNull()
    expect(document.querySelector('img[aria-hidden="true"]')).toBeNull()
    // And the wall still has something on it, because the contact shape is what carries it now.
    expect(screen.getByTestId('gig-contact-panel')).toBeTruthy()
  })
})

