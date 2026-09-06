/** @vitest-environment jsdom */
/**
 * The shapes Pregonero does not coordinate.
 *
 * What is being tested is mostly the *absence* of behaviour: no state, no arm dependency, no case
 * for the logo, and nothing at all for a test pattern.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ShapeStatic } from './ShapeStatic'
import { isStaticType } from './visualsFile'
import type { VisualShape } from './visualsFile'

vi.mock('./mediaPathStore', () => ({
  resolveMediaPath: (src: string) =>
    src === 'logo.png' || src === 'loop.mp4' ? `/media/${src}` : null,
  absolutePathToMediaUrl: (path: string) => `media://local${path}`,
}))

afterEach(cleanup)

function shapeWith(layer: Record<string, unknown>): VisualShape {
  return {
    id: 'static-1',
    name: 'Logo',
    corners: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    layer,
    visible: true,
  }
}

describe('isStaticType', () => {
  it('names the three kinds that are on because the projector is on', () => {
    expect(isStaticType('image')).toBe(true)
    expect(isStaticType('video')).toBe(true)
    expect(isStaticType('text')).toBe(true)
  })

  it('does not include the song-aware types, or the test pattern', () => {
    expect(isStaticType('song-lyrics')).toBe(false)
    expect(isStaticType('gig-contact')).toBe(false)
    expect(isStaticType('pattern')).toBe(false)
    expect(isStaticType('fill')).toBe(false)
  })
})

describe('ShapeStatic', () => {
  it('paints an image through this machine’s link table, filling the quad', () => {
    render(
      <ShapeStatic shape={shapeWith({ type: 'image', src: 'logo.png' })} type="image" width={1920} height={1080} />
    )
    const img = document.querySelector('img') as HTMLImageElement
    expect(img.getAttribute('src')).toBe('media://local/media/logo.png')
    expect(img.style.objectFit).toBe('fill')
    // Decorative by construction: the audience is not reading alt text off a wall.
    expect(img.getAttribute('aria-hidden')).toBe('true')
  })

  it('plays a static video muted and looping, with nothing deciding when', () => {
    render(
      <ShapeStatic shape={shapeWith({ type: 'video', src: 'loop.mp4' })} type="video" width={1920} height={1080} />
    )
    const video = document.querySelector('video') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe('media://local/media/loop.mp4')
    expect(video.muted).toBe(true)
    expect(video.hasAttribute('loop')).toBe(true)
    expect(video.hasAttribute('autoplay')).toBe(true)
  })

  it('paints nothing for a source this machine cannot resolve', () => {
    // A broken image on a wall says less than an empty shape does, and the fix is a link.
    render(
      <ShapeStatic shape={shapeWith({ type: 'image', src: 'unlinked.png' })} type="image" width={1920} height={1080} />
    )
    expect(document.querySelector('img')).toBeNull()
  })

  it('paints a text layer’s own string, with the layer’s own formatting', () => {
    render(
      <ShapeStatic
        shape={shapeWith({ type: 'text', text: 'CHANGO PEPPER', align: 'left', color: '#d98b7a' })}
        type="text"
        width={1000}
        height={1000}
      />
    )
    const inner = document.querySelector('.shape-text-inner') as HTMLElement
    expect(inner.textContent).toBe('CHANGO PEPPER')
    expect(inner.style.textAlign).toBe('left')
    expect(inner.style.color).toBe('rgb(217, 139, 122)')
  })

  it('paints nothing for an empty text layer', () => {
    render(
      <ShapeStatic shape={shapeWith({ type: 'text', text: '' })} type="text" width={1000} height={1000} />
    )
    expect(document.querySelector('.shape-text-inner')).toBeNull()
  })
})
