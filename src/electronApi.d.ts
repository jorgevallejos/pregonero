/**
 * The context bridge exposed by `electron/preload.cjs`. Absent when the renderer runs outside
 * Electron (the Vite dev server in a plain browser, and jsdom in tests), so every caller must
 * handle `undefined`.
 */
/** What one read of the gig folder brings back. Absence is a `false`, never an error. */
export type GigFolderRead = {
  folderPath: string
  gigText: string | null
  gigError: string | null
  gigPresent: boolean
  visualsText: string | null
  visualsError: string | null
  visualsPresent: boolean
}

export type SongValidationResult =
  | { status: 'ok' }
  | { status: 'failed'; messages: string[] }
  | { status: 'skipped'; reason: string }

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
      /** Native directory picker for the gig folder. Resolves to an absolute path, or null if cancelled. */
      openGigFolderDialog: () => Promise<string | null>
      /** Native directory picker for the songs root and the media folder. Absolute path, or null. */
      openFolderDialog: (title?: string) => Promise<string | null>
      /** One read of the gig folder: `gig.json` plus the file its `visuals` pointer names. */
      readGigFolder: (
        folderPath: string,
        visualsPointer?: string
      ) => Promise<GigFolderRead>
      /** Writes `gig.json`. Pregonero is its only writer, so there is nothing to merge. */
      writeGigFile: (
        folderPath: string,
        text: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      /** Writes `debrief.md` into the gig folder. Pregonero writes it, then Jorge edits it. */
      writeDebriefFile: (
        folderPath: string,
        text: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      /** `bombista validate --for-performance`. A missing binary comes back as `skipped`. */
      validateSongForPerformance: (songPath: string) => Promise<SongValidationResult>
    }
  }
}

export {}
