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
  nextIndex,
  prevIndex,
  type SongItem,
  type LyricLine,
} from './songState'
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

  const goNext = () => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const next = nextIndex(ls, idx)
    setSongIndex(next)
    setIndexState(next)
    if (next >= 0) {
      setBlank(false)
      setBlankState(false)
    }
  }

  const goPrev = () => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const prev = prevIndex(ls, idx)
    setSongIndex(prev)
    setIndexState(prev)
    if (prev >= 0) {
      setBlank(false)
      setBlankState(false)
    }
  }

  const goRestart = () => {
    setSongIndex(-1)
    setIndexState(-1)
    setBlank(true)
    setBlankState(true)
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
    if (action === 'next') {
      const next = nextIndex(ls, idx)
      setSongIndex(next)
      setIndexState(next)
      if (next >= 0) {
        setBlank(false)
        setBlankState(false)
      }
    } else if (action === 'prev') {
      const prev = prevIndex(ls, idx)
      setSongIndex(prev)
      setIndexState(prev)
      if (prev >= 0) {
        setBlank(false)
        setBlankState(false)
      }
    } else if (action === 'blankToggle') {
      setBlank(!curBlank)
      setBlankState(!curBlank)
    } else if (action === 'setIndex' && value !== undefined) {
      const clamped = value < 0 ? -1 : Math.max(0, Math.min(value, ls.length - 1))
      setSongIndex(clamped)
      setIndexState(clamped)
      if (clamped === -1) {
        setBlank(true)
        setBlankState(true)
      }
    }
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
