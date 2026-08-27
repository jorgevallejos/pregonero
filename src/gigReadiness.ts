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
import type { GigFile, SetupFingerprints } from './gigFile'
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
  /**
   * Work this step knows about that does not hold it up — an unreadable reference sitting in the
   * library, a `bombista` finding. Same distinction `SongReadiness` draws, for the same reason: a
   * step that could never complete while a known-broken file exists is a guided path nobody can
   * walk, and `libertad.json` is deliberately kept in the library rather than hidden.
   */
  notes: string[]
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
  /**
   * **The setup confirmation, and whether it is still true.** Null when setup has never been
   * confirmed, which is an ordinary state and not a fault.
   */
  confirmation: SetupConfirmation | null
  /**
   * **What last happened to the running order**, carried so a screen can say it.
   *
   * `gig.json`'s `setlist` is the one the app performs, so opening a gig can replace the order the
   * app was holding, and changing the order in the app can replace one edited in the file. Either
   * way something is displaced, and the rule is that it is announced rather than done quietly. It
   * is computed in `gigSession`, where the two sides are both in hand; nothing is derived from it.
   */
  adoption: SetlistAdoptionNotice | null
}

/**
 * **The confirmation, rendered.** It is a milestone rather than a lock: nothing here blocks
 * anything, and `stale` is a warning with names attached.
 *
 * `moved` is the part that earns the whole feature. A confirmation that could not lapse would hand
 * out peace of mind that is no longer true, so when something has changed since it was made, this
 * says **which thing**.
 */
export type SetupConfirmation = {
  confirmedAt: string
  /** True when anything it was confirmed against has changed since. */
  stale: boolean
  /** What moved, in the words the screen shows. Empty when nothing did. */
  moved: string[]
}

/** The running-order change to report. `gigSession` builds it; this function only carries it. */
export type SetlistAdoptionNotice = {
  direction: 'adopted' | 'wrote'
  now: string[]
  displaced: string[]
  unresolved: string[]
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
  /** What last happened to the running order, when anything did. Carried through, never computed. */
  adoption?: SetlistAdoptionNotice | null
  /**
   * The whole library, for step 1 — which is about the songs and not about this gig. Defaults to
   * the setlist, so a caller that has no separate view of the library still gets a real verdict.
   */
  library?: readonly SetlistSongInput[]
  /**
   * The fingerprints as they are **now** — of each setlist song's file, of `visuals.json`, of the
   * display configuration. Compared against what `gig.setup` recorded, and nothing else.
   */
  fingerprints?: SetupFingerprints
}

const NO_FINGERPRINTS: SetupFingerprints = { songs: {}, visuals: null, display: '' }

/**
 * **Has the confirmation stopped being true?**
 *
 * Setup finishes at the venue, and then a song gets fixed, or the room is re-mapped, or the
 * projector is unplugged. Each of those is a legitimate thing to do — fixing a song at the venue is
 * *fix once, every gig benefits* — and each one means the confirmation no longer describes what is
 * on this machine. So it lapses, visibly, and names what moved.
 *
 * Nothing here blocks. This is a milestone reporting on itself.
 */
function compareFingerprints(
  recorded: SetupFingerprints,
  now: SetupFingerprints,
  titleOf: (songId: string) => string
): string[] {
  const moved: string[] = []

  for (const [songId, fingerprint] of Object.entries(recorded.songs)) {
    const current = now.songs[songId]
    if (current === undefined) {
      moved.push(`${titleOf(songId)} was in the setlist when setup was confirmed, and is not now.`)
    } else if (current !== fingerprint) {
      moved.push(`${titleOf(songId)} has been edited since setup was confirmed.`)
    }
  }
  for (const songId of Object.keys(now.songs)) {
    if (!(songId in recorded.songs)) {
      moved.push(`${titleOf(songId)} was added to the setlist after setup was confirmed.`)
    }
  }

  if (recorded.visuals !== now.visuals) {
    moved.push(
      recorded.visuals === null
        ? 'The room was mapped after setup was confirmed.'
        : now.visuals === null
          ? 'visuals.json is no longer there.'
          : 'The room has been re-mapped since setup was confirmed.'
    )
  }

  if (recorded.display !== now.display) {
    moved.push('The displays have changed since setup was confirmed.')
  }

  return moved
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
  1: 'The songs',
  2: 'The gig',
  3: 'Gig visuals',
  4: 'Song visuals',
  5: 'Readiness at the venue',
  6: 'Setup confirmed',
}

/**
 * **Step 1: prepare the songs.** First in the flow because songs are **gig-independent** and are
 * often done days ahead, and the only step whose subject is the library rather than the gig.
 *
 * Everything inside a song file is Bombista's — this asks only whether the library holds a song at
 * all, which is what step 2 needs in order to draw a setlist from one. A reference that will not
 * read and a `bombista` finding are **notes**: they are work, and a step that could never complete
 * while `libertad.json` sits in the library would be a guided path nobody could walk.
 */
function computeStep1(
  library: readonly SetlistSongInput[],
  validation: Readonly<Record<string, SongValidation>>
): GigStep {
  const notes: string[] = []
  for (const entry of library) {
    if (entry.song === null) {
      notes.push(`${entry.title}: ${entry.error ?? `${entry.path} could not be read`}`)
    }
    const verdict = validation[entry.id]
    if (verdict?.status === 'failed') {
      for (const message of verdict.messages) notes.push(`${entry.title}: bombista: ${message}`)
    }
  }
  const readable = library.filter((entry) => entry.song !== null)
  const missing =
    readable.length > 0
      ? []
      : [
          library.length === 0
            ? 'No songs yet. A song needs lyrics and audio: `bombista new`, the words, then align.'
            : 'No song in the library reads yet.',
        ]
  return {
    step: 1,
    name: STEP_NAMES[1]!,
    status: missing.length === 0 ? 'complete' : 'not-yet',
    missing,
    notes,
  }
}

function readinessWithoutGig(
  setlist: readonly SetlistSongInput[],
  library: readonly SetlistSongInput[] = setlist,
  validation: Readonly<Record<string, SongValidation>> = {}
): GigReadiness {
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
    steps: [
      // Step 1 is real with no gig open: songs are gig-independent, which is why they come first.
      computeStep1(library, validation),
      ...[2, 3, 4, 5, 6].map((step) => ({
        step,
        name: STEP_NAMES[step]!,
        status: 'not-yet' as StepStatus,
        missing: ['No gig folder is open.'],
        notes: [],
      })),
    ],
    songs,
    playableSongIds: songs.filter((s) => s.ready).map((s) => s.songId),
    refusals: [],
    validationSkipped: false,
    confirmation: null,
    adoption: null,
  }
}

export function computeGigReadiness(input: GigReadinessInput): GigReadiness {
  if (input.folderPath === null) {
    return readinessWithoutGig(input.setlist, input.library ?? input.setlist, input.validation)
  }

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
    // Ids `gig.json` names that this machine cannot turn into a song. They are a gap in the gig,
    // not in a song — nothing downstream can even name them, so they are named here.
    for (const id of input.adoption?.unresolved ?? []) {
      step2Missing.push(`${id}: named in the gig’s setlist, but no file for it is known here.`)
    }
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

  // ── Step 1: the songs. Gig-independent, which is why it is first ──────────────────────────
  const step1 = computeStep1(input.library ?? input.setlist, input.validation)

  // ── Step 5: the venue. It reconfirms; it does not discover ────────────────────────────────
  const earlier: StepStatus[] = [step1.status, step2Status, step3Status, step4Status]
  const step5Status: StepStatus = earlier.includes('broken')
    ? 'broken'
    : earlier.every((s) => s === 'complete')
      ? 'complete'
      : 'not-yet'
  const step5Missing =
    step5Status === 'complete' ? [] : ['Everything above has to be true before the venue check.']

  // ── Step 6: setup confirmed. **The one thing the design deliberately stores**, and the only
  // thing on this screen that is not derived from the files. It records that the checks passed and
  // what they passed against, so it can notice it has stopped being true.
  const titleOf = (songId: string) =>
    input.setlist.find((entry) => entry.id === songId)?.title ?? songId
  const recorded = input.gig?.setup ?? null
  const moved =
    recorded === null
      ? []
      : compareFingerprints(recorded.against, input.fingerprints ?? NO_FINGERPRINTS, titleOf)
  const confirmation: SetupConfirmation | null =
    recorded === null
      ? null
      : { confirmedAt: recorded.confirmedAt, stale: moved.length > 0, moved }

  const step6Missing: string[] = []
  let step6Status: StepStatus = 'complete'
  if (step5Status === 'broken') {
    step6Status = 'broken'
    step6Missing.push('Something above is a refusal, not a gap.')
  } else if (confirmation === null) {
    step6Status = 'not-yet'
    step6Missing.push(
      step5Status === 'complete'
        ? 'Everything checks out. Confirm setup when you are standing in the room.'
        : 'The readiness check at the venue has not passed yet.'
    )
  } else if (confirmation.stale) {
    // **Lapsed, not broken.** Nothing is wrong with the gig; the confirmation is simply out of date,
    // and re-confirming is one action away.
    step6Status = 'not-yet'
    step6Missing.push(
      `Setup was confirmed on ${confirmation.confirmedAt}, and has lapsed:`,
      ...confirmation.moved
    )
  } else if (step5Status !== 'complete') {
    step6Status = 'not-yet'
    step6Missing.push('The readiness check at the venue no longer passes.')
  }

  return {
    folderPath: input.folderPath,
    gigId: input.gig?.id ?? null,
    date: input.gig?.date ?? null,
    venue: input.gig?.venue ?? null,
    gate: 'on',
    steps: [
      step1,
      { step: 2, name: STEP_NAMES[2]!, status: step2Status, missing: step2Missing, notes: [] },
      { step: 3, name: STEP_NAMES[3]!, status: step3Status, missing: step3Missing, notes: [] },
      { step: 4, name: STEP_NAMES[4]!, status: step4Status, missing: step4Missing, notes: [] },
      { step: 5, name: STEP_NAMES[5]!, status: step5Status, missing: step5Missing, notes: [] },
      {
        step: 6,
        name: STEP_NAMES[6]!,
        status: step6Status,
        missing: step6Missing,
        notes: [],
      },
    ],
    songs,
    playableSongIds,
    refusals,
    validationSkipped,
    confirmation,
    adoption: input.adoption ?? null,
  }
}

/**
 * **Arming an unconfirmed gig warns; it never refuses.** The hard gate is per-song completeness,
 * which is a different thing and stays exactly as it is.
 *
 * Empty when setup is confirmed and still true, or when there is no gig to confirm.
 */
export function armWarnings(readiness: GigReadiness): string[] {
  if (readiness.gate === 'off') return []
  if (readiness.confirmation === null) return ['Setup has not been confirmed for this gig.']
  if (!readiness.confirmation.stale) return []
  return ['Setup was confirmed and has lapsed:', ...readiness.confirmation.moved]
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
