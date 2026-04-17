/** @vitest-environment jsdom */
/**
 * Projection screen: shows only the current translated lyric line.
 * It must NOT show a next-line preview (preview is on the performance control screen only).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { act, render, screen, waitFor, cleanup } from '@testing-library/react'
import App from './App'
import {
  setSongLines,
  setSongIndex,
  setBlank,
  setCurrentSongId,
  setProjectionLanguage,
} from './songState'
import type { SongItem } from './songState'
import { createInitialSnapshot, saveSetlistStore } from './setlistStore'

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

describe('Projection screen', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
    sessionStorage.clear()
    window.location.hash = '#/'
  })

  it('shows only the current translated lyric line (no next-line preview)', async () => {
    setupProjectionStorage(TWO_LINES, 0, false)
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    })

    expect(getProjectionNextPreview()).toBeNull()
  })

  it('does not show control performance timer/status button UI on projection screen', async () => {
    setupProjectionStorage(TWO_LINES, 0, false)
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    })

    expect(screen.queryByTestId('performance-status-button')).toBeNull()
    expect(screen.queryByText(/^Min \d+$/)).toBeNull()
  })

  it('does not show any next-line preview when on last line', async () => {
    setupProjectionStorage(TWO_LINES, 1, false)
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(screen.getByText('World')).toBeTruthy()
    })

    expect(getProjectionNextPreview()).toBeNull()
  })

  it('shows only current lyric when a section marker follows (no preview)', async () => {
    setupProjectionStorage(LINES_WITH_SECTION, 0, false)
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(screen.getByText('First')).toBeTruthy()
    })

    expect(getProjectionNextPreview()).toBeNull()
  })

  it('respects newline characters inside a single lyric phrase (manual line breaks)', async () => {
    setupProjectionStorage(PHRASE_WITH_MANUAL_BREAKS, 0, false)
    render(<App initialHash="#/projection" />)

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
      0,
      false
    )
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(document.querySelector('.projection-lyric')?.textContent).toBe('Line one\n\nLine two')
    })
  })

  /** Full-opacity dwell before auto fade-out (must match ProjectionView AUTO_FADE_MS). */
  const PHRASE_FULL_OPACITY_MS = 6000

  it('keeps the current lyric at full opacity until the phrase display duration elapses, then starts fade-out', async () => {
    vi.useFakeTimers()
    try {
      setupProjectionStorage(TWO_LINES, 0, false)
      render(<App initialHash="#/projection" />)

      await act(async () => {
        await Promise.resolve()
      })
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
    setSongIndex(0)
    setBlank(false)
    setCurrentSongId('test')
    setProjectionLanguage('en')
    window.location.hash = '#/projection'
    render(<App initialHash="#/projection" />)

    await waitFor(() => {
      expect(screen.getByText('One')).toBeTruthy()
    })

    setProjectionLanguage('fr')
    setSongIndex(-1)
    setBlank(true)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

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

    setSongIndex(0)
    setBlank(false)
    window.dispatchEvent(new StorageEvent('storage', { key: null, newValue: null }))

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeTruthy()
    })
  })
})
