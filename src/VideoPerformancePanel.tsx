import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { getBeatPhase, type SongTempo, type BeatPhaseResult } from './beatScheduler'
import { absolutePathToMediaUrl } from './mediaPathStore'
import { resolveVideoSongTime, videoCueLookup } from './videoCueLookup'
import { isPastLastCue } from './autoAdvanceState'
import { setVideoTransportCommand } from './videoTransport'
import { useHoldToConfirm } from './useHoldToConfirm'
import { BeatCircle } from './BeatCircle'
import { isLyricLine, getLyricText, type SongItem, type TimelineEntry, type TimelineLeadIn } from './songState'

interface Props {
  absolutePath: string | null
  timeline: TimelineEntry[]
  /** Lead-in metadata for a v2 timeline. Undefined for legacy timelines — no offset applied. */
  leadIn?: TimelineLeadIn
  lines: SongItem[]
  singingLang: string
  tempo?: SongTempo
  /**
   * **Whether the song has finished** — the last lyric line is up and the transport has flipped
   * to `Unarm`. The beat indicator stops here (Jorge, 2026-09-05); nothing else uses it.
   */
  songFinished?: boolean
  /**
   * **The video has passed the last cue: the song is over.**
   *
   * `v0.94.0` gave a song an ending in `clock` and in `manual`, and **Video mode reached neither**
   * — the clock's ending lives in an effect that returns early here, and manual's is a press this
   * mode does not make. So the last phrase stayed on the wall, the song was never marked finished,
   * and the setlist could never end.
   *
   * **The panel reports; it does not decide.** Ending a song is one act and it lives in
   * `ControlView.endCurrentSong`, which owns the played log — the same act the other two modes
   * reach. What differs per mode is only which clock is read, and that difference is irreducible.
   *
   * **Fired once**, because a video that reaches its end keeps the last `timeupdate` it fired and
   * a paused one can be scrubbed past the end again.
   */
  onSongEnded?: () => void
  onUnarm: () => void
  onSeek: (targetTime: number) => void
}

type PlayState = 'idle' | 'count-in' | 'playing' | 'paused'

const TICK_MS = 50

/**
 * Whether this tempo + song has a real count-in (countInBars > 0).
 * A song with no tempo, or countInBars undefined/0, goes straight to video play on Play.
 */
function hasCountIn(tempo: SongTempo | undefined): boolean {
  if (!tempo) return false
  return (tempo.countInBars ?? 0) > 0
}

export function VideoPerformancePanel({
  absolutePath,
  timeline,
  leadIn,
  lines,
  singingLang,
  tempo,
  songFinished = false,
  onSongEnded,
  onUnarm,
  onSeek,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [playState, setPlayState] = useState<PlayState>('idle')

  // Clock state — one source of truth for elapsed time.
  // startMsRef holds the adjusted epoch so that elapsed = Date.now() - startMsRef is correct
  // even after a pause/resume cycle.
  const startMsRef = useRef<number>(0)
  // How much time had elapsed when the clock was last paused.
  const pausedElapsedRef = useRef<number>(0)
  // Whether video.play() has been triggered for the current play session.
  const videoStartedRef = useRef(false)

  const [phase, setPhase] = useState<BeatPhaseResult | null>(null)

  /**
   * **THE PULSE'S OWN EPOCH, SET WHEN THE SONG LOADS** (Jorge, 2026-09-05).
   *
   * The beat runs through *loaded, not yet cued* — the intro card up — through the press, and
   * into *running*. Before this the indicator was null until `Play`, so the half the design
   * asks for most (**he gets into the rhythm and eventually presses start**) was the half that
   * was missing.
   *
   * **The panel is remounted per song by its `key`**, so mount is load: that is the one rule —
   * arming loads the first song and `next` loads every other — rather than a second trigger
   * written here that could drift from the non-video one in `useBeatClock`.
   *
   * **This is the same two-clock split `useBeatClock` documents under P5**, and it is a second
   * implementation of it. Read that note before changing either: the pulse is a click track the
   * performer plays to, on its own epoch, and the transport's epoch is the count-in's. `Play`
   * re-anchors both, deliberately, because a count-in exists to establish the downbeat.
   */
  const pulseStartMsRef = useRef<number>(Date.now())
  const pausedPulseElapsedRef = useRef<number>(0)

  // Keep latest tempo in a ref so the interval closure always has fresh values without
  // being listed as a dependency (avoids restarting the interval on object identity changes).
  const tempoRef = useRef(tempo)
  tempoRef.current = tempo

  // **Both were the song's `media` block, which no longer exists.** A song holds no media; what
  // plays is named by `visuals.json`, and an assignment is a name. So the two manual corrections
  // default to zero — see `ShapeVideo`, which records the same loss.
  const trimStart = 0
  const offset = 0

  // ── clock interval ───────────────────────────────────────────────────────

  const isClockRunning = playState === 'count-in' || playState === 'playing'

  // Primitive dep values to avoid restarting the interval on object identity changes.
  const bpm = tempo?.bpm
  const numerator = tempo?.numerator
  const denominator = tempo?.denominator
  const countInBars = tempo?.countInBars

  // **The pulse runs from the moment the song loads**, not from `Play` — and it stops when the
  // song finishes, which is when the wall goes black and there is nothing left to keep time to.
  const isPulseRunning = tempo !== undefined && playState !== 'paused' && !songFinished
  const shouldTick = isClockRunning || isPulseRunning

  const isClockRunningRef = useRef(isClockRunning)
  isClockRunningRef.current = isClockRunning
  const isCountingInRef = useRef(false)
  isCountingInRef.current = playState === 'count-in'

  useEffect(() => {
    if (!shouldTick) return

    const tick = () => {
      const tempoNow = tempoRef.current
      if (!tempoNow) {
        setPhase(null)
        return
      }
      const now = Date.now()

      // ── The pulse, on its own epoch ──
      // The count-in concept is suppressed unless a count-in is actually running: a free-running
      // idle pulse is a plain click, not a phantom count-in the performer would read as meaning
      // something. During a real count-in both epochs are the same, so this is byte-identical to
      // what `Play` produced before the pulse existed here.
      const pulseTempo = isCountingInRef.current ? tempoNow : { ...tempoNow, countInBars: 0 }
      setPhase(getBeatPhase(pulseTempo, now - pulseStartMsRef.current))

      // ── The transport, and the count-in → video handoff ──
      if (!isClockRunningRef.current) return
      const p = getBeatPhase(tempoNow, now - startMsRef.current)
      if (p.beginFired && !videoStartedRef.current) {
        videoStartedRef.current = true
        videoRef.current?.play().catch(() => {})
        setVideoTransportCommand('play')
        setPlayState('playing')
      }
    }

    tick()
    const id = setInterval(tick, TICK_MS)
    return () => clearInterval(id)
  }, [shouldTick, bpm, numerator, denominator, countInBars])

  // The song is over: the indicator goes with it rather than freezing on its last beat.
  useEffect(() => {
    if (songFinished) setPhase(null)
  }, [songFinished])

  // ── Play button ──────────────────────────────────────────────────────────

  const handlePlay = useCallback(() => {
    if (playState === 'paused') {
      // Resume: adjust both epochs so each continues from where it was — the pulse resumes the
      // click rather than re-anchoring it.
      startMsRef.current = Date.now() - pausedElapsedRef.current
      pulseStartMsRef.current = Date.now() - pausedPulseElapsedRef.current
      if (videoStartedRef.current) {
        // Video had been started before the pause; resume it.
        videoRef.current?.play().catch(() => {})
        setPlayState('playing')
      } else {
        // Paused during count-in; count-in continues.
        setPlayState('count-in')
      }
      return
    }

    if (playState !== 'idle') return

    // Fresh start
    videoStartedRef.current = false
    startMsRef.current = Date.now()
    // A count-in's job is to establish the downbeat, so Play defines the phase — the same
    // entitlement `useBeatClock`'s `start()` has, and the reason the cue has none.
    pulseStartMsRef.current = startMsRef.current
    pausedPulseElapsedRef.current = 0

    if (!hasCountIn(tempo)) {
      // No count-in: start video immediately.
      videoStartedRef.current = true
      videoRef.current?.play().catch(() => {})
      setVideoTransportCommand('play')
      setPlayState('playing')
    } else {
      setPlayState('count-in')
    }
  }, [playState, tempo])

  // ── Pause button ─────────────────────────────────────────────────────────

  const handlePause = useCallback(() => {
    if (playState !== 'count-in' && playState !== 'playing') return
    pausedElapsedRef.current = Date.now() - startMsRef.current
    pausedPulseElapsedRef.current = Date.now() - pulseStartMsRef.current
    videoRef.current?.pause()
    setVideoTransportCommand('pause')
    setPlayState('paused')
    setPhase((prev) => prev) // keep phase frozen at current value
  }, [playState])

  // ── Restart button ────────────────────────────────────────────────────────

  const handleRestart = useCallback(() => {
    // Reset video to trimStart.
    const video = videoRef.current
    if (video) {
      video.pause()
      video.currentTime = trimStart
    }
    setVideoTransportCommand('stop')
    onSeek(trimStart)

    videoStartedRef.current = false
    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
    // Restart re-runs the count-in, so it re-anchors the pulse with it (see the Play branch).
    pulseStartMsRef.current = startMsRef.current
    pausedPulseElapsedRef.current = 0
    setPhase(null)

    if (!hasCountIn(tempo)) {
      videoStartedRef.current = true
      video?.play().catch(() => {})
      setVideoTransportCommand('play')
      setPlayState('playing')
    } else {
      setPlayState('count-in')
    }
  }, [tempo, trimStart, onSeek])

  // ── Unarm button ─────────────────────────────────────────────────────────

  const unarmHold = useHoldToConfirm(() => { setVideoTransportCommand('stop'); onUnarm() })

  // ── Track currentTime for subtitle display ────────────────────────────────

  const [activeCueIndex, setActiveCueIndex] = useState(-1)

  // **Reported once per song.** Reset when the timeline changes, which is what a new song is here.
  const endedReportedRef = useRef(false)
  useEffect(() => {
    endedReportedRef.current = false
  }, [timeline])
  const onSongEndedRef = useRef(onSongEnded)
  onSongEndedRef.current = onSongEnded

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTimeUpdate = () => {
      // **The panel is only ever mounted in Video mode**, which is what makes `true` the honest
      // answer here: `showVideoPerformance` gates it on `isVideoMode`, and that is now *a video is
      // assigned to this song for this gig*. The contract's table, read where it can be answered.
      const songTime = resolveVideoSongTime(video.currentTime, offset, leadIn, true)
      setActiveCueIndex(videoCueLookup(timeline, songTime))
      // **The same predicate the clock's ending uses**, against this mode's own clock. Past the
      // last cue the lookup answers `-1`, which would have cleared the phrase — but a video that
      // reaches its end stops firing `timeupdate`, so the last index computed is the last index
      // there is. **Nothing was wrong with the lookup; nothing asked it again.**
      if (!endedReportedRef.current && isPastLastCue(timeline, songTime * 1000)) {
        endedReportedRef.current = true
        onSongEndedRef.current?.()
      }
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
    // Depend on leadIn's primitive fields, not the object itself — `leadIn` is derived from the
    // library song and may be a fresh object every render (see the "Hook stability gotcha" in
    // CLAUDE.md).
  }, [timeline, offset, leadIn?.durationSec])

  // Derive the current singing-language lyric text from activeCueIndex → lines.
  // Section markers and out-of-range indices render no lyric text.
  const activeItem =
    activeCueIndex >= 0 && activeCueIndex < lines.length ? lines[activeCueIndex] : null
  const activeLyricText =
    activeItem && isLyricLine(activeItem) ? getLyricText(activeItem, singingLang) : ''

  // ── No-path state ─────────────────────────────────────────────────────────

  if (!absolutePath) {
    return (
      <div className="video-perf-panel video-perf-panel-nopath" data-testid="video-perf-no-path">
        <p>Video not linked. Link it from Manage Setlists.</p>
        <VideoPerfBottomBar
          playState={playState}
          onPlay={handlePlay}
          onPause={handlePause}
          onRestart={handleRestart}
          unarmHold={unarmHold}
        />
      </div>
    )
  }

  const beatCircleStyle: CSSProperties = {
    position: 'absolute',
    bottom: '0.75rem',
    right: '0.75rem',
  }

  return (
    <div className="video-perf-panel">
      <div className="video-perf-video-wrap">
        <video
          ref={videoRef}
          src={absolutePathToMediaUrl(absolutePath)}
          muted
          playsInline
          className="video-perf-preview"
        />
        {tempo && (
          <BeatCircle tempo={tempo} phase={phase} style={beatCircleStyle} />
        )}
        {activeLyricText && (
          <p
            className="control-lyric video-perf-lyric-overlay"
            data-testid="video-perf-lyric-overlay"
          >
            {activeLyricText}
          </p>
        )}
      </div>
      <VideoPerfBottomBar
        playState={playState}
        onPlay={handlePlay}
        onPause={handlePause}
        onRestart={handleRestart}
        unarmHold={unarmHold}
      />
    </div>
  )
}

interface BottomBarProps {
  playState: PlayState
  onPlay: () => void
  onPause: () => void
  onRestart: () => void
  unarmHold: ReturnType<typeof useHoldToConfirm>
}

function VideoPerfBottomBar({ playState, onPlay, onPause, onRestart, unarmHold }: BottomBarProps) {
  const isPlayActive = playState === 'idle' || playState === 'paused'
  const isPauseActive = playState === 'count-in' || playState === 'playing'
  return (
    <div className="video-perf-bottom-bar">
      <button
        type="button"
        className={`ctrl-btn video-perf-play${isPlayActive ? ' ctrl-arm' : ''}`}
        onClick={onPlay}
        disabled={!isPlayActive}
        aria-label="Play"
      >
        Play
      </button>
      <button
        type="button"
        className="ctrl-btn video-perf-pause"
        onClick={onPause}
        disabled={!isPauseActive}
        aria-label="Pause"
      >
        Pause
      </button>
      <button
        type="button"
        className="ctrl-btn video-perf-restart"
        onClick={onRestart}
        aria-label="Restart"
      >
        Restart
      </button>
      <button
        type="button"
        className="ctrl-btn ctrl-unarm video-perf-unarm"
        onPointerDown={unarmHold.onPointerDown}
        onPointerUp={unarmHold.onPointerUp}
        onPointerLeave={unarmHold.onPointerLeave}
        aria-label="Unarm"
      >
        {unarmHold.isHolding ? 'Hold to confirm…' : 'Unarm'}
      </button>
    </div>
  )
}
