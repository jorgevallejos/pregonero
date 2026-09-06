/**
 * **STANDBY AND THE PERFORMING VIEW — the player's own screen.**
 *
 * Lifted out of `App.tsx` on 2026-09-06 so that **no file belongs to both products**. The
 * boundary — *the shell makes things, the player uses them* — was declared and measured the day
 * before, and `App.tsx` was the one file it could not be true of: it defined this screen and
 * imported every one of the shell's rooms to route to them.
 *
 * Nothing here changed. The extraction is a move, and the guard on it is that the suite that
 * covered this screen from `App.tsx` still covers it unchanged.
 */

import { useSongNavigation } from './useSongNavigation'

import { songVideoAssets } from './visualsFile'
import { useBroadcastVisuals } from './visualsBroadcast'

import {
  isSection,
  getSongIndex,
  getBlank,
  setCurrentSongId,
  setCurrentSongTitle,
  getEffectiveProjectionLanguage,
  getEffectiveSingingLanguage,
  getCurrentSongId,
  getLyricText,
  getSingingLanguage,
  getProjectionLanguage,
  getLastLyricIndex,
  isLyricLine,
} from './songState'
import { resolveMediaPath } from './mediaPathStore'
import { VideoPerformancePanel } from './VideoPerformancePanel'
import { usePerformanceState } from './performanceState'
import { useWebSocket } from './useWebSocket'
import { useProjectionOpenState } from './useProjectionOpenState'
import { useProjectionPlacement } from './useProjectionPlacement'
import { useConcertSessionTimer } from './concertSessionState'
import { useHoldToConfirm, useRestartKeyHold } from './useHoldToConfirm'
import {
  getPerformanceControlState,
  tryArm,
  isNavigationEnabled,
  type PerformanceControlPrerequisites,
} from './performanceControlStateMachine'
import { isContactLit, isPresenting, setContactLitBroadcast } from './gigContactState'
import { gigPhase } from './gigPhase'

// **One owner for what a gig is called**, shared with Backstage's rows and the gig flow's header.
import { gigLabelFrom, type MessageHome } from './gigFile'

import { SetupValue } from './SetupValue'
import { useEffect, useState, useRef } from 'react'
import { useBeatClock } from './useBeatClock'
import { BeatCircle } from './BeatCircle'
import { setAutoBlackout } from './autoBlackout'
import { getLibrarySongById, getOrderedSongsForActiveSetlist } from './setlistStore'
import { addPlayedSong, isSetlistComplete } from './playedSongsState'
import { useGigReadiness } from './useGigReadiness'
import { useGigsExist } from './useGigsExist'

import { isSongReadyToArm, whySongCannotArm } from './gigReadiness'
import { getProjectionStatusText } from './projectionStatus'
import { setVideoRunsBroadcast } from './videoRunsBroadcast'
import type { LyricLine, SongItem } from './songState'
import { computeAutoAdvanceIndex, isCueStartMode, type AdvanceMode } from './autoAdvanceState'
import {
  DRIVE_MODES,
  driveModeAvailable,
  driveModeRefusal,
  resolveDriveMode,
  type DriveMode,
  type SongDriveCapabilities,
} from './driveMode'
import './control.css'

/** v0.5: labels from performance control state machine (SETUP | READY_TO_ARM | ARMED) */
const CONTROL_STATE_LABELS: Record<'SETUP' | 'READY_TO_ARM' | 'ARMED', string> = {
  SETUP: 'Performance: Setup',
  READY_TO_ARM: 'Performance: Ready to Arm',
  ARMED: 'Performance: Armed',
}
const NEXT_SONG_TILE_DELAY_MS = 6_000

/** Build state-machine prerequisites from current app state (no new data model). */
function buildPerformanceControlPrerequisites(
  currentSongId: string,
  lines: SongItem[],
  effectiveLang: string,
  effectiveSingingLang: string,
  projectionOpen: boolean,
  songReadyForGig: boolean
): PerformanceControlPrerequisites {
  return {
    songSelected: currentSongId !== '' && lines.length > 0,
    translationLanguageSelected: effectiveLang.length > 0,
    singingLanguageSelected: lines.length > 0 && effectiveSingingLang.length > 0,
    projectionOpen,
    songReadyForGig,
  }
}

type ControlViewStateInput = {
  currentSongId: string
  lines: SongItem[]
  effectiveLang: string
  effectiveSingingLang: string
  projectionOpen: boolean
  songReadyForGig: boolean
  armed: boolean
  arm: () => void
  unarm: () => void
  lineCount: number
  currentIndex: number
}

/** Encapsulates performance control state machine and readiness; keeps UI from duplicating logic. */
function usePerformanceControlViewState({
  currentSongId,
  lines,
  effectiveLang,
  effectiveSingingLang,
  projectionOpen,
  songReadyForGig,
  armed,
  arm,
  unarm,
  lineCount,
  currentIndex,
}: ControlViewStateInput) {
  const prereqs = buildPerformanceControlPrerequisites(
    currentSongId,
    lines,
    effectiveLang,
    effectiveSingingLang,
    projectionOpen,
    songReadyForGig
  )
  const controlState = getPerformanceControlState(prereqs, armed)
  const controlStateLabel = CONTROL_STATE_LABELS[controlState]
  const canArm = controlState === 'READY_TO_ARM'
  const canUnarm = controlState === 'ARMED'
  const navEnabled = isNavigationEnabled(controlState)
  const nextDisabled =
    lineCount === 0 ||
    !navEnabled ||
    (controlState === 'ARMED' && currentIndex >= lineCount - 1)

  const handleArmClick = () => {
    if (tryArm(prereqs, armed)) arm()
  }

  const handleUnarmClick = () => {
    if (canUnarm) unarm()
  }

  return {
    controlState,
    controlStateLabel,
    canArm,
    canUnarm,
    navEnabled,
    nextDisabled,
    handleArmClick,
    handleUnarmClick,
  }
}

function ProjectionButton({
  isOpen,
  onToggle,
}: {
  isOpen: boolean
  onToggle: () => void
}) {
  const api = window.electronAPI
  if (!api) return null

  if (isOpen) {
    return (
      <button
        type="button"
        className="ctrl-btn ctrl-projection"
        onClick={onToggle}
      >
        Close
      </button>
    )
  }

  return (
    <button type="button" className="ctrl-btn ctrl-projection" onClick={onToggle}>
      Open
    </button>
  )
}

export function ControlView() {
  const { projectionOpen, openProjection, closeProjection } = useProjectionOpenState(
    typeof window !== 'undefined' ? window.electronAPI : undefined
  )
  // Re-read when the window opens: the projector can be plugged in between arriving and doors.
  const placement = useProjectionPlacement(projectionOpen)

  const {
    lines,
    index,
    blank,
    currentItem,
    currentSongTitle,
    goNext,
    goPrev,
    goRestart,
    setBlankState,
    loadLines,
    loadError,
    applyRemoteState,
    applyCommand,
    nextLyricLine,
  } = useSongNavigation()
  const effectiveLang = getEffectiveProjectionLanguage(lines)
  const effectiveSingingLang = getEffectiveSingingLanguage(lines)
  const { state: performanceState, armed: armedFlag, arm, unarm } = usePerformanceState(
    projectionOpen,
    lines,
    effectiveLang,
    index
  )
  const currentSongId = getCurrentSongId()

  // The gig's readiness delta. Rendered here in two places — the hard gate below, and the Gig
  // section of the setup panel. Nothing in this component re-derives what "ready" means.
  const gigReadiness = useGigReadiness()
  // **Whether the `GIG` column draws `Choose` at all.** Read from the folder on arriving here, not
  // stored — see `useGigsExist`.
  const gigsExist = useGigsExist()
  const songReadyForGig = isSongReadyToArm(gigReadiness, currentSongId)
  const songBlockedReasons = songReadyForGig ? [] : whySongCannotArm(gigReadiness, currentSongId)
  // **The setup warning is no longer read here** (2026-09-06). It is a milestone rather than a
  // gate — arming an unconfirmed gig warns and proceeds — so it never had a moment on this screen
  // where it could be said without being in the way. `armWarnings` still exists and the gig flow's
  // sign-off still renders it, which is the screen that owns setup.

  const concertTimer = useConcertSessionTimer()
  const elapsedMinutes = concertTimer.elapsedMinutes
  const timerPaused = concertTimer.paused
  const armWithConcertSessionStart = () => {
    concertTimer.startIfNeeded()
    arm()
  }
  const [timerActionsVisible, setTimerActionsVisible] = useState(false)
  const timerCircleContainerRef = useRef<HTMLButtonElement | null>(null)
  const timerActionsContainerRef = useRef<HTMLDivElement | null>(null)
  const songNotes = currentSongId ? getLibrarySongById(currentSongId)?.notes ?? '' : ''
  const currentLibrarySong = currentSongId ? getLibrarySongById(currentSongId) : undefined
  const songIntro = currentLibrarySong?.intro?.[effectiveLang] ?? ''


  /**
   * **The drive mode he has chosen for this song, or null for the default.**
   *
   * **Resets whenever the song changes**, so a choice made for one song does not carry into the
   * next — the same rule the Transitions toggle it replaces lived under.
   */
  const [selectedDriveMode, setSelectedDriveMode] = useState<DriveMode | null>(null)
  /** The refusal a pressed-but-unavailable mode is showing, or null. Popup, never inline. */
  const [driveRefusal, setDriveRefusal] = useState<string | null>(null)
  /** Why `Arm` refused, or null. Same rule: a popup, never a line in a column. */
  const [armRefusal, setArmRefusal] = useState<string[] | null>(null)
  // P6: set when the performer presses Next/Previous during Auto playback, dropping the song
  // into Manual for the REMAINDER of the song. Reset on the next song and the next arm (below),
  // and by the Restart handlers — never sticky across songs.
  const [manualOverrideTaken, setManualOverrideTaken] = useState(false)
  const prevAdvanceModeSongIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevAdvanceModeSongIdRef.current !== currentSongId) {
      prevAdvanceModeSongIdRef.current = currentSongId
      setSelectedDriveMode(null)
      setManualOverrideTaken(false)
    }
  }, [currentSongId])

  /**
   * **VIDEO IS A FACT ABOUT THE ROOM, NOT ABOUT THE SONG** (Jorge, 2026-09-03).
   *
   * This read `currentLibrarySong.media`, which was **pre-split code**: it treated the projected
   * video as the song's affair, and under *the song holds no media* it is not. A recording derives
   * a timeline and is then irrelevant; what appears on the wall is named by `visuals.json`, per
   * song, per shape, by Muralista.
   *
   * **The first asset any of this song's video shapes carries**, because this panel drives one
   * clock. The wall lights every one of them, each with its own — see the projection below.
   */
  const controlVisuals = useBroadcastVisuals()
  const songVideoSrc =
    controlVisuals && currentSongId
      ? (songVideoAssets(controlVisuals, currentSongId).named[0] ?? null)
      : null
  const isVideoMode = songVideoSrc !== null
  const resolvedVideoPath = songVideoSrc ? resolveMediaPath(songVideoSrc) : null
  const songTimeline = currentLibrarySong?.timeline ?? []
  const hasTimeline = songTimeline.length > 0

  /**
   * **DRIVE MODE, AND IT IS ONE CONTROL NOW** (Jorge, 2026-09-03/04).
   *
   * `clock`, `video`, `manual`, assembled from the two axes that already existed: what the room
   * assigns this song, and what the song file carries. **The default is the most capable
   * available** — video, then clock, then manual — so the common case is that Jorge touches
   * nothing.
   */
  const driveCaps: SongDriveCapabilities = { hasVideo: isVideoMode, hasTimeline }
  const driveMode = resolveDriveMode({
    selected: selectedDriveMode,
    caps: driveCaps,
    manualOverrideTaken,
  })
  /**
   * **The advance mode is what drive mode *is*, on the non-video side.** It is kept as a derived
   * value rather than a second control because everything under it — the auto-advance effect, the
   * cue-start path, the transport — is written against it, and one control producing one value is
   * the whole point of the concept.
   */
  const effectiveAdvanceMode: AdvanceMode = driveMode === 'clock' ? 'auto' : 'manual'

  /**
   * **A mode that cannot act says why when pressed** (Jorge, 2026-09-04), rather than sitting dead.
   * **A disabled control with nothing explaining it is forbidden, and an explanation is precisely
   * what cannot be read across a dark room** — so the refusal is a popup, which is what everything
   * that has gone wrong at this screen is.
   */
  const chooseDriveMode = (mode: DriveMode) => {
    const refusal = driveModeRefusal(mode, driveCaps)
    if (refusal !== null) {
      setDriveRefusal(refusal)
      return
    }
    setSelectedDriveMode(mode)
  }
  // The performer only gets the video panel when the song has a video AND it's actually
  // being shown (display mode isn't 'none'). In 'none' mode a video song behaves exactly
  // like a non-video song for the performer (manual Next/Previous/Restart).
  /**
   * **Choosing video as the drive mode is what makes the video run** (Jorge, 2026-09-03). It used
   * to be `isVideoMode && effectiveDisplayMode !== 'none'` — a size control deciding whether the
   * clip played at all, which is **format wearing a performance control's clothes.** Where the
   * video lands was answered by the shapes weeks earlier.
   *
   * **The performer's own panel follows the same answer rather than needing one of its own**, which
   * is a residual question Cowork raised and is not one.
   */
  const showVideoPerformance = driveMode === 'video'

  /**
   * **The wall is told whether the video runs, and nothing else about the mode.** It cannot work it
   * out: it knows the room's assignment and nothing about what was chosen, so a `manual` drive on a
   * song the room gives a video would leave a frozen first frame up all song.
   *
   * Written through on every change of the value rather than inside a handler — the reader takes it
   * at mount, and a broadcast that only moved on a click goes stale against a fresh session's own
   * state (the A1 rule in `CLAUDE.md`).
   */
  useEffect(() => {
    setVideoRunsBroadcast(showVideoPerformance)
  }, [showVideoPerformance])
  const armed = performanceState === 'armed' || performanceState === 'performing'
  const {
    controlState,
    controlStateLabel,
    canArm,
    canUnarm,
    nextDisabled: nextDisabledFromControlState,
    handleArmClick,
    handleUnarmClick,
  } = usePerformanceControlViewState({
    currentSongId,
    lines,
    effectiveLang,
    effectiveSingingLang,
    projectionOpen,
    songReadyForGig,
    armed,
    arm: armWithConcertSessionStart,
    unarm,
    lineCount: lines.length,
    currentIndex: index,
  })
  const { sendCommandWithState, sendSeek } = useWebSocket({
    index,
    blank,
    applyRemoteState,
    applyCommand,
  })

  /** Tracked user-facing config (storage); avoids false positives when only derived effectiveLang changes. */
  const prevUserConfigRef = useRef<{
    songId: string
    proj: string
    sing: string
  } | null>(null)

  // Internal concert flow sets song id while already armed; in that case we should not unarm
  // just to restart the UI.
  const skipAutoUnarmOnNextSongTransitionRef = useRef(false)

  // When the current song was loaded. Recording happens at song end, so this is the only place
  // the start time can be taken; an entry whose load moment was never seen writes `null`.
  const songLoadedAtRef = useRef<string | null>(null)
  useEffect(() => {
    songLoadedAtRef.current = currentSongId ? new Date().toISOString() : null
  }, [currentSongId])

  useEffect(() => {
    const next = {
      songId: getCurrentSongId(),
      proj: getProjectionLanguage(),
      sing: getSingingLanguage(),
    }
    const prev = prevUserConfigRef.current
    if (prev === null) {
      prevUserConfigRef.current = next
      return
    }

    const userConfigChanged =
      prev.songId !== next.songId || prev.proj !== next.proj || prev.sing !== next.sing

    if (userConfigChanged) {
      const skipUnarm = skipAutoUnarmOnNextSongTransitionRef.current
      if (controlState === 'ARMED' && !skipUnarm) {
        unarm()
      }
      skipAutoUnarmOnNextSongTransitionRef.current = false
      goRestart()
      sendCommandWithState('setIndex', -1, { currentIndex: -1, blank: true })
    }

    prevUserConfigRef.current = next
  }, [controlState, unarm, goRestart, sendCommandWithState])

  const handleNext = () => {
    // The first Next (index -1 → 0) also starts the non-video beat clock — the beat
    // indicator is driven by the existing controls, not a separate Start button.
    // startBeatClock() is a no-op when already running or when there is no tempo.
    //
    // P1 (start-on-cue): for a cue-start Auto song (v2 timeline, no video — see
    // isCueStartAuto below), this same first press IS the timeline's start cue — it fires
    // startAtCue() instead, which begins the clock straight into 'playing' regardless of
    // tempo.countInBars (no count-in). isCueStartAuto/startAtCue are declared further down
    // this component but already assigned by the time this closure is ever invoked (it's only
    // called from a later click, after the full render — the same pattern this function
    // already relies on for startBeatClock, destructured from useBeatClock() below it).
    const wasNotStarted = getSongIndex() === -1
    // P6: a Next pressed while Auto is actually driving the song takes the wheel for the rest
    // of the song. The cue press itself (wasNotStarted) is excluded — that press STARTS Auto,
    // it doesn't override it.
    if (isAutoArmed && !wasNotStarted) {
      setManualOverrideTaken(true)
    }
    goNext()
    const newIndex = getSongIndex()
    if (wasNotStarted) {
      if (isCueStartAuto) {
        startAtCue()
      } else {
        startBeatClock()
      }
    }
    sendCommandWithState('next', undefined, {
      currentIndex: newIndex,
      blank: getBlank(),
    })
  }
  const handlePrev = () => {
    // P6: Previous takes the wheel exactly as Next does. Previous is disabled before the cue,
    // so the index check is belt-and-braces against a pedal/keyboard path reaching it early.
    if (isAutoArmed && getSongIndex() >= 0) {
      setManualOverrideTaken(true)
    }
    goPrev()
    const prevIdx = getSongIndex()
    sendCommandWithState('prev', undefined, { currentIndex: prevIdx, blank: getBlank() })
  }
  const handleRestart = () => {
    goRestart()
    // Restart also restarts the non-video beat clock (no-op when there is no tempo).
    restartBeatClock()
    // P6: back to the top of the song means the song drives itself again.
    setManualOverrideTaken(false)
    sendCommandWithState('setIndex', -1, { currentIndex: -1, blank: true })
  }

  // ── T2 Auto transport (non-video, Auto mode): mirrors the Video panel's Play/Pause/Restart,
  // but the clock is the beat clock and the audience is black (no video) until a cue is due. ──
  const handleAutoPlay = () => {
    // start() begins the count-in (or resumes from pause). The audience goes black immediately
    // (the count-in shows on the performer's beat indicator, not on the audience screen); cues
    // then reveal lyrics on both screens via the Auto drive effect's setIndex broadcasts.
    startBeatClock()
    setAutoBlackout(true)
  }
  const handleAutoPause = () => {
    pauseBeatClock()
  }
  const handleAutoRestart = () => {
    // Return to the pre-Play state: clock idle, audience back on the intro/title, index reset.
    resetBeatClock()
    setAutoBlackout(false)
    goRestart()
    // P6: back to the top of the song means the song drives itself again.
    setManualOverrideTaken(false)
    sendCommandWithState('setIndex', -1, { currentIndex: -1, blank: true })
  }
  const handleToggleProjection = () => {
    if (projectionOpen) {
      closeProjection()
    } else {
      openProjection()
    }
  }
  const handleBlankToggle = () => {
    setBlankState(!blank)
    sendCommandWithState('blankToggle', undefined, { currentIndex: getSongIndex(), blank: getBlank() })
  }

  const handleUnarm = () => {
    setAutoBlackout(false)
    handleUnarmClick()
  }

  const goToSongs = () => {
    window.location.hash = '#/songs'
  }

  const goToLanguages = () => {
    window.location.hash = '#/languages'
  }

  const goToSetupHome = () => {
    window.location.hash = '#/setup'
  }

  const goToGigs = () => {
    window.location.hash = '#/gigs'
  }

  const orderedSongs = getOrderedSongsForActiveSetlist()
  // **The setlist as it can actually be played**, and the only list the running order is derived
  // against. Readiness decides what is unplayable — the same function that gates arming, never a
  // second list that can disagree with it. A trailing song that cannot be played is never played,
  // so a predicate reading the authored setlist would wait for it forever: the gig would never
  // end, and that is discovered at the end of a real night.
  const playableSongs = orderedSongs.filter((song) =>
    gigReadiness.playableSongIds.includes(song.id)
  )
  const currentSongPosition = currentSongId
    ? playableSongs.findIndex((song) => song.id === currentSongId)
    : -1
  // The gig is the unit: arm once, play the setlist through once, then it is over. Anything
  // played afterwards is a repeat — a single song, honoured on request — and must never resume
  // the setlist from that song's position. Derived from the played log, not stored, so it
  // cannot disagree with it. Re-read each render; every append re-renders this component.
  const setlistDone = isSetlistComplete(playableSongs.map((song) => song.id))

  /**
   * **THE GIG'S PHASE: before the setlist, in it, after it** (2026-09-06).
   *
   * The states were always real and were nameless — `armed`, a played log and a playable setlist,
   * assembled by hand wherever the gig was needed. **Naming it is what gives moments 3, 9, 11 and
   * 12 somewhere to attach**, and both of the things it decides below used to be separate readings
   * of `setlistDone` that nothing tied together.
   *
   * **The stored armed flag, not the control screen's label**: with the projection window closed an
   * armed performance reports `setup`, and he is still armed.
   */
  const phase = gigPhase({ armed: armedFlag, setlistDone })

  // **The message home's one condition**, evaluated here because every input is this window's: the
  // armed flag, the played log and the playable setlist. The Projection window is handed the
  // answer rather than the inputs, so there is one implementation of the condition and no second
  // opinion about it.
  //
  // Written through on every change of the value, not only inside a click handler — the reader
  // takes it at mount, and a broadcast that only moved on a click goes stale against a fresh
  // session's own state (the A1 rule in CLAUDE.md).
  const contactLit = isContactLit({
    armed: armedFlag,
    setlistDone,
    presenting: isPresenting(lines, index),
  })
  // **The content travels with the answer, on the one channel that already exists.** The
  // Projection window has no `electronAPI` and cannot read the gig folder, so the four fields go
  // where the boolean goes — see `gigContactState`. Keyed on the serialised block so a re-render
  // that changed nothing does not rewrite the key.
  const messageHomeJson = JSON.stringify(gigReadiness.messageHome ?? {})
  useEffect(() => {
    setContactLitBroadcast(contactLit, JSON.parse(messageHomeJson) as MessageHome)
  }, [contactLit, messageHomeJson])

  // **Moment 12's other half, and it is the same fact as the one above.** A repeat plays from
  // `after` and stays in `after`, so once the setlist has closed there is no next song to offer —
  // during the repeat or after it. Read off the phase rather than off `setlistDone` a second time,
  // because *the running order cannot resume* and *the wall goes back to him* are one ruling.
  const nextSongForTile =
    phase !== 'after' && currentSongPosition >= 0 && currentSongPosition < playableSongs.length - 1
      ? playableSongs[currentSongPosition + 1]
      : null
  const [showNextSongTile, setShowNextSongTile] = useState(false)

  const isEndOfSong =
    controlState === 'ARMED' &&
    lines.length > 0 &&
    index >= 0 &&
    index < lines.length &&
    isLyricLine(lines[index]) &&
    index === getLastLyricIndex(lines)
  const nextDisabled = nextDisabledFromControlState

  const handleStartNextSongInConcertSession = () => {
    if (!nextSongForTile) return
    if (currentSongId) addPlayedSong(currentSongId, { startedAt: songLoadedAtRef.current })

    // This is an internal concert-flow transition (already armed), so we must not auto-unarm
    // just because the user-facing song id changes.
    skipAutoUnarmOnNextSongTransitionRef.current = true

    loadLines(nextSongForTile.items)
    setCurrentSongId(nextSongForTile.id)
    setCurrentSongTitle(nextSongForTile.title)
    setShowNextSongTile(false)
  }

  // When re-arming mid-song, restart so the performer sees the intro screen first.
  /**
   * **`Arm` is pressable even when it cannot act, and says why** (2026-09-06).
   *
   * It was `disabled={!canArm}` with the reasons in bullets beside it. **Both halves were wrong on
   * this screen**: a column shows a state and never a message, and a dead button on a panel read
   * across a dark room tells you nothing at all — which is exactly how the walk of `v0.80.0` ended
   * at moment 5, pressing a control that did nothing.
   *
   * **The reasons come from readiness where there are any, and from the prerequisites otherwise.**
   * *No song*, *no languages*, *the projection window is closed* are the three the gate can be
   * blocked on that readiness knows nothing about, and every one of them is a fact he can act on.
   */
  const armRefusals = (): string[] => {
    if (canArm) return []
    if (songBlockedReasons.length > 0) return songBlockedReasons
    const missing: string[] = []
    if (currentSongId === '' || lines.length === 0) missing.push('No song is loaded. Choose one on Setlist.')
    if (effectiveSingingLang === '' || effectiveLang === '') {
      missing.push('No languages are chosen. Choose them on Languages.')
    }
    if (!projectionOpen) missing.push('The projection window is closed. Open it in the Projection column.')
    return missing.length > 0 ? missing : ['This gig cannot be armed yet.']
  }

  const handleArmPressed = () => {
    const refusals = armRefusals()
    if (refusals.length > 0) {
      setArmRefusal(refusals)
      return
    }
    handleArmAndRestart()
  }

  const handleArmAndRestart = () => {
    // Fresh arm: audience starts on the intro/title, not blacked out from a prior performance.
    setAutoBlackout(false)
    if (index >= 0) {
      goRestart()
      sendCommandWithState('setIndex', -1, { currentIndex: -1, blank: true })
    }
    handleArmClick()
  }

  const restartKeyHold = useRestartKeyHold(handleRestart)

  const handlersRef = useRef({
    handleNext,
    handlePrev,
    handleRestart,
    handleBlankToggle,
    goToSongs,
    goToLanguages,
    arm: handleArmAndRestart,
    unarm: handleUnarm,
    controlState,
    nextDisabled,
  })
  handlersRef.current = {
    handleNext,
    handlePrev,
    handleRestart,
    handleBlankToggle,
    goToSongs,
    goToLanguages,
    arm: handleArmAndRestart,
    unarm: handleUnarm,
    controlState,
    nextDisabled,
  }
  const restartKeyHoldRef = useRef(restartKeyHold)
  restartKeyHoldRef.current = restartKeyHold

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const { handleNext: next, handlePrev: prev, handleBlankToggle: blankToggle, goToSongs: toSongs, goToLanguages: toLangs, arm: doArm, unarm: doUnarm, controlState: cState, nextDisabled: nextDisabledRef } = handlersRef.current
      const { onKeyDown: restartKeyDown } = restartKeyHoldRef.current
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        if (!nextDisabledRef) next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        prev()
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        restartKeyDown()
      } else if (e.key === 'a' || e.key === 'A') {
        e.preventDefault()
        if (cState === 'READY_TO_ARM') doArm()
        else if (cState === 'ARMED') doUnarm()
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault()
        toSongs()
      } else if (e.key === 'l' || e.key === 'L') {
        e.preventDefault()
        toLangs()
      } else if (e.key === 'b' || e.key === 'B') {
        e.preventDefault()
        blankToggle()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        restartKeyHoldRef.current.onKeyUp()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      restartKeyHoldRef.current.onKeyUp()
    }
  }, [])

  const currentEs =
    currentItem && !isSection(currentItem)
      ? (() => {
          const line = currentItem as LyricLine
          const lang =
            effectiveSingingLang ||
            (Object.keys(line.languages).sort()[0] ?? '')
          return getLyricText(line, lang)
        })()
      : ''
  const notStarted = index === -1
  const displayText = notStarted
    ? songNotes
    : currentEs || (loadError ? loadError : '—')

  const nextPreviewText =
    nextLyricLine
      ? (() => {
          const lang =
            effectiveSingingLang ||
            (Object.keys(nextLyricLine.languages).sort()[0] ?? '')
          return getLyricText(nextLyricLine, lang)
        })()
      : ''

  const restartHold = useHoldToConfirm(handleRestart)
  const unarmHold = useHoldToConfirm(handleUnarm)

  const showSetupPanel = controlState === 'SETUP' || controlState === 'READY_TO_ARM'
  const showArmedShell = controlState === 'ARMED'

  // Beat clock: non-video performer view only. Video mode manages its own clock inside VideoPerformancePanel.
  // The clock does NOT auto-start on arm — it stays idle until the performer presses Start,
  // decoupled from lyric advance (Next). See CLAUDE.md / d-wire Prompt 5.
  const songTempo = currentLibrarySong?.tempo

  // ── PREGONERO STORES NO TEMPO (Jorge, 2026-09-05) ────────────────────────────────────────
  //
  // **`llt.performedBpm.v1` is deleted, not moved to a side.** A performed tempo per song, held
  // in `localStorage`, was flagged on 04/09 as arguably setup and left for Jorge to rule. **He
  // ruled it out of existence: tempo has one home and it is the song file.**
  //
  // **So the pulse and the cue times are the song's own `tempo.bpm`**, and there is nothing to
  // scale against — `getTempoScale`, `scaleTimeline` and `resolvePerformedBpm` went with the
  // store, because at one home they were the identity function wearing a name. The rule they
  // were built to protect is now structural rather than remembered: **`tempo.bpm` cannot be
  // retimed against a past gig if there is no second tempo to retime it against.**
  //
  // **And the question of which reset clears it stops existing**, which is what the ruling was
  // reaching for — see `journey-performance.md`.

  // T2: Auto lyric-advance behaves like Video mode but driven by the beat clock. When the
  // song is armed non-video in Auto, the performer gets Play/Pause/Restart transport (not
  // Next/Previous), and the audience is black during the count-in and before the first cue
  // (see handleAutoPlay / autoBlackout / the projection blackout listener).
  //
  // **This is `clock`, the drive mode.** Drive mode is not a concept in this code — it is
  // assembled from the two axes that are — and *non-video, Auto, has a timeline* is what
  // `clock` names.
  const isAutoArmed =
    showArmedShell && !showVideoPerformance && effectiveAdvanceMode === 'auto' && hasTimeline

  const {
    phase: beatPhase,
    songElapsedMs,
    playState: beatPlayState,
    start: startBeatClock,
    startAtCue,
    pause: pauseBeatClock,
    restart: restartBeatClock,
    reset: resetBeatClock,
  } = useBeatClock(
    songTempo,
    // **The clock runs in `clock` and nowhere else** (Jorge, 2026-09-06). It used to run in
    // `manual` too, invisibly since 05/09 and pointlessly: nothing in `manual` reads
    // `songElapsedMs`, nothing draws the phase, and **nothing beat-related exists in `manual`
    // at all** now that the count-in has gone with the pulse. Video keeps its own clock inside
    // `VideoPerformancePanel`.
    isAutoArmed,
    // **The loaded song. A change to it is a load, and a load starts the beat** — one rule
    // covering both of Jorge's triggers, arming and `next`. See `useBeatClock`.
    currentSongId
  )
  // P1 (start-on-cue): a v2-timeline, no-video Auto song skips Play/count-in entirely — the
  // performer's first pedal press/Next is the start cue itself (see handleNext, startAtCue in
  // useBeatClock.ts). Keyed on primitives only (timelineVersion, isVideoMode — a boolean
  // derived from media.type), never on currentLibrarySong/media object identity, per the hook-
  // stability gotcha in CLAUDE.md. isVideoMode (not showVideoPerformance) is deliberate: a
  // video song with display mode 'none' still has video media and must NOT get cue-start,
  // matching "has no video media" in the P1 spec exactly.
  const isCueStartAuto = isCueStartMode({
    armed: isAutoArmed,
    advanceMode: effectiveAdvanceMode,
    timelineVersion: currentLibrarySong?.timelineVersion,
    hasVideo: isVideoMode,
  })
  // Once Play (legacy Auto) or the cueing Next (cue-start Auto, P1) has fired, the performer's
  // own screen stops showing the intro/notes; idle means we're still waiting to start/cue.
  // (Whether the AUDIENCE goes black meanwhile is a separate concern — see isCueStartAuto and
  // the autoBlackout comments on handleAutoPlay: legacy Auto blacks the audience out on Play,
  // cue-start Auto never does, so the audience keeps showing the title/intro until the cue.)
  const autoPerformanceStarted = isAutoArmed && beatPlayState !== 'idle'

  // P6: the override resets on the next arm as well as the next song, so a song taken manual
  // one night starts the next arm driving itself again.
  useEffect(() => {
    setManualOverrideTaken(false)
  }, [armed])

  // **NOTHING BEAT-RELATED EXISTS IN `manual` AT ALL** (Jorge, 2026-09-06).
  //
  // **R2's Manual Start step is gone.** It ran a count-in a full bar before the first lyric so the
  // performer could catch the tempo before singing — and **the indicator was its only observable
  // effect**, which the 05/09 ruling had just removed from `manual`. **A step that does nothing
  // you can see is worse than no step**, so the step goes rather than the display coming back.
  //
  // **The pulse and the count-in are different things**, and separating them is what made the
  // question answerable: the pulse is continuous and keeps Jorge with something playing itself,
  // the count-in is finite and tells him when to come in. **`manual` has neither now**, because in
  // `manual` he is the clock.
  //
  // **What manual becomes is simpler: the first press reveals the first phrase**, which is what
  // moment 7 describes and what the app did before R2.

  // Auto lyric-advance drive (non-video performer view only): once the beat clock's song
  // has begun (songElapsedMs ticking, i.e. the first Next has started the clock and the
  // count-in has completed), map elapsed time against the timeline to a target cue index
  // and, if it differs from the current index, jump there — same path a remote/manual
  // setIndex command takes, so the Projection window stays in sync. Manual Next/Prev always
  // remain available and simply move `index`; because this effect keys off songElapsedMs
  // (not index), the next tick recomputes from the timeline and Auto resumes tracking
  // elapsed time rather than fighting the manual move.
  // Deps are primitives only (songElapsedMs, hasTimeline, index, effectiveAdvanceMode,
  // showVideoPerformance) — never the timeline/song object identity, and not applyCommand/
  // sendCommandWithState (unmemoized, new reference every render) — per the hook-stability
  // gotcha (CLAUDE.md): currentLibrarySong is a fresh object every render, and this effect
  // must not re-run on every render just because a callback reference changed.
  const timelineRef = useRef(songTimeline)
  timelineRef.current = songTimeline
  // P9: read through a ref, not an effect dep — the scale is frozen for the duration of a
  // performance (the control is only reachable before arming), so a change must never re-target
  // the current line mid-song.
  const applyRemoteStateRef = useRef(applyRemoteState)
  applyRemoteStateRef.current = applyRemoteState
  const sendCommandWithStateRef = useRef(sendCommandWithState)
  sendCommandWithStateRef.current = sendCommandWithState
  useEffect(() => {
    if (showVideoPerformance) return
    if (effectiveAdvanceMode !== 'auto' || !hasTimeline) return
    if (songElapsedMs <= 0) return
    // **The cue times are the recording's own timings, unscaled.** Nothing stands between the
    // song file and the clock since the performed tempo went — see the block above.
    const targetIndex = computeAutoAdvanceIndex(timelineRef.current, songElapsedMs)
    if (targetIndex === index) return
    // A real cue (index >= 0) un-blanks; before the first cue / in gaps (index -1) stays blank.
    const targetBlank = targetIndex < 0
    // Update the local performer state AND the shared (cross-window) localStorage index/blank
    // via applyRemoteState — NOT applyCommand('setIndex'). computeNavigationState's setIndex
    // branch PRESERVES the current blank, so an applyCommand path would leave blank=true in
    // localStorage while the WS broadcast carries blank=false. The Projection window re-reads
    // index/blank from localStorage on every storage event, so it would read blank=true and
    // stay BLACK even though a cue is due — the Auto "audience stays black" bug. Writing the
    // same blank the broadcast carries keeps both windows consistent, exactly like manual Next.
    applyRemoteStateRef.current(targetIndex, targetBlank)
    sendCommandWithStateRef.current('setIndex', targetIndex, {
      currentIndex: targetIndex,
      blank: targetBlank,
    })
  }, [songElapsedMs, effectiveAdvanceMode, hasTimeline, showVideoPerformance, index])

  const languagesDisplay =
    effectiveSingingLang && effectiveLang
      ? `${effectiveSingingLang.toUpperCase()} → ${effectiveLang.toUpperCase()}`
      : effectiveLang
        ? effectiveLang.toUpperCase()
        : ''
  useEffect(() => {
    if (showArmedShell) return
    setTimerActionsVisible(false)
  }, [showArmedShell])

  useEffect(() => {
    setShowNextSongTile(false)
    if (!isEndOfSong || !nextSongForTile) return
    const timer = setTimeout(() => {
      setShowNextSongTile(true)
    }, NEXT_SONG_TILE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [isEndOfSong, nextSongForTile?.id, currentSongId])

  useEffect(() => {
    if (!timerActionsVisible) return

    const onDocumentPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return

      const clickedInsideCircle =
        timerCircleContainerRef.current?.contains(event.target) ?? false
      const clickedInsideActions =
        timerActionsContainerRef.current?.contains(event.target) ?? false

      if (!clickedInsideCircle && !clickedInsideActions) {
        setTimerActionsVisible(false)
      }
    }

    document.addEventListener('pointerdown', onDocumentPointerDown)
    return () => document.removeEventListener('pointerdown', onDocumentPointerDown)
  }, [timerActionsVisible])

  /**
   * **The refusal a drive-mode button gives when it cannot act.**
   *
   * **A popup, because this screen is read across a stage in the dark**, where a band of text at a
   * control is invisible — the same reason arming errors are popups and the same overlay they use.
   * **No message ever appears in a control column** (Jorge, 2026-09-05): a column shows a state.
   */
  /**
   * **Why `Arm` could not act, said where it can be read.** Same overlay as every other thing that
   * has gone wrong at this screen — **anything that has gone wrong at the control view is a
   * popup**, because a band of text at a control is invisible across a stage in the dark.
   */
  const armRefusalPopup = armRefusal === null ? null : (
    <div className="ctrl-timeline-save-overlay" data-testid="arm-refusal">
      <div
        className="ctrl-timeline-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="This song cannot be armed yet"
      >
        <p className="ctrl-timeline-save-message" data-testid="arm-refusal-title">
          {currentSongTitle || 'This song'} cannot be armed:
        </p>
        <ul data-testid="arm-refusal-reasons">
          {armRefusal.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
          {/* **The escape hatch, said out loud**, and it travels with the reasons rather than
              sitting under the column: the room is the one refusal a person can go and fix in
              another tool, and the sentence is what tells him he may. */}
          {songBlockedReasons.length > 0 && (
            <li>Or map the wall directly in Muralista and come back.</li>
          )}
        </ul>
        <div className="ctrl-timeline-save-actions">
          <button
            type="button"
            className="ctrl-btn"
            data-testid="arm-refusal-close"
            onClick={() => setArmRefusal(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )

  const driveRefusalPopup = driveRefusal === null ? null : (
    <div className="ctrl-timeline-save-overlay" data-testid="drive-mode-refusal">
      <div
        className="ctrl-timeline-save-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="That drive mode is not available for this song"
      >
        <p className="ctrl-timeline-save-message" data-testid="drive-mode-refusal-message">
          {driveRefusal}
        </p>
        <div className="ctrl-timeline-save-actions">
          <button
            type="button"
            className="ctrl-btn"
            data-testid="drive-mode-refusal-close"
            onClick={() => setDriveRefusal(null)}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <div className="control-screen">
      {driveRefusalPopup}
      {armRefusalPopup}
      {showSetupPanel && (
        <header className="control-masthead" role="banner">
          {/* **THE MASTHEAD IS THE ROOM'S NAME AND NOTHING ELSE** (Jorge, 2026-09-05). The
              wordmark `Pregonero / Live lyric translation` and the by-line
              `v0.xx.x / A Tramoya tool / by Chango Pepper` are both gone.

              **Third time this argument has run**: Bombista's header went on 02/09 and Muralista's
              label on 04/09, for the same reason — **the tool introducing itself to someone who did
              not choose it.** Jorge opened his own app; it does not need to say whose it is or what
              it is called.

              **Where the version survives, because that rule cost a day.** Two builds calling
              themselves one number is the trap, so the number has to be readable somewhere: it is
              in the macOS About panel, `Tramoya → About Tramoya`, from the bundle's own
              `CFBundleShortVersionString`. **That is a stronger claim than a string in the
              renderer**, because it is the bundle describing itself rather than the page.

              **The design also says: standalone, the player keeps its name and version, as
              Bombista does on `--no-header`. There is no standalone yet** — Pregonero is not a
              framed page, so *hosted* is the only mode that exists and the branch would be
              unreachable code guarding a boundary nothing has measured. It arrives with the
              extraction, not before it.

              **THE ROOM IS CALLED `Standby`** (Jorge, 2026-09-04). **Standby is the stage manager's
              call before a cue**, which is exactly what this screen is — choose the gig, choose the
              song, choose the mode, stand by — and **arming is the GO**. It is inside
              `showSetupPanel`, so it is gone the instant you arm: the performing view is a
              different room and does not change. */}
          <h1 className="control-room-name" data-testid="control-room-name">
            Standby
          </h1>
        </header>
      )}

      {showArmedShell && (
        <header className="control-top-bar" role="banner">
          <div className="top-bar-summary">
            <span className="top-summary-line">
              Song: {currentSongTitle || '—'}
            </span>
            <span className="top-summary-line">
              Languages: {languagesDisplay || '—'}
            </span>
            <span className="top-summary-line">
              Projection: {getProjectionStatusText(projectionOpen)}
            </span>
            <span
              className="top-title top-title-state"
              data-testid="performance-state-label"
            >
              {controlStateLabel}
            </span>
          </div>
        </header>
      )}

      <main className={`control-center ${showSetupPanel ? 'control-center-setup' : ''}`}>
        {showSetupPanel && (
          <>
            {/* **`Performance: Setup` is gone** (Jorge, 2026-09-05), and it goes for a second
                reason on top of the masthead's. **Those two words now name the two halves of the
                split** — the shell prepares, the player performs — so a heading pairing them
                describes nothing and contradicts both.

                **The state is still on the screen, in the column that owns it.** `ARM` reads
                `Unarmed`, and its button is enabled exactly when the state is `READY_TO_ARM`. That
                is the same distinction the heading spelled out, shown where it is acted on. */}
            <div
              className={
                controlState === 'SETUP'
                  ? 'control-performance-state control-setup-sections'
                  : 'control-performance-state'
              }
              aria-live="polite"
            >
              <div className="control-setup-section">
                <span className="control-setup-label">Gig</span>
                <div className="control-setup-content">
                  {/* **THE GIG'S NAME, NEVER THE FOLDER'S ID** (Jorge, 2026-09-03). This read
                      `gigReadiness.gigId`, and since 03/09 that is an opaque ten-character id —
                      so the one column that says which night this is said `k3f9x2abcd`.
                      **Backstage was fixed for exactly this on the same day** and the control
                      view was missed; `gigLabelFrom` is the single owner of the rule and both
                      screens go through it, because a second rendering of *what a gig is called*
                      is how the row and the stage start disagreeing.

                      **`No gig` from nothing**, which is what `gate === 'off'` means: with no
                      folder open there is no date, no venue and no folder to fall back to. */}
                  <SetupValue
                    testId="control-gig-value"
                    text={
                      gigReadiness.gate === 'off' || gigReadiness.folderPath === null
                        ? 'No gig'
                        : gigLabelFrom(
                            gigReadiness.date,
                            gigReadiness.venue?.name ?? null,
                            gigReadiness.folderPath
                          )
                    }
                  />
                </div>
                {/* **THE SUMMARY PARAGRAPH IS GONE** (2026-09-06, third time this rule has had to
                    be applied). It said *Step 3 — the room — is not done yet*, *2 songs cannot be
                    armed*, *Setup has lapsed*. **A column shows a state, never a message**, and
                    this panel is read across a stage in the dark where a band of text at a control
                    is invisible.

                    **It is removed rather than relocated, and that is the honest move.** Every
                    sentence it carried is about setup, and setup has a screen that says all of it,
                    line by line: the gig flow's sign-off, one press away through `Setup`.
                    **Standby says which gig; Backstage says whether it is ready.** */}
                <div className="control-setup-extras" />
                <div className="control-setup-buttons">
                  {/* **`Choose` above `Setup`, and it is shown only when there is a gig to
                      choose** (Jorge, 2026-09-05). It opens the full-screen picker, exactly as
                      `Setlist` does for songs — **one pattern for both columns.**

                      **This supersedes *the gig name itself is the control*** (03/09). That made
                      the value the button because the panel is read at a distance in a dark room;
                      **the reasoning reverses on its own terms, because every other column already
                      carries a button in that slot**, so a button in a known position is the
                      easier target in the dark rather than the harder one.

                      **`Play` and `Select` were both rejected.** `Play` already means a transport
                      action in this suite — Muralista's `Play / Pause / Restart` — and here it
                      would sit two columns from `Arm` and read as *start something*; a button that
                      opens a list must not be named for an action it does not take. `Select` names
                      the mechanism, against the run of `Backstage`, `Save to the catalogue` and
                      `Sign off the gig`. **`Choose` is already the app's word for opening a
                      picker**, on the folders screen.

                      **From nothing there is no button and no empty picker.** The column reads
                      `No gig`, the only control is `Setup`, and that says *go make one* without a
                      screen to say it in — the same shape as `No gigs yet.` with `New` above it.

                      **`Setup` is the shell's door drawn onto the player's screen.** The control
                      view is the performance surface; everything that is desk work is one level
                      below it, on Setup home. `Folders` came off this column deliberately — where
                      songs and media live on this machine is configuration rather than content,
                      and it lives in preferences now, reached from that screen. */}
                  {gigsExist && (
                    <div className="control-setup-button-row">
                      <button
                        type="button"
                        className="ctrl-btn ctrl-setup-link"
                        data-testid="control-gig-choose"
                        onClick={goToGigs}
                      >
                        Choose
                      </button>
                    </div>
                  )}
                  <div className="control-setup-button-row">
                    <button type="button" className="ctrl-btn ctrl-setup-link" onClick={goToSetupHome}>
                      Setup
                    </button>
                  </div>
                </div>
              </div>
              <div className="control-setup-section">
                <span className="control-setup-label">Song</span>
                <div className="control-setup-content">
                  {currentSongId && lines.length > 0 ? (
                    <SetupValue text={currentSongTitle} />
                  ) : null}
                </div>
                <div className="control-setup-extras" />
                <div className="control-setup-buttons">
                  <div className="control-setup-button-row">
                    <button type="button" className="ctrl-btn ctrl-setup-link" onClick={goToSongs}>
                      Setlist
                    </button>
                  </div>
                </div>
              </div>
              <div className="control-setup-section">
                <span className="control-setup-label">Lyrics display</span>
                <div className="control-setup-content">
                  {effectiveLang ? (
                    <SetupValue text={languagesDisplay} />
                  ) : null}
                </div>
                <div className="control-setup-extras">
                  {/* **DRIVE MODE: THREE BUTTONS, ALWAYS THREE** (Jorge, 2026-09-04). The control
                      keeps the same shape song to song and can be hit without looking. **Only-the-
                      possible was rejected**: a control that changes shape per song is harder to
                      use at distance than one with a dead button in it.

                      **A button that cannot act stays pressable and refuses, naming why in a
                      popup** — exactly as `Arm` does when the gig is not ready. That gives this
                      screen one behaviour rather than two, and it is the rule for a surface read
                      across a stage in the dark, where a band of text at a control is invisible.

                      **It replaces the `Transitions` toggle**, which was one of the two axes this
                      is assembled from; the other was `Videoclip`, and that one is gone with it. */}
                  <div className="control-setup-toggle-area">
                    <div className="ctrl-toggle-group">
                      <span className="ctrl-toggle-label">Drive mode</span>
                      <div className="ctrl-segmented" role="group" aria-label="Drive mode">
                        {DRIVE_MODES.map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={`ctrl-segment${driveMode === mode ? ' ctrl-segment--active' : ''}${driveModeAvailable(mode, driveCaps) ? '' : ' ctrl-segment--disabled'}`}
                            aria-pressed={driveMode === mode}
                            aria-disabled={!driveModeAvailable(mode, driveCaps)}
                            data-testid={`drive-mode-${mode}`}
                            onClick={() => chooseDriveMode(mode)}
                          >
                            {mode === 'video' ? 'Video' : mode === 'clock' ? 'Clock' : 'Manual'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  {/* **THE PERFORMED-TEMPO BOX IS GONE** (Jorge, 2026-09-05). It let a song be
                      performed at a tempo other than the recording's, stored per song under
                      `llt.performedBpm.v1`. **Tempo has one home and it is the song file**, so
                      there is no second number to type and nothing for a reset to clear. */}
                </div>
                <div className="control-setup-buttons">
                  <button type="button" className="ctrl-btn ctrl-setup-link" onClick={goToLanguages}>
                    Languages
                  </button>
                </div>
              </div>
              {window.electronAPI && (
                <div className="control-setup-section">
                  <span className="control-setup-label">Projection</span>
                  <div className="control-setup-content">
                    {/* **`Open` or `Closed`, and nothing about size** (2026-09-06). It read
                        `Open, No video` / `Open, Small` / `Open, Big` off the display mode, and
                        with the Videoclip toggle gone that was a status reporting a control that
                        no longer exists — and reporting it wrongly, since **whether the video runs
                        is the drive mode now.** The column says whether the window is open, which
                        is the one thing this column is about. */}
                    {/* **The two placement notes are gone from this column** (2026-09-06). One
                        said which display it landed on and one said why it had not — **messages,
                        and a column shows a state.** The one that mattered is the fallback, and
                        **it is not lost: it is in the value.** `Open, on this screen` is the state,
                        and it is readable at the distance this panel is read at, where a paragraph
                        is not. */}
                    <SetupValue text={getProjectionStatusText(projectionOpen, placement.placed)} />
                  </div>
                  {/* **THE VIDEOCLIP TOGGLE IS GONE** (Jorge, 2026-09-03, built 2026-09-06).
                      **Three things were tangled in one control**: format and placement, which are
                      setup and Muralista's, decided at the wall; **whether the video runs tonight,
                      which is the drive mode**; and size, which **was never a third thing** — it
                      was format wearing a performance control's clothes.

                      **Choosing `video` as the drive mode is what makes the video run**, and where
                      it lands was answered by the shapes weeks earlier. The rest of `DisplayMode`
                      is dead behind this and goes next. */}
                  <div className="control-setup-extras" />
                  <div className="control-setup-buttons">
                    <ProjectionButton isOpen={projectionOpen} onToggle={handleToggleProjection} />
                  </div>
                </div>
              )}
              {/* **THE RIG COLUMN IS GONE** (Jorge, 2026-09-04, said for the third time; it was
                  already owed removal on 02/09 for not being understood). **None of it is a
                  performance concern**, and it was inert anyway — a static list with no state and
                  no store, which is a decision pretending to be a question.

                  **The rest of the arrangement is unchanged**: same columns, same order, same
                  proportions. The redesign is what is *in* them, not how they are laid out, and
                  that is not this round.

                  `RIG_CHECKLIST` itself stays: `GigView`'s step-5 checklist still renders it, and
                  that one is ticked rather than read. */}
              <div className="control-setup-section">
                <span className="control-setup-label">Arm</span>
                <div className="control-setup-content">
                  <SetupValue text="Unarmed" />
                </div>
                {/* **THE BULLETS ARE GONE FROM THIS COLUMN** (2026-09-06). They said why the song
                    could not be armed, and why setup had lapsed. **A column shows a state, never a
                    message.**

                    **The refusal is not lost, it is moved to where it can be read**: `Arm` stays
                    pressable and says why it cannot act, in a popup, exactly as a drive-mode button
                    does. **That gives this screen one behaviour rather than two** — a control that
                    cannot act says why when pressed — which is the ruling drive mode already
                    follows.

                    **The setup warning is removed rather than moved, and deliberately.** It is not
                    a gate: arming an unconfirmed gig warns and proceeds, so a popup carrying it
                    would be a dialog in front of the one press that must never wait. Everything it
                    said is on the gig flow's sign-off, line by line, one press away through
                    `Setup`. */}
                <div className="control-setup-extras" />
                <div className="control-setup-buttons">
                  <button
                    type="button"
                    className="ctrl-btn ctrl-arm"
                    data-testid="control-arm-button"
                    // **Pressable, and honest about not being able to act.** `disabled` would take
                    // the press and with it the only way to find out why — which is how the walk
                    // of `v0.80.0` ended at moment 5. `aria-disabled` says the same thing to a
                    // reader without taking the press away.
                    aria-disabled={!canArm}
                    onClick={handleArmPressed}
                  >
                    Arm
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
        {showArmedShell && showVideoPerformance && (
          <VideoPerformancePanel
            // **The panel is remounted per song, so mount is *a song loaded*** — the trigger the
            // beat indicator starts on, written once rather than as a second `next` path here.
            key={currentSongId}
            songFinished={isEndOfSong}
            absolutePath={resolvedVideoPath}
            timeline={currentLibrarySong!.timeline ?? []}
            leadIn={currentLibrarySong!.leadIn}
            lines={lines}
            singingLang={effectiveSingingLang}
            tempo={songTempo}
            onUnarm={handleUnarm}
            onSeek={sendSeek}
          />
        )}
        {showArmedShell && !showVideoPerformance && (
          <>
            <div className="control-performing-stage" data-testid="performing-content" style={{ position: 'relative' }}>
              {/* **THE BEAT INDICATOR: `clock` AND `video` ONLY, NEVER `manual`** (Jorge,
                  2026-09-05). **This supersedes moments 6 and 7**, which both said it shows in
                  all three drive modes.

                  **Two reasons, and the second settles it.** The indicator exists to keep Jorge
                  with something that is running on its own — the timeline here, the animation in
                  the video panel. **In `manual` nothing is running: he is the clock**, so there
                  is nothing to drift from and nothing to report. And a manual-only song may carry
                  no tempo at all, so in the one mode where it would be drawn there is frequently
                  no pulse to draw.

                  **`isAutoArmed` is `clock`.** Drive mode is not a concept in this code yet — it
                  is assembled from two axes that are (`isVideoMode`, and the Transitions toggle)
                  — and `isAutoArmed` is exactly *non-video, Auto, has a timeline*, which is what
                  `clock` names. **P6 falls out of it for free:** a `Next` mid-song takes the
                  wheel, `effectiveAdvanceMode` becomes `manual`, and the indicator goes with it,
                  because from that press onward he is the clock.

                  **One condition, not an exception:** drawn when the mode is `clock` and the
                  song has a tempo. A song without one shows nothing, in any mode.

                  **It stops when the song finishes.** `isEndOfSong` is the app's own word for
                  that — the last lyric line is up, the transport button has flipped to `Unarm`
                  and the next song is being offered. It starts again on `next`, because that
                  loads a song.

                  **THE COUNT-IN WENT TOO, AND SO DID THE STEP THAT RAN IT** (Jorge,
                  2026-09-06). The 05/09 ruling read *not in `manual`, at the cue or during the
                  song*; the running pulse was unambiguous and the count-in was not, so it was
                  left standing and put back as a question. **Answered: nothing beat-related
                  exists in `manual` at all.** R2's Manual Start step is deleted with it, because
                  the indicator was its only observable effect and **a step that does nothing you
                  can see is worse than no step.** So `clock` is the whole of the condition here,
                  and there is no second clause. */}
              {isAutoArmed && songTempo && !isEndOfSong && (
                <div
                  className="control-beat-clock-wrap"
                  style={{
                    position: 'absolute',
                    bottom: '0.75rem',
                    left: '0.75rem',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <BeatCircle tempo={songTempo} phase={beatPhase} />
                </div>
              )}
              {/* P6: the song is no longer driving itself — the performer has taken the wheel.
                  Must be readable at a glance, mid-song, under stage light. */}
              {manualOverrideTaken && (
                <div
                  className="control-manual-override-badge"
                  data-testid="manual-override-badge"
                  style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem' }}
                >
                  MANUAL
                </div>
              )}
              <div className="control-performing-stage-stack">
                <div className="control-performing-lyric-block">
                  {/* T2: in Auto, once Play is pressed the performer screen is black until the
                      first cue (mirrors the audience) — no notes, intro, or instruction. */}
                  <p className="control-lyric">
                    {autoPerformanceStarted && notStarted ? '' : displayText}
                  </p>
                  {!notStarted && (
                    <span
                      data-testid="control-next-preview"
                      className="control-next-preview"
                    >
                      {nextPreviewText}
                    </span>
                  )}
                  {notStarted && !autoPerformanceStarted && songIntro && (
                    <p className="control-song-intro">{songIntro}</p>
                  )}
                  {notStarted && !autoPerformanceStarted && (
                    <p className="control-state-instruction">
                      {isCueStartAuto
                        ? 'Press Next when ready to start the song'
                        : isAutoArmed
                          ? 'Press Play to start'
                          : 'Press Next to reveal the first line'}
                    </p>
                  )}
                </div>
                {isEndOfSong && nextSongForTile && showNextSongTile && (
                  <div className="performing-next-song-tile-wrap">
                    <span className="performing-next-song-helper-label">Tap to continue</span>
                    <button
                      type="button"
                      className="songs-song-btn"
                      data-testid="next-song-tile"
                      onClick={handleStartNextSongInConcertSession}
                    >
                      <span className="songs-song-title">{nextSongForTile.title}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </main>

      {showArmedShell && (
        <div className="ctrl-timer-floating" data-testid="performance-status-floating">
          <button
            type="button"
            ref={timerCircleContainerRef}
            className={`ctrl-btn ctrl-timer-status ctrl-timer-status-circle ${timerPaused ? 'ctrl-timer-status-paused' : ''}`}
            data-testid="performance-status-button"
            aria-label="Toggle performance timer actions"
            onClick={() => setTimerActionsVisible((visible) => !visible)}
          >
            <span
              className="ctrl-timer-status-minutes ctrl-timer-status-minutes-prominent"
              data-testid="performance-status-minutes"
            >
              {elapsedMinutes}'
            </span>
          </button>
          {timerActionsVisible && (
            <div
              ref={timerActionsContainerRef}
              className="ctrl-timer-actions"
              data-testid="performance-status-actions"
            >
              <button
                type="button"
                className="ctrl-btn ctrl-timer-action"
                onClick={() => concertTimer.togglePause()}
              >
                {timerPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                type="button"
                className="ctrl-btn ctrl-timer-action"
                onClick={() => {
                  concertTimer.reset()
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      )}

      {showArmedShell && !showVideoPerformance && (
        <footer className="control-bottom-bar">
          <div className="bottom-buttons">
            {isCueStartAuto ? (
              <>
                {/* P1: cue-start Auto (v2 timeline, no video) — no Play button and no
                    count-in; the first Next press (or a pedal press mapped to it) IS the
                    timeline's start cue, handled inside handleNext via startAtCue(). Manual
                    Next/Previous stay available throughout, before and after the cue, as the
                    override they already are elsewhere. Pause/Restart only make sense — and
                    only appear — once there is something to pause or restart. */}
                <button
                  type="button"
                  className="ctrl-btn ctrl-prev"
                  onClick={handlePrev}
                  disabled={lines.length === 0 || index <= -1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="ctrl-btn ctrl-next"
                  onClick={handleNext}
                  disabled={nextDisabled}
                >
                  Next
                </button>
                {autoPerformanceStarted && (
                  <>
                    {beatPlayState === 'paused' ? (
                      /* Not itself in the P1 acceptance list, but Pause with no way back would
                         be a dead end mid-performance — resuming reuses startBeatClock(),
                         which already special-cases playState === 'paused' before its
                         count-in branch, so it resumes correctly regardless of tempo. */
                      <button
                        type="button"
                        className="ctrl-btn ctrl-auto-play ctrl-arm"
                        onClick={startBeatClock}
                        aria-label="Resume"
                      >
                        Resume
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="ctrl-btn ctrl-auto-pause"
                        onClick={handleAutoPause}
                        disabled={beatPlayState !== 'playing'}
                        aria-label="Pause"
                      >
                        Pause
                      </button>
                    )}
                    <button
                      type="button"
                      className="ctrl-btn ctrl-auto-restart"
                      onClick={handleAutoRestart}
                      aria-label="Restart"
                    >
                      Restart
                    </button>
                  </>
                )}
              </>
            ) : isAutoArmed ? (
              <>
                {/* T2: Auto uses video-style transport — you don't reason in terms of
                    next/previous, the beat clock drives the cues. */}
                <button
                  type="button"
                  className={`ctrl-btn ctrl-auto-play${beatPlayState === 'idle' || beatPlayState === 'paused' ? ' ctrl-arm' : ''}`}
                  onClick={handleAutoPlay}
                  disabled={!(beatPlayState === 'idle' || beatPlayState === 'paused')}
                  aria-label="Play"
                >
                  Play
                </button>
                <button
                  type="button"
                  className="ctrl-btn ctrl-auto-pause"
                  onClick={handleAutoPause}
                  disabled={!(beatPlayState === 'count-in' || beatPlayState === 'playing')}
                  aria-label="Pause"
                >
                  Pause
                </button>
                <button
                  type="button"
                  className="ctrl-btn ctrl-auto-restart"
                  onClick={handleAutoRestart}
                  aria-label="Restart"
                >
                  Restart
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ctrl-btn ctrl-prev"
                  onClick={handlePrev}
                  disabled={lines.length === 0 || index <= -1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="ctrl-btn ctrl-next"
                  onClick={handleNext}
                  disabled={nextDisabled}
                >
                  Next
                </button>
                {/* **One Restart, because there is no Start step to return to** (Jorge,
                    2026-09-06). R2 put a `Start` here for a manual song with a tempo, and a
                    second `Restart` behind it that went back to the pre-Start state. Both were
                    the count-in's, and the count-in has left `manual`. */}
                <button
                  type="button"
                  className="ctrl-btn ctrl-restart"
                  onPointerDown={restartHold.onPointerDown}
                  onPointerUp={restartHold.onPointerUp}
                  onPointerLeave={restartHold.onPointerLeave}
                >
                  {restartHold.isHolding ? 'Hold to confirm…' : 'Restart'}
                </button>
              </>
            )}
            <button
              type="button"
              className={`ctrl-btn ${isEndOfSong ? 'ctrl-arm' : 'ctrl-unarm'}`}
              onClick={
                isEndOfSong && canUnarm
                  ? () => {
                      if (currentSongId)
                        addPlayedSong(currentSongId, { startedAt: songLoadedAtRef.current })
                      handleUnarm()
                    }
                  : undefined
              }
              onPointerDown={!isEndOfSong && canUnarm ? unarmHold.onPointerDown : undefined}
              onPointerUp={!isEndOfSong && canUnarm ? unarmHold.onPointerUp : undefined}
              onPointerLeave={!isEndOfSong && canUnarm ? unarmHold.onPointerLeave : undefined}
              disabled={!canUnarm}
              aria-label="Unarm (return to setup without clearing song, language, or projection)"
            >
              {isEndOfSong ? 'Unarm' : unarmHold.isHolding ? 'Hold to confirm…' : 'Unarm'}
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}
