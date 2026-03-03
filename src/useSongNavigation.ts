import { useEffect, useState } from 'react'
import {
  getSongLines,
  getSongIndex,
  setSongLines,
  setSongIndex,
  getCurrentItem,
  getNextLyricIndex,
  nextIndex,
  prevIndex,
  type SongItem,
  type LyricLine,
} from './songState'

export function useSongNavigation(): {
  lines: SongItem[]
  index: number
  currentItem: SongItem | null
  nextLyricLine: LyricLine | null
  goNext: () => void
  goPrev: () => void
  loadLines: (items: SongItem[]) => void
} {
  const [lines, setLines] = useState<SongItem[]>(getSongLines)
  const [index, setIndexState] = useState(getSongIndex)

  useEffect(() => {
    const onStorage = () => {
      setLines(getSongLines())
      setIndexState(getSongIndex())
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
  }

  const goPrev = () => {
    const ls = getSongLines()
    const idx = getSongIndex()
    const prev = prevIndex(ls, idx)
    setSongIndex(prev)
    setIndexState(prev)
  }

  const loadLines = (items: SongItem[]) => {
    setSongLines(items)
    setSongIndex(0)
    setLines(items)
    setIndexState(0)
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
    currentItem,
    nextLyricLine,
    goNext,
    goPrev,
    loadLines,
  }
}
