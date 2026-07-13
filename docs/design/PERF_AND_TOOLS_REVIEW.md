# Performance & Missing-Tools Review

Follow-up to the full-codebase review (2026-07-13): where the system spends its time, which of
that is avoidable, and which analyses the toolset doesn't offer yet. Every perf claim is anchored
to code; product items are ranked by value-per-effort. Companion: `docs/design/CHAT_TOOLSET_REVIEW.md`
(chat-surface defects), `ROADMAP.md` (the backlog these feed).

The cost model everything below follows: **engine searches dominate all repertoire tooling by
orders of magnitude**; tree walks are O(nodes) on opening-sized trees and basically free. So the
wins are ranked: fewer searches > cheaper searches > parallel searches > everything else.

---

## Performance / speedups

### P1. Engine pool — parallel searches (largest available speedup)

Both hosts run ONE single-threaded wasm instance with strictly serialized searches
(`serial()` — engine.ts:91-96, stockfish.ts:77-82; zero `Worker`/`worker_threads` in the Node
engine). Every scan is embarrassingly parallel: `find_repertoire_gaps` = 20 independent positions,
`find_pruning_transpositions` = per-candidate searches, `batch_review` = per-game passes,
`analyzeMainline` = per-position evals. An N-worker pool (Node `worker_threads`, browser N×`Worker`)
gives ~linear speedup with cores on exactly the operations users wait minutes for.

Shape: pool behind the same `analyseMulti` signature (the `Analyse` injection point means
chess-tools needs zero changes); the eval cache becomes the pool's front. The P2 scan memo
(pgn.ts:601) already keys by position, so out-of-order completion is safe; `onProgress` counts
completions instead of sequence. Watch: wasm memory per worker (~64MB+ each) — cap pool at
`min(cores, 4)` default, env-tunable.

### P2. Stop clearing the engine's transposition table between searches

`ucinewgame` is sent before EVERY search (engine.ts:136, stockfish.ts:122,187) — it wipes the
engine's hash table. Repertoire scans search hundreds of positions that differ by 1-2 moves; a warm
TT carries most of the previous search's work forward. Sending `ucinewgame` once per tool call (or
never — position changes are full `position fen`) keeps the TT hot for a real same-depth speedup on
every multi-position scan. Trade-off: TT warmth changes move ordering, so node counts (and
occasionally the reported line at equal eval) vary run-to-run — same class of nondeterminism
`movetime` already accepts. Document it; keep depth as the reproducibility knob.

### P3. Persist the eval cache across sessions

Both eval caches are in-memory only (engine.ts:35, stockfish.ts:71) — every new Claude Code session
or PWA reload re-searches the same repertoire from scratch, and re-analysis of a repertoire you
iterate on daily is the dominant repeat cost. Node: write-through to a small disk store
(`~/.cache/chess-mcp/` — JSON-lines or sqlite; key `positionKey|multipv`, value depth+lines, prune
by size). Browser: mirror `multiCache` to IndexedDB (load on boot, debounced write). The depth-reuse
rule (`stored depth >= requested` serves) already makes stale-by-depth impossible; evals are
position-pure so there is no invalidation problem at all.

### P4. Engine cache keyed on full FEN misses transpositions

`evalCache.key = fen|multipv` with clocks included (engine.ts:28-37, deliberate: 50-move rule).
But every consumer that benefits from transposition reuse re-keys by `positionKey` itself
(pruneTranspositions memo pgn.ts:601) — the engine cache misses the same position reached with a
different halfmove/fullmove counter, which in opening trees is the common case (transpositions
by definition arrive with different move counts). Candidate: key on
`positionKey|multipv` when the halfmove clock is low (< 50), full FEN otherwise — opening analysis
gets transposition hits, 50-move-sensitive endgames keep exactness. Pairs with P3 (a persisted
cache should be keyed the transposition-friendly way from day one).

### P5. `pruneTranspositions` re-runs the full-tree pre-pass on every cursor chunk

`allWork = leaves.map(replayLeaf)` (pgn.ts:588) replays and candidate-filters the WHOLE tree before
slicing, on every chunked call — driving a big scan in N chunks pays the engine-free pre-pass N
times (each `replayLeaf` runs `enumerateLegal` × `landsInCrossBranchPrep` per your-turn step). It
exists to compute `totalPositionsEstimate`. Options: (a) accept a slice-only estimate on cursor
calls; (b) cache the pre-pass per `repertoire_id` (the tree is immutable per handle —
clone-on-write guarantees it). (b) is clean server-side.

### P6. `enumerateLegal` allocates every after-position before a `.some()` early-exits

pgn.ts:189-205 builds the full `{move, after}` array (one `pos.clone()` + `play` per legal move,
~30 clones/node), then the P1-prefilter asks `.some(...)` over it (pgn.ts:581). A generator (or a
`someLegal(pos, pred)` helper) stops cloning at the first cross-branch hit. Micro but free, and it
sits inside the per-leaf-per-step hot loop of the pre-pass P5 also hits.

### P7. Memoize `themes`/`centerState` like `classifyStructure`

`classifyStructure` is placement-memoized (structure.ts:352-363); `themes()` and `centerState()`
are not, yet `structuralSignals` (structure.ts:430) calls all three per board — per leaf in
`buildFitProfile`, per candidate in suggest_*, per ply in the UI's `lineFit` (gaps.ts:158). Same
placement-key memo, same determinism argument. Small constant-factor win, zero risk.

### P8. `GameTree.edit` clones via PGN round-trip

`fromPgn(this.toPgn())` (pgn.ts:937) = serialize + reparse + full `assertLegal` replay per edit.
`checkShortcutCoverage` does it per inspection; the single-session edit loop does it per action.
A direct structural node copy (the tree is already legal — cloning can't introduce illegality)
skips all three. Only matters if edit loops get long; low priority.

## Process

### PR1. Chunked scans re-enter through a cold server anyway

The MCP server is a per-session stdio process; P3 (persistent evals) is what actually makes
`find_pruning_transpositions` cursor-driving cheap across sessions — worth doing before any further
cursor-protocol polish.

### PR2. CI engine smoke (existing ROADMAP item)

`test/smoke-client.mjs` stays out of CI because of live network calls; gating those behind an env
flag lets the engine path regress visibly. Already on ROADMAP; repeating here because several fixes
this week (terminal-position `[]`, watchdog behavior) were exactly engine-path regressions smoke
would catch.

---

## Missing analysis / tools

### T1. `audit_repertoire_moves` — engine-check YOUR moves, tree-wide (clear gap)

Nothing today engine-vets the user's own prescribed moves across the tree: `find_repertoire_gaps`
checks opponent coverage, congruence is thematic, `compare_moves` is one position by hand,
`analyze_game` wants a linear game. The obvious missing primitive: walk every your-turn node,
multipv-2 search, report `cp_loss(prescribed vs best)` ranked worst-first with drill-down paths —
"which of my repertoire moves are actually bad". Reuses `decisionNodes`-style enumeration (flip the
turn filter), the near-best machinery, and the severity vocabulary. Engine cost ≈ one gap scan.
Highest value-per-effort on this list.

### T2. Lichess opening-explorer integration (one client, three tools)

`explorer.lichess.ovh` (masters / lichess / player DBs) is free, fits the existing rate-limited
`apiclient`, and unlocks:
  - **Popularity-weighted gaps** — the existing ROADMAP item's concrete data source: rank
    `find_repertoire_gaps` output by how often opponents actually play each uncovered move
    (engine criticality × real-world frequency).
  - **`position_popularity`** — moves + frequencies + win rates at a FEN ("what do humans play
    here"), the grounding for "is this line practically relevant".
  - **Theory-depth detection** — walk each line until explorer game counts collapse: the ply where
    the repertoire leaves known theory. Tells the user where memorization stops paying and prep
    becomes original — pairs directly with Shorten's memorization economics.

### T3. `prep_vs_opponent` — compose existing pieces into match prep

Given an opponent username: fetch their games (tools exist), aggregate their opening tree by color,
intersect with the repertoire — which of YOUR lines you'll actually reach vs them, their habitual
moves your tree doesn't cover, and (with T2) their score in those lines. `repertoire_vs_history`
already walks games-vs-map; this is the same walk pointed at the opponent + a per-line hit-rate
rollup. High practical value for match play; mostly orchestration, little new math.

### T4. Criticality / only-move tagging → drill export

From any multipv-2+ scan (T1 produces this for free): tag your-turn positions where
`best − second ≥ threshold` — the "only move" positions where misremembering is punished. Rank
lines by criticality density ("sharpest lines to drill"). Then export the tagged set as a
spaced-repetition deck (FEN → prescribed move, CSV/Anki format) — the training-loop complement to
Shorten's "memorize less": *memorize what matters, drop the rest*. (`tactics_drill` #29 on ROADMAP
is adjacent; this variant needs no external puzzle DB — the repertoire IS the deck.)

### T5. Structural position search

`get_structural_profile` aggregates; there is no query. "Show every line reaching an IQP /
fianchetto / locked-center position" = filter `leaves()` by classifier output, return paths —
engine-free, ~30 lines, makes the 19-structure classifier navigable instead of just descriptive.

### T6. Annotated repertoire export

`export_annotated_pgn` is game-mainline-only. A repertoire variant embedding analysis results as
PGN comments/NAGs at the flagged nodes (gap here / congruence outlier / T1 cp_loss / T4 only-move)
makes every finding portable to any board GUI instead of living only in tool JSON. Builder exists
(chessops `makePgn` keeps comments; the edit loop already round-trips).

### T7. `repertoire_vs_history`: report all departures, not the first

`walkGameVsRepertoire` stops at the first departure per game (game.ts:72 comment). A game where the
user misplays at ply 6 still contains an opponent novelty at ply 14 the prep should learn from.
Continue the walk past a departure while positions still match by transposition key — same map, same
loop, richer drill list. Small change, existing tool gets better.

## Robustness & consistency notes

Not perf, not chat-surface — recorded here so the repo carries them (some previously lived only in
session memory).

### R1. Node engine watchdog race (known-deferred; fix shape now exists)

engine.ts:111 resolves null on the 30s watchdog but leaves the search running; the next serialized
search replaces the global `lineHandler`, and the timed-out search's late `bestmove` can resolve
the NEXT search early — with partial/empty lines that get **cached**. The browser side got the
stop-then-grace fix (commit 84ee190); mirroring it to Node (send `stop`, resolve on the imminent
bestmove, grace timer for a hung engine, skip cache on stopped) closes the race the same way.

### R2. FEN-setup PGNs load but every walker ignores the header (known-deferred)

`assertLegal` honors a `FEN` header (pgn.ts:238); every other walker replays from
`Chess.default()` — `positionAt` (pgn.ts:286), leaves/coverage/keyIndex/congruence/
`userMovesAlong` (repcongruence.ts:79), `mainline` (game.ts:25, comment admits it). A FEN-header
PGN passes load, then every tool silently analyses the wrong positions or errors. Cheapest honest
fix: reject FEN-header PGNs at `fromPgn` with a closed-set error until walkers take a start
position; full fix: one root-position helper all walkers share.

### R3. Handle TTL only enforced on store

`get()` (handles.ts:40-45) never checks TTL — an expired repertoire is served indefinitely if no
`load_*` call happens to trigger `evict()`. Harmless for correctness (the tree is immutable), but
the README documents "idle seconds before a cached repertoire expires" and memory-bounding is the
TTL's job. One `if (now - e.ts > TTL_MS)` in `get()`.

### R4. No in-flight request coalescing at either engine

Two concurrent identical `analyseMulti` cache misses both run the search (both hosts — the serial
chain runs them back-to-back; the second finds the cache filled only if keyed identically AND the
first finished). The P1 pool front should dedupe in-flight requests by cache key.

### R5. Autosave restore trusts the saved path

persist.ts:48 `goto(saved.path)` — a corrupt/mixed IndexedDB record makes the first `fen()` read
throw in render, after the restore try/catch has already passed: crash loop until site data is
cleared. One probe (`tree.fenAt(path)` inside the try, fall back to `[]`) makes restore
self-healing.

### R6. OpenRouter stream errors surface as silent truncation

openrouter.ts:91-124 parses `delta` frames and ignores everything else — a mid-stream provider
error event or abnormal `finish_reason` (length, content_filter) just ends the text. The user sees
a clipped answer with no signal. Surface non-`stop` finish reasons and error events into the chat
error state.

### R7. UI gap scan is a hand-maintained fork of `findRepertoireGaps`

store/gaps.ts:261-329 duplicates the scan loop for progress + cancel (header comment owns it).
Parity (severity math, covered-by-transposition semantics) is by hand. `pruneTranspositions`
already takes an `onProgress` callback — give `findRepertoireGaps` the same (+ a cancel check) and
the UI fork collapses onto the shared implementation.

### R8. `aggregateGames` best/worst group has no sample floor

game.ts:142-152 ranks groups by raw win_rate — a 1-game group can be crowned worst/best opening.
A min-games threshold (or reporting games alongside, which it does — but the headline pick should
respect it) keeps batch_review verdicts honest.

### R9. Cloud eval ships every browsed position to Lichess

store/cloud.ts fires on each position change (600ms debounce). By design and rate-limited, but
worth a settings toggle for users who don't want their prep lines leaving the machine — the whole
rest of the PWA is local-first.

## Suggested order

1. **P3 + P4** (persistent, transposition-keyed eval cache) — every session, every tool, forever.
2. **T1** (`audit_repertoire_moves`) — biggest product gap, smallest new surface.
3. **P2** (keep TT warm) — one-line-ish, benchmark before/after on the sample repertoire.
4. **P1** (engine pool) — the big lever; do after P3 so the pool fronts a persistent cache.
5. **T2** (explorer client + popularity gaps) — unlocks the existing ROADMAP item.
6. **T3/T4** — composition tools on top of T1/T2 output.
7. **P5-P8, T5-T7** — opportunistic.
