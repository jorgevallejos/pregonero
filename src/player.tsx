/**
 * **Pregonero's entry.** Its own page, framed by Tramoya and loaded directly by the projection
 * window — the same shape Bombista's and Muralista's pages have, which is what the split of
 * `v0.75.0` was built toward. See `PlayerRoot`.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PlayerRoot } from './PlayerRoot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlayerRoot />
  </StrictMode>
)
