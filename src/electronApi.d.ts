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

/**
 * The displays this machine has. **A fingerprint to compare, never a value to render from** — the
 * output size is a parameter passed on every render, and nothing here weakens that.
 */
export type DisplayDescription = {
  count: number
  displays: {
    id: string
    width: number
    height: number
    scaleFactor: number
    internal: boolean
    primary: boolean
  }[]
  fingerprint: string
}

/**
 * What one Bombista run came back with. `skipped` means the binary was not there or did not
 * answer — **never a reason to stop being able to perform.**
 */
export type BombistaResult = {
  status: 'ok' | 'failed' | 'skipped'
  output: string
  code: number | null
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
      openFileDialog: (kind?: 'video' | 'audio' | 'json') => Promise<string | null>
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
      /** Runs one Bombista subcommand. A song file path, never a gig. */
      runBombista: (subcommand: string, args: string[]) => Promise<BombistaResult>
      bombistaVersion: () => Promise<{ present: boolean; version: string | null }>
      bombistaStagingDir: (
        songId: string
      ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
      /** Starts `bombista serve` and opens a window on the address it prints. */
      openBombistaReview: (
        args: string[]
      ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
      /** Opens a tool's page in a window of its own, over localhost. */
      openTool: (
        key: string,
        folder: string,
        page: string,
        title: string
      ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
      closeTool: (key: string) => Promise<void>
      isToolOpen: (key: string) => Promise<boolean>
      /** What displays this machine has. Read-only — nothing renders from it. */
      describeDisplays: () => Promise<DisplayDescription>
      /** `bombista validate --for-performance`. A missing binary comes back as `skipped`. */
      validateSongForPerformance: (songPath: string) => Promise<SongValidationResult>
    }
  }
}

export {}
