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

### P1. Engine pool — parallel searches — ✅ shipped 2026-07-13 (both hosts, commits 7d0fe32 + 9d34f57)

Node: pool of Stockfish wasm child processes speaking UCI over stdio (worker_threads is a dead
end — the emscripten UMD wrapper treats a node worker as a web worker and exports nothing),
`ENGINE_POOL_SIZE` env (default `min(cores,4)`, `0` forces the old in-process engine, which is
also the automatic fallback when spawn fails). chess-tools scan loops (`findRepertoireGaps`,
`auditRepertoireMoves`, `analyzeMainline`, `compareMoves`, `checkShortcutCoverage`) fire
per-position searches concurrently — the pool queue is the limiter. Fixture scan (96 positions,
depth 14 multipv 2, cache off): 17.1s serial → **6.4s at 4 children (2.7×)**, 4.9s at 8.
Absorbed R4 (in-flight dedupe, depth-aware join) and fixed R1 on the pool path (per-child single
ownership + stop-then-grace; stopped partials never cached). Browser half: N-worker scan pool
behind `analyseMulti` (budget `min(hardwareConcurrency||2,5)`, one slot reserved) + a DEDICATED
live worker (`analyseLive`, store/analysis.ts) so board browsing never queues behind a chat-scan
burst; dead streaming `analyse()` deleted. Deferred: prune-scan concurrency — its budget/cursor
accounting conflicts with fire-all, and the cross-leaf memo + persistent cache already blunt it.

### P2. Stop clearing the engine's transposition table between searches — ✅ shipped 2026-07-13

`ucinewgame` was sent before EVERY search — wiping the engine's hash table between positions that
differ by 1-2 moves. Now sent once per process (Node) / per worker (browser) at engine init; the
warm TT carries the previous search's work forward. Benchmark (fixture repertoire, 203 decision
positions, depth 14 multipv 2, cache disabled): 41.8s → 33.9s, **~19% faster**, stable across
runs. Trade-off (documented in AGENTS.md): TT warmth changes move ordering, so node counts (and
occasionally the reported line at equal eval) vary run-to-run — same class of nondeterminism
`movetime` already accepts; `depth` stays the reproducibility knob.

### P3. Persist the eval cache across sessions — ✅ shipped 2026-07-13

Both eval caches were in-memory only — every new session/reload re-searched the same repertoire.
Shipped: Node write-through JSONL at `$EVAL_CACHE_DIR/evals.jsonl` (default `~/.cache/chess-mcp/`,
`0` disables, loaded at boot, compacted on growth); browser `multiCache` mirrored to IndexedDB
(load at init, debounced write-back). Depth-reuse (`stored depth >= requested` serves) makes
stale-by-depth impossible; evals are position-pure, so entries never need invalidation.

### P4. Engine cache keyed on full FEN misses transpositions — ✅ shipped 2026-07-13

The cache key included the FEN clocks, so the same position reached by a different move order —
the common case in opening trees — missed. Shipped (both hosts): key = first four FEN fields
(`positionKey` rule) while the halfmove clock is < 50, full FEN at/above (50-move exactness).
Later extended with the cross-multipv serve (see §T1): a stored multipv-N entry truncates to
answer a narrower request at the same depth.

### P5. `pruneTranspositions` re-runs the full-tree pre-pass on every cursor chunk — ✅ shipped 2026-07-13

Option (b) as landed: the engine-free pre-pass (key index + per-leaf replay/candidates) is cached
on the GameTree INSTANCE per color — one field, no handle-keyed side table, and it serves both
hosts (the MCP handle is immutable via clone-on-write; the UI's live tree invalidates through
`appendSan`, its single mutation entry point). Cursor chunks and repeat scans on the same handle
now pay the pre-pass once (fixture: 52ms → 0ms on the second chunk); `totalPositionsEstimate`
stays whole-tree-accurate on every chunk. Scan code treats the cached `steps[].pos` as read-only.

### P6. `enumerateLegal` allocates every after-position before a `.some()` early-exits — ✅ shipped 2026-07-13

`iterateLegal` generator + `someLegal(pos, pred)` helper; `enumerateLegal` is now `[...iterateLegal()]`
so the move-building logic isn't duplicated. The P5 pre-pass candidate filter uses `someLegal` and
stops cloning at the first cross-branch hit.

### P7. Memoize `themes`/`centerState` like `classifyStructure` — ✅ shipped 2026-07-13

Same placement-key FIFO memo (4096 entries; themes keyed placement+color). Cached objects are
shared — callers must not mutate them (none did). Also what makes T5's repeat queries near-instant.

### P8. `GameTree.edit` clones via PGN round-trip — ✅ shipped 2026-07-13

Public `GameTree.clone()`: direct structural node copy (data + nags/comments arrays copied, headers
map cloned) — no serialize, no reparse, no `assertLegal` replay (the source tree is already legal).
`edit` uses it; T6's `annotateRepertoire` builds on it too.

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

### T1. `audit_repertoire_moves` — engine-check YOUR moves, tree-wide — ✅ shipped 2026-07-13

Nothing previously engine-vetted the user's own prescribed moves across the tree: `find_repertoire_gaps`
checks opponent coverage, congruence is thematic, `compare_moves` is one position by hand,
`analyze_game` wants a linear game. Shipped as chess-tools `auditRepertoireMoves` + MCP server tool:
`turnNodes` (the your-turn flip of `decisionNodes`, one shared walker) → multipv-2 per position →
`cp_loss(prescribed vs best)` ranked worst-first with SAN drill-down paths, `classifyCpLoss`
vocabulary, and `best_margin` (best − second — the T4 only-move seed, emitted for free). A
prescribed move outside the multipv lines gets one single-PV after-position search (the same
1-ply-offset comparison `analyzeMainline` makes). Bundled: cross-multipv eval-cache serve (a stored
multipv-N entry truncates to answer a narrower request at the same depth, both hosts) — so a gap
scan's multipv-4 entries now front the audit's searches. Chat/panel surfaces deliberately deferred
(chat: CHAT_TOOLSET_REVIEW §10 schema bloat; panel: wants R7's shared onProgress first).

### T2. Lichess opening-explorer integration (one client, three tools)

**SHIPPED 2026-07-13** — client in `chess-tools/src/explorer.ts` over the shared `apiclient`;
MCP server only (chat/panel deferred behind CHAT_TOOLSET_REVIEW §10, same call as T1). The three
capabilities, as landed:
  - **Popularity-weighted gaps** — `popularity` flag on `find_repertoire_gaps` (not a new tool):
    the surviving gaps (post-limit, so ≤ limit requests) get `played_pct`/`played_games` and
    re-rank by frequency WITHIN each severity tier; explorer failure nulls the annotation, never
    the scan. Closed the ROADMAP feature item.
  - **`position_popularity`** — per-move frequencies + white-POV win rates + opening name at a
    FEN; `db` = `lichess` (default: 1800+ blitz/rapid/classical) or `masters`.
  - **`find_theory_depth`** — DFS from the root querying the explorer per position; a line exits
    theory at the first position with < `min_games` (100 lichess / 5 masters). No descent below
    an exit + transposition dedupe ⇒ queries ≈ unique in-theory positions; `max_positions` ≤120
    caps wall-clock (~1 query/s).

Landed constraints discovered at ship time: the explorer requires **auth since ~2026-03**
(anonymous → 401; personal token, no scopes, `LICHESS_TOKEN` → `explorer_auth_required` when
unset) and the host moved to `explorer.lichess.org`. Cache is in-memory only (explorer data
drifts daily; stale popularity is silently wrong, unlike a merely-shallow stale eval). Bundled:
`apiclient` now honours Lichess's 60 s post-429 cooldown globally. The `/player` DB (NDJSON
stream) is deliberately left for T3.

### T3. `prep_vs_opponent` — compose existing pieces into match prep — ✅ shipped 2026-07-13

Given an opponent username: fetch their games (tools exist), aggregate their opening tree by color,
intersect with the repertoire — which of YOUR lines you'll actually reach vs them, their habitual
moves your tree doesn't cover, and their score in those lines. Shipped as MCP-only `prep_vs_opponent`
(index.ts, next to `repertoire_vs_history`): fetches the opponent's games on the color they'd face
this repertoire from, reuses `walkGameVsRepertoire` per game for coverage/`uncovered_opponent_moves`
(same shape as `repertoire_vs_history`, minus `player_deviations` — in these games repColor's moves
are a random third party's, not the target's, so that field is noise here), and buckets games by
`identifyDeepest` opening name into a `lines[]` rollup (games, hit_rate, win/draw/loss_rate from
the opponent's own `user_result`). No engine calls — pure composition of T1-era pieces + T2's
`identifyDeepest`/games fetchers. Chat/panel surface deliberately deferred (CHAT_TOOLSET_REVIEW §10
schema bloat, same call as T1/T2).

### T4. Criticality / only-move tagging → drill export — ✅ shipped 2026-07-13

Tag your-turn positions where `best − second ≥ threshold` — the "only move" positions where
misremembering is punished — and export them as a spaced-repetition deck: the training-loop
complement to Shorten's "memorize less": *memorize what matters, drop the rest*. Shipped as
chess-tools `findOnlyMoves` + `onlyMoveDeckCsv` and MCP tool `find_only_moves`: same `turnNodes`
walk + multipv-2 search as T1 but the opposite filter (the audit's cp_loss gate drops the healthy
prescribed-is-best case this tool exists for), `min_margin` default 100cp, single-legal-move
nodes skipped (nothing to drill). `lines[]` ranks leaf lines by tagged-node density
(transposition-aware; the denominator counts scanned nodes only). `export_path` (confined to
REPERTOIRE_DIR) writes the FULL tagged set as a flashcard CSV — `front,back,fen,margin`, front =
numbered SAN path + side to move, back = prescribed move(s) + margin note, fen column for
board-rendering Anki templates; `limit` truncates only the in-context findings.
`prescribed_is_best=false` flags a sharp position whose repertoire move isn't the engine best —
route to `audit_repertoire_moves` before drilling (the deck drills the *prescribed* move; the
repertoire stays the arbiter). No new engine machinery — the eval cache's cross-multipv serve
means a prior audit or gap scan fronts the whole T4 scan. (`tactics_drill` #29 on ROADMAP is
adjacent; this variant needs no external puzzle DB — the repertoire IS the deck.)

### T5. Structural position search — ✅ shipped 2026-07-13

`searchStructures` (chess-tools) + MCP tool `find_structures`: filter leaf positions by classifier
output — named `structure` (case-insensitive, validated against `STRUCTURE_NAMES` with the list in
the error), `min_confidence`, `center`, boolean `themes[]`, `color_complex` — criteria AND-ed, ≥1
required (`missing_criteria`). Engine-free; P7's memos make repeat queries near-instant. MCP-only
(chat/panel deferred behind CHAT_TOOLSET_REVIEW §10, same call as T1-T4).

### T6. Annotated repertoire export — ✅ shipped 2026-07-13

`annotateRepertoire` (chess-tools, enginetools) + MCP tool `export_annotated_repertoire`: runs the
selected sources (`include` ⊆ audit / only_moves / gaps / congruence, default all) and embeds every
finding as a PGN comment at the flagged node of a P8 clone — audit findings also get the $2/$4/$6
NAG (same glyph map as `export_annotated_pgn`); a root-position gap goes to the game-level comment.
FULL finding sets are annotated (the interactive tools' `limit`s are in-context concerns);
`max_positions` caps the engine work, and audit + only-move share the same turnNodes multipv-2
searches via the eval cache. `export_path` (confined) writes the PGN to a file, else inline.

### T7. `repertoire_vs_history`: report all departures, not the first — ✅ shipped 2026-07-13

`walkGameVsRepertoire` now returns `player_deviations[]` / `uncovered_opponents[]` (each with
`ply`) and keeps walking after a departure, checking each later position against the move-map by
transposition key — a game that leaves book at ply 6 and transposes back still surfaces the ply-14
novelty. `in_book_plies` unchanged (consecutive from the start). All three aggregators updated
(`repertoire_vs_history`, `prep_vs_opponent`, the PWA chat mirror); dedupe keys unchanged, so one
game can now contribute several drill entries.

## Robustness & consistency notes

Not perf, not chat-surface — recorded here so the repo carries them (some previously lived only in
session memory).

### R1. Node engine watchdog race — ✅ fixed 2026-07-13 (P1 pool)

The pool path has per-child single ownership + the stop-then-grace watchdog (send `stop`, resolve
on the imminent bestmove, kill+respawn a hung child); stopped partials are never cached. The
shared `runSearch` gives the in-process FALLBACK path the same stop-then-grace behavior; only a
fallback engine hung past the grace window retains a residual handler-swap race (can't kill
in-process wasm) — accepted, fallback-only.

### R2. FEN-setup PGNs load but every walker ignores the header (known-deferred)

`assertLegal` honors a `FEN` header (pgn.ts:238); every other walker replays from
`Chess.default()` — `positionAt` (pgn.ts:285), leaves/coverage/keyIndex/congruence/
`userMovesAlong` (repcongruence.ts:79), `mainline` (game.ts:25, comment admits it). A FEN-header
PGN passes load, then every tool silently analyses the wrong positions or errors. Cheapest honest
fix: reject FEN-header PGNs at `fromPgn` with a closed-set error until walkers take a start
position; full fix: one root-position helper all walkers share.

### R3. Handle TTL only enforced on store

`get()` (handles.ts:40-45) never checks TTL — an expired repertoire is served indefinitely if no
`load_*` call happens to trigger `evict()`. Harmless for correctness (the tree is immutable), but
the README documents "idle seconds before a cached repertoire expires" and memory-bounding is the
TTL's job. One `if (now - e.ts > TTL_MS)` in `get()`.

### R4. No in-flight request coalescing at either engine — ✅ fixed 2026-07-13 (P1 pool, both hosts)

`analyseMulti` (and browser `analyseLive`) keep an in-flight map keyed by cache key; a concurrent
identical miss joins the pending search (join requires pending depth ≥ requested — a depth-16
request never silently adopts a pending depth-12 result).

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

1. ~~**P3 + P4** (persistent, transposition-keyed eval cache)~~ — shipped 2026-07-13: Node
   write-through JSONL at `EVAL_CACHE_DIR` (default `~/.cache/chess-mcp/`), browser IndexedDB
   mirror; both keyed `positionKey|multipv` below halfmove clock 50, full FEN at/above.
2. ~~**T1** (`audit_repertoire_moves`)~~ — shipped 2026-07-13 (see §T1; includes the
   cross-multipv cache serve on both hosts and the `turnNodes` shared walker).
3. ~~**P2** (keep TT warm)~~ — shipped 2026-07-13 (see §P2; ~19% same-depth scan speedup,
   nondeterminism trade-off documented in AGENTS.md).
4. ~~**P1** (engine pool)~~ — shipped 2026-07-13, both hosts (Node child-process pool +
   concurrent scan loops, 2.7× on the fixture scan; browser worker pool + dedicated live worker;
   R4 dedupe, R1 fix — see §P1).
5. ~~**T2** (explorer client + popularity gaps)~~ — shipped 2026-07-13 (see §T2; explorer now
   needs `LICHESS_TOKEN`, host moved to explorer.lichess.org).
6. ~~**T3** (`prep_vs_opponent`)~~ — shipped 2026-07-13 (see §T3).
7. ~~**T4** (only-move tagging + drill export)~~ — shipped 2026-07-13 (see §T4;
   `find_only_moves` + flashcard-CSV export).
8. ~~**P5-P8, T5-T7**~~ — shipped 2026-07-13 (P5 pre-pass cache, P6 lazy legal enumeration,
   P7 themes/center memo, P8 structural clone; T5 `find_structures`, T6
   `export_annotated_repertoire`, T7 all-departures history walk). Remaining in this doc:
   the R2/R3/R5-R9 robustness notes.
