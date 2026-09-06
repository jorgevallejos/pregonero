/**
 * Laying a lyric out inside a shape's unit box: the stretch correction, and the fields Muralista
 * writes for it.
 */
import { describe, it, expect } from 'vitest'
import {
  fitInBox,
  TEXT_MIN_PX,
  quadStretch,
  readTextFields,
  textLayoutBoxWidth,
  textLayoutInsetX,
  TEXT_DEFAULTS,
  TEXT_INSET,
  TEXT_INSET_Y,
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

/**
 * **When a real line beats the boundary, it shrinks — it never spills.**
 *
 * Muralista tunes `maxSize` against its dummy line and writes down a boundary; Pregonero renders
 * the real lyrics inside it. Muralista's v1 scope is that text cannot overflow, so the answer for a
 * line that beats the boundary anyway is a smaller line — and **only that line**, because text
 * jumping size line to line on a wall is worse than text being smaller.
 */
describe('a line against the boundary', () => {
  /**
   * A box whose contents get taller as the font grows, so the fit has something monotonic to search.
   * `charsPerRow` at the maximum size is what decides whether a given string fits.
   */
  function fakeBox(opts: { text: string; boxW: number; boxH: number; charWidthAtPx1: number }) {
    const box = { clientWidth: opts.boxW, clientHeight: opts.boxH } as HTMLElement
    let px = 0
    const measured = {
      get scrollWidth() {
        // A single unbreakable run cannot wrap: its width is the width that has to fit.
        const longest = opts.text.split(/\s+/).reduce((m, w) => Math.max(m, w.length), 0)
        return Math.ceil(longest * opts.charWidthAtPx1 * px)
      },
      get scrollHeight() {
        const available = opts.boxW - 2 * Math.round(TEXT_INSET * opts.boxW)
        const perRow = Math.max(1, Math.floor(available / (opts.charWidthAtPx1 * px)))
        return Math.ceil(opts.text.length / perRow) * Math.ceil(px * 1.15)
      },
    } as unknown as HTMLElement
    return {
      box,
      measured,
      apply: (n: number) => {
        px = n
      },
    }
  }

  const MAX = 200

  it('renders at the boundary, untouched, when the line fits', () => {
    const f = fakeBox({ text: 'Libertad', boxW: 1000, boxH: 1000, charWidthAtPx1: 0.5 })
    expect(fitInBox(f.box, f.measured, f.apply, MAX, textLayoutInsetX(1000), TEXT_INSET_Y)).toBe(MAX)
  })

  it('is uniform across every line that fits — the same size, not a size each', () => {
    const sizes = ['Libertad', 'Soy una puerta', 'Paso'].map((text) => {
      const f = fakeBox({ text, boxW: 1000, boxH: 1000, charWidthAtPx1: 0.5 })
      return fitInBox(f.box, f.measured, f.apply, MAX, textLayoutInsetX(1000), TEXT_INSET_Y)
    })
    expect(new Set(sizes).size).toBe(1)
    expect(sizes[0]).toBe(MAX)
  })

  it('shrinks a line that beats the boundary, rather than letting it spill', () => {
    const long = 'Que le vent bouleverse tous pareillement et sans distinction aucune, jamais'
    const f = fakeBox({ text: long, boxW: 1000, boxH: 1000, charWidthAtPx1: 0.5 })
    const size = fitInBox(f.box, f.measured, f.apply, MAX, textLayoutInsetX(1000), TEXT_INSET_Y)
    expect(size).toBeLessThan(MAX)
    // And it genuinely fits at what it came back with: nothing overflows.
    f.apply(size)
    const availW = 1000 - 2 * textLayoutInsetX(1000)
    const availH = 1000 - 2 * TEXT_INSET_Y
    expect(f.measured.scrollWidth).toBeLessThanOrEqual(availW)
    expect(f.measured.scrollHeight).toBeLessThanOrEqual(availH)
  })

  it('shrinks only the offending line — the next one is back at the boundary', () => {
    const long = fakeBox({
      text: 'Que le vent bouleverse tous pareillement et sans distinction aucune, jamais',
      boxW: 1000,
      boxH: 1000,
      charWidthAtPx1: 0.5,
    })
    fitInBox(long.box, long.measured, long.apply, MAX, textLayoutInsetX(1000), TEXT_INSET_Y)
    const short = fakeBox({ text: 'Paso', boxW: 1000, boxH: 1000, charWidthAtPx1: 0.5 })
    expect(
      fitInBox(short.box, short.measured, short.apply, MAX, textLayoutInsetX(1000), TEXT_INSET_Y)
    ).toBe(MAX)
  })

  it('shrinks for a single unbreakable run too, which is the case wrapping cannot help', () => {
    const f = fakeBox({ text: 'ontdekkingsreiziger', boxW: 200, boxH: 1000, charWidthAtPx1: 0.5 })
    expect(fitInBox(f.box, f.measured, f.apply, MAX, textLayoutInsetX(200), TEXT_INSET_Y)).toBeLessThan(MAX)
  })

  it('leaves the boundary alone where the box has not been measured, rather than collapsing', () => {
    const box = { clientWidth: 0, clientHeight: 0 } as HTMLElement
    const measured = { scrollWidth: 9999, scrollHeight: 9999 } as unknown as HTMLElement
    expect(fitInBox(box, measured, () => {}, MAX, 60, 60)).toBe(MAX)
  })

  /**
   * **AN `apply` THAT MOVES NOTHING RETURNS THE FLOOR, AND IT LOOKS LIKE A LAYOUT PROBLEM**
   * (found on the wall, 2026-09-06).
   *
   * The search is only a search if `apply` changes what `measured` measures. Given one that does
   * not, `fits()` answers for the layout as it already stands at every candidate — false all
   * fourteen times when the content does not fit at the maximum — and `lo` is never raised off
   * `TEXT_MIN_PX`. **Nothing throws and nothing warns; the content is simply tiny**, which is the
   * same silent failure the zero-width box above is guarded against, reached the other way.
   *
   * Both locked cards did exactly this: `apply` wrote a `--t` custom property and every measure
   * was written from React state instead, so the message home came out at 8px on the wall.
   * `cardAutoFit.test.tsx` is the guard that stops it coming back; this is the mechanism.
   */
  it('returns the floor when apply moves nothing, which is how a card ends up 8px tall', () => {
    const box = { clientWidth: 1000, clientHeight: 1000 } as HTMLElement
    // Too big at every size, and deaf to `apply` — exactly a card sized from somewhere else.
    const measured = { scrollWidth: 9999, scrollHeight: 9999 } as unknown as HTMLElement
    expect(fitInBox(box, measured, () => {}, MAX, 60, 60)).toBe(TEXT_MIN_PX)
  })
})
