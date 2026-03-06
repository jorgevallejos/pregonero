import { useEffect, useState, useRef } from 'react'

/**
 * Hold-to-confirm hook for destructive actions.
 * Used by Restart and Close Projection in the control UI.
 */
export const HOLD_CONFIRM_MS = 1000

export function useHoldToConfirm(onConfirm: () => void) {
  const [isHolding, setIsHolding] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm

  useEffect(() => {
    if (!isHolding) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      return
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setIsHolding(false)
      onConfirmRef.current()
    }, HOLD_CONFIRM_MS)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [isHolding])

  return {
    isHolding,
    onPointerDown: () => setIsHolding(true),
    onPointerUp: () => setIsHolding(false),
    onPointerLeave: () => setIsHolding(false),
  }
}

/**
 * Hold-to-confirm for Restart keyboard shortcut (R key).
 * Keydown starts the hold timer; keyup cancels it. Does not bypass safety.
 */
export function useRestartKeyHold(onConfirm: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onConfirmRef = useRef(onConfirm)
  onConfirmRef.current = onConfirm

  const onKeyDown = () => {
    if (timerRef.current) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      onConfirmRef.current()
    }, HOLD_CONFIRM_MS)
  }

  const onKeyUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  return { onKeyDown, onKeyUp }
}
