# Vendored from Muralista — a cache, not a fork

**Two things are vendored here, for two different reasons.** `warp.js` is code Pregonero *runs*.
`mapper.js` is a file Pregonero *reads a fixture out of*. Both follow the same rule, and the rule
is the point: taken at a tag, hashed beside the copy, tested, never edited here.

## `warp.js` — code Pregonero runs

`warp.js` is **Muralista's**, copied here byte for byte. Pregonero executes it because Pregonero is
the only thing running on stage; the warp is still Muralista's to own, because only Muralista has a
camera and can close the loop against a real wall.

**Recorded at muralista `v1.7.0`, `mapper/warp.js`.** The tag is in `warp.source.json` alongside the
SHA-256 of the bytes. **The bytes have not moved since `v1.4.0`** — `v1.4.1`, `v1.6.0` and `v1.7.0`
are all byte-identical here, because none of them touched the maths — so the tag in that file
follows the page's tag rather than recording a re-vendor: all four files must be at one tag, and
this is the one they are at.

`warp.test.mjs` is Muralista's contract test, vendored from the same tag and unchanged. It is the
same file run in both repos, which is what makes "both repos are green" mean the two tools agree
about where every shape lands. `npm test` runs it (`npm run test:warp`).

## `mapper.js` — the file the stand-ins live in

**Taken from muralista `v1.7.0`, `mapper/mapper.js`**, with the tag and the SHA-256 in
`muralista-fixtures.source.json` and the hash test in `src/muralistaFixtures.test.ts`.

**`v1.7.0` moved this file for the page, not for the stand-ins.** It added the hosted gig endpoint —
`?gig=<relative URL>` makes Muralista read `gig.json` and `PUT` `visuals.json` over HTTP instead of
through a directory handle, which is how Pregonero stops asking for a folder it already made — and
left `LYRICS_PREVIEW_TEXT` and `INTRO_PLACEHOLDER` exactly as they were. The digest moved because
the file did; the two values this repo reads out of it did not.

It is here for exactly two constants, and Pregonero never executes it:

- **`LYRICS_PREVIEW_TEXT`** — the stand-in a `song-lyrics` slot is seeded with.
- **`INTRO_PLACEHOLDER`** — the annotation, title and tagline the `song-intro` card paints.

**These are two independent stand-ins.** Replacing one does not move the other: Muralista `v1.5.0`
replaced the lyrics one and `v1.6.0` replaced the intro one, separately, and assuming otherwise is
what cost a round.

`src/muralistaFixtures.ts` reads them out of these bytes by evaluating the declarations, so the
values Pregonero tests against are the values Muralista evaluates — escapes, quote marks and all.

**Why the whole 300 KB file and not an extract.** An extract would be a hand-copy, and a hand-copy
is precisely what went stale: `worstCase.ts` used to carry `LYRICS_PREVIEW_TEXT` typed in by hand
with its three numbers hardcoded beside it, Muralista replaced the string on 2026-08-27, and every
test in this repo stayed green. `mapper.js` is the only artefact Muralista tags that contains these
constants — the warp got its own file in `v1.4.0` and the stand-ins have not — so the file is what
gets vendored. **If Muralista ever extracts its fixtures the way it extracted the warp, this
shrinks to that module and nothing else here changes.**

## Two rules, and neither is a style preference

**Never edit anything in this folder except `warp.d.ts` and this README.** A fix goes into Muralista
and is re-vendored; the hash tests in `src/vendorWarp.test.ts` and `src/muralistaFixtures.test.ts`
are what demote these copies from forks to caches, and editing in place is what would quietly turn
them back into forks.

**When a change comes across, the tag in the matching `*.source.json` is what moves**, together
with the digest and the copy. A copy that can only say "sometime in August" cannot be re-synced
when the two disagree. **Never update a digest to match a file that was edited here** — that turns
the one test that can notice a fork into a rubber stamp.

`warp.d.ts` is Pregonero's, not Muralista's: the module has no types of its own and a `.d.ts` next
to it is how a TypeScript caller sees the exports without a single byte of the original moving.

The contract these bytes implement — including the four caller obligations no test in either repo
can catch — is `projects/tramoya-integration/docs/warp-contract.md` in the vault.
