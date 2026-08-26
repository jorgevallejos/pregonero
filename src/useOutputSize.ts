import { useEffect, useState } from 'react'

export type OutputSize = { width: number; height: number }

function readOutputSize(): OutputSize {
  if (typeof window === 'undefined') return { width: 0, height: 0 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * **The output size in real pixels, now.** Every warp is evaluated against this and nothing else.
 *
 * The corners in `visuals.json` are normalised and resolution-independent; the matrix built from
 * them is in real stage pixels, and the projector at a venue is not the display the room was
 * mapped on. So the size is a *parameter*, passed on every render, and a matrix is **never cached
 * across a resize or a display change** — see `docs/warp-contract.md` in the vault, caller
 * obligation 3. That failure renders perfectly and lands in the wrong place, with nothing
 * crashing and nothing warning, which is why it is a hook and not a value read once at mount.
 *
 * Moving the projection window to another display fires `resize` when the window's own size
 * changes, and re-renders at the new size are all that is needed: `frameMatrix3d` is pure and is
 * re-evaluated, never memoised on geometry that has moved.
 */
export function useOutputSize(): OutputSize {
  const [size, setSize] = useState<OutputSize>(readOutputSize)

  useEffect(() => {
    const onResize = () => {
      setSize((previous) => {
        const next = readOutputSize()
        // Same numbers, same object: React bails out of the re-render, and nothing downstream
        // recomputes. A *different* size always produces a new object, so nothing is ever stale.
        return next.width === previous.width && next.height === previous.height ? previous : next
      })
    }
    window.addEventListener('resize', onResize)
    // A display change can alter devicePixelRatio without altering innerWidth/innerHeight. It
    // costs nothing to re-read on that too, and reading is the whole cure.
    const dpr = window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`)
    dpr?.addEventListener?.('change', onResize)
    onResize()
    return () => {
      window.removeEventListener('resize', onResize)
      dpr?.removeEventListener?.('change', onResize)
    }
  }, [])

  return size
}
