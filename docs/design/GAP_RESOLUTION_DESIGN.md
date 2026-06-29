# Gap Resolution — Transposition-First, Structure-Aware Fallback

Status: **largely implemented (2026-06-20)**. Done: bridges tool dissolved
(`find_transposition_opportunities` removed from both surfaces; `transpositionBridges` +
`TranspositionBridge` deleted); `find_repertoire_gaps` is transposition-first
(`covered_by_transposition`) in chess-tools **and** the UI `store/gaps.ts` scan; `frontier_link`
lives on as the engine-vetted `extendedBridges` "Connect" panel; **stub resolution wired into
`get_repertoire_coverage`** (opt-in `connect_stubs` flag, both surfaces) via `resolveDanglingStubs`.
**Deferred:** novel-gap inline suggestions (`suggest` flag → `suggestComplementaryLines`) — the model
still calls `suggest_complementary_lines` itself for an unresolved stub/gap. Supersedes
`find_transposition_opportunities` as a standalone tool (see [Migration](#migration--superseded))
and reshapes the bridges half of `TOOL_CONSOLIDATION_DESIGN.md` (Plan C).

Repo-relative paths: `chess-tools/src/` = `packages/chess-tools/src/`, MCP server under
`apps/mcp-server/src/`, PWA under `apps/ui/src/`.

---

## Motivation (from retro.md + the bridges dig)

`shorten` (`find_pruning_transpositions`) earns its place: it cuts memorization off **complete**
lines. `bridges` (`find_transposition_opportunities`) does **not** earn its place as a *tool* — its
three kinds are really one useful idea plus two dead ones:

| Bridge kind (`pgn.ts:361`) | Fires at | What it really is |
|---|---|---|
| `frontier_link` | leaf, your turn | "this dangling **stub** is already covered elsewhere — wire it in" |
| `coverage_confirmed` | leaf, opp turn | "this opponent move **transposes into prep** — not a real gap" |
| `move_order_merge` | interior node | "an alternate order also lands in prep" — cosmetic; you match by position at the board anyway |

The unifying insight: `frontier_link` and `coverage_confirmed` are both **gap/stub resolution by
transposition** — they answer "can this hole be closed by routing back into existing prep?" That
belongs **inside** gap detection, not in a parallel tool the user must remember to chain. And:

- `move_order_merge` resolves nothing → **drop**.
- `coverage_confirmed` only ever fires at **leaves** today; it never checks an uncovered reply at an
  **interior** decision node — which is exactly where `find_repertoire_gaps` raises gaps. So folding
  it in is strictly *more* complete, not a relocation.

---

## The two holes a repertoire has

| Hole | Node | You owe | Detected today by |
|---|---|---|---|
| **Uncovered opponent reply** | interior decision node, opp to move | a **response** | `find_repertoire_gaps` (`Gap`) |
| **Dangling stub** | leaf, your turn | a **continuation** | `get_repertoire_coverage` (`dangling_lines`) |

Both are resolved by the same principle.

## The principle

> **Close every hole by transposition into existing prep first (zero new theory). Only when that
> fails, propose engine lines ranked by fit to the repertoire's structure/themes.**

Transposition is always preferred: it adds no memorization and is sound by construction (it lands in
prep you already play). The engine fallback is the consolation — and it is ranked so the novel line
*looks like the rest of your repertoire*.

---

## Current state (grounded)

- **`Gap`** (`enginetools.ts:117`): `{ path, fen, uncovered_move, eval, mate, severity }`.
  `findRepertoireGaps` walks `decisionNodes(tree, color)`, runs `analyse(fen, 4, depth)` per node,
  and flags each top-engine move **not in `node.covered`** as a gap. **It never checks whether that
  uncovered move transposes into prep** — the blind spot.
- **`decisionNodes`** (`gaps.ts:35`) is transposition-aware only for **merging** decision nodes the
  tree already reaches by multiple orders — not for resolving uncovered replies.
- **`suggestComplementaryLines`** (`enginetools.ts:198`) already is the structure-aware fallback:
  engine multipv from an anchor, each candidate scored by `profile_match` =
  `profileStructureShares(...)` of the resulting structure (`low_memorization` mode), sorted by fit
  then eval. This is the "engine lines that fit the theme/architecture" the retro asks for — it just
  needs to run **after** the transposition check, per gap.
- **`extendedBridges`** (`pgn.ts:388`) already does multi-ply, engine-vetted "extend a stub until it
  rejoins prep" — that is the engine half of stub resolution, reusable as-is.
- **The cross-branch-prep test** (`keyMap.get(positionKey(after))` + ancestor/descendant guard) is
  copy-pasted across `transpositionBridges` / `extendedBridges` / `pruneTranspositions`
  (`TOOL_CONSOLIDATION_DESIGN.md` Plan C). Gap resolution becomes its **third** consumer.

---

## Design

### Shared primitive (lifts Plan C)

```ts
// chess-tools/src/pgn.ts (or transposition.ts) — module-private, three consumers:
//   gap resolution · stub resolution (extendedBridges) · shorten (pruneTranspositions)
buildKeyIndex(tree): { keyMap: Map<key, {path, sanPath, ply}>; keyCount: Map<key, number> }
landsInCrossBranchPrep(keyMap, afterPos, ownPath): { sanPath, ply } | null  // null ⇒ leaves prep / same line
```

### Resolution shape (shared by both holes)

```ts
type Resolution =
  | { kind: "transposition"; joinsPath: string[]; via: string[] }   // routes back into prep; via = bridging SAN(s) (len ≥ 1)
  | { kind: "novel"; suggestions: ComplementarySuggestion[] };       // no transposition — engine replies ranked by structural fit

// ComplementarySuggestion = the existing suggestComplementaryLines entry:
//   { move, resulting_structure, eval, pv, profile_match }
```

### A. Uncovered opponent reply → enhanced `find_repertoire_gaps`

For each top-engine move at a decision node that is **not** in `node.covered`:

```
afterPos = play(uncovered_move)
tgt = landsInCrossBranchPrep(keyMap, afterPos, node.path)
if tgt:  resolution = { transposition, joinsPath: tgt.sanPath, via: [uncovered_move] }
         // NOT a real gap — the reply walks into your prep; demote severity / mark resolved
else:    resolution = { novel, suggestions: suggestComplementaryLines(anchor = node.fen) }
         // a genuine gap — your best in-theme responses, ranked by profile_match
```

`Gap` gains `resolution: Resolution`. Transposition-resolved entries are suppressed from the gap
count (or surfaced under a separate `covered_by_transposition` list) so the headline gap number
finally excludes false gaps — the thing the workflow currently patches by telling the model to "run
`get_transpositions` before trusting gaps."

### B. Dangling stub → coverage resolution

For each `dangling_lines` leaf (your turn, owed a continuation):

```
ext = extendedBridges-from-this-leaf (engine-vetted, maxDepth/budget)   // does it rejoin prep in k plies?
if ext:  resolution = { transposition, joinsPath: ext.joinsPath, via: ext.moves }
else:    resolution = { novel, suggestions: suggestComplementaryLines(anchor = leaf.fen) }   // continue in-theme
```

This is `frontier_link` + its multi-ply extension, re-housed as stub resolution.

### Orchestration

Implement as **enhancements to the existing tools**, not a new monolith:

- `find_repertoire_gaps` returns each gap with its `resolution` (transposition check is engine-free
  and runs inside the pass it already does; `novel` suggestions are opt-in via a
  `suggest: boolean` arg to bound engine cost).
- A coverage-side resolver (extend `get_repertoire_coverage`, or a thin `resolve_dangling` that wraps
  `extendedBridges` + `suggestComplementaryLines`).
- `suggestComplementaryLines` stays the fallback engine — unchanged, just called per hole.

The model/UI then has one honest answer per hole instead of orchestrating gaps → get_transpositions →
suggest_* by hand.

---

## Tool-surface impact

| Tool | Change |
|---|---|
| `find_transposition_opportunities` (bridges) | **removed** as a public tool; `frontier_link` logic → stub resolution, `coverage_confirmed` → gap resolution, `move_order_merge` → dropped |
| `find_repertoire_gaps` | each gap carries `resolution` (transposition-first); `suggest` flag adds in-theme fallback lines; false (transposing) gaps no longer counted |
| `get_repertoire_coverage` | dangling lines carry the same `resolution` |
| `suggestComplementaryLines` | unchanged — reused as the `novel` fallback |
| `find_pruning_transpositions` (shorten) | unchanged here; stays a separate tool (opposite job). Deeper search = `SUGGEST_PRUNE_DESIGN.md` thread |
| shared primitive | `landsInCrossBranchPrep` / `buildKeyIndex` now feed gaps + stubs + shorten (three consumers) |

Net public tools: bridges **gone**, no new tool added (logic absorbed). The user-facing surface
shrinks and every remaining repertoire tool answers a question that stands on its own.

---

## File changes

| File | Change |
|---|---|
| `chess-tools/src/pgn.ts` | extract `buildKeyIndex` / `landsInCrossBranchPrep`; **delete** `transpositionBridges`; keep `extendedBridges` (now "stub resolver"); rewire `pruneTranspositions` onto the shared primitive |
| `chess-tools/src/gaps.ts` / `enginetools.ts` | `findRepertoireGaps`: per-uncovered-move transposition check + `resolution` on `Gap`; optional `suggest` fallback via `suggestComplementaryLines` |
| `chess-tools/src/pgn.ts` (coverage) | dangling lines carry `resolution` (extendedBridges → else suggest) |
| `chess-tools/src/index.ts` | drop `TranspositionBridge` export if unused publicly; export shared helpers |
| `apps/mcp-server/src/index.ts` | remove `find_transposition_opportunities`; gaps/coverage return `resolution` |
| `apps/ui/src/llm/tools.ts` | remove `find_transposition_opportunities`; gaps/coverage `resolution` |
| `apps/ui/src/llm/workflows.ts` | rewrite the bridges step → "gaps are transposition-first; novel gaps get in-theme suggestions" |
| `apps/ui/src/store/repertoire.ts` + `RepertoirePanel.tsx` | fold the Bridges panel into the Gaps/Coverage rows (each row shows its resolution: 🔗 transposes → wire, or ✎ novel → suggestions) |
| `scripts/smoke-gametree.mjs` | replace bridge assertions with gap/stub-resolution assertions |
| `docs/design/TRANSPOSITION_OPPORTUNITIES_DESIGN.md` | mark superseded |

---

## Testing (smoke-gametree.mjs, injected analyse/pickMoves stubs)

- **Gap resolved by transposition**: a decision node whose strong uncovered reply transposes into a
  prepared line → `resolution.kind === "transposition"`, correct `joinsPath`, excluded from the gap
  count.
- **Genuine gap**: uncovered reply that leaves prep → `resolution.kind === "novel"`; with `suggest`,
  `suggestions` ranked by `profile_match` (stubbed structures).
- **Stub resolved**: a dangling leaf that rejoins prep in 2 plies via `extendedBridges` →
  `transposition` resolution, `via.length === 2`.
- **Stub novel**: a dangling leaf that can't rejoin → `novel` continuations.
- **Interior-node coverage** (the bonus over old `coverage_confirmed`): an uncovered reply at an
  *interior* decision node that transposes is resolved (old bridges missed this).
- Existing `pruneTranspositions` / `extendedBridges` assertions stay green (primitive extraction is
  behaviour-preserving).

---

## Non-Goals

- Merging `shorten` into this. Opposite job (shrink complete lines vs fill holes); stays a separate
  tool. Its "go deeper" dial is `SUGGEST_PRUNE_DESIGN.md`.
- Auto-applying any resolution. Transpositions stage the wiring move(s); novel suggestions stage a
  previewed line. User accepts, as today.
- Resurrecting `move_order_merge` — it resolves no hole.
- Opponent-forced convergences — `get_transpositions` already describes those.

---

## Migration / superseded

- `find_transposition_opportunities` (design doc since removed) → **superseded**: `frontier_link`/`coverage_confirmed`
  logic moves here; `move_order_merge` dropped; the tool is removed.
- `TOOL_CONSOLIDATION_DESIGN.md` Plan C → **revised**: the bridges/shorten "keep both faces, dedupe"
  framing is replaced by "bridges dissolves into gap resolution; the shared primitive now has three
  consumers." `engine_move` + `board_image` deletions there are unaffected.
- `SUGGEST_PRUNE_DESIGN.md` → unchanged; `shorten` deeper-search thread continues there.
</content>
