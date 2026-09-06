/**
 * **WHAT THE PLAYER NEEDS FROM THE PLATFORM, MEASURED** (2026-09-06).
 *
 * The import graph says the two products are separable — `productBoundary.test.ts` proves it, and
 * `App.tsx` was split so that no file belongs to both. **That measurement cannot see the thing that
 * decides whether the player can be framed**, because the thing is not an import.
 *
 * **A page's capabilities are a property of how it is embedded, not of what it does**
 * (`project-context.md`, *Framing a page changes its platform identity*). Origin, top-level site
 * and permissions policy all change when a page is framed, and **everything keyed to them changes
 * silently — no error, no warning, and every unit test still green, because a test frames
 * nothing.**
 *
 * So this counts the two surfaces a frame has to answer for, and pins them:
 *
 * - **The main process.** Every call below is one the player makes.
 * - **The cross-window storage channels.** Every channel below is how the wall learns what to
 *   paint.
 *
 * ## THE PLAYER IS FRAMED NOW, AND NEITHER SURFACE COST ANYTHING (2026-09-06)
 *
 * **The numbers did not fall. They stopped being a price**, which is the better outcome and the
 * one this file must not go on mis-stating.
 *
 * The premise underneath both counts was **cross-origin**: a cross-origin frame gets no preload, so
 * sixteen calls would become messages; Chromium partitions storage by top-level site, so eight
 * channels would break. **The blocker was never the frame — it was `file://` being the top level.**
 * With the shell on its own registered scheme the frame is same-origin, and measured on the packed
 * build it **reaches `window.parent.electronAPI` directly** and **shares `localStorage` with the
 * projection window it opens.**
 *
 * **So there is no bridge and no relay: the sixteen calls do not get cheaper, they never exist.**
 *
 * **This test asserts numbers, not behaviour, and that is still deliberate** — it goes red when the
 * player asks the platform for something new. What that day now means is not *the frame got more
 * expensive* but *the player grew a new dependency on the machine*, which is worth seeing either
 * way.
 *
 * ## THE SURFACE IS FIFTEEN, NOT SIXTEEN, AND THE SPLIT IS HOW THAT WAS LEARNED (2026-09-06)
 *
 * `openFileDialog` came off this list when the player moved to its own repository, and **nothing
 * about the player changed to remove it.** It was reached through an exported `platform.ts`
 * function that only the first-run folders screen calls — and that screen stayed in Tramoya.
 *
 * The old measurement walked the `PLAYER` list inside a repository that still held both products,
 * so the closure ran on through a shared screen into a call the player never makes. **A boundary
 * you can walk past is a boundary you can miscount**, and a separate repository cannot be walked
 * past: what is not here cannot be reached.
 *
 * **The native file dialog was the most expensive item on this list** — the one that most obviously
 * could not cross a cross-origin frame — and the player never needed it.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const SRC = resolve(__dirname)
const SKIP_DIRS = new Set(['vendor', 'fixtures', 'testSupport', 'icons'])

/** Every source module in this repository, which is every module the player has. */
const PLAYER_MODULES: string[] = readdirSync(SRC).filter(
  (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)
)

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      sourceFiles(full, out)
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) continue
    if (/\.test\.tsx?$/.test(entry.name)) continue
    if (/\.d\.ts$/.test(entry.name)) continue
    out.push(relative(SRC, full))
  }
  return out
}

function importsOf(moduleRelPath: string): string[] {
  const src = readFileSync(join(SRC, moduleRelPath), 'utf8')
  const found = new Set<string>()
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"](\.[^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const base = resolve(dirname(join(SRC, moduleRelPath)), m[1]!)
    for (const ext of ['', '.ts', '.tsx']) {
      try {
        if (statSync(base + ext).isFile()) {
          found.add(relative(SRC, base + ext))
          break
        }
      } catch {
        /* not this extension */
      }
    }
  }
  return [...found]
}

const KNOWN = new Set(sourceFiles(SRC))

/** Block and line comments removed, so prose about a call is not counted as one. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Everything the player reaches, its own modules and the shared ones below them. */
function playerClosure(): string[] {
  const seen = new Set<string>()
  // **Every module in this repository is the player's**, since the split of 2026-09-06 — there is
  // no boundary list to consult here, because there is nothing on the other side of it. This walked
  // `PLAYER` from `productBoundary.ts` while the two products shared a repo.
  const stack = [...PLAYER_MODULES]
  while (stack.length > 0) {
    const m = stack.pop()!
    if (seen.has(m) || !KNOWN.has(m)) continue
    seen.add(m)
    for (const dep of importsOf(m)) if (!seen.has(dep)) stack.push(dep)
  }
  return [...seen].sort()
}

/**
 * **Every main-process call the player's closure makes**, whether through `platform.ts` or straight
 * off `window.electronAPI`.
 */
function mainProcessCalls(): string[] {
  const platformSrc = withoutComments(readFileSync(join(SRC, 'platform.ts'), 'utf8'))

  /** The `electronAPI` methods one exported `platform.ts` function reaches. */
  function callsInsidePlatformFunction(name: string): string[] {
    const start = platformSrc.search(
      new RegExp(`export (?:async )?function ${name}\\b`)
    )
    if (start < 0) return []
    // The next top-level `export` after it is where this function's body ends. Crude and exact
    // enough: everything in this file is a top-level export at column zero.
    const rest = platformSrc.slice(start + 1)
    const next = rest.search(/\nexport /)
    const body = next < 0 ? rest : rest.slice(0, next)
    return [...body.matchAll(/\ba\.([a-zA-Z]+)\(/g)].map((m) => m[1]!)
  }

  const used = new Set<string>()
  for (const module of playerClosure()) {
    if (module === 'platform.ts') continue
    // **Comments are prose, not calls** (2026-09-06). This scanned raw text, so a doc that wrote
    // `electronAPI.ping()` as an EXAMPLE was counted as a seventeenth machine call. The measure is
    // what the player calls; a sentence about what it calls is not one.
    const src = withoutComments(readFileSync(join(SRC, module), 'utf8'))
    // Straight off the bridge, in a view that has one.
    for (const m of src.matchAll(/electronAPI[?.]*\.([a-zA-Z]+)\(/g)) used.add(m[1]!)
    for (const m of src.matchAll(/\bapi\.([a-zA-Z]+)\(/g)) if (m[1] !== 'then') used.add(m[1]!)
    // Through `platform.ts`, named or as a namespace — only the functions this module calls.
    const wanted = new Set<string>()
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\/platform'/gs)) {
      for (const raw of m[1]!.split(',')) {
        const name = raw.trim().replace(/^type\s+/, '')
        if (name) wanted.add(name)
      }
    }
    if (/import \* as platform from '\.\/platform'/.test(src)) {
      for (const m of src.matchAll(/platform\.([a-zA-Z]+)\(/g)) wanted.add(m[1]!)
    }
    for (const name of wanted) for (const call of callsInsidePlatformFunction(name)) used.add(call)
  }
  return [...used].sort()
}

/** Every module in the player's closure that talks over a `storage` event. */
function crossWindowChannels(): string[] {
  return playerClosure().filter((m) =>
    /addEventListener\('storage'/.test(readFileSync(join(SRC, m), 'utf8'))
  )
}

describe('what the player asks of the platform, and what framing costs it', () => {
  it('names every main-process call the player makes, and a same-origin frame makes them all', () => {
    // **A frame has no preload of its own**, and this app withholds one from Bombista's and
    // Muralista's pages on purpose — `nodeIntegrationInSubFrames` would hand it to those too, which
    // the spike measured. **A SAME-ORIGIN frame needs none: it reaches the embedder's window.**
    // Measured on the packed build, `window.parent.electronAPI` answers.
    //
    // Two of these are writes and one launches a subprocess, so a bridge would not have been a
    // read-only one. **There is no bridge. These sixteen do not get cheaper — they never cross.**
    expect(mainProcessCalls()).toEqual([
      'closeProjection',
      'createGigFolder',
      'describeDisplays',
      'getFileStats',
      'isProjectionOpen',
      'listGigsFolder',
      'listSongsFolder',
      'onProjectionClosed',
      'onProjectionOpened',
      'openProjection',
      'projectionPlacement',
      'readGigFolder',
      'readSongFile',
      'validateSongForPerformance',
      'writeGigFile',
    ])
  })

  it('names every cross-window channel, which a same-origin frame does share', () => {
    // **Chromium partitions storage by top-level SITE, and a port is not part of a site.** That is
    // what made `file://` the blocker rather than the frame: a `file://` shell shares nothing with
    // anything. **Both documents are `tramoya://app` now**, so the framed player and the projection
    // window it opens share `localStorage` — measured on the packed build, in both directions.
    //
    // **This is how the wall learns what to paint**: the lyric and its index, the room, the message
    // home, the blackout, the video transport, whether the video runs, the armed flag.
    //
    // **THIS COUNTS LISTENER MODULES, NOT KEYS, AND THE DIFFERENCE HAS BITTEN ONCE** (2026-09-06).
    // The display-mode channel was read by a listener living inside `ProjectionView.tsx`, which was
    // already on this list; **`videoRunsBroadcast.ts` replaced it with a module of its own, so the
    // count went up by one while the number of keys crossing stayed the same.** A rise here is a
    // question to ask, never an answer: **read what moved before reading it as a cost.**
    expect(crossWindowChannels()).toEqual([
      'LanguagesView.tsx',
      'ProjectionView.tsx',
      'ShapeVideo.tsx',
      // **The card channel, formerly inside `gigContactState.ts`** (2026-09-06). The count did not
      // move: the wire came out of the player's condition module and into a `SHARED` one of its
      // own, because the gig flow's Cards step writes it and the condition is still the player's.
      'cardBroadcast.ts',
      'performanceState.ts',
      'useSongNavigation.ts',
      'videoRunsBroadcast.ts',
      'visualsBroadcast.ts',
    ])
  })
})
