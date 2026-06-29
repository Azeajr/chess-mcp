# Gap Fill in the PWA — show the line, suggest a reply, click to graft

Status: **implemented (2026-06-28)**. Implements the **deferred** slice of
[`GAP_RESOLUTION_DESIGN.md`](./GAP_RESOLUTION_DESIGN.md) ("novel-gap inline suggestions —
`suggest` flag → `suggestComplementaryLines`") for the PWA Gaps panel, plus a richer two-axis
ranking (best eval **and** best structural fit) and a line-display upgrade. The MCP-server `suggest`
flag is out of scope here; this is the browser-side, click-to-stage experience.

Repo-relative paths: `chess-tools/src/` = `packages/chess-tools/src/`, PWA under `apps/ui/src/`.

---

## What the user asked for

1. The Gaps rows should show the **whole line** (the path to the decision node) as well as the
   **prospective move** (the uncovered opponent reply), not just the bare move.
2. Each gap should **separately suggest a line that fills it**, prioritising good eval and good fit
   with the repertoire — surfaced as **two options**: *best eval* and *good fit + decent eval*.
3. Clicking a suggested line should **add it to the repertoire**.
4. Edits should be made **in memory**, reflected in the UI, and written to disk only on Save / at the
   end of the workflow.

## What already exists (grounded)

- **Request 4 is already the architecture.** `acceptPreview()` (`store/suggestions.ts:106`) →
  `actions.appendLine` (`store/game.ts:80`) mutates the in-memory `GameTree`, bumps `version` (board +
  move-list re-render), and sets `dirty = true`. Nothing touches the file until `saveFile()`
  (`store/files.ts:90`); autosave persists only to IndexedDB, never the on-disk PGN. Staging several
  gap-fills, Accepting each, then one Save at the end is **already** the behaviour. **No new infra.**
- **Click-to-graft already exists.** `stagePreviewLine(fromPath, sans)` (`store/suggestions.ts:97`)
  validates a SAN line against the position at `fromPath`, paints the gold preview arrow, and
  `acceptPreview()` grafts it. Used today by Extend / Fix / Connect / Shorten rows. Gap rows just
  don't call it yet.
- **The fill engine already exists.** `suggestComplementaryLines(tree, color, anchorFen, opts, analyse)`
  (`enginetools.ts:419`) returns engine candidates pre-filtered to within 1 pawn of best, each
  carrying `{ move, eval (white-POV cp), profile_match, resulting_structure, pv }`. One call yields
  **both** ranking axes.

So the only genuinely new work is **#1 (display)** + **#2 (two-option fill)** + wiring **#3** onto the
existing stage/accept path.

---

## Grounding catch: the fill anchor

A gap's `uncoveredMove` is a **specific** opponent move, not the engine's #1 at that node. If we hand
the raw decision-node FEN (`fenAt(g.path)`, opponent to move) to `suggestComplementaryLines`, it plays
the engine's *best* opponent move and suggests a reply to **that** — the wrong gap.

Correct anchor = the position **after `uncoveredMove`** (user to move):

```
anchorFen = fenAt(g.path)  →  play(parseSan(uncoveredMove))  →  makeFen   // user's turn
```

Passed that, `suggestComplementaryLines` sees `pos.turn === color`, skips its opponent-move branch,
and ranks the user's replies directly. The gap store already plays `uncoveredMove` during the scan
(`store/gaps.ts:105`), so this is the same computation.

---

## Design

### A. Line display (#1)

`store/gaps.ts` `Gap` already carries `path`. In `RepertoirePanel.tsx`, render the SAN line via the
existing `currentTree().sanPathAt(g.path)` and the prospective move via `g.uncoveredMove`, both in
**numbered notation** (`numbered(sans, startPly)` → `1. e4 c6 2. Nf3 d5`, not bare space-joined SAN):

```
<1. e4 e5 2. Nf3 …>  ·  <uncoveredMove>   <eval>   <severity>
```

Clicking the line text still navigates (`actions.goto(g.path)`). Fill-option lines are shown **inline,
fully** (numbered, continuing from the gap depth) — they wrap, no hover/`title` needed.

### B. Two-option fill (#2), on-demand per gap

Mirror the congruence-panel `fixFlag` pattern: each gap row gets a **Fill** button; clicking runs one
engine search for that gap and expands two suggestion rows beneath it. State keyed by gap identity
(`g.path.join(",") + "|" + g.uncoveredMove`), so multiple gaps can be open at once.

```ts
// store/gaps.ts (new)
fillSuggestions: Signal<Record<gapKey, "loading" | {error} | GapFill>>
interface GapFill {
  bestEval: FillOption;          // max mover-cp among candidates
  bestFit:  FillOption | null;   // max profile_match; null when identical to bestEval (deduped)
}
interface FillOption { reply: string; line: string[]; evalCp: number; fit: number; }
```

Procedure for `fillGap(g)`:

1. `anchorFen` = position after `uncoveredMove` (see grounding catch).
2. `res = await suggestComplementaryLines(tree, color, anchorFen, { mode: "low_memorization", limit: 4 }, analyseMulti)`
   → candidate replies (eval + mover-cp).
3. **Build each candidate's full deep line** (see C), then score **fit at the line's endpoint** via a
   **blended structural profile** (`buildFitProfile` / `fitScore`): the endpoint's named structure
   **+ center state + themes** (fianchetto, minority attack, flank-vs-center, wing majorities, color
   complex), each weighted by how common it is across the repertoire's leaves; fit = mean familiarity
   of the endpoint's signals. A lone named-structure match (`profile_match` / `profileStructureShares`)
   was almost always `"unknown"` → 0, which made best-fit collapse into best-eval on every gap; the
   blend keeps it discriminating even when the structure is unnamed (center + themes still place the
   position relative to the repertoire). Scored at the endpoint, not one ply after the reply.
4. `bestEval` = candidate with max mover-cp. `bestFit` = the **distinct** remaining candidate with max
   endpoint-fit (so two genuinely different replies are offered). `bestFit` is null only when there is
   one candidate. The second row is labelled *best fit* when its fit beats best-eval's, else *alt*.

If the gap is mate-flagged or the engine is offline, surface the error inline (reuse the existing
`scanError`-style empty row).

### C. Graft depth (#3) — median repertoire line length

Clicking a fill option stages `[uncoveredMove, reply, ...pvTail]` from `g.path` via the existing
`stagePreviewLine` (Accept grafts; Save persists — #4). The user wants the **resulting line length to
match the repertoire's typical depth**, computed as the **median leaf line length**, with the caveat
that **short lines that are really transpositions must not drag the median down**.

New pure helper in `chess-tools` (tree math, unit-testable):

```ts
// chess-tools/src/gaps.ts
/** Median ply-length of the repertoire's *genuine* leaf lines. Leaves whose final position also
 *  occurs elsewhere in the tree (keyCount > 1 — a transposition endpoint) are excluded, since the
 *  author truncated them on purpose. Returns 0 for an empty tree. */
export function medianLineLength(tree: GameTree): number
```

Implementation reuses the existing pattern: `tree.leaves()` (`pgn.ts:797`, gives `{path, pos}` per
leaf) + `buildKeyIndex(tree.game.moves).keyCount` — exclude any leaf where
`keyCount.get(positionKey(makeFen(pos.toSetup()))) > 1` (the same transposition-leaf skip already used
at `pgn.ts:419-421`). Median of the surviving `path.length`s.

Graft length, in the store. The filled line should be **as deep as a typical repertoire line** — i.e.
the resulting line's *total* depth ≈ the filtered median, so `toAdd` (plies appended from the gap) is
`median − gapDepth`, floored at 2 so the gap is always closed:

```
target = medianLineLength(tree) || FALLBACK_PLIES
toAdd  = max(2, target - g.path.length)
line   = [uncoveredMove, reply, ...engineTail].slice(0, toAdd)
stagePreviewLine(g.path, line)                             // validates, then Accept grafts
```

The line also **ends on the user's move**: index 0 is the opponent's `uncoveredMove`, so user replies
sit at odd indices → an even length ends on a user move; a trailing opponent move is dropped
(color-agnostic — correct for a black or white repertoire).

`engineTail` is **not** the suggestion's `pv` string — `pvSan` caps that at 5 plies, which made the
old fills far too short. Stockfish also truncates its PV *below* the nominal depth, so a single search
(however deep) can't guarantee the length — lines came out uneven. So `engineTail` **iterates**: walk
the PV, and when it ends before the target, re-search from where it ended and continue, until `toAdd`
is reached (or the game ends). Per-search depth tracks the remaining need, capped at `MAX_TAIL_DEPTH`
(iterating shallow is cheaper than one very deep search). Result: every shown line lands at the median
length (no shortfall).

**Cost discipline (local wasm, serialized — time not money).** The two shown options are the only ones
deep-built. Candidates are first ranked by fit on a **short probe line** (`PROBE_PLIES`, one shallow
search each); only `bestEval` + `bestFit` get the full median-deep iterative build. So a Fill pays a
few cheap probes + two deep lines, not four deep lines. The whole line is built in the store and stored
on `FillOption.line`, so display and graft use the same sequence.

**Optional tail-trim mitigation (note, not committing):** stop the PV tail early if a tail position
transposes back into existing prep (`landsInCrossBranchPrep`) — that both shortens memorization and
avoids inventing opponent moves past a natural merge. Deferred unless the plain-median version feels
too long in practice; the median already adapts to the repertoire's own depth.

---

## File changes

| File | Change |
|---|---|
| `chess-tools/src/gaps.ts` | add `medianLineLength(tree)` (transposition-leaf–excluded median) |
| `chess-tools/src/index.ts` | export `medianLineLength` |
| `apps/ui/src/store/gaps.ts` | add `fillSuggestions` signal + `fillGap(g)` (anchor-after-uncovered → `suggestComplementaryLines` → best-eval/best-fit dedup); `clearFill` on rescan |
| `apps/ui/src/components/RepertoirePanel.tsx` | Gaps rows show `sanPathAt(g.path)` + `uncoveredMove`; **Fill** button; expanded best-eval / best-fit rows that `stagePreviewLine` the median-length graft |
| `scripts/smoke-gametree.mjs` | assert `medianLineLength` excludes transposition leaves and returns the median ply of genuine lines |

No MCP-server or `llm/tools.ts` change — this is the browser panel only. The model still has its own
`suggest_complementary_lines` path unchanged.

---

## Testing

- `medianLineLength`: tree with leaf depths {4, 6, 8} → 6; same tree where the depth-4 leaf's position
  also appears mid-line (keyCount > 1) → excluded → median of {6, 8} = 7; empty tree → 0.
- `fillGap` (stubbed `analyseMulti`): anchor is the position *after* `uncoveredMove` (not the engine's
  best opponent move); two options returned; identical best-eval/best-fit collapses to one.
- Graft: staged line length == `max(2, median − g.path.length)`; staged line validates from `g.path`;
  Accept sets `dirty`, Save writes, in-memory tree shows the new reply (existing pipeline, spot-check).

## Non-goals

- MCP-server `suggest` flag (still deferred in `GAP_RESOLUTION_DESIGN.md`).
- Auto-computing fills during the Scan (kept on-demand per gap to keep Scan fast).
- Any new persistence path — #4 is the existing accept→appendLine→Save pipeline.
