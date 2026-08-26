/**
 * Laying a lyric out inside a shape's unit box: the stretch correction, and the fields Muralista
 * writes for it.
 */
import { describe, it, expect } from 'vitest'
import {
  quadStretch,
  readTextFields,
  textLayoutBoxWidth,
  textLayoutInsetX,
  TEXT_DEFAULTS,
  TEXT_INSET,
} from './shapeTextLayout'
import { UNIT_SIZE } from './vendor/warp.js'
import type { Point } from './visualsFile'

const FULL: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
]

describe('quadStretch', () => {
  it('is the quad’s real-pixel width against its real-pixel height', () => {
    // A full-frame quad on a 16:9 output is 1920x1080 of real pixels.
    expect(quadStretch(FULL, 1920, 1080)).toBeCloseTo(1920 / 1080, 10)
  })

  it('is 1 for a square region, whatever the output size', () => {
    const square: Point[] = [
      [0, 0],
      [0.5, 0],
      [0.5, 1],
      [0, 1],
    ]
    expect(quadStretch(square, 1000, 500)).toBeCloseTo(1, 10)
  })

  it('takes the mean of opposite edges, because a trapezoid has no single width', () => {
    // A keystone: the top edge is half the bottom one. Neither is "the" width.
    const keystone: Point[] = [
      [0.25, 0],
      [0.75, 0],
      [1, 1],
      [0, 1],
    ]
    const horizontal = (0.5 * 1000 + 1 * 1000) / 2
    // The verticals are the slanted sides, so they are longer than the height.
    const side = Math.hypot(0.25 * 1000, 1 * 1000)
    expect(quadStretch(keystone, 1000, 1000)).toBeCloseTo(horizontal / side, 10)
  })

  it('answers 1 rather than a wrong number when there is no quad', () => {
    expect(quadStretch(null, 1920, 1080)).toBe(1)
    expect(quadStretch([[0, 0]] as Point[], 1920, 1080)).toBe(1)
  })
})

describe('textLayoutBoxWidth', () => {
  it('widens the layout box by exactly the stretch, so the counter-scale takes it back out', () => {
    expect(textLayoutBoxWidth(FULL, 1, 1920, 1080)).toBe(Math.round(UNIT_SIZE * (1920 / 1080)))
  })

  it('is a whole number — a fractional one collapses the fit to the floor in a box with room', () => {
    expect(Number.isInteger(textLayoutBoxWidth(FULL, 1, 1234, 567))).toBe(true)
  })

  it('halves the box at aspect 2, which paints letters twice as wide', () => {
    const at1 = textLayoutBoxWidth(FULL, 1, 1000, 1000)
    const at2 = textLayoutBoxWidth(FULL, 2, 1000, 1000)
    expect(at2).toBe(Math.round(at1 / 2))
  })

  it('never returns zero, whatever the file says', () => {
    expect(textLayoutBoxWidth(null, 1, 0, 0)).toBeGreaterThan(0)
  })
})

describe('textLayoutInsetX', () => {
  it('is a whole-pixel fraction of the box, so every quantity the fit compares is an integer', () => {
    expect(textLayoutInsetX(1777)).toBe(Math.round(TEXT_INSET * 1777))
    expect(Number.isInteger(textLayoutInsetX(1777))).toBe(true)
  })
})

describe('readTextFields', () => {
  it('defaults every field for a shape that declares none', () => {
    expect(readTextFields(undefined)).toEqual(TEXT_DEFAULTS)
  })

  it('reads what Muralista wrote', () => {
    expect(
      readTextFields({
        maxSize: 0.3,
        aspect: 1.4,
        align: 'left',
        color: '#ffcc00',
        outline: false,
        outlineWidth: 0.1,
      })
    ).toEqual({
      maxSize: 0.3,
      aspect: 1.4,
      align: 'left',
      color: '#ffcc00',
      outline: false,
      outlineWidth: 0.1,
    })
  })

  it('clamps a hand-edited file rather than trusting it', () => {
    const fields = readTextFields({ maxSize: 8, aspect: -3, align: 'justify', color: 'red' })
    expect(fields.maxSize).toBe(0.6)
    expect(fields.aspect).toBe(0.5)
    expect(fields.align).toBe('center')
    expect(fields.color).toBe('#ffffff')
  })
})
