import { describe, it, expect } from 'vitest'
import { digest } from './fingerprint'

describe('a file fingerprint', () => {
  it('is the same for the same text, every time', () => {
    expect(digest('hola')).toBe(digest('hola'))
  })

  it('changes when the text changes, including by one character', () => {
    expect(digest('hola')).not.toBe(digest('holá'))
    expect(digest('hola')).not.toBe(digest('hola '))
  })

  it('is eight hex digits, whatever the input', () => {
    for (const text of ['', 'a', 'x'.repeat(10000), '{"title":"Libertad"}']) {
      expect(digest(text)).toMatch(/^[0-9a-f]{8}$/)
    }
  })

  it('does not collide across the catalogue-sized inputs it is actually given', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) seen.add(digest(`{"title":"song-${i}","lyrics":[]}`))
    expect(seen.size).toBe(2000)
  })
})
