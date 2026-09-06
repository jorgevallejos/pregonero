/**
 * **THE ONE WAY TO THE MACHINE, AND IT WORKS FROM INSIDE A FRAME.**
 *
 * A framed page gets **no preload of its own** — this app withholds it from Bombista's and
 * Muralista's pages on purpose, and Electron gives it to a subframe only behind
 * `nodeIntegrationInSubFrames`, which the spike of 2026-09-06 measured **handing `electronAPI` to
 * cross-origin frames as well.** That flag would leak the bridge to both vendored tools.
 *
 * **A same-origin frame needs no flag: it reaches its embedder's window directly.** Measured on
 * this app's own scheme — `tramoya://app` — a frame's `window.parent.electronAPI.ping()` answers
 * `pong-from-main-process`. **And it cannot leak**, because the browser refuses a cross-origin
 * frame access to its parent at all: the same spike recorded `SecurityError` for every
 * cross-origin case, with and without the flag.
 *
 * **So the sixteen forwarded calls a bridge would have carried do not get cheaper — they never
 * exist.** This function is the whole of the arrangement.
 *
 * The `try` is not defensive decoration: reading `parent.electronAPI` across origins **throws**,
 * and that is the mechanism this relies on rather than a case it works around.
 */
/** The bridge's shape is declared on `Window` in `electronApi.d.ts`; this is that type. */
export type Bridge = NonNullable<Window['electronAPI']>

export function bridge(): Bridge | undefined {
  if (typeof window === 'undefined') return undefined
  if (window.electronAPI) return window.electronAPI
  try {
    if (window.parent && window.parent !== window) return window.parent.electronAPI
  } catch {
    /* cross-origin parent: the browser refuses, which is the guarantee and not a failure */
  }
  return undefined
}

/** Whether this page is running inside a frame at all. */
export function isFramed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.parent !== window
  } catch {
    return true
  }
}

/**
 * **The player asking the shell to open one of its rooms.**
 *
 * Backstage, the song flow, the gig flow and Preferences are the shell's, and the player reaches
 * them from three places: `Setup` on Standby, and two doors on the setlist screen. Framed, setting
 * this page's own hash would move the frame and leave the shell where it was — so the address that
 * changes is the embedder's.
 *
 * **Same-origin, so it is one assignment and not a message.** Unframed it is the page's own hash,
 * which is what the app did before the player had a page of its own.
 */
export function goToShellRoom(hash: string): void {
  if (typeof window === 'undefined') return
  try {
    if (window.parent && window.parent !== window) {
      window.parent.location.hash = hash
      return
    }
  } catch {
    /* a cross-origin embedder cannot be navigated, and the player is never framed by one */
  }
  window.location.hash = hash
}
