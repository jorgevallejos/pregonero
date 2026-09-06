/** @vitest-environment jsdom */
/**
 * **The message home: two columns, a clay rule between them, and every field optional.**
 *
 * The card was one line and a QR until 2026-09-05. **The QR came out** — it was the only piece of
 * this card's content with no home — and what is left is a logo, a line and two handles, all
 * artist-level and all satisfied by the Preferences ruling with nothing new invented.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ShapeContact, readContactFields, hasContactContent } from './ShapeContact'
import { UNIT_SIZE } from './vendor/warp.js'

vi.mock('./mediaPathStore', () => ({
  resolveMediaPath: (src: string) => (src === 'logo.png' ? '/media/logo.png' : null),
  absolutePathToMediaUrl: (path: string) => `media://local${path}`,
}))

afterEach(cleanup)

describe('readContactFields', () => {
  it('takes the gig block as it is, because the gig file is the contract', () => {
    // **The content travels in the gig**, written by the shell at setup and read by the player at
    // performance — a player that reads only the gig folder cannot read the shell's Preferences.
    expect(readContactFields({ url: 'changopepper.com', message: 'Write to me.' })).toEqual({
      url: 'changopepper.com',
      message: 'Write to me.',
    })
  })

  it('reads an absent block as four absent fields', () => {
    expect(readContactFields(undefined)).toEqual({})
    expect(readContactFields(null)).toEqual({})
  })

  it('says a card with nothing in it has nothing to show', () => {
    // **All four empty means nothing is pointed at the shape, so the shape is dark.** A blank lit
    // rectangle at the end of a gig is worse than no card.
    expect(hasContactContent({})).toBe(false)
    expect(hasContactContent({ handle: '@changopepper' })).toBe(true)
  })
})

describe('ShapeContact', () => {
  it('paints nothing at all when every field is empty', () => {
    const { container } = render(<ShapeContact fields={{}} boxWidth={UNIT_SIZE} />)
    expect(container.firstChild).toBeNull()
  })

  it('paints the line in the instrument’s voice, on the ink ground', () => {
    render(<ShapeContact fields={{ message: 'Write to me.' }} boxWidth={UNIT_SIZE} />)
    const line = screen.getByTestId('message-home-line')
    expect(line.textContent).toBe('Write to me.')
    expect(line.style.color).toBe('rgb(230, 223, 209)')
    expect((document.querySelector('.layer-contact') as HTMLElement).style.background).toBe(
      'rgb(18, 18, 17)'
    )
  })

  it('puts the handles dim, beneath the line', () => {
    render(
      <ShapeContact
        fields={{ message: 'Write to me.', url: 'changopepper.com', handle: '@changopepper' }}
        boxWidth={UNIT_SIZE}
      />
    )
    const handles = screen.getByTestId('message-home-handles')
    expect(handles.textContent).toBe('changopepper.com@changopepper')
    expect(handles.style.color).toBe('rgb(139, 132, 120)')
    // Smaller than the line, off the same number, so the whole card shrinks as one thing. **The
    // ratio itself, not a number derived from the ceiling**: `--t` is what the fit moves, and a
    // measure written any other way does not move with it — see `cardAutoFit.test.tsx`.
    expect(screen.getByTestId('message-home-line').style.fontSize).toBe('var(--t)')
    expect(handles.style.fontSize).toBe('calc(var(--t) * 0.62)')
  })

  it('fills the logo column’s width, because equal heights is not available', () => {
    // Jorge asked for the logo to match column two's height and **the wordmark will not allow it**
    // — 2.56 : 1 would be wider than the whole card. It fills its column instead.
    render(<ShapeContact fields={{ logo: 'logo.png', message: 'Write to me.' }} boxWidth={UNIT_SIZE} />)
    const logo = screen.getByTestId('message-home-logo')
    expect(logo.getAttribute('src')).toBe('media://local/media/logo.png')
    expect(logo.style.height).toBe('auto')
  })

  it('draws the clay rule only when both columns have content', () => {
    // **Logo alone is just the logo**, with no rule and no second column; the line alone has
    // nothing to divide from. The rule appears when both sides exist.
    render(<ShapeContact fields={{ logo: 'logo.png', message: 'Write to me.' }} boxWidth={UNIT_SIZE} />)
    expect(screen.getByTestId('message-home-rule').style.background).toBe('rgb(217, 139, 122)')

    cleanup()
    render(<ShapeContact fields={{ logo: 'logo.png' }} boxWidth={UNIT_SIZE} />)
    expect(screen.queryByTestId('message-home-rule')).toBeNull()
    expect(screen.getByTestId('message-home-logo')).toBeTruthy()

    cleanup()
    render(<ShapeContact fields={{ message: 'Write to me.' }} boxWidth={UNIT_SIZE} />)
    expect(screen.queryByTestId('message-home-rule')).toBeNull()
    expect(screen.queryByTestId('message-home-logo-column')).toBeNull()
  })

  it('leaves the column empty when the logo file does not resolve on this machine', () => {
    // A name resolving to nothing is not the same as no name: the column is empty rather than the
    // card broken, and the gig's sign-off is where a missing file is reported.
    render(<ShapeContact fields={{ logo: 'missing.png', message: 'Write to me.' }} boxWidth={UNIT_SIZE} />)
    expect(screen.queryByTestId('message-home-logo')).toBeNull()
    expect(screen.queryByTestId('message-home-rule')).toBeNull()
    expect(screen.getByText('Write to me.')).toBeTruthy()
  })

  it('takes the quad’s stretch back out, like every other panel', () => {
    render(<ShapeContact fields={{ message: 'x' }} boxWidth={2000} />)
    const panel = document.querySelector('.layer-contact') as HTMLElement
    expect(panel.style.width).toBe('2000px')
    expect(panel.style.transform).toBe(`scaleX(${UNIT_SIZE / 2000})`)
  })

  it('carries no QR, and no field for one', () => {
    // **The QR came out of this version with a trigger**: if gig nights produce no visible arrivals
    // on the site, the funnel read says so and it returns.
    render(
      <ShapeContact
        fields={{ logo: 'logo.png', url: 'changopepper.com', handle: '@x', message: 'y' }}
        boxWidth={UNIT_SIZE}
      />
    )
    expect(screen.queryByTestId('gig-contact-qr')).toBeNull()
    expect(document.querySelector('.contact-qr')).toBeNull()
  })
})
