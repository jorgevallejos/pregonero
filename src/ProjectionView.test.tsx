/** @vitest-environment jsdom */
/**
 * Projection screen: shows only the current translated lyric line.
 * It must NOT show a next-line preview (preview is on the performance control screen only).
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import App from './App'
import {
  setSongLines,
  setSongIndex,
  setBlank,
  setCurrentSongId,
  setProjectionLanguage,
} from './songState'
import type { SongItem } from './songState'

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
  vi.stubGlobal('WebSocket', vi.fn().mockImplementation(() => ({
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
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

function setupProjectionStorage(lines: SongItem[], index: number, blank: boolean) {
  sessionStorage.setItem('liveLyricLaunched', '1')
  setSongLines(lines)
  setSongIndex(index)
  setBlank(blank)
  setCurrentSongId('test')
  setProjectionLanguage('en')
  window.location.hash = '#/projection'
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
})
