# Shorten / transposition-pruning — improvement backlog

Follow-up work for `find_pruning_transpositions` (MCP) and the PWA "Shorten" scan, captured after the
cursor-pagination + progress-bar pass (commit `a7eb9f2`). Related design: `SUGGEST_PRUNE_DESIGN.md`,
`TRANSPOSITION_OPPORTUNITIES_DESIGN.md`.

Core lives in `packages/chess-tools/src/pgn.ts` (`pruneTranspositions` → `PruneScanResult`); surfaces:
`apps/mcp-server/src/index.ts` (tool), `apps/ui/src/store/repertoire.ts` + `RepertoirePanel.tsx`
(PWA scan), `apps/ui/src/llm/tools.ts` (PWA chat tool). Engine: `apps/mcp-server/src/engine.ts`
(has a `fen|multipv` eval cache), `apps/ui/src/engine/stockfish.ts` (no cache).

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

## Tier 1b — the cache change (design once, then implement together)

P1/P2/P3/P4 all touch the same loop / the same cache concept. Treat as **one** change:
- [ ] **P3** Add a PWA eval cache (session `Map`) like the MCP's — PWA has none today.
- [ ] **P2** Clock-insensitive cache key (FEN first-4-fields) for the prune walk, so true
  transpositions reached via different move-orders share a cached eval. Negligible opening-phase
  accuracy loss; keep the clock-sensitive cache for the 50-move-rule-relevant general path.
- [ ] **P4** (optional, if still needed after P1+P3) Dedupe distinct decision positions across leaves,
  eval each once, then assemble suggestions in a cheap tree walk. O(Σ leaf-length) → O(distinct nodes).

## Tier 2 — needs a design doc + user judgment first (semantic / strategic risk)

- [ ] **C1** Report multiple re-routes per leaf, not just the earliest — depth-vs-cut choice.
- [ ] **C3** When two lines converge, compare eval/length and recommend keeping the **stronger** line;
  today the join target is whatever already exists (possibly the worse line).
- [ ] **C4** Opponent-deviation check: flag suggestions where the opponent can sidestep before the
  joined position (the saved tail may still be needed). Effectively its own feature.
- [ ] **C5** Optional looser identity (ignore castling-rights/ep when matching). **Risk: manufactures
  false transpositions** — castling/ep genuinely change the position. Not a safe default.
- [ ] **C6** Optional tool-side global ranking across chunks (so the agent doesn't re-sort).
- [ ] **E1** Adaptive depth: shallow triage pass, deep re-check only on candidate re-route nodes.
- [ ] **E2** Reconcile PWA vs MCP engine settings/builds at the near-best margin — may be "document the
  divergence" rather than "fix" (two different wasm builds).
- [ ] **E3** Auto-pick `movetime` for sharp nodes (high eval swing) vs `depth` for quiet ones.

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
