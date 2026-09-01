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

/**
 * **Where `bombista` was found, and everywhere that was looked.**
 *
 * `source` says which answer won: `configured` is the path preferences holds, taken verbatim;
 * `path` is the inherited `PATH`, which is the right answer when the app was launched from a
 * shell; `known-location` is where a Python CLI actually installs, which is the answer a
 * Finder-launched app needs because its `PATH` is `/usr/bin:/bin:/usr/sbin:/sbin`; `unresolved`
 * means nothing was found and the bare name is being used, so the failure downstream stays
 * `skipped` exactly as it was.
 */
export type BombistaLocation = {
  command: string
  source: 'configured' | 'path' | 'known-location' | 'unresolved'
  /** Every candidate looked at, so preferences can say where it looked. */
  searched: string[]
}

/**
 * Where the projection window went. **A sentence for a screen** — nothing renders from it, and the
 * output size stays a parameter passed on every render.
 */
export type ProjectorPlacement = {
  placed: boolean
  /** Why it was not placed. Null when it was. */
  reason: string | null
  /** The display it went to, as `WxH`. Null when it was not placed. */
  display: string | null
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
      /** Where the projection window went, and why. */
      projectionPlacement: () => Promise<ProjectorPlacement>
      onProjectionOpened: (cb: () => void) => () => void
      onProjectionClosed: (cb: () => void) => () => void
      openFileDialog: (
        kind?: 'video' | 'audio' | 'json' | 'lyrics',
        /** Where the dialog opens. Remembered per picker in the renderer. */
        defaultPath?: string
      ) => Promise<string | null>
      getFileStats: (filePath: string) => Promise<{ exists: boolean; size: number }>
      /** Native picker for song files. Resolves to absolute paths, or [] if cancelled. */
      openSongFileDialog: (defaultPath?: string) => Promise<string[]>
      /** Reads a song file's text. Never throws across the bridge — failures come back as `ok: false`. */
      readSongFile: (
        filePath: string
      ) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
      /** Native directory picker for the gig folder. Resolves to an absolute path, or null if cancelled. */
      openGigFolderDialog: (defaultPath?: string) => Promise<string | null>
      /** Native directory picker for the songs root, the gigs root and the media folder. */
      openFolderDialog: (title?: string, defaultPath?: string) => Promise<string | null>
      /**
       * One read of the folder the machine's two files are in — `<gig>/setup`, joined by the
       * renderer: `gig.json` plus the file its `visuals` pointer names, beside it.
       */
      readGigFolder: (
        folderPath: string,
        visualsPointer?: string
      ) => Promise<GigFolderRead>
      /**
       * Makes a gig's folder under the gigs root. **A name, never a path** — picking a folder is
       * the import path now. Refuses a name that is not one folder segment, and refuses to create
       * over something that is already there.
       */
      createGigFolder: (
        gigsRoot: string,
        name: string
      ) => Promise<{ ok: true; folderPath: string } | { ok: false; error: string }>
      /**
       * Writes `gig.json` into the folder it is handed, making that folder if it is not there.
       * Pregonero is its only writer, so there is nothing to merge.
       */
      writeGigFile: (
        folderPath: string,
        text: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      /** Writes `debrief.md` at the gig folder's root. Pregonero writes it, then Jorge edits it. */
      writeDebriefFile: (
        folderPath: string,
        text: string
      ) => Promise<{ ok: true } | { ok: false; error: string }>
      /** Runs one Bombista subcommand. A song file path, never a gig. */
      runBombista: (
        subcommand: string,
        args: string[],
        bombistaPath: string | null
      ) => Promise<BombistaResult>
      bombistaVersion: (
        bombistaPath: string | null
      ) => Promise<{ present: boolean; version: string | null }>
      /** Where `bombista` was found, and everywhere that was looked. */
      locateBombista: (bombistaPath: string | null) => Promise<BombistaLocation>
      bombistaStagingDir: (
        songId: string
      ) => Promise<{ ok: true; path: string } | { ok: false; error: string }>
      /** Starts `bombista serve` and opens a window on the address it prints. */
      openBombistaReview: (
        args: string[],
        bombistaPath: string | null
      ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
      /** The song files in the songs folder, sorted. `songs/` is the source of truth. */
      /**
       * The song files in the folder it is handed — `<songs>/song-performance`, joined by the
       * renderer. A folder that is not there yet is `present: false` with no files and no problem;
       * only a folder that refuses to be read is `ok: false`.
       */
      listSongsFolder: (
        folderPath: string
      ) => Promise<
        { ok: true; present: boolean; files: string[] } | { ok: false; error: string }
      >
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
      validateSongForPerformance: (
        songPath: string,
        bombistaPath: string | null
      ) => Promise<SongValidationResult>
    }
  }
}

export {}
