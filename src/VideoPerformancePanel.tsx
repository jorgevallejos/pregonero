import { useEffect, useRef, useState, useCallback } from 'react'
import type { CSSProperties } from 'react'
import { getBeatPhase, type SongTempo, type BeatPhaseResult } from './beatScheduler'
import { absolutePathToMediaUrl } from './mediaPathStore'
import { videoCueLookup } from './videoCueLookup'
import { setVideoTransportCommand } from './VideoProjectionRegion'
import { useHoldToConfirm } from './useHoldToConfirm'
import { BeatCircle } from './BeatCircle'
import type { MediaFile, TimelineEntry } from './songState'

interface Props {
  absolutePath: string | null
  media: MediaFile
  timeline: TimelineEntry[]
  tempo?: SongTempo
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
  media,
  timeline,
  tempo,
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

  // Keep latest tempo in a ref so the interval closure always has fresh values without
  // being listed as a dependency (avoids restarting the interval on object identity changes).
  const tempoRef = useRef(tempo)
  tempoRef.current = tempo

  const trimStart = media.trimStart ?? 0
  const offset = media.offset ?? 0

  // ── clock interval ───────────────────────────────────────────────────────

  const isClockRunning = playState === 'count-in' || playState === 'playing'

  // Primitive dep values to avoid restarting the interval on object identity changes.
  const bpm = tempo?.bpm
  const numerator = tempo?.numerator
  const denominator = tempo?.denominator
  const countInBars = tempo?.countInBars

  useEffect(() => {
    if (!isClockRunning || !tempoRef.current) return

    const tick = () => {
      if (!tempoRef.current) return
      const elapsed = Date.now() - startMsRef.current
      const p = getBeatPhase(tempoRef.current, elapsed)
      setPhase(p)

      // Handoff: once count-in ends, start the video.
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
  }, [isClockRunning, bpm, numerator, denominator, countInBars])

  // ── Play button ──────────────────────────────────────────────────────────

  const handlePlay = useCallback(() => {
    if (playState === 'paused') {
      // Resume: adjust start epoch so elapsed continues from where it was.
      startMsRef.current = Date.now() - pausedElapsedRef.current
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
    setVideoTransportCommand('seek', trimStart)
    onSeek(trimStart)

    videoStartedRef.current = false
    startMsRef.current = Date.now()
    pausedElapsedRef.current = 0
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

  const unarmHold = useHoldToConfirm(onUnarm)

  // ── Track currentTime for subtitle display ────────────────────────────────

  const [activeCueIndex, setActiveCueIndex] = useState(-1)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTimeUpdate = () => {
      const t = video.currentTime
      setActiveCueIndex(videoCueLookup(timeline, t + offset))
    }
    video.addEventListener('timeupdate', onTimeUpdate)
    return () => video.removeEventListener('timeupdate', onTimeUpdate)
  }, [timeline, offset])

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
      <div className="video-perf-video-wrap" style={{ position: 'relative' }}>
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
      </div>
      <div className="video-perf-lyric-row">
        <span className="video-perf-cue-info">
          {activeCueIndex >= 0 ? `Cue ${activeCueIndex + 1} / ${timeline.length}` : '—'}
        </span>
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
