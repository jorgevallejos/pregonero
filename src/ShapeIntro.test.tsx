/** @vitest-environment jsdom */
/**
 * The locked title-card template. There are no formatting controls, so **these proportions are the
 * entire design** and a test that pins them is the only thing stopping them drifting.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ShapeIntro, INTRO_TITLE_MAX_SIZE, INTRO_INSET } from './ShapeIntro'
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
    // jsdom measures nothing, so the fit leaves the title at its ceiling — which is what makes the
    // ratios below readable as ratios.
    const t = INTRO_TITLE_MAX_SIZE * UNIT_SIZE
    expect(css('.intro-title').fontSize).toBe(`${t}px`)
    expect(css('.intro-annotation').fontSize).toBe(`${t * 0.2}px`)
    expect(css('.intro-tagline').fontSize).toBe(`${t * 0.28}px`)
    expect(css('.intro-rule').width).toBe(`${t * 0.4}px`)
    expect(css('.intro-rule').height).toBe(`${t * 0.04}px`)
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
