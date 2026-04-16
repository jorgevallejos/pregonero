import { useEffect, useState } from 'react'

const KEY_CONCERT_SESSION_STARTED = 'liveLyricConcertSessionStarted'
const KEY_CONCERT_SESSION_RUNNING = 'liveLyricConcertSessionRunning'
const KEY_CONCERT_SESSION_ACCUMULATED_SECONDS = 'liveLyricConcertSessionAccumulatedSeconds'
const KEY_CONCERT_SESSION_START_TS_MS = 'liveLyricConcertSessionStartTsMs'

export type ConcertSessionTimerSnapshot = {
  started: boolean
  running: boolean
  paused: boolean
  elapsedSeconds: number
}

function getSessionStorage(): Storage | undefined {
  return typeof sessionStorage !== 'undefined' ? sessionStorage : undefined
}

function readBool(key: string): boolean {
  const storage = getSessionStorage()
  if (!storage) return false
  return storage.getItem(key) === '1'
}

function readNumber(key: string, fallback: number): number {
  const storage = getSessionStorage()
  if (!storage) return fallback
  const raw = storage.getItem(key)
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function writeBool(key: string, value: boolean): void {
  const storage = getSessionStorage()
  if (!storage) return
  if (value) storage.setItem(key, '1')
  else storage.setItem(key, '0')
}

function writeNumber(key: string, value: number): void {
  const storage = getSessionStorage()
  if (!storage) return
  storage.setItem(key, String(value))
}

export function getConcertSessionTimerSnapshot(nowMs: number = Date.now()): ConcertSessionTimerSnapshot {
  const started = readBool(KEY_CONCERT_SESSION_STARTED)
  if (!started) {
    return {
      started: false,
      running: false,
      paused: false,
      elapsedSeconds: 0,
    }
  }

  const running = readBool(KEY_CONCERT_SESSION_RUNNING)
  const accumulatedSeconds = readNumber(KEY_CONCERT_SESSION_ACCUMULATED_SECONDS, 0)
  if (!running) {
    return {
      started: true,
      running: false,
      paused: true,
      elapsedSeconds: accumulatedSeconds,
    }
  }

  const startTsMs = readNumber(KEY_CONCERT_SESSION_START_TS_MS, nowMs)
  const elapsedSeconds = accumulatedSeconds + (nowMs - startTsMs) / 1000
  return {
    started: true,
    running: true,
    paused: false,
    elapsedSeconds: Math.max(0, elapsedSeconds),
  }
}

export function startConcertSessionIfNeeded(nowMs: number = Date.now()): void {
  const started = readBool(KEY_CONCERT_SESSION_STARTED)
  if (started) return

  // First ever arming of a song starts the concert session and the timer.
  writeBool(KEY_CONCERT_SESSION_STARTED, true)
  writeBool(KEY_CONCERT_SESSION_RUNNING, true)
  writeNumber(KEY_CONCERT_SESSION_ACCUMULATED_SECONDS, 0)
  writeNumber(KEY_CONCERT_SESSION_START_TS_MS, nowMs)
}

export function pauseConcertTimer(nowMs: number = Date.now()): void {
  const snap = getConcertSessionTimerSnapshot(nowMs)
  if (!snap.started || !snap.running) return

  writeBool(KEY_CONCERT_SESSION_RUNNING, false)
  writeNumber(KEY_CONCERT_SESSION_ACCUMULATED_SECONDS, snap.elapsedSeconds)
}

export function resumeConcertTimer(nowMs: number = Date.now()): void {
  const snap = getConcertSessionTimerSnapshot(nowMs)
  if (!snap.started || snap.running) return

  writeBool(KEY_CONCERT_SESSION_RUNNING, true)
  writeNumber(KEY_CONCERT_SESSION_START_TS_MS, nowMs)
}

export function togglePauseConcertTimer(nowMs: number = Date.now()): void {
  const snap = getConcertSessionTimerSnapshot(nowMs)
  if (!snap.started) return
  if (snap.running) pauseConcertTimer(nowMs)
  else resumeConcertTimer(nowMs)
}

export function resetConcertTimer(nowMs: number = Date.now()): void {
  // Reset is an explicit user action: it always starts (unpauses) the timer.
  writeBool(KEY_CONCERT_SESSION_STARTED, true)
  writeBool(KEY_CONCERT_SESSION_RUNNING, true)
  writeNumber(KEY_CONCERT_SESSION_ACCUMULATED_SECONDS, 0)
  writeNumber(KEY_CONCERT_SESSION_START_TS_MS, nowMs)
}

export function useConcertSessionTimer(): {
  started: boolean
  paused: boolean
  elapsedMinutes: number
  startIfNeeded: () => void
  togglePause: () => void
  reset: () => void
} {
  // Elapsed time is derived from the persisted start/accumulated timestamps so it survives
  // screen navigation and component unmounts.
  const [started, setStarted] = useState(() => getConcertSessionTimerSnapshot().started)
  const [running, setRunning] = useState(() => getConcertSessionTimerSnapshot().running)
  const [paused, setPaused] = useState(() => getConcertSessionTimerSnapshot().paused)
  const [elapsedMinutes, setElapsedMinutes] = useState(() => {
    const snap = getConcertSessionTimerSnapshot()
    // Use rounding instead of flooring to avoid off-by-one display issues when
    // remounting under fake timers or around minute boundaries.
    return Math.round(snap.elapsedSeconds / 60)
  })

  const refresh = () => {
    const snap = getConcertSessionTimerSnapshot()
    setStarted(snap.started)
    setRunning(snap.running)
    setElapsedMinutes(Math.round(snap.elapsedSeconds / 60))
    setPaused(snap.paused)
  }

  useEffect(() => {
    // Update UI once per minute while running; paused state freezes elapsed display.
    if (!started || !running) return
    const id = window.setInterval(() => refresh(), 60_000)
    return () => window.clearInterval(id)
  }, [started, running])

  return {
    started,
    paused,
    elapsedMinutes,
    startIfNeeded: () => {
      startConcertSessionIfNeeded()
      refresh()
    },
    togglePause: () => {
      togglePauseConcertTimer()
      refresh()
    },
    reset: () => {
      resetConcertTimer()
      refresh()
    },
  }
}

