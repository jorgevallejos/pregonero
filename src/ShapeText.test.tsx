/** @vitest-environment jsdom */
/**
 * **The lyric on the wall, and the one thing about it that is not the shape's to say.**
 *
 * Everything else `ShapeText` draws comes from the shape's own format settings — the size, the
 * alignment, the colour, the outline — and those are Muralista's, read from `visuals.json`.
 * **The face is not among them**, which is why it was inherited and why it was wrong: there is no
 * `fontFamily` field on a `song-lyrics` layer to disagree with, so nothing could catch it.
 *
 * See `muralistaTextContract.test.ts` for why the face is part of the contract rather than a
 * preference, and `shapeTextLayout.TEXT_FONT_FAMILY` for where the values come from.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ShapeText } from './ShapeText'
import {
  TEXT_DEFAULTS,
  TEXT_FONT_FAMILY,
  TEXT_FONT_WEIGHT,
  TEXT_LINE_HEIGHT,
  TEXT_OVERFLOW_WRAP,
} from './shapeTextLayout'

afterEach(cleanup)

function inner(): HTMLElement {
  render(
    <ShapeText
      text="Y si me quedo aquí, me quedo contigo"
      boxWidth={1466}
      fields={TEXT_DEFAULTS}
      opacity={1}
      transitionMs={0}
      testId="lyric"
    />
  )
  return document.querySelector('.shape-text-inner') as HTMLElement
}

describe('the face a lyric is painted in', () => {
  it('states it rather than inheriting it from the projection window', () => {
    // Inherited, this was `'EB Garamond', Georgia, serif` at weight 600, out of `control.css` —
    // a serif at a lighter weight, inside a boundary measured for a bold sans.
    const el = inner()
    expect(el.style.fontFamily).toBe(TEXT_FONT_FAMILY)
    expect(el.style.fontWeight).toBe(String(TEXT_FONT_WEIGHT))
    expect(el.style.lineHeight).toBe(String(TEXT_LINE_HEIGHT))
  })

  it('wraps on word boundaries, because the auto-fit is what handles a word that cannot wrap', () => {
    expect(inner().style.overflowWrap).toBe(TEXT_OVERFLOW_WRAP)
  })

  it('still takes everything the shape does say from the shape', () => {
    render(
      <ShapeText
        text="una línea"
        boxWidth={1000}
        fields={{ ...TEXT_DEFAULTS, align: 'left', color: '#ff0000' }}
        opacity={1}
        transitionMs={0}
        testId="lyric-2"
      />
    )
    const el = document.querySelectorAll('.shape-text-inner')[0] as HTMLElement
    expect(el.style.textAlign).toBe('left')
    expect(el.style.color).toBe('rgb(255, 0, 0)')
  })
})
