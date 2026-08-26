/**
 * The context bridge exposed by `electron/preload.cjs`. Absent when the renderer runs outside
 * Electron (the Vite dev server in a plain browser, and jsdom in tests), so every caller must
 * handle `undefined`.
 */
declare global {
  interface Window {
    electronAPI?: {
      openProjection: () => Promise<void>
      closeProjection: () => Promise<void>
      isProjectionOpen: () => Promise<boolean>
      onProjectionOpened: (cb: () => void) => () => void
      onProjectionClosed: (cb: () => void) => () => void
      openFileDialog: () => Promise<string | null>
      getFileStats: (filePath: string) => Promise<{ exists: boolean; size: number }>
      /** Native picker for song files in `songs/`. Resolves to absolute paths, or [] if cancelled. */
      openSongFileDialog: () => Promise<string[]>
      /** Reads a song file's text. Never throws across the bridge — failures come back as `ok: false`. */
      readSongFile: (
        filePath: string
      ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
    }
  }
}

export {}
