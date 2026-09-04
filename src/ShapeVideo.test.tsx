/** @vitest-environment jsdom */
/**
 * The playing song's media, inside a `song-video` shape.
 *
 * This carries forward the transport behaviour the full-frame renderer had — it does not auto-play,
 * it starts paused at `trimStart`, and it obeys the play/pause/stop and seek commands the Control
 * window broadcasts — because the channel outlived the renderer. What is gone with the renderer is
 * the letterbox and the subtitle band: **the quad is the framing now**, and stretch-to-fill is a
 * fixed behaviour rather than an option.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'

vi.mock('./mediaPathStore', () => ({
  absolutePathToMediaUrl: (path: string) => `media://${path}`,
}))

/**
 * **`trimStart` is a prop now, not a field of the song's media** (2026-09-04). A song holds no
 * media; what plays is named by `visuals.json`, and an assignment is a name — so the value has no
 * author today and defaults to 0. Kept as a prop, and tested at a non-zero value, because the
 * seeking behaviour is real and the number is the only thing without a home.
 */
const TRIM_START = 3.0

let playSpy: Mock<() => Promise<void>>
let pauseSpy: Mock<() => void>
let currentTimeSetter: Mock<(value: number) => void>

beforeEach(() => {
  playSpy = vi.fn<() => Promise<void>>(() => Promise.resolve())
  pauseSpy = vi.fn<() => void>()
  currentTimeSetter = vi.fn<(value: number) => void>()
  HTMLVideoElement.prototype.play = playSpy
  HTMLVideoElement.prototype.pause = pauseSpy
  Object.defineProperty(HTMLVideoElement.prototype, 'currentTime', {
    get: vi.fn(() => 0),
    set: currentTimeSetter,
    configurable: true,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

async function importShapeVideo() {
  const shapeVideo = await import('./ShapeVideo')
  const transport = await import('./videoTransport')
  return { ...shapeVideo, ...transport }
}

function fireTransport(key: string, action: 'play' | 'pause' | 'stop') {
  const payload = JSON.stringify({ action, nonce: Date.now() })
  window.dispatchEvent(new StorageEvent('storage', { key, newValue: payload }))
}

describe('ShapeVideo — mount', () => {
  it('does NOT auto-play on mount', async () => {
    const { ShapeVideo } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('seeks to trimStart on mount', async () => {
    const { ShapeVideo } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    expect(currentTimeSetter).toHaveBeenCalledWith(TRIM_START)
  })

  it('fills the unit box exactly, because the quad is the framing', async () => {
    const { ShapeVideo } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video.style.width).toBe('100%')
    expect(video.style.height).toBe('100%')
    // `fill`, not `contain`: a video that wants to sit differently is a different quad, so a
    // different shape. There is no letterbox here and no formatting to choose.
    expect(video.style.objectFit).toBe('fill')
  })
})

describe('ShapeVideo — transport', () => {
  it('plays when a play command arrives', async () => {
    const { ShapeVideo, VIDEO_TRANSPORT_KEY } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    await act(async () => { fireTransport(VIDEO_TRANSPORT_KEY, 'play') })
    expect(playSpy).toHaveBeenCalled()
  })

  it('ignores an unrelated storage key', async () => {
    const { ShapeVideo } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    await act(async () => { fireTransport('somethingElse', 'play') })
    expect(playSpy).not.toHaveBeenCalled()
  })

  it('pauses when a pause command arrives', async () => {
    const { ShapeVideo, VIDEO_TRANSPORT_KEY } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    await act(async () => { fireTransport(VIDEO_TRANSPORT_KEY, 'pause') })
    expect(pauseSpy).toHaveBeenCalled()
  })

  it('pauses and returns to trimStart on stop', async () => {
    const { ShapeVideo, VIDEO_TRANSPORT_KEY } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    currentTimeSetter.mockClear()
    await act(async () => { fireTransport(VIDEO_TRANSPORT_KEY, 'stop') })
    expect(pauseSpy).toHaveBeenCalled()
    expect(currentTimeSetter).toHaveBeenCalledWith(TRIM_START)
  })

  it('reports started and stopped to the caller that owns the intro card', async () => {
    const { ShapeVideo, VIDEO_TRANSPORT_KEY } = await importShapeVideo()
    const onStartedChange = vi.fn()
    await act(async () => {
      render(
        <ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} onStartedChange={onStartedChange} />
      )
    })
    await act(async () => { fireTransport(VIDEO_TRANSPORT_KEY, 'play') })
    expect(onStartedChange).toHaveBeenLastCalledWith(true)
    await act(async () => { fireTransport(VIDEO_TRANSPORT_KEY, 'stop') })
    expect(onStartedChange).toHaveBeenLastCalledWith(false)
  })

  it('seeks where the scrubber says', async () => {
    const { ShapeVideo, VIDEO_SEEK_TARGET_KEY } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    currentTimeSetter.mockClear()
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: VIDEO_SEEK_TARGET_KEY,
          newValue: JSON.stringify({ time: 12.5, nonce: Date.now() }),
        })
      )
    })
    expect(currentTimeSetter).toHaveBeenCalledWith(12.5)
  })

  it('survives a malformed payload rather than throwing at the projector', async () => {
    const { ShapeVideo, VIDEO_TRANSPORT_KEY } = await importShapeVideo()
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} />)
    })
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: VIDEO_TRANSPORT_KEY, newValue: 'not json' })
      )
    })
    expect(playSpy).not.toHaveBeenCalled()
  })
})

describe('ShapeVideo — the clock', () => {
  it('reports its own currentTime, which is what the lyrics read against', async () => {
    const { ShapeVideo } = await importShapeVideo()
    const onTimeUpdate = vi.fn()
    Object.defineProperty(HTMLVideoElement.prototype, 'currentTime', {
      get: vi.fn(() => 4.25),
      set: currentTimeSetter,
      configurable: true,
    })
    await act(async () => {
      render(<ShapeVideo absolutePath="/v.mp4" trimStart={TRIM_START} onTimeUpdate={onTimeUpdate} />)
    })
    const video = document.querySelector('video') as HTMLVideoElement
    await act(async () => { video.dispatchEvent(new Event('timeupdate')) })
    expect(onTimeUpdate).toHaveBeenCalledWith(4.25)
  })
})
