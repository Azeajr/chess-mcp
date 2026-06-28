# Shorten / transposition-pruning — improvement backlog

Follow-up work for `find_pruning_transpositions` (MCP) and the PWA "Shorten" scan, captured after the
cursor-pagination + progress-bar pass (commit `a7eb9f2`). Related design: `SUGGEST_PRUNE_DESIGN.md`,
`TRANSPOSITION_OPPORTUNITIES_DESIGN.md`.

Core lives in `packages/chess-tools/src/pgn.ts` (`pruneTranspositions` → `PruneScanResult`); surfaces:
`apps/mcp-server/src/index.ts` (tool), `apps/ui/src/store/repertoire.ts` + `RepertoirePanel.tsx`
(PWA scan), `apps/ui/src/llm/tools.ts` (PWA chat tool). Engine: `apps/mcp-server/src/engine.ts`
(has a `fen|multipv` eval cache), `apps/ui/src/engine/stockfish.ts` (no cache).

## Verification log

- **P1 (MCP, live):** full scan of the real repertoire dropped from **385 → 16** engine analyses,
  same 6 suggestions. C2 filled the previously-null QGD `Bb4+` trade (`evalStay:-26`). U1 estimate
  tight (`total_positions_estimate:16`, == actual).
- **P3 (PWA, in-app, headless Chromium + Playwright):** loaded a synthetic repertoire with a
  cross-branch transposition, drove the real Shorten **Scan** button twice. Scan #1: 1 engine search,
  cache `0→1`, 2 suggestions. Scan #2 (identical): **0 new searches**, cache unchanged, same 2
  suggestions → cache hits serve the whole repeat. (Scan #2 wall-time was a polling artifact, not real
  cost — the search counter is the evidence.) Incidentally also confirmed P2 live: 1 search → 2
  suggestions from the shared node. Temp instrumentation reverted; tree clean.

## Why not just do all at once

- 20+ items in one branch = unreviewable diff. Land in logical commits.
- The cache items overlap — design the cache **once**, not piecemeal, or each redoes the last.
- Several items are **semantic / strategic**, not mechanical — they can regress soundness or prune the
  line you wanted. Those need a design doc + user judgment first (the "design-doc-first" rule).
- The perf items past the cache are **premature until profiled** — P1+P3 may already be enough.
- The PWA-UX items can't be verified by typecheck; they need the running app (`/run` + eyeball).

## Tier 1 — DONE (commit follows this doc update)

- [x] **H1** Export `PruneScanResult` from `packages/chess-tools/src/index.ts`. Also exported
  `pruneTailPath`.
- [x] **H2** Smoke coverage: `onProgress` fires, the `evalStay`-null/C2 path, P1 zero-work, and
  `pruneTailPath`. 119 pass.
- [x] **H3** Resolved by the P1 rewrite — the parity formula is gone; the estimate now counts real
  candidate nodes via a per-node `s.pos.turn` check, so it's color/root-agnostic by construction.
- [x] **P1** Pre-filter (engine-free): replay each leaf, keep only your-turn nodes whose legal moves
  include a cross-branch transposer; the engine is called on those alone. Doubles as a TIGHT progress
  denominator (real engine work, not a parity bound). `pruneTranspositions` core, both surfaces.
- [x] **C2** `evalStay` resolved via a single-PV eval of the position after the line's own move
  (negated to the mover) when that move is outside the engine's top-k → `evalDelta` never null.
- [x] **U1** Added `estimatedPositionsRemaining` (from this call's actual positions-per-leaf) +
  surfaced as `estimated_positions_remaining` on both tool returns.
- [x] **W1** `pruneTailPath(suggestion)` helper (exported, tested) returns the apply path =
  `linePath` truncated to `atPly+1`, encoding the don't-prune-`atPath` footgun. (Full one-call
  apply-+-rescan MCP tool still open — see W-series.)

## Tier 1b — the cache change — DONE

- [x] **P2** Scan-local memo in `pruneTranspositions`, keyed by transposition-stable `positionKey`
  (4-field FEN) + multipv. A position reached by several leaves or move-orders is analysed once; only
  a cache miss counts toward `analyses`/`onProgress`. Lives in the shared core, so both surfaces get
  it. No global-cache 50-move risk (the clock-insensitivity is local to one scan). Smoke: a shared
  candidate position is analysed once (`positionsAnalysed === 1`).
- [x] **P3** PWA `analyseMulti` eval cache (`stockfish.ts`), mirroring the MCP engine cache:
  `${fen}|${multipv}` key, depth-aware (serve if cached depth ≥ request), movetime compares at depth 0,
  FIFO eviction. Helps every PWA scan (gaps / shorten / bridges / complementary), not just shorten. The
  live single-PV `analyse` stays uncached (the eval bar wants a fresh streaming search).
- [~] **P4** Dedupe distinct decision positions across leaves — **not needed**: P1 (pre-filter) + P2
  (scan memo) already collapse the work. Revisit only if profiling a huge tree shows otherwise.

## Tier 2 — BUILT (see `SHORTEN_SEMANTICS_DESIGN.md` for the signed-off design)

- [x] **C1** All re-routes per line, tagged `bestSavings` (earliest/biggest cut) + `bestEval` (best
  resulting eval) — the user trades memorization vs quality.
- [x] **E1** `confirm_depth` deep-confirms each line's bestEval pick (`evalConfirmed`).
- [x] **C3** `compare_shortcut_lines` tool: adopt (transpose) vs abandon (stay) on EVAL at the fork +
  structural FIT (subtree distribution vs aggregate) with mainline-leaf labels; recommends eval unless
  ≤ tiebreak then fit; flags eval/fit disagreement. The quality axis vs `savedPlies`.
- [x] **C4** `check_shortcut_coverage` tool: prune the tail on a copy, re-run the gap scan, return new
  gaps — the shortcut's coverage cost.
- [x] **C6** Tool owns ranking: full (no-cursor) call is the authoritative global sort (`partial:false`);
  cursor chunks are progress-only (`partial:true`) and must never be merged by the LLM.
- [~] **C5** NOT built (already correct): identity is strict (placement+turn+castling+legal-ep); chessops
  normalizes phantom ep via `legalEpSquare`. Loosening would create false shortcuts.
- [~] **E2** DOCUMENT only — two wasm builds differ at the margin; MCP is the soundness reference.
- [~] **E3** NOT built — `movetime_ms` is already a manual dial.

Live verification of the two new tools (C3/C4) + the C1/E1/C6 changes is pending an MCP reconnect.

## Tier 3 — defer until profiled (premature optimization)

- [ ] **P5** Engine parallelism (PWA worker pool; MCP batching). Only if P1+P3 leave the scan too slow.

## Tier 4 — PWA UX, batch behind a `/run` verify pass (typecheck won't catch regressions)

- [ ] **U2** Stream suggestions into the PWA as found (push partials via `onProgress`).
- [ ] **U3** PWA cancel button (the `pruneToken` cancel logic already exists; expose it).
- [ ] **U4** Tighter PWA bar estimate (upper bound makes it fill late then jump) — smooth, or subtract
  expected early-emits.
- [ ] **U5** Suggest a chunk size from `total_positions_estimate` to hit a target per-call latency.
- [ ] **W3** Before/after leaf-count preview for a chosen prune.

## Tier 5 — footgun, needs a guardrail

- [ ] **W2** Batch-apply all non-positive-`evalDelta` suggestions — auto-mutates the repertoire. Only
  behind an explicit confirm + a dry-run diff.

## Top 3 by impact

P1 (pre-filter) · P2/P3 (transposition-aware cache) · C2 (fix the null eval trade).
