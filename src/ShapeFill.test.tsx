/** @vitest-environment jsdom */
/**
 * A fill: black held over a region, so light does not land where the room does not want it.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { ShapeFill } from './ShapeFill'
import type { Point, VisualShape } from './visualsFile'

afterEach(cleanup)

const RING: Point[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0.5, 0.9],
  [0, 1],
]

function fillShape(layer: Record<string, unknown> = { type: 'fill' }): VisualShape {
  return { id: 'keepout', name: 'Keep-out 1', corners: null, outline: RING, layer, visible: true }
}

describe('ShapeFill', () => {
  it('paints the outline as a polygon in output pixels, with no warp involved', () => {
    render(<ShapeFill shape={fillShape()} width={1000} height={500} />)
    const poly = document.querySelector('polygon') as SVGPolygonElement
    expect(poly.getAttribute('points')).toBe('0,0 1000,0 1000,500 500,450 0,500')
    // A fill is a mask, not content: there is no unit box here and no matrix, which is also why
    // it needs no content frame.
    expect(document.querySelector('.shape-wrapper')).toBeNull()
  })

  it('is black unless the file says otherwise', () => {
    render(<ShapeFill shape={fillShape()} width={100} height={100} />)
    const poly = document.querySelector('polygon') as SVGPolygonElement
    expect(poly.style.fill).toBe('rgb(0, 0, 0)')
    // Fill and stroke are the same colour: the stroke is the dilation, not an edge.
    expect(poly.style.stroke).toBe(poly.style.fill)
  })

  it('reads a colour and a margin from the layer', () => {
    render(
      <ShapeFill shape={fillShape({ type: 'fill', color: '#123456', margin: 0.02 })} width={100} height={1000} />
    )
    const poly = document.querySelector('polygon') as SVGPolygonElement
    expect(poly.style.fill).toBe('rgb(18, 52, 86)')
    expect(poly.style.strokeWidth).toBe('20')
  })

  it('paints nothing for a ring that is not a polygon', () => {
    const notARing = { ...fillShape(), outline: [[0, 0], [1, 1]] as Point[], corners: null }
    render(<ShapeFill shape={notARing} width={100} height={100} />)
    expect(document.querySelector('polygon')).toBeNull()
  })
})
