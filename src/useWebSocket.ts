import { useEffect, useRef } from 'react'

export type StateMessage = { type: 'state'; currentIndex: number; blank: boolean }
export type CommandMessage = {
  type: 'command'
  action: 'next' | 'prev' | 'blankToggle' | 'setIndex'
  value?: number
}

type Nav = {
  index: number
  blank: boolean
  applyRemoteState: (index: number, blank: boolean) => void
  applyCommand: (action: 'next' | 'prev' | 'blankToggle' | 'setIndex', value?: number) => void
}

function getWsUrl(): string {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `ws://${host}:8765`
}

export function useWebSocket(nav: Nav | null): {
  sendCommand: (action: 'next' | 'prev' | 'blankToggle' | 'setIndex', value?: number) => void
  sendState: () => void
  sendCommandWithState: (
    action: 'next' | 'prev' | 'blankToggle' | 'setIndex',
    value?: number,
    state?: { currentIndex: number; blank: boolean }
  ) => void
} {
  const wsRef = useRef<WebSocket | null>(null)
  const navRef = useRef(nav)
  navRef.current = nav

  useEffect(() => {
    if (!nav) return
    const url = getWsUrl()
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      const n = navRef.current
      if (n) {
        ws.send(JSON.stringify({ type: 'state', currentIndex: n.index, blank: n.blank }))
      }
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string)
        const n = navRef.current
        if (!n) return
        if (msg.type === 'state') {
          n.applyRemoteState(Number(msg.currentIndex), Boolean(msg.blank))
        } else if (msg.type === 'command') {
          if (msg.currentIndex !== undefined && msg.blank !== undefined) {
            n.applyRemoteState(Number(msg.currentIndex), Boolean(msg.blank))
          } else {
            n.applyCommand(msg.action, msg.value)
          }
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onclose = () => {
      wsRef.current = null
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [])

  const sendCommand = (action: 'next' | 'prev' | 'blankToggle' | 'setIndex', value?: number) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', action, value }))
    }
  }

  const sendState = () => {
    const ws = wsRef.current
    const n = navRef.current
    if (ws?.readyState === WebSocket.OPEN && n) {
      ws.send(JSON.stringify({ type: 'state', currentIndex: n.index, blank: n.blank }))
    }
  }

  const sendCommandWithState = (
    action: 'next' | 'prev' | 'blankToggle' | 'setIndex',
    value?: number,
    state?: { currentIndex: number; blank: boolean }
  ) => {
    const ws = wsRef.current
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'command', action, value, ...state }))
    }
  }

  return { sendCommand, sendState, sendCommandWithState }
}
