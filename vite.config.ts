import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * **One page, because this repo is one product.**
 *
 * `player.html` is the whole of Pregonero. Tramoya vendors what this builds and serves it from the
 * app's own origin — `tramoya://app/player.html` — which is what lets the framed page reach the
 * embedder's bridge and share storage with the projection window.
 *
 * **That origin is the host's to provide and not this build's to assume**: `src/bridge.ts` asks for
 * the bridge and copes with not having one, which is also what makes the page testable here.
 *
 * `base: './'` so the built page is position-independent — it is served from wherever the host puts
 * it, and nothing in this build may bake in a path.
 */
export default defineConfig({
  root: '.',
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: { player: resolve(__dirname, 'player.html') },
    },
  },
  server: { port: 5175, strictPort: true, host: '0.0.0.0' },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
