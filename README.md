# Pregonero

**The surtitle player.** Given a gig, a room and song files, it arms and puts words on shapes until
the setlist ends. **It creates nothing** — that is the whole of the product, and the reason it is
its own repository.

Pregonero is what an opera house runs: a player fed by files someone else made. The files are made
by [Bombista](https://github.com/jorgevallejos/bombista), which authors the words in time, and
[Muralista](https://github.com/jorgevallejos/muralista), which authors the space.

## What this repo builds

One page. `player.html`, and everything it loads.

```bash
npm install
npm run dev     # the page on its own, at localhost:5175
npm run build   # dist/player.html and its assets
npm test        # the suite, plus Muralista's own warp contract test
```

## How it is used

**[Tramoya](https://github.com/jorgevallejos/tramoya) is the shell**, and it holds the three tools,
owns the folders, and manages the catalogue and the gigs. It vendors what this repo builds and
serves it from the app's own origin — `tramoya://app/player.html` — framed inside the shell's
window, and loaded directly by the projection window.

**Same origin is not an implementation detail.** It is what lets the framed page reach the
embedder's bridge to the machine and share `localStorage` with the projection window, which is how
the wall learns what to paint. Chromium partitions storage by top-level site, so a cross-origin
frame would have neither.

**The page never assumes it has a host.** `src/bridge.ts` asks for the bridge and copes with not
having one — which is what makes it testable here, and what a standalone Pregonero would boot from.

## The boundary

The split of 2026-09-06 put every module on one side of a line: *the shell makes things, the player
uses them.* Backstage, the song flow and the gig flow make; **Standby and the performing view use a
finished gig.**

Arming is not the boundary. It is a state inside the player, because a player that cannot choose
the song, set the languages, open the projection and arm is not a player.

**What travelled with the player are the modules it reads the made files with** — the gig, the
room, the song, the catalogue's read half. Tramoya keeps its own copies for the shell, and pins
them against this repo's tag so the two cannot drift apart in silence.

## Where the reasoning lives

Design decisions, the data contract and the history of both products are in the
`tramoya-integration` vault, not here.
