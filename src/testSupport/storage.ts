/**
 * A `Storage` for tests, and the guard that installs one only when it is needed.
 *
 * jsdom provides `localStorage`, but not in every environment this suite runs in, and where it is
 * missing the symptom is `localStorage.clear is not a function` in a `beforeEach` — a failure that
 * says nothing about the test. `gigSession.test.ts` grew this guard first; it is here so the next
 * file that needs it copies a pointer rather than the implementation.
 */
import { vi } from 'vitest'

export function createStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }
}

/**
 * Installs a working `localStorage` and `sessionStorage` when this environment lacks one.
 *
 * Call from `beforeAll`. It leaves a real implementation alone, so a test that relies on jsdom's
 * own storage behaviour is unaffected.
 */
export function ensureStorage(): void {
  if (
    typeof globalThis.localStorage === 'undefined' ||
    typeof globalThis.localStorage.clear !== 'function'
  ) {
    vi.stubGlobal('localStorage', createStorage())
  }
  if (
    typeof globalThis.sessionStorage === 'undefined' ||
    typeof globalThis.sessionStorage.clear !== 'function'
  ) {
    vi.stubGlobal('sessionStorage', createStorage())
  }
}
