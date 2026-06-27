# Shorten — semantic improvements (Tier 2) design

Design for the **semantic** shorten/transposition items (Tier 2 in `SHORTEN_IMPROVEMENTS_TODO.md`):
the ones that change *which* suggestions appear, *which* line is recommended, or *what counts* as a
transposition — so they can regress soundness or coverage and need a decision, not just code.

Tiers 1 + 1b (pre-filter, eval caches, cursor pagination, progress, `evalStay` fill, `pruneTailPath`)
are shipped and verified (P1: 385→16 analyses live; P3: 2nd scan zero engine work). This doc covers
**C1, C3, C4, C5, C6, E1, E2, E3**.

Core: `pruneTranspositions` in `packages/chess-tools/src/pgn.ts` → `PruneSuggestion[]` inside a
`PruneScanResult`. A re-route lands **one ply** into an existing position (`landsInCrossBranchPrep`
compares the position after your single re-route move against `keyMap`); `joinsPath` is the shallowest
occurrence of that position. Identity = `positionKey` = FEN first 4 fields (placement, turn, castling,
en-passant).

---

## C1 — multiple re-routes per leaf

**Problem.** Today one suggestion per leaf: the loop sets `emitted=true` and breaks at the earliest
viable re-route (biggest tail cut). A line with a second, shallower-cut re-route never surfaces; the
user can't choose depth-saved vs eval-cost.

**Current.** `for (const idx of candidates) { if (emitted) break; … emitted = true; break; }` — first
viable wins.

**Proposal.** Collect *all* viable re-routes per leaf; return them grouped (or flat with a
`leafId`). Keep "earliest" as the default/recommended one; mark the rest as alternatives. Cap per leaf
(e.g. top 3) to bound output and engine cost (each extra re-route node is another analysis — but P1
already bounded candidates, and P2 caches, so cost is modest).

**Recommendation: DO, gated behind a flag** (`max_per_line`, default 1). Keeps today's behavior the
default; opt-in for power users. Low risk — purely additive, no change to what's "sound".

**Decision:** default 1 (preserve current) vs default "all". → *Recommend default 1.*

---

## C3 — recommend the better of two converging lines

**Problem.** When the re-route makes the original tail redundant, we keep `joinsPath` (the shallowest
existing occurrence) and prune the original. But `joinsPath` may be the *worse* of the two lines —
the tool never compares them. The user could prune their preferred, stronger line.

**Current.** No comparison. `joinsPath` is chosen purely by shallowness in `keyMap`.

**Proposal.** At the converged position, the two lines are *identical from here on by definition*
(same position) — so "better line" is NOT about the continuation (it's shared). The real difference is
the **path taken to reach it** and **what else hangs off each path**. Two sub-cases:
1. Pure move-order transposition (same set of moves, different order) → lines are equivalent; keep the
   shorter/shallower. Already what we do. No change.
2. The paths differ in moves (not just order) → they are genuinely different lines that happen to
   collide at one position. Pruning either is a real repertoire choice. Here, surface **both** the
   original-line eval and the join-line eval *at the convergence position's parent decision* so the
   user sees the trade — but do **not** auto-pick.

**Recommendation: PARTIAL — surface, don't decide.** Add the comparison data (`evalStay` already gives
the original; add the join line's eval) and let the user choose. Auto-picking "better" injects a
strategic judgment the engine eval alone can't make (prep familiarity, sharpness, what you've studied).

**Decision:** surface-only (recommended) vs auto-recommend-stronger vs auto-prune-weaker. → *Recommend
surface-only.* Auto-prune is the W2 footgun territory.

---

## C4 — coverage-preservation check (the real "opponent" risk)

**Problem.** Reframed from the backlog's "opponent-deviation": since the re-route lands directly in a
prepared position, there's no intervening opponent move to deviate. The genuine risk is **pruning the
original tail drops opponent-reply coverage that `joinsPath`'s subtree doesn't replicate.** Same
position, but the original tail may have prepared branches (opponent alternatives) that the join line
doesn't — pruning creates new gaps.

**Current.** No check. `savedPlies` counts the tail dropped but ignores whether that tail carried
unique coverage.

**Proposal.** Before recommending the prune, compare the **subtree under the original tail** vs the
**subtree under `joinsPath`** (both root at the same position, so directly comparable). If the original
subtree has opponent-reply branches absent from the join subtree, flag
`coverage_delta: { lost_replies: [...] }` on the suggestion. Cheap (tree walk, no engine) — reuse the
gap/coverage machinery (`find_repertoire_gaps` / `coverage`).

**Recommendation: DO.** This is the highest-value semantic item — it's the one that prevents a
"shortening" from silently introducing a gap. Pure tree analysis, no engine, no soundness guess.

**Decision:** flag-only vs block-the-suggestion when coverage is lost. → *Recommend flag-only* (report
`coverage_delta`; let the user weigh saved plies vs lost coverage).

---

## C5 — looser transposition identity (drop castling/ep)

**Problem.** `positionKey` includes castling rights + en-passant. Two positions identical in piece
placement but differing only in (e.g.) a still-available castling right are treated as different →
some real transpositions are missed.

**Current.** `positionKey = fen.split(" ").slice(0,4).join(" ")` (placement, turn, castling, ep).

**Proposal.** Optional `loose_identity` flag dropping castling+ep (placement+turn only).

**Recommendation: DO NOT (default), offer only with a loud caveat.** Castling rights and ep are part
of the position — two positions differing in them are genuinely different (one side can still castle,
the other can't; an ep capture is or isn't available). Treating them as equal manufactures **false
transpositions** — the "joined" prep may not actually apply. The miss rate from keeping them is low and
the false-positive cost is high (recommending an unsound shortcut).

**Decision:** drop entirely, or offer behind an off-by-default `loose_identity` flag documented as
"may produce unsound transpositions". → *Recommend drop entirely* unless a concrete missed-transposition
example shows up.

---

## C6 — global ranking across cursor chunks

**Problem.** Each `find_pruning_transpositions` call sorts only its own chunk's suggestions; an agent
paginating must merge + re-sort across chunks itself.

**Current.** Per-call sort by `savedPlies`, then `evalDelta`, then `atPly`.

**Recommendation: SKIP for now.** Cheap for the agent to merge, and P1 made full scans so cheap
(16 analyses) that chunking is rarely needed here. Revisit only if a tree large enough to *require*
chunking shows up. Documented in the skill already (agent aggregates + re-sorts).

---

## E1 — adaptive depth (shallow triage, deep confirm)

**Problem.** Every candidate node is analysed at full depth/movetime; the near-best gate only needs to
know "is the re-route within the window," which a shallow pass often settles.

**Proposal.** Shallow first pass (e.g. depth 8) to reject nodes where the re-route is clearly outside
the window; deep re-check only on survivors before emitting. Faster *and* the emitted eval trade is
deep/trustworthy.

**Recommendation: DEFER (Tier 3, profile first).** P1 already cut analyses ~24× — depth-staging adds
complexity for a now-small base. Worth it only if a large tree makes the deep pass dominate again.

---

## E2 — reconcile PWA vs MCP engines

**Problem.** PWA uses the single-threaded `stockfish-18-lite-single` wasm; MCP uses the bundled
`stockfish` npm wasm. They can disagree at the near-best margin, so the two surfaces may emit slightly
different suggestion sets.

**Recommendation: DOCUMENT, don't "fix".** They are different builds for good reasons (browser worker
vs node). Forcing identical output isn't feasible. Action: a one-paragraph note in the skill / README
that suggestion sets can differ at the margin between surfaces, and that the MCP (stronger) is the
reference for soundness. No code.

---

## E3 — auto-pick movetime for sharp nodes

**Problem.** `depth` is a poor effort dial for sharp/tactical positions; `movetime` is better there but
the caller must choose.

**Recommendation: SKIP / low priority.** The caller already can pass `movetime_ms`. Auto-detecting
"sharp" (eval swing across candidates) needs a probe pass = added cost for marginal gain. Leave the
dial manual; document the guidance (already in the skill).

---

## Recommended phase order

1. **C4** (coverage-preservation flag) — highest value, pure tree analysis, prevents silent gaps.
2. **C1** (`max_per_line`, default 1) — additive, low risk.
3. **C3** (surface join-line eval; no auto-pick) — pairs naturally with C1's alternatives.
4. C5 / C6 / E1 / E2 / E3 — **don't build now**: drop, defer, or document (per each above).

So the actual build target for Tier 2 is **C4 + C1 + C3**; the rest are decisions to *not* build
(recorded here so they aren't reopened).

## Decisions for you

1. **C4** flag-only vs block-on-coverage-loss — *recommend flag-only*.
2. **C1** default `max_per_line` 1 vs all — *recommend 1*.
3. **C3** surface-only vs auto-pick — *recommend surface-only*.
4. **C5** drop entirely vs off-by-default loose flag — *recommend drop*.
5. Confirm C6/E1/E2/E3 as **won't-build-now** (skip/defer/document).
