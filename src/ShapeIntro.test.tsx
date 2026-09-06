/** @vitest-environment jsdom */
/**
 * The locked title-card template. There are no formatting controls, so **these proportions are the
 * entire design** and a test that pins them is the only thing stopping them drifting.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ShapeIntro, INTRO_TITLE_MAX_SIZE, INTRO_INSET } from './ShapeIntro'
import { cardDesignBox } from './cardBox'
import { UNIT_SIZE } from './vendor/warp.js'

afterEach(cleanup)

const PARTS = {
  title: 'Tragedia de cerdo asado',
  annotation: 'Tragedy of Roasted Pig',
  tagline: 'A pig, a fire, and a family that never agreed on anything.',
}

function css(selector: string): CSSStyleDeclaration {
  return (document.querySelector(selector) as HTMLElement).style
}

describe('ShapeIntro', () => {
  it('fills the three parts from the song file, in the template’s own order', () => {
    render(<ShapeIntro parts={PARTS} boxWidth={UNIT_SIZE} />)
    const block = document.querySelector('.intro-block') as HTMLElement
    // Top to bottom: a clay rule and the translation as an annotation; then the title; then the
    // tagline. Not a parenthesised second headline — an annotation is what the translation is.
    expect([...block.querySelectorAll('.intro-annotation, .intro-title, .intro-tagline')].map(
      (el) => el.textContent
    )).toEqual([PARTS.annotation, PARTS.title, PARTS.tagline])
  })

  it('speaks in the instrument’s voice: ink ground, monospace, left-aligned, no radii', () => {
    render(<ShapeIntro parts={PARTS} boxWidth={UNIT_SIZE} />)
    const panel = css('.layer-intro')
    expect(panel.background).toBe('rgb(18, 18, 17)')
    expect(panel.textAlign).toBe('left')
    expect(panel.fontFamily).toContain('monospace')
    expect(panel.borderRadius).toBe('')
  })

  it('sizes every part as a multiple of the title, so the card shrinks as one thing', () => {
    render(<ShapeIntro parts={PARTS} boxWidth={UNIT_SIZE} />)
    // **The ratios themselves, not numbers derived from the ceiling.** `--t` is the one number and
    // it is what the fit moves; a measure written any other way stays put while the fit searches,
    // which is how the message home came out at 8px on a wall — see `cardAutoFit.test.tsx`.
    // **A fraction of the CARD's height, not the shape's** (2026-09-06). The card has its own
    // proportions and is scaled into the shape; a title sized off the shape made the card a
    // different card in every room — see `cardBox.ts`.
    expect(css('.intro-block').getPropertyValue('--t')).toBe(
      `${INTRO_TITLE_MAX_SIZE * cardDesignBox(UNIT_SIZE).height}px`
    )
    expect(css('.intro-title').fontSize).toBe('var(--t)')
    expect(css('.intro-annotation').fontSize).toBe('calc(var(--t) * 0.4)')
    expect(css('.intro-tagline').fontSize).toBe('calc(var(--t) * 0.28)')
    expect(css('.intro-rule').width).toBe('calc(var(--t) * 0.4)')
    expect(css('.intro-rule').height).toBe('calc(var(--t) * 0.04)')
    expect(css('.intro-rule').background).toBe('rgb(217, 139, 122)')
  })

  it('insets the card by a fraction of the box, on both axes', () => {
    render(<ShapeIntro parts={PARTS} boxWidth={1333} />)
    expect(css('.layer-intro').padding).toBe(
      `${Math.round(INTRO_INSET * UNIT_SIZE)}px ${Math.round(INTRO_INSET * 1333)}px`
    )
  })

  it('takes the quad’s stretch back out, exactly as a lyric box does', () => {
    render(<ShapeIntro parts={PARTS} boxWidth={2000} />)
    const panel = css('.layer-intro')
    expect(panel.width).toBe('2000px')
    expect(panel.height).toBe(`${UNIT_SIZE}px`)
    expect(panel.transform).toBe(`scaleX(${UNIT_SIZE / 2000})`)
    expect(panel.transformOrigin).toBe('0 0')
  })

  it('shows only the title when the song file carries nothing else', () => {
    render(<ShapeIntro parts={{ title: 'Vidas' }} boxWidth={UNIT_SIZE} />)
    expect(screen.getByText('Vidas')).toBeTruthy()
    // No annotation means no rule either: the rule exists to sit beside it.
    expect(document.querySelector('.intro-annotation')).toBeNull()
    expect(document.querySelector('.intro-rule')).toBeNull()
    expect(document.querySelector('.intro-tagline')).toBeNull()
    // And the title does not carry the gap that separated it from an annotation that is not there.
    expect(css('.intro-title').marginTop).toBe('0px')
  })
})

/**
 * **THE TRANSLATED TITLE IS READABLE AT WALL DISTANCE** (Jorge, 2026-09-06).
 *
 * Found at moment 6 and **measured rather than eyeballed** — real components at the real quad in
 * headless Chrome, because jsdom returns zero for every dimension and the suite is blind to this by
 * construction. On the gig's own video frame at 1920x1080 the annotation came out **14.8px tall on
 * a 590px shape**, against a lyric line in the shape beside it at **272px**. One eighteenth.
 *
 * **What the suite CAN hold is the proportion**, and the proportion was contradicting this file's
 * own doc: *the tagline is the fragile part, smallest on the wall* — while the annotation was
 * `0.2t` and the tagline `0.28t`. **The smallest thing on the card was the one the doc did not
 * name.** That is checkable here, and it is what stops the number drifting back.
 */
describe('the card\u2019s parts keep their order of size', () => {
  const ratio = (declaration: string): number => {
    const m = /calc\(var\(--t\)\s*\*\s*([\d.]+)\)/.exec(declaration)
    if (m) return parseFloat(m[1]!)
    return declaration === 'var(--t)' ? 1 : NaN
  }

  it('puts the title first, the translated title after it, and the tagline smallest', () => {
    render(<ShapeIntro parts={PARTS} boxWidth={UNIT_SIZE} />)
    const title = ratio(css('.intro-title').fontSize)
    const annotation = ratio(css('.intro-annotation').fontSize)
    const tagline = ratio(css('.intro-tagline').fontSize)

    expect(title).toBe(1)
    expect(annotation).toBeLessThan(title)
    // **The line that was wrong.** It was 0.2 against the tagline's 0.28.
    expect(annotation).toBeGreaterThan(tagline)
  })
})
