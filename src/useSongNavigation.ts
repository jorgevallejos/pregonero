import { useEffect, useState } from 'react'
import {
  getSongLines,
  getSongIndex,
  getBlank,
  setSongLines,
  setSongIndex,
  setBlank,
  getCurrentSongId,
  getCurrentItem,
  getNextLyricIndex,
  type SongItem,
  type LyricLine,
} from './songState'
import { computeNavigationState } from './navigationState'
import { SONGS } from './songs'

export function useSongNavigation(): {
  lines: SongItem[]
  index: number
  blank: boolean
  currentItem: SongItem | undefined
  nextLyricLine: LyricLine | null
  goNext: () => void
  goPrev: () => void
  goRestart: () => void
  setBlankState: (blank: boolean) => void
  loadLines: (items: SongItem[]) => void
  loadError: string | null
  currentSongTitle: string
  applyRemoteState: (index: number, blank: boolean) => void
  applyCommand: (action: 'next' | 'prev' | 'blankToggle' | 'setIndex', value?: number) => void
} {
  const [lines, setLines] = useState<SongItem[]>(getSongLines)
  const [index, setIndexState] = useState(getSongIndex)
  const [blank, setBlankState] = useState(getBlank)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Sync from storage only; do not auto-load a default song on startup
  useEffect(() => {
    setLines(getSongLines())
    setIndexState(getSongIndex())
    setBlankState(getBlank())
  }, [])

  useEffect(() => {
    const onStorage = () => {
      setLines(getSongLines())
      setIndexState(getSongIndex())
      setBlankState(getBlank())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const applyComputedState = (nextIndex: number, nextBlank: boolean) => {
    setSongIndex(nextIndex)
    setIndexState(nextIndex)
    setBlank(nextBlank)
    setBlankState(nextBlank)
  }

  const goNext = () => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const curBlank = getBlank()
    const next = computeNavigationState(ls, idx, curBlank, 'next')
    applyComputedState(next.index, next.blank)
  }

  const goPrev = () => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const curBlank = getBlank()
    const next = computeNavigationState(ls, idx, curBlank, 'prev')
    applyComputedState(next.index, next.blank)
  }

  const goRestart = () => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const curBlank = getBlank()
    const next = computeNavigationState(ls, idx, curBlank, 'restart')
    applyComputedState(next.index, next.blank)
  }

  const setBlankAndStore = (value: boolean) => {
    setBlank(value)
    setBlankState(value)
  }

  const applyRemoteState = (newIndex: number, newBlank: boolean) => {
    setSongIndex(newIndex)
    setIndexState(newIndex)
    setBlank(newBlank)
    setBlankState(newBlank)
  }

  const applyCommand = (action: 'next' | 'prev' | 'blankToggle' | 'setIndex', value?: number) => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const curBlank = getBlank()
    const next = computeNavigationState(ls, idx, curBlank, action, value)
    applyComputedState(next.index, next.blank)
  }

  const loadLines = (items: SongItem[]) => {
    setSongLines(items)
    setSongIndex(-1)
    setLines(items)
    setIndexState(-1)
    setLoadError(null)
  }

  const currentItem = getCurrentItem(lines, index)
  const nextLyricIdx = getNextLyricIndex(lines, index)
  const nextLyricLine =
    nextLyricIdx >= 0 && nextLyricIdx < lines.length && 'es' in lines[nextLyricIdx]
      ? (lines[nextLyricIdx] as LyricLine)
      : null

  return {
    lines,
    index,
    blank,
    currentItem,
    nextLyricLine,
    goNext,
    goPrev,
    goRestart,
    setBlankState: setBlankAndStore,
    loadLines,
    loadError,
    currentSongTitle: (() => {
      const id = getCurrentSongId()
      if (!id) return 'No song selected'
      return SONGS.find((s) => s.id === id)?.title ?? '—'
    })(),
    applyRemoteState,
    applyCommand,
  }
}
