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
import { createInitialSnapshot, saveSetlistStore } from './setlistStore'
import { KEY_ARMED_BROADCAST } from './performanceState'
import { KEY_END_CARD_VISIBLE } from './endCardState'

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
  saveSetlistStore(createInitialSnapshot([song]))
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

      const lyric = screen.getByText('Hello')
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
  saveSetlistStore(createInitialSnapshot([song]))
  sessionStorage.setItem('liveLyricLaunched', '1')
  setSongLines(song.items)
  setSongIndex(-1)
  setBlank(true)
  setCurrentSongId(song.id)
  setProjectionLanguage('en')
  setSingingLanguage('es')
  window.location.hash = '#/projection'
}

describe('Projection lifecycle: logo on mount, intro on arm', () => {
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
  })

  it('shows the logo when mounted mid-song (index 3), not the current lyric', async () => {
    saveSetlistStore(createInitialSnapshot([PERF_SONG]))
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

    expect(screen.queryByText('L4')).toBeNull()
    const logo = document.querySelector('img[aria-hidden="true"]') as HTMLElement
    expect(logo).toBeTruthy()
    expect(logo.style.opacity).toBe('1')
  })

  it('shows intro screen after arm transition (non-armed to armed)', async () => {
    saveSetlistStore(createInitialSnapshot([PERF_SONG]))
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

  it('shows first lyric after arm transition followed by advancing to index 0', async () => {
    saveSetlistStore(createInitialSnapshot([PERF_SONG]))
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

  it('shows logo again after unmount and remount during performing', async () => {
    saveSetlistStore(createInitialSnapshot([PERF_SONG]))
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

    expect(screen.queryByText('Hello')).toBeNull()
    const logo = document.querySelector('img[aria-hidden="true"]') as HTMLElement
    expect(logo).toBeTruthy()
    expect(logo.style.opacity).toBe('1')
  })
})

describe('Song intro screen on projection (ARMED + index === -1)', () => {
  const WAIT_TIMEOUT = 3000

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
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
    expect(screen.getByText('(Tragedy of Roasted Pig)')).toBeTruthy()
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

describe('End card screen on projection', () => {
  const END_CARD_CONTENT = '# Thanks for listening\n\nChango Pepper'
  const WAIT_TIMEOUT = 3000

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      text: vi.fn().mockResolvedValue(END_CARD_CONTENT),
    }))
  })

  afterEach(() => {
    localStorage.removeItem(KEY_END_CARD_VISIBLE)
  })

  function setupProjectionWithEndCard() {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines(TWO_LINES)
    setSongIndex(-1)
    setBlank(true)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'
  }

  it('shows end-card screen when KEY_END_CARD_VISIBLE is set in localStorage', async () => {
    setupProjectionWithEndCard()
    render(<App initialHash="#/projection" />)

    localStorage.setItem(KEY_END_CARD_VISIBLE, '1')
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_END_CARD_VISIBLE, newValue: '1' }))

    await waitFor(() => {
      expect(screen.getByTestId('end-card-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
  })

  it('end-card screen renders the content from end-card.md', async () => {
    setupProjectionWithEndCard()
    render(<App initialHash="#/projection" />)

    localStorage.setItem(KEY_END_CARD_VISIBLE, '1')
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_END_CARD_VISIBLE, newValue: '1' }))

    await waitFor(() => {
      const screen_ = screen.getByTestId('end-card-screen')
      expect(screen_.textContent).toMatch(/Thanks for listening/)
      expect(screen_.textContent).toMatch(/Chango Pepper/)
    }, { timeout: WAIT_TIMEOUT })
  })

  it('hides end-card screen when KEY_END_CARD_VISIBLE is removed from localStorage', async () => {
    localStorage.setItem(KEY_END_CARD_VISIBLE, '1')
    setupProjectionWithEndCard()
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(screen.getByTestId('end-card-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    localStorage.removeItem(KEY_END_CARD_VISIBLE)
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_END_CARD_VISIBLE, newValue: null }))

    await waitFor(() => {
      expect(screen.queryByTestId('end-card-screen')).toBeNull()
    }, { timeout: WAIT_TIMEOUT })
  })

  it('normal lyric content is not shown while end-card is active', async () => {
    setupProjectionWithEndCard()
    render(<App initialHash="#/projection" />)
    await flushEffects()
    simulateArm()
    await flushEffects()
    setSongIndex(0)
    setBlank(false)
    dispatchStorageUpdate()

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })

    localStorage.setItem(KEY_END_CARD_VISIBLE, '1')
    window.dispatchEvent(new StorageEvent('storage', { key: KEY_END_CARD_VISIBLE, newValue: '1' }))

    await waitFor(() => {
      expect(screen.getByTestId('end-card-screen')).toBeTruthy()
    }, { timeout: WAIT_TIMEOUT })
    expect(screen.queryByText('Hello')).toBeNull()
  })
})

describe('Non-video projection layout (regression guard: centered full-screen, no split)', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  /**
   * Non-video intro screen: the projection-animation-region / projection-subtitle-band
   * split must NOT appear. Everything should render inside a single centered projection-screen
   * (no split div structure).
   */
  it('non-video intro screen does NOT use the animation-region/subtitle-band split layout', async () => {
    const { saveSetlistStore, createInitialSnapshot } = await import('./setlistStore')
    saveSetlistStore(createInitialSnapshot([{
      id: 'no-video-song',
      title: 'No Video Song',
      items: [{ languages: { es: 'Hola', en: 'Hello' } }],
    }]))
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

    // Intro screen should appear
    await waitFor(() => {
      expect(screen.getByTestId('song-intro-screen')).toBeTruthy()
    }, { timeout: 3000 })

    // The split layout divs must NOT exist for a non-video song
    expect(document.querySelector('.projection-animation-region')).toBeNull()
    expect(document.querySelector('.projection-subtitle-band')).toBeNull()
  })

  /**
   * Non-video lyric phrase: the projection-animation-region / projection-subtitle-band
   * split must NOT appear. The lyric should be centered on the full screen.
   */
  it('non-video lyric does NOT use the animation-region/subtitle-band split layout', async () => {
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

    // The split layout divs must NOT exist for a non-video song
    expect(document.querySelector('.projection-animation-region')).toBeNull()
    expect(document.querySelector('.projection-subtitle-band')).toBeNull()
  })

  /**
   * Non-video projection-screen should use centered flex layout (alignItems: center,
   * justifyContent: center) — not a column-stacked split.
   */
  it('non-video projection-screen has centered flex layout (not column split)', async () => {
    sessionStorage.setItem('liveLyricLaunched', '1')
    setSongLines([{ languages: { es: 'Hola', en: 'Hello' } }])
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'

    render(<App initialHash="#/projection" />)
    simulateArm()
    await act(async () => { await Promise.resolve() })
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    }, { timeout: 3000 })

    const screen_ = document.querySelector('.projection-screen') as HTMLElement
    expect(screen_).toBeTruthy()
    // Should be centered (alignItems: center), not a column split
    expect(screen_.style.alignItems).toBe('center')
    expect(screen_.style.justifyContent).toBe('center')
  })
})

describe('A2.3 — intro screen shows in video mode too (over the pre-play black cover)', () => {
  const WAIT_TIMEOUT = 3000

  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  async function setupVideoSongArmed(song: {
    id: string
    title: string
    items: SongItem[]
    title_translations?: Record<string, string>
    intro?: Record<string, string>
  }) {
    const { MEDIA_PATH_STORE_KEY } = await import('./mediaPathStore')
    saveSetlistStore(createInitialSnapshot([{
      ...song,
      media: { type: 'video' as const, src: 'test.mp4' },
      timeline: [{ start: 0, end: 1 }, { start: 1, end: 2 }],
    }]))
    localStorage.setItem(MEDIA_PATH_STORE_KEY, JSON.stringify({ 'test.mp4': '/fake/path/test.mp4' }))
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
    expect(screen.getByText('(Tragedy of Roasted Pig)')).toBeTruthy()
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

    // Confirms we're in the video compositor path, not the centered non-video layout.
    expect(document.querySelector('.projection-animation-region')).toBeTruthy()
  })

  it('intro screen disappears once a play transport command arrives (video starts)', async () => {
    const { VIDEO_TRANSPORT_KEY } = await import('./VideoProjectionRegion')
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
