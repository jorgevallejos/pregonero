/**
 * **The gig picker — the full-screen list `Choose` opens from Standby** (Jorge, 2026-09-05).
 *
 * **One pattern for both columns.** `Setlist` opens a full-screen list of songs from the `SONG`
 * column; this is the same screen for the `GIG` column — big rows, one per gig, and a `Back` that
 * returns to Standby. **The picker rides on Standby, which is the player's**, and it is one of the
 * two surfaces the shell and the player share.
 *
 * **This supersedes *the gig name itself is the control*** (03/09). That ruling made the value the
 * button because the panel is read at a distance in a dark room. **The reasoning reverses on its
 * own terms: every other column already carries a button in that slot**, so a button in a known
 * position is the easier target in the dark, not the harder one.
 *
 * **From nothing there is no button and no empty picker.** Standby draws `Choose` only when there
 * is at least one gig, so this screen is never met empty — the column reads `No gig`, the only
 * control is `Setup`, and that says *go make one* without a screen to say it in.
 *
 * **Newest first, by the gig's own date.** `gig.json` carries `YYYY-MM-DD`, which sorts as a
 * string, and nothing is written until the date and the venue are both answered — so every gig
 * this app made has one. A gig whose file was written by hand and has none sorts last, because an
 * undated gig cannot be tonight's.
 *
 * **It selects through `openGigFolder` and nothing else.** That function is the whole memory of
 * which gig is open; the pencil on Backstage goes through it too. **Two doors performing one act
 * is fine; two mechanisms is how they drift.**
 *
 * **Big full-width rows, stacked from the top, left-aligned** (Jorge, 2026-09-06). The first
 * build reused the setlist screen's song tile — a fixed 220×130 box in a centred auto-fit grid,
 * label clamped to three lines — so the one thing this screen exists to show was wrapped and
 * truncated inside a small box in an empty window. **The row is the width of the app and the
 * label is one line**, because this is read across a dark room like everything else here.
 *
 * **Nothing is asked on the way, and a half-finished gig is selectable.** Readiness is reported at
 * arming, which is where the gate is — the same rule the play triangle lived under before it came
 * off Backstage's rows. Blocking selection here would stop Jorge looking at his own gig.
 */
import { useEffect, useState } from 'react'
import { getGigsFolder } from './contentFolders'
import { readGigFolders } from './gigFolderList'
import { readGigLabels } from './gigLabels'
import { gigLabel, parseGigFile } from './gigFile'
import { openGigFolder } from './gigSession'
import { readGigFolder } from './platform'

export type GigChoice = { path: string; label: string; date: string | null }

/**
 * **What the picker lists, in the order it lists them.**
 *
 * Read live, like every other gig reading in this app: the label follows an edit made in the flow,
 * and nothing about a gig is stored anywhere but its own file.
 */
export async function readGigChoices(
  gigsRoot: string,
  options: {
    list?: typeof readGigFolders
    labels?: typeof readGigLabels
    read?: (folderPath: string) => Promise<{ gigText: string | null }>
  } = {}
): Promise<GigChoice[]> {
  const list = options.list ?? readGigFolders
  const labels = options.labels ?? readGigLabels
  const read = options.read ?? readGigFolder

  const listing = await list(gigsRoot)
  const labelByPath = await labels(listing.gigs)

  const choices: GigChoice[] = []
  for (const path of listing.gigs) {
    let date: string | null = null
    try {
      const text = (await read(path)).gigText
      if (text !== null) date = parseGigFile(text).date ?? null
    } catch {
      date = null
    }
    choices.push({ path, label: labelByPath.get(path) ?? gigLabel(null, path), date })
  }
  return sortNewestFirst(choices)
}

/** Newest first by the gig's own date; undated last, then by label so the order is stable. */
export function sortNewestFirst(choices: readonly GigChoice[]): GigChoice[] {
  return [...choices].sort((a, b) => {
    const ad = a.date ?? ''
    const bd = b.date ?? ''
    if (ad !== bd) {
      if (ad === '') return 1
      if (bd === '') return -1
      return bd.localeCompare(ad)
    }
    return a.label.localeCompare(b.label)
  })
}

export function GigsView() {
  const [choices, setChoices] = useState<GigChoice[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const gigsRoot = getGigsFolder()
      const found = gigsRoot === null ? [] : await readGigChoices(gigsRoot)
      if (!cancelled) setChoices(found)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const goBack = () => {
    window.location.hash = '#/'
  }

  const choose = (path: string) => {
    if (busy) return
    setBusy(true)
    void (async () => {
      await openGigFolder(path)
      window.location.hash = '#/'
    })()
  }

  return (
    /* **ROWS, NOT SONG TILES** (Jorge, 2026-09-06). This screen reused `.songs-song-btn`, which is
       a fixed 220×130 box in a centred auto-fit grid with a three-line clamp on its label — so a
       gig read `2026-05-16 · Bom Festival` wrapped over three lines and truncated, alone in an
       empty screen. **The second class is how every screen on this surface escapes that grid**
       (Backstage, the folders list, the song flow); this follows the precedent rather than
       inventing a way out. */
    <div className="songs-screen gigs-picker-screen">
      <header className="songs-top-bar">
        <button type="button" className="songs-back" onClick={goBack}>
          Back
        </button>
        <h1 className="songs-title">Gigs</h1>
      </header>
      <main className="songs-body gigs-picker-body" data-testid="gigs-picker">
        {/* **`null` is *not read yet* and `[]` is *read and empty*, and they are different
            screens.** The empty one should be unreachable — Standby draws no `Choose` from
            nothing — so it says what it means rather than pretending to be a list. */}
        {choices === null ? null : choices.length === 0 ? (
          <p className="setlist-prompt" data-testid="gigs-picker-empty">
            No gigs yet. Gigs are made on Backstage.
          </p>
        ) : (
          choices.map((choice) => (
            <button
              key={choice.path}
              type="button"
              className="gigs-picker-row"
              data-testid={`gigs-picker-row-${choice.path.split('/').filter(Boolean).pop()}`}
              disabled={busy}
              onClick={() => choose(choice.path)}
            >
              {/* The date and the venue on one line, which is what `gigLabelFrom` already
                  returns. **One rule for what a gig is called**, and this screen does not get a
                  second rendering of it. */}
              {choice.label}
            </button>
          ))
        )}
      </main>
    </div>
  )
}
