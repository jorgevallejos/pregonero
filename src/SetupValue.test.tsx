import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SetupValue, longestWordLength, setupValueStyle } from './SetupValue'

afterEach(cleanup)

/**
 * **The unit under test is the number, not the pixels.** jsdom does no layout, so nothing here can
 * say a word fitted — and a test that pretended to would be worse than none. What it CAN pin is the
 * fact the sizing rule is a function of: how long the longest unbreakable run in a value is, and
 * that it reaches the element for CSS to divide the cap by.
 *
 * The pixels are checked the way this project checks pixels: on the screen, in the installed app.
 */
describe('the longest word in a Standby value', () => {
  it('is the whole string when there is nothing to break at', () => {
    expect(longestWordLength('Unarmed')).toBe(7)
    expect(longestWordLength('Closed')).toBe(6)
  })

  it('is one word, not the sentence — a value with spaces breaks at them', () => {
    expect(longestWordLength('No gig')).toBe(3)
    expect(longestWordLength('Open, No video')).toBe(5)
    expect(longestWordLength('ES → EN')).toBe(2)
  })

  it('counts a hyphen as somewhere CSS will break, because it is', () => {
    expect(longestWordLength('Bar Eduard — 12/09')).toBe(6)
    expect(longestWordLength('anti-establishment')).toBe(13)
  })

  it('is never zero, so the cap is never divided by nothing', () => {
    expect(longestWordLength('')).toBe(1)
    expect(longestWordLength('   ')).toBe(1)
  })

  it('reaches the element as the number the stylesheet divides by', () => {
    expect(setupValueStyle('Unarmed')).toEqual({ '--value-longest-word': 7 })
    render(<SetupValue text="Unarmed" testId="v" />)
    const el = screen.getByTestId('v')
    expect(el.getAttribute('style')).toContain('--value-longest-word: 7')
    expect(el.className).toBe('control-setup-value')
    expect(el.textContent).toBe('Unarmed')
  })
})
