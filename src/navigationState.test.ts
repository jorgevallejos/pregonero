import { describe, it, expect } from 'vitest'
import type { LyricLine, SongItem } from './songState'
import { computeNavigationState } from './navigationState'

const lyric = (es: string, translations: Record<string, string>): LyricLine =>
  ({ es, translations })
const section = (label: string): SectionMarker => ({ type: 'section', label })

describe('computeNavigationState', () => {
  describe('next', () => {
    it('from -1 with non-empty lines → index 0, blank false', () => {
      const lines: SongItem[] = [lyric('Hola', { en: 'Hello' })]
      expect(computeNavigationState(lines, -1, true, 'next')).toEqual({
        index: 0,
        blank: false,
      })
    })

    it('from middle index → index +1, blank false', () => {
      const lines: SongItem[] = [
        lyric('Uno', {}),
        lyric('Dos', {}),
        lyric('Tres', {}),
      ]
      expect(computeNavigationState(lines, 1, true, 'next')).toEqual({
        index: 2,
        blank: false,
      })
    })

    it('from last index → index unchanged, blank false', () => {
      const lines: SongItem[] = [lyric('Uno', {}), lyric('Dos', {})]
      expect(computeNavigationState(lines, 1, true, 'next')).toEqual({
        index: 1,
        blank: false,
      })
    })

    it('empty lines and index -1 → index stays -1, blank unchanged', () => {
      expect(computeNavigationState([], -1, true, 'next')).toEqual({
        index: -1,
        blank: true,
      })
    })
  })

  describe('prev', () => {
    it('from 0 → index 0, blank false', () => {
      const lines: SongItem[] = [lyric('Uno', {}), lyric('Dos', {})]
      expect(computeNavigationState(lines, 0, true, 'prev')).toEqual({
        index: 0,
        blank: false,
      })
    })

    it('from middle index → index -1, blank false', () => {
      const lines: SongItem[] = [
        lyric('Uno', {}),
        lyric('Dos', {}),
        lyric('Tres', {}),
      ]
      expect(computeNavigationState(lines, 1, true, 'prev')).toEqual({
        index: 0,
        blank: false,
      })
    })

    it('from -1 → index stays -1, blank unchanged', () => {
      const lines: SongItem[] = [lyric('Hola', { en: 'Hello' })]
      expect(computeNavigationState(lines, -1, true, 'prev')).toEqual({
        index: -1,
        blank: true,
      })
    })
  })

  describe('restart', () => {
    it('always → index -1, blank true', () => {
      const lines: SongItem[] = [lyric('Uno', {}), lyric('Dos', {})]
      expect(computeNavigationState(lines, 1, false, 'restart')).toEqual({
        index: -1,
        blank: true,
      })
      expect(computeNavigationState(lines, -1, false, 'restart')).toEqual({
        index: -1,
        blank: true,
      })
    })
  })

  describe('blankToggle', () => {
    it('index unchanged, blank toggled', () => {
      const lines: SongItem[] = [lyric('Uno', {})]
      expect(computeNavigationState(lines, 0, true, 'blankToggle')).toEqual({
        index: 0,
        blank: false,
      })
      expect(computeNavigationState(lines, 0, false, 'blankToggle')).toEqual({
        index: 0,
        blank: true,
      })
    })
  })

  describe('setIndex', () => {
    const lines: SongItem[] = [
      lyric('Uno', {}),
      lyric('Dos', {}),
      lyric('Tres', {}),
    ]

    it('valid index → that index, blank unchanged when index >= 0', () => {
      expect(computeNavigationState(lines, -1, true, 'setIndex', 1)).toEqual({
        index: 1,
        blank: true,
      })
      expect(computeNavigationState(lines, 0, false, 'setIndex', 2)).toEqual({
        index: 2,
        blank: false,
      })
    })

    it('value -1 → index -1, blank true', () => {
      expect(computeNavigationState(lines, 1, false, 'setIndex', -1)).toEqual({
        index: -1,
        blank: true,
      })
    })

    it('value clamped to valid range', () => {
      expect(computeNavigationState(lines, 0, false, 'setIndex', 10)).toEqual({
        index: 2,
        blank: false,
      })
      expect(computeNavigationState(lines, 0, false, 'setIndex', 0)).toEqual({
        index: 0,
        blank: false,
      })
    })

    it('value undefined → current state unchanged', () => {
      expect(
        computeNavigationState(lines, 1, false, 'setIndex', undefined)
      ).toEqual({ index: 1, blank: false })
    })
  })
})
