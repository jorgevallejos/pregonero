# Vendored from Muralista — a cache, not a fork

`warp.js` is **Muralista's**, copied here byte for byte. Pregonero executes it because Pregonero is
the only thing running on stage; the warp is still Muralista's to own, because only Muralista has a
camera and can close the loop against a real wall.

**Taken from muralista `v1.4.0`, `mapper/warp.js`.** The tag is recorded in `warp.source.json`
alongside the SHA-256 of the bytes, and it is the tag the copy was actually taken from —
`v1.4.0` and `v1.4.1` are byte-identical (`v1.4.1` added Muralista's own CI and no maths), so
either would have produced these bytes, and this one is the one that did.

`warp.test.mjs` is Muralista's contract test, vendored from the same tag and unchanged. It is the
same file run in both repos, which is what makes "both repos are green" mean the two tools agree
about where every shape lands. `npm test` runs it (`npm run test:warp`).

## Two rules, and neither is a style preference

**Never edit anything in this folder except `warp.d.ts` and this README.** A fix goes into Muralista
and is re-vendored; the hash test in `src/vendorWarp.test.ts` is what demotes this copy from a fork
to a cache, and editing in place is what would quietly turn it back into one.

**When a change comes across, the tag in `warp.source.json` is what moves.** A copy that can only
say "sometime in August" cannot be re-synced when the two disagree.

`warp.d.ts` is Pregonero's, not Muralista's: the module has no types of its own and a `.d.ts` next
to it is how a TypeScript caller sees the exports without a single byte of the original moving.

The contract these bytes implement — including the four caller obligations no test in either repo
can catch — is `projects/tramoya-integration/docs/warp-contract.md` in the vault.
