import { useEffect, useRef } from 'react'
import { absolutePathToMediaUrl } from './mediaPathStore'
import {
  VIDEO_SEEK_TARGET_KEY,
  VIDEO_TRANSPORT_KEY,
  type VideoSeekTarget,
  type VideoTransportCommand,
} from './videoTransport'

type Props = {
  absolutePath: string
  /**
   * **`trimStart` and `offset` are gone with the song's `media` block** (Jorge, 2026-09-03/04).
   * A song holds no media, and Muralista's assignment is a NAME — so the two manual corrections
   * that block carried have no home and default to zero. `videoCueLookup` documents that an offset
   * of 0 with no lead-in is bit-for-bit the original formula, so this is a lost adjustment rather
   * than a broken clock. Recorded here because it is the one thing the ruling did not name.
   */
  trimStart?: number
  /**
   * Reports the element's own clock. **Only the first video shape is given this**: it is the clock
   * the lyrics read against, and two clocks would be two answers to what line is showing.
   */
  onTimeUpdate?: (currentTime: number) => void
  /** Fires on the transport transitions the caller needs — play started, stopped back to the top. */
  onStartedChange?: (started: boolean) => void
}

/**
 * The playing song's media, filling a `song-video` shape.
 *
 * **No formatting at all, and that is the design rather than a shortcut.** The quad *is* the
 * framing, and stretch-to-fill is fixed v1 behaviour: a video that wants to sit differently is a
 * different quad, so a different shape. Hence `object-fit: fill` over the whole unit box — the box
 * is what the warp maps onto the corners, so filling it is what makes the video land exactly
 * inside them.
 */
export function ShapeVideo({ absolutePath, trimStart = 0, onTimeUpdate, onStartedChange }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Callbacks in a ref: the listeners below are attached once, and a caller that re-creates its
  // handler every render must not detach and reattach them (see the hook stability gotcha).
  const callbacks = useRef({ onTimeUpdate, onStartedChange })
  callbacks.current = { onTimeUpdate, onStartedChange }

  // Seek to trimStart when the src or trimStart changes. Does NOT auto-play.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = trimStart
  }, [absolutePath, trimStart])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => callbacks.current.onTimeUpdate?.(video.currentTime)
    video.addEventListener('timeupdate', onTime)
    return () => video.removeEventListener('timeupdate', onTime)
  }, [])

  // The legacy seek channel, used by VideoControlPanel's scrubber.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== VIDEO_SEEK_TARGET_KEY || !e.newValue) return
      try {
        const payload = JSON.parse(e.newValue) as VideoSeekTarget
        if (videoRef.current && typeof payload.time === 'number') {
          videoRef.current.currentTime = payload.time
        }
      } catch {
        // ignore malformed payloads
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // play / pause / stop from VideoPerformancePanel.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== VIDEO_TRANSPORT_KEY || !e.newValue) return
      try {
        const payload = JSON.parse(e.newValue) as VideoTransportCommand
        const video = videoRef.current
        if (!video) return
        if (payload.action === 'play') {
          callbacks.current.onStartedChange?.(true)
          void video.play().catch(() => {})
        } else if (payload.action === 'pause') {
          video.pause()
        } else if (payload.action === 'stop') {
          callbacks.current.onStartedChange?.(false)
          video.pause()
          video.currentTime = trimStart
        }
      } catch {
        // ignore malformed payloads
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [trimStart])

  return (
    <video
      ref={videoRef}
      data-testid="shape-video"
      src={absolutePathToMediaUrl(absolutePath)}
      muted
      playsInline
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        objectFit: 'fill',
        display: 'block',
      }}
    />
  )
}
