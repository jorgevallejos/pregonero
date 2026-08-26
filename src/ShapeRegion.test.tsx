/** @vitest-environment jsdom */
/**
 * The compositor primitive, and the caller obligations `docs/warp-contract.md` says no test can
 * catch. Most of them it cannot — they fail on a wall, at a gig. What *is* checkable is that this
 * component evaluates Muralista's function at the real output size on every render and holds no
 * matrix of its own, which is the mechanism the uncatchable failures all go through.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { ShapeRegion } from './ShapeRegion'
import { frameMatrix3d, UNIT_SIZE } from './vendor/warp.js'
import type { Point, VisualShape } from './visualsFile'

afterEach(cleanup)

const KEYSTONE: Point[] = [
  [0.2, 0.1],
  [0.9, 0.15],
  [0.85, 0.8],
  [0.15, 0.75],
]

function shapeWith(overrides: Partial<VisualShape>): VisualShape {
  return { id: 's1', name: 'S1', layer: { type: 'song-lyrics' }, visible: true, ...overrides }
}

function wrapper(): HTMLElement | null {
  return document.querySelector('.shape-wrapper')
}

describe('ShapeRegion', () => {
  it('maps the unit box onto the shape’s corners at the size it is given', () => {
    render(
      <ShapeRegion shape={shapeWith({ corners: KEYSTONE })} width={1920} height={1080}>
        <span>content</span>
      </ShapeRegion>
    )
    const el = wrapper()!
    expect(el.style.transform).toBe(frameMatrix3d(KEYSTONE, 1920, 1080))
    // The content box is the unit square, in px. Content that sizes itself against the screen
    // instead is not warped, it is guessed.
    expect(el.style.width).toBe(`${UNIT_SIZE}px`)
    expect(el.style.height).toBe(`${UNIT_SIZE}px`)
    expect(el.style.transformOrigin).toBe('0 0')
  })

  it('gives the same corners a different matrix at a different output size', () => {
    // The single most important property: the corners are normalised, the matrix is in real
    // stage pixels, and the projector at a venue is not the display the room was mapped on.
    const { rerender } = render(
      <ShapeRegion shape={shapeWith({ corners: KEYSTONE })} width={1920} height={1080}>
        <span>content</span>
      </ShapeRegion>
    )
    const atProjector = wrapper()!.style.transform
    rerender(
      <ShapeRegion shape={shapeWith({ corners: KEYSTONE })} width={1024} height={768}>
        <span>content</span>
      </ShapeRegion>
    )
    const atLaptop = wrapper()!.style.transform
    expect(atLaptop).not.toBe(atProjector)
    expect(atLaptop).toBe(frameMatrix3d(KEYSTONE, 1024, 768))
  })

  it('skips the render rather than painting a guess when the corners are degenerate', () => {
    const collinear: Point[] = [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0.5, 0],
    ]
    render(
      <ShapeRegion shape={shapeWith({ corners: collinear })} width={1920} height={1080}>
        <span>content</span>
      </ShapeRegion>
    )
    expect(wrapper()).toBeNull()
    expect(document.body.textContent).toBe('')
  })

  it('renders nothing for a shape with no frame at all', () => {
    render(
      <ShapeRegion shape={shapeWith({ corners: null, outline: null })} width={1920} height={1080}>
        <span>content</span>
      </ShapeRegion>
    )
    expect(wrapper()).toBeNull()
  })

  it('clips nothing while the outline is the frame', () => {
    render(
      <ShapeRegion
        shape={shapeWith({ corners: KEYSTONE, outline: KEYSTONE })}
        width={1920}
        height={1080}
      >
        <span>content</span>
      </ShapeRegion>
    )
    expect((document.querySelector('.shape-root') as HTMLElement).style.clipPath).toBe('')
  })

  it('clips along a many-point outline, in output pixels, and still warps by the frame', () => {
    const ring: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0.5, 0.9],
      [0, 1],
    ]
    render(
      <ShapeRegion
        shape={shapeWith({ corners: KEYSTONE, outline: ring })}
        width={1000}
        height={500}
      >
        <span>content</span>
      </ShapeRegion>
    )
    const root = document.querySelector('.shape-root') as HTMLElement
    expect(root.style.clipPath).toBe(
      'polygon(0px 0px, 1000px 0px, 1000px 500px, 500px 450px, 0px 500px)'
    )
    // The outline clips; it does not warp. The transform still comes from the four corners.
    expect(wrapper()!.style.transform).toBe(frameMatrix3d(KEYSTONE, 1000, 500))
  })

  it('recomputes rather than remembering — the same component, resized twice, never repeats', () => {
    const sizes: [number, number][] = [
      [1920, 1080],
      [1280, 800],
      [1920, 1080],
    ]
    const seen: string[] = []
    const { rerender } = render(
      <ShapeRegion shape={shapeWith({ corners: KEYSTONE })} width={1} height={1}>
        <span>content</span>
      </ShapeRegion>
    )
    for (const [w, h] of sizes) {
      act(() => {
        rerender(
          <ShapeRegion shape={shapeWith({ corners: KEYSTONE })} width={w} height={h}>
            <span>content</span>
          </ShapeRegion>
        )
      })
      seen.push(wrapper()!.style.transform)
    }
    expect(seen[0]).toBe(frameMatrix3d(KEYSTONE, 1920, 1080))
    expect(seen[1]).toBe(frameMatrix3d(KEYSTONE, 1280, 800))
    // Back to the first size: the matrix is the first one again because it was derived again,
    // not because anything held on to it.
    expect(seen[2]).toBe(seen[0])
  })
})
