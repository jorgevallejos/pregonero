/** @vitest-environment jsdom */
/**
 * **THE FRAME REACHES THE MACHINE THROUGH ITS EMBEDDER, AND THAT IS THE WHOLE ARRANGEMENT.**
 *
 * Measured on this app's own scheme before it was built (2026-09-06): a same-origin frame's
 * `window.parent.electronAPI.ping()` answers `pong-from-main-process`. **So the sixteen forwarded
 * calls a bridge would have carried do not get cheaper — they never exist.**
 *
 * **And it cannot leak to the vendored tools.** `nodeIntegrationInSubFrames` looks like the way to
 * give a frame the bridge and is the wrong one: the same spike measured it handing `electronAPI` to
 * **cross-origin** frames too, which means Bombista's and Muralista's pages. **The `parent` route
 * needs no flag and cannot leak, because the browser refuses a cross-origin frame access to its
 * parent at all** — `SecurityError`, recorded in every cross-origin case of the spike, with the
 * flag and without it.
 *
 * That refusal is a **throw**, which is why the read is wrapped: the `try` is the mechanism this
 * relies on, not a case it works around.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { bridge, isFramed } from './bridge'

const w = window as unknown as { electronAPI?: unknown; parent: unknown }
const realParent = window.parent

afterEach(() => {
  delete w.electronAPI
  Object.defineProperty(window, 'parent', { value: realParent, configurable: true, writable: true })
})

function setParent(value: unknown) {
  Object.defineProperty(window, 'parent', { value, configurable: true, writable: true })
}

describe('reaching the machine', () => {
  it('uses its own preload when it has one — the top-level window', () => {
    const own = { openProjection: () => Promise.resolve() }
    w.electronAPI = own
    expect(bridge()).toBe(own)
  })

  it('reaches the embedder’s when it has none — a same-origin frame', () => {
    const parents = { electronAPI: { openProjection: () => Promise.resolve() } }
    setParent(parents)
    expect(bridge()).toBe(parents.electronAPI)
  })

  it('prefers its own, so the top-level window never reads through itself', () => {
    const own = { openProjection: () => Promise.resolve() }
    w.electronAPI = own
    setParent({ electronAPI: { openProjection: () => Promise.resolve() } })
    expect(bridge()).toBe(own)
  })

  it('answers undefined in a browser, where there is no bridge anywhere', () => {
    setParent({})
    expect(bridge()).toBeUndefined()
  })

  /**
   * **The guarantee, and it arrives as a throw.** A cross-origin frame reading `parent.electronAPI`
   * gets `SecurityError` from the browser — so Bombista's and Muralista's pages cannot reach it,
   * and no flag or allow-list is doing that work.
   */
  it('answers undefined rather than throwing when the parent is cross-origin', () => {
    setParent({
      get electronAPI(): unknown {
        throw new DOMException('Blocked a frame with origin … from accessing a cross-origin frame.')
      },
    })
    expect(() => bridge()).not.toThrow()
    expect(bridge()).toBeUndefined()
  })

  it('does not reach for a parent that is itself', () => {
    setParent(window)
    expect(bridge()).toBeUndefined()
    expect(isFramed()).toBe(false)
  })

  it('knows it is framed when the parent is another window', () => {
    setParent({})
    expect(isFramed()).toBe(true)
  })
})
