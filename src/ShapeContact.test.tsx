/** @vitest-environment jsdom */
/**
 * The contact panel: one line, and a QR beside it when a file was named for one.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { ShapeContact, readContactFields, CONTACT_MAX_SIZE } from './ShapeContact'
import { UNIT_SIZE } from './vendor/warp.js'

vi.mock('./mediaPathStore', () => ({
  getMediaPath: (src: string) => (src === 'qr.png' ? '/media/qr.png' : null),
  absolutePathToMediaUrl: (path: string) => `media://local${path}`,
}))

afterEach(cleanup)

describe('readContactFields', () => {
  it('collapses a pasted newline, because one line is the design', () => {
    expect(readContactFields({ text: 'changopepper.be\n@changopepper' }).text).toBe(
      'changopepper.be @changopepper'
    )
  })

  it('treats a whitespace-only QR name as no QR', () => {
    // A truthy "  " reaches the wall as a broken image with nothing saying why.
    expect(readContactFields({ qrSrc: '   ' }).qrSrc).toBeNull()
  })

  it('defaults both fields for a shape that declares neither', () => {
    expect(readContactFields(undefined)).toEqual({ text: '', qrSrc: null })
  })
})

describe('ShapeContact', () => {
  it('paints the line in the instrument’s voice, on one line', () => {
    render(<ShapeContact fields={{ text: 'changopepper.be', qrSrc: null }} boxWidth={UNIT_SIZE} />)
    const line = document.querySelector('.contact-line') as HTMLElement
    expect(line.textContent).toBe('changopepper.be')
    expect(line.style.whiteSpace).toBe('nowrap')
    expect(line.style.color).toBe('rgb(230, 223, 209)')
    expect((document.querySelector('.layer-contact') as HTMLElement).style.background).toBe(
      'rgb(18, 18, 17)'
    )
  })

  it('sizes the QR off the same number as the line, so both shrink together', () => {
    render(<ShapeContact fields={{ text: 'scan me', qrSrc: 'qr.png' }} boxWidth={UNIT_SIZE} />)
    const t = CONTACT_MAX_SIZE * UNIT_SIZE
    const qr = screen.getByTestId('gig-contact-qr')
    expect(qr.getAttribute('src')).toBe('media://local/media/qr.png')
    expect(qr.style.width).toBe(`${t * 3.4}px`)
    expect(qr.style.height).toBe(qr.style.width)
    // Paper ground and real padding: a code printed straight onto ink does not scan at all.
    expect(qr.style.background).toBe('rgb(230, 223, 209)')
    expect(qr.style.padding).toBe(`${t * 0.18}px`)
  })

  it('shows no QR when the file is not linked on this machine', () => {
    render(<ShapeContact fields={{ text: 'scan me', qrSrc: 'missing.png' }} boxWidth={UNIT_SIZE} />)
    expect(screen.queryByTestId('gig-contact-qr')).toBeNull()
    expect(screen.getByText('scan me')).toBeTruthy()
  })

  it('takes the quad’s stretch back out, like every other panel', () => {
    render(<ShapeContact fields={{ text: 'x', qrSrc: null }} boxWidth={2000} />)
    const panel = document.querySelector('.layer-contact') as HTMLElement
    expect(panel.style.width).toBe('2000px')
    expect(panel.style.transform).toBe(`scaleX(${UNIT_SIZE / 2000})`)
  })
})
