/**
 * **One readiness function.** Given a gig folder it returns the delta: what is missing, per setup
 * step and per song. Everything in the app that sounds like it needs its own notion of validity is
 * a *rendering* of this, and **nothing else may form its own opinion about what "ready" means** —
 * a second implementation is the warp problem in a different costume.
 *
 * Four views were designed; this stage ships two of them. The hard gate at arm time and the report
 * when a gig is opened are here. The setup flow's per-step gating and the setup confirmation going
 * stale are round G, and they render this same delta.
 *
 * ## Three rules this function exists to keep
 *
 * **A per-step verdict, never a boolean.** The gig file exists from setup step 2 and is incomplete
 * for most of its life; that is the normal state, not a degraded one. A single pass/fail would make
 * a half-built gig unopenable, and therefore impossible to finish. **Absence of a later step's data
 * means *not yet*, never *broken*.** `broken` is reserved for the loud refusals — a file that will
 * not parse, a `visualsVersion` this build does not know, a mapping of a different room.
 *
 * **Derived from the files, never stored as progress.** "Step 3 is done" is not a flag, it is *the
 * visuals pointer resolves and carries the shapes the setlist needs*. Work happens outside
 * Pregonero — Muralista is fully usable standalone and is deliberately kept that way — so stored
 * progress diverges the moment it does, and diverges silently.
 *
 * **Setlist membership is not proof of playability.** It records that the song passed the gate when
 * it was added; songs change afterwards and nothing chases the gigs holding them. Everything is
 * re-checked on open.
 *
 * ## Completeness, not correctness
 *
 * Pregonero checks that the pointer resolves, the files parse, every setlist song resolves to a
 * shape for each type it needs, and the content those types require exists. It does **not** judge
 * whether a timeline is sane or a quad is valid — those belong to the tools that own them.
 * `bombista validate --for-performance` answers the timeline question and arrives here as a *note*,
 * never as an arm block: correctness findings belong to the setup step that can act on them, and a
 * machine without `bombista` on its `PATH` must not lose the ability to perform.
 */

import type { LibrarySong } from './setlistStore'
import { isLyricLine } from './songState'
import type { GigFile } from './gigFile'
import { resolveShapesForType, type VisualsFile } from './visualsFile'

/** The song-aware types a song can point content at. `gig-contact` is gig-level and not per song. */
const PER_SONG_TYPES = ['song-lyrics', 'song-video', 'song-intro'] as const

/** The types that, when they resolve, mean the song has somewhere to actually perform. */
const PERFORMING_TYPES = ['song-lyrics', 'song-video'] as const

export type StepStatus = 'complete' | 'not-yet' | 'broken'

export type GigStep = {
  step: number
  name: string
  status: StepStatus
  /** What is missing, in the words the screen shows. Empty when the step is complete. */
  missing: string[]
}

export type SongReadiness = {
  songId: string
  title: string
  /** The hard gate. False means the song cannot be armed. */
  ready: boolean
  /** Why not. Empty when ready. */
  missing: string[]
  /** Reported, never blocking: what `bombista` said, and whether it ran at all. */
  notes: string[]
}

export type GigReadiness = {
  folderPath: string | null
  gigId: string | null
  /** The gig's own identity fields, carried so the debrief can name the night without a second read. */
  date: string | null
  venue: { name?: string; city?: string } | null
  /**
   * `off` when no gig folder is open. There is no gig for a song to be un-ready against, so the
   * gate blocks nothing and the app behaves as it did before this stage. Round G's setup flow is
   * what makes having a gig the normal state; until then, refusing to arm without one would be a
   * gate on nothing.
   */
  gate: 'on' | 'off'
  steps: GigStep[]
  songs: SongReadiness[]
  /**
   * The setlist as it can actually be played, in order. **The one list any "setlist is done"
   * predicate may be derived against** — see `isSetlistComplete`. A trailing song that cannot be
   * played is never played, so a predicate reading the authored setlist would wait for it forever
   * and the gig would never end: no contact panel, no debrief, discovered at the end of a real
   * night.
   */
  playableSongIds: string[]
  /** The loud refusals, verbatim. A non-empty list is a file to fix, not a state to work around. */
  refusals: string[]
  /** True when `bombista` could not be run at all, so no song carries its verdict. */
  validationSkipped: boolean
}

/** One setlist row: the reference, and the song if its file read and parsed. */
export type SetlistSongInput = {
  id: string
  title: string
  path: string
  /** Null when the reference did not resolve. `libertad.json` is the live example. */
  song: LibrarySong | null
  /** Why it did not resolve. Present iff `song` is null. */
  error?: string
}

/** What `mediaPathStore` plus a `stat` know about one logical `media.src` on this machine. */
export type MediaResolution = { linked: boolean; exists: boolean }

export type SongValidation =
  | { status: 'ok' }
  | { status: 'failed'; messages: string[] }
  | { status: 'skipped'; reason: string }

export type GigReadinessInput = {
  folderPath: string | null
  /** Null when there is no gig folder, or when `gig.json` would not parse. */
  gig: GigFile | null
  /** The refusal, when `gig.json` exists and will not parse. */
  gigProblem: string | null
  /** Whether a file sits where the `visuals` pointer points. Absent is *not yet*. */
  visualsPresent: boolean
  visuals: VisualsFile | null
  /** The refusal, when `visuals.json` exists and was rejected. */
  visualsProblem: string | null
  /** The setlist, in order. */
  setlist: readonly SetlistSongInput[]
  /** Keyed by the song file's logical `media.src`. */
  mediaResolution: Readonly<Record<string, MediaResolution>>
  /** Keyed by song id. */
  validation: Readonly<Record<string, SongValidation>>
}

function lyricLineCount(song: LibrarySong): number {
  return song.items.filter(isLyricLine).length
}

/** The types this song actually points content at, given the gig's shapes and its own reassignment. */
function resolvedTypesFor(visuals: VisualsFile, songId: string): string[] {
  return PER_SONG_TYPES.filter((type) => resolveShapesForType(visuals, type, songId).length > 0)
}

function songNotes(validation: SongValidation | undefined): string[] {
  if (!validation) return []
  if (validation.status === 'ok') return []
  if (validation.status === 'skipped') return [`Not validated: ${validation.reason}`]
  return validation.messages.map((m) => `bombista: ${m}`)
}

/**
 * Whether this song's content is there for every type it points at.
 *
 * `song-video` is the one that carries a real requirement: it plays the song's declared `media`
 * with subtitles bound to that video's own clock, so it needs the media to exist on this machine
 * *and* a timeline to read against it. `song-lyrics` needs lyric lines and nothing more — the
 * timeline question there is `bombista`'s, and it arrives as a note, because ten of the fourteen
 * songs in `songs/` are performed from the pedal with no timeline at all.
 */
function contentMissingFor(
  song: LibrarySong,
  types: readonly string[],
  mediaResolution: Readonly<Record<string, MediaResolution>>
): string[] {
  const missing: string[] = []
  if (types.includes('song-lyrics') && lyricLineCount(song) === 0) {
    missing.push('has a lyrics shape but no lyric lines')
  }
  if (types.includes('song-video')) {
    const src = song.media?.src
    if (!src) {
      missing.push('has a video shape but declares no media')
    } else {
      const resolution = mediaResolution[src]
      if (!resolution || !resolution.linked) {
        missing.push(`has a video shape but ${src} is not linked on this machine`)
      } else if (!resolution.exists) {
        missing.push(`has a video shape but the file linked for ${src} is not there`)
      }
      if ((song.timeline ?? []).length === 0) {
        missing.push('has a video shape but no timeline to bind subtitles to')
      }
    }
  }
  return missing
}

const STEP_NAMES: Record<number, string> = {
  2: 'The gig',
  3: 'Gig visuals',
  4: 'Song visuals',
  5: 'Readiness at the venue',
}

function readinessWithoutGig(setlist: readonly SetlistSongInput[]): GigReadiness {
  const songs: SongReadiness[] = setlist.map((entry) => ({
    songId: entry.id,
    title: entry.title,
    ready: entry.song !== null,
    missing: entry.song === null ? [entry.error ?? `${entry.path} could not be read`] : [],
    notes: [],
  }))
  return {
    folderPath: null,
    gigId: null,
    date: null,
    venue: null,
    gate: 'off',
    steps: [2, 3, 4, 5].map((step) => ({
      step,
      name: STEP_NAMES[step]!,
      status: 'not-yet' as StepStatus,
      missing: ['No gig folder is open.'],
    })),
    songs,
    playableSongIds: songs.filter((s) => s.ready).map((s) => s.songId),
    refusals: [],
    validationSkipped: false,
  }
}

export function computeGigReadiness(input: GigReadinessInput): GigReadiness {
  if (input.folderPath === null) return readinessWithoutGig(input.setlist)

  const refusals: string[] = []
  if (input.gigProblem) refusals.push(input.gigProblem)
  if (input.visualsProblem) refusals.push(input.visualsProblem)

  const validationSkipped =
    input.setlist.length > 0 &&
    input.setlist.every((e) => input.validation[e.id]?.status === 'skipped')

  // ── Per song ──────────────────────────────────────────────────────────────────────────────
  const songs: SongReadiness[] = input.setlist.map((entry) => {
    const missing: string[] = []
    const notes = songNotes(input.validation[entry.id])

    if (entry.song === null) {
      missing.push(entry.error ?? `${entry.path} could not be read`)
    } else if (input.visuals === null) {
      missing.push(
        input.visualsProblem ?? 'this gig has no visuals.json yet — map the room in Muralista'
      )
    } else {
      const types = resolvedTypesFor(input.visuals, entry.id)
      const performing = types.filter((t) => (PERFORMING_TYPES as readonly string[]).includes(t))
      if (performing.length === 0) {
        missing.push('no shape carries this song — the gig has no lyrics or video shape for it')
      }
      missing.push(...contentMissingFor(entry.song, types, input.mediaResolution))
    }

    return {
      songId: entry.id,
      title: entry.title,
      ready: missing.length === 0,
      missing,
      notes,
    }
  })

  const playableSongIds = songs.filter((s) => s.ready).map((s) => s.songId)

  // ── Step 2: the gig exists and knows what it is ───────────────────────────────────────────
  const step2Missing: string[] = []
  let step2Status: StepStatus = 'complete'
  if (input.gigProblem) {
    step2Status = 'broken'
    step2Missing.push(input.gigProblem)
  } else if (input.gig === null) {
    step2Status = 'not-yet'
    step2Missing.push('No gig.json in this folder yet.')
  } else {
    if (!input.gig.date) step2Missing.push('The gig has no date.')
    if (!input.gig.venue?.name) step2Missing.push('The gig has no venue.')
    if (input.setlist.length === 0) step2Missing.push('The gig has no setlist.')
    for (const song of songs) {
      if (song.missing.some((m) => m.includes('could not be read'))) {
        step2Missing.push(`${song.title}: ${song.missing[0]}`)
      }
      for (const note of song.notes) {
        if (note.startsWith('bombista:')) step2Missing.push(`${song.title}: ${note}`)
      }
    }
    if (step2Missing.length > 0) step2Status = 'not-yet'
  }

  // ── Step 3: the room's shapes, at gig level ───────────────────────────────────────────────
  const step3Missing: string[] = []
  let step3Status: StepStatus = 'complete'
  if (input.visualsProblem) {
    step3Status = 'broken'
    step3Missing.push(input.visualsProblem)
  } else if (!input.visualsPresent || input.visuals === null) {
    step3Status = 'not-yet'
    step3Missing.push(
      `No ${input.gig?.visuals ?? 'visuals.json'} yet — map the room in Muralista and come back.`
    )
  } else if (resolveShapesForType(input.visuals, 'song-lyrics', null).length === 0) {
    step3Status = 'not-yet'
    step3Missing.push('The gig has no lyrics shape. Every song needs one unless it names its own.')
  }

  // ── Step 4: the songs that deviate. Nothing new lands in gig.json here ────────────────────
  const notCarried = songs.filter((s) => !s.ready && s.missing.some((m) => m.startsWith('no shape') || m.startsWith('has a')))
  const step4Missing = notCarried.map((s) => `${s.title}: ${s.missing.join('; ')}`)
  const step4Status: StepStatus =
    step3Status !== 'complete' ? 'not-yet' : step4Missing.length > 0 ? 'not-yet' : 'complete'

  // ── Step 5: the venue. It reconfirms; it does not discover ────────────────────────────────
  const earlier: StepStatus[] = [step2Status, step3Status, step4Status]
  const step5Status: StepStatus = earlier.includes('broken')
    ? 'broken'
    : earlier.every((s) => s === 'complete')
      ? 'complete'
      : 'not-yet'
  const step5Missing =
    step5Status === 'complete' ? [] : ['Everything above has to be true before the venue check.']

  return {
    folderPath: input.folderPath,
    gigId: input.gig?.id ?? null,
    date: input.gig?.date ?? null,
    venue: input.gig?.venue ?? null,
    gate: 'on',
    steps: [
      { step: 2, name: STEP_NAMES[2]!, status: step2Status, missing: step2Missing },
      { step: 3, name: STEP_NAMES[3]!, status: step3Status, missing: step3Missing },
      { step: 4, name: STEP_NAMES[4]!, status: step4Status, missing: step4Missing },
      { step: 5, name: STEP_NAMES[5]!, status: step5Status, missing: step5Missing },
    ],
    songs,
    playableSongIds,
    refusals,
    validationSkipped,
  }
}

/**
 * **The hard gate at arm time.** A song whose visuals are not set up is not selectable for
 * performance and cannot be armed: the failure lands on the setup screen instead of on the wall.
 *
 * With no gig open the gate is off, because there is nothing to be un-ready against.
 */
export function isSongReadyToArm(readiness: GigReadiness, songId: string): boolean {
  if (!songId) return false
  if (readiness.gate === 'off') return true
  return readiness.songs.some((s) => s.songId === songId && s.ready)
}

/** Why a song cannot be armed, for the screen. Empty when it can. */
export function whySongCannotArm(readiness: GigReadiness, songId: string): string[] {
  if (readiness.gate === 'off') return []
  const song = readiness.songs.find((s) => s.songId === songId)
  if (!song) return songId ? ['This song is not in the gig’s setlist.'] : []
  return song.missing
}

/** The delta for a library with no gig at all. The gate is off; nothing is blocked. */
export function emptyGigReadiness(): GigReadiness {
  return readinessWithoutGig([])
}
