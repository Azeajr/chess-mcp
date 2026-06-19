# Find Transposition Opportunities — Design

Status: **proposed**.

A new repertoire tool that finds where two parts of your repertoire could be **bridged** by a
move order but aren't linked yet — the *prescriptive* counterpart to the existing
`get_transpositions` (which only *describes* convergences your tree already contains).

All file references are repo-relative: `chess-tools/src/` = `packages/chess-tools/src/`,
UI paths under `apps/ui/src/`.

---

## Motivation

`get_transpositions` (`GameTree.transpositions()`) reports positions the repertoire **already**
reaches by ≥2 move orders. It answers "where do my lines converge?" It does **not** find
*new* links.

What's missing: given the lines you already prepare, where does playing one extra move — or a
different move order — route you **back into existing prep**? Those are free coverage and
memory savings:

- A line stops at a frontier; one move from there transposes into a position you already cover
  deeper in another branch. Extend 1 ply → instant reuse, no new theory.
- An opponent can reach a covered position by a move order your tree doesn't explicitly show, so
  `find_repertoire_gaps` may false-flag it. Surfacing the bridge confirms you're covered.
- A whole sub-line duplicates another by transposition → a prune candidate (cross-referenced;
  see Non-Goals — handled by a sibling `suggest_prune`, not here).

This is engine-free and cheap: a hash lookup per legal move over an opening-depth tree.

---

## Core idea

Transposition key (existing `positionKey`, `chess-tools/src/congruence.ts`) is the first four
FEN fields — placement + turn + castling + en passant, clocks dropped. Two routes to the same
position share a key (and castling/ep differences correctly *don't* match).

> Build `positionKey → shallowest node` over **all** tree nodes. Then for every node N,
> enumerate the legal moves **not already children of N**; if a move's resulting key already
> exists elsewhere in the tree, that move is a **bridge** from N into existing prep.

Because the target position is one you already play, the bridge is sound *by construction* — no
engine judgement needed.

---

## Opportunity classes

Dispatched on N's shape and whose move bridges (relative to the repertoire `color`):

| `kind` | N | Bridging move's side | Meaning / action |
|---|---|---|---|
| `frontier_link` | leaf (no children) | **your** move | "Extend this line 1 ply → back in known prep." Actionable: stage + graft. |
| `coverage_confirmed` | leaf, opponent to move | opponent move | An opponent try transposes into your prep — already covered (informational; suppresses a false gap). |
| `move_order_merge` | interior (has children) | either | A different move order at this node also lands in prep — add it to catch alternate sequences. |

`frontier_link` is the headline value; the others are confirmations / completeness.

---

## Data model

```ts
// chess-tools/src/pgn.ts (new method on GameTree)
export interface TranspositionBridge {
  /** SAN path to the node the bridge departs from. */
  fromPath: string[];
  /** SAN of the bridging move (not currently a child of fromPath). */
  move: string;
  /** Side to move at fromPath ("white" | "black"). */
  sideToMove: Color;
  /** Shallowest SAN path that already reaches the position the bridge lands on. */
  joinsPath: string[];
  /** Ply depth of joinsPath (for ranking — prefer landing in deeper, more-developed prep). */
  joinsPly: number;
  kind: "frontier_link" | "coverage_confirmed" | "move_order_merge";
}
```

---

## Algorithm

```
transpositionBridges(): TranspositionBridge[]

1. keyMap: Map<positionKey, { path: Path; sanPath: string[]; ply: number }>
   DFS all nodes; for each, record its key → keep the SHALLOWEST occurrence.
   (root included; root's key never a useful target but harmless.)

2. results = []
   DFS again. At each node N (path P, position pos, key K_N):
     childKeys = set of keys of N's existing children   // skip these — already in tree
     for each legal move m at pos:
       posʹ = pos.play(m); Kʹ = positionKey(posʹ)
       if Kʹ in childKeys: continue                      // m already a tree edge
       target = keyMap.get(Kʹ)
       if !target: continue                              // m leaves the repertoire entirely
       if isPrefix(P, target.path) or isPrefix(target.path, P): continue
            // skip ancestor/descendant relationships — not a cross-branch bridge
       results.push({
         fromPath: sanPathAt(P), move: makeSan(pos, m), sideToMove: pos.turn,
         joinsPath: target.sanPath, joinsPly: target.ply,
         kind: classify(N, pos.turn),                    // see table
       })
   3. de-dupe identical (fromPath, move); rank.
```

**Legal-move enumeration**: inline via `chessgroundDests(pos)` (already imported in pgn.ts) +
`makeSan` — pawns to the last rank as queen promotions only (matches `legalMoves` in
`validate.ts`; underpromotion transpositions are irrelevant in openings).

**`classify(N, turn)`**: leaf + turn === color → `frontier_link`; leaf + turn === opponent →
`coverage_confirmed`; interior → `move_order_merge`.

**Ranking** (most actionable first):
1. `frontier_link` > `move_order_merge` > `coverage_confirmed`
2. shallower `fromPath` (earlier in prep = higher impact)
3. deeper `joinsPly` (lands in more-developed prep = more saved)

**Complexity**: O(nodes × ~30 legal moves) hash lookups. Opening trees are hundreds of nodes →
instant, no engine.

**Correctness guards**:
- Skip when `fromPath`/`joinsPath` are ancestor↔descendant — that's the line continuing, not a
  transposition.
- `positionKey` includes castling + ep, so positions that merely *look* alike but differ in
  rights don't false-match.
- A move already a child of N is skipped (it's the existing edge).

---

## Tool contract

Mirror the existing repertoire tools in both surfaces.

```ts
// apps/ui/src/llm/tools.ts — schema (PWA)
fn("find_transposition_opportunities",
   "Engine-free. Find move-order bridges that interlink the repertoire: moves not yet in the tree that transpose one line into a position already prepared elsewhere. frontier_link = extend a stopped line 1 ply into known prep; move_order_merge = an alternate order at a branch; coverage_confirmed = an opponent try that's already covered by transposition.",
   { limit: { type: "integer" }, kinds: { type: "array", items: { type: "string" } } });

// executor
case "find_transposition_opportunities": {
  const all = tree.transpositionBridges();
  const wanted = (args.kinds as string[] | undefined);
  const shown = all
    .filter((b) => !wanted?.length || wanted.includes(b.kind))
    .slice(0, (args.limit as number) ?? 20);
  return { total: all.length, returned: shown.length, opportunities: shown };
}
```

MCP server (`apps/mcp-server/src/index.ts`): same, against the stateful `repertoire_id` tree —
`e.tree.transpositionBridges()`, no engine.

---

## UI integration

A new **Tier A** section in `RepertoirePanel` (Feature 6 of the chat–repertoire design):

```
Repertoire
  ▸ Gaps          [Scan]
  ▸ Congruence    [Scan]
  ▾ Bridges       [Scan]          ← new, instant (engine-free)
      🔗 frontier   1.c4 c5 2.Nc3 → e6  joins 1.c4 e6 2.Nc3 c5   [stage]
      ↪ order       1.e4 c6 2.d4  → Nc3 joins 1.e4 c6 2.Nc3 …     [stage]
      ✓ covered     1.e4 c6 2.c3  → d5  (already prepared)        [→]
  ▸ Extend here   …
```

Row behaviour (reuses the chip layer):
- **`frontier_link` / `move_order_merge`** → `stagePreviewLine(indexPathOfSan(fromPath), [move])`
  (gold arrow + Accept grafts the linking move). `goto(fromPath)` first so the arrow shows.
- **`coverage_confirmed`** → navigate only (`actions.goto(indexPathOfSan(fromPath))`); it's
  informational, nothing to add.

Store: extend `apps/ui/src/store/repertoire.ts` with a `bridges` signal + `scanBridges()` that
calls `runTool("find_transposition_opportunities", …)` — same pattern as `scanCongruence`. No
engine, so no progress/cancel needed; it's synchronous-fast.

---

## File changes

| File | Change |
|---|---|
| `chess-tools/src/pgn.ts` | **New** `GameTree.transpositionBridges()` + `TranspositionBridge` type |
| `chess-tools/src/index.ts` | export `TranspositionBridge` |
| `apps/ui/src/llm/tools.ts` | schema + executor case |
| `apps/mcp-server/src/index.ts` | `find_transposition_opportunities` tool (stateful tree) |
| `apps/ui/src/store/repertoire.ts` | `bridges` signal + `scanBridges()` |
| `apps/ui/src/components/RepertoirePanel.tsx` | "Bridges" section; rows stage (links) or navigate (confirmed) |
| `apps/ui/src/llm/workflows.ts` | mention the tool in the repertoire workflow method |
| `scripts/smoke-gametree.mjs` | assertions (see Testing) |
| `apps/ui/src/styles.css` | minor: bridge-row kind icons (reuse `.rep-row`) |

---

## Testing (smoke-gametree.mjs)

Engine-free, so fully covered by the smoke suite:

- **frontier_link**: a tree with two orders to the same position where one branch stops a ply
  short. e.g. `1. c4 e6 2. Nc3 c5 *` plus a stub `1. c4 c5 2. Nc3 *` (Black to move, …e6
  bridges into the first line). Assert one `frontier_link` with `move: "e6"`,
  `joinsPath` ending `…c5`.
- **move_order_merge**: interior node with an unplayed sibling move that transposes.
- **no false positive** on a linear line (`1. e4 e5 2. Nf3 *` → no bridges).
- **ancestor/descendant excluded**: the natural continuation is never reported as a bridge.

---

## Non-Goals

- **Multi-ply bridges** (your move + forced reply, k ≥ 2). Combinatorial blow-up; v1 is 1 ply.
  Note as a future `depth` parameter (bounded, your-move-then-forced-only).
- **`suggest_prune`** (whole redundant sub-lines that transpose into another) — a sibling tool
  derivable from `transpositions()`; out of scope here, cross-referenced.
- **Soundness ranking** — bridges land in *your* prep, so they're sound by construction; no
  engine pass.
- **Auto-linking** — every bridge is staged as a preview the user Accepts; nothing auto-grafts.

---

## Open questions

1. Should `coverage_confirmed` bridges be fed to `find_repertoire_gaps` as `exclude_paths` to
   suppress the false gaps they explain? Recommendation: yes, as a later refinement — keep the
   tools independent for now and let the chat workflow chain them.
2. Cap on bridges per `fromPath`? A node can bridge via several moves. Recommendation: keep all
   but rank; the `limit` param bounds the list.
3. Include `move_order_merge` by default, or behind a flag? They're noisier than `frontier_link`.
   Recommendation: include all, ranked; the UI section is collapsible so noise is cheap.
```
