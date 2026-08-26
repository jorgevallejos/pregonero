import { useEffect, useState } from 'react'
import { getGigReadiness, subscribeGigReadiness } from './gigSession'
import type { GigReadiness } from './gigReadiness'

/**
 * The current readiness delta. **A rendering of the one readiness function, never a second
 * opinion** — this hook subscribes and re-renders; it computes nothing itself.
 *
 * It reads through on every render rather than holding a copy, because with no gig open the delta
 * is a pure function of the library and must not lag a setlist edit by a tick.
 */
export function useGigReadiness(): GigReadiness {
  const [, bump] = useState(0)
  useEffect(() => subscribeGigReadiness(() => bump((n) => n + 1)), [])
  return getGigReadiness()
}
