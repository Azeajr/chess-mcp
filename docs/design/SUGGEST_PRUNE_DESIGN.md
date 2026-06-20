# Suggest Prune — Line Shortening via Engine-Vetted Transposition

Status: **planned**.

The prescriptive counterpart to the bridge tools, aimed at **memorization reduction**. Bridges
*extend* a stopped line into prep; this *shortens* a complete line by finding an early move order
that routes it into a **different** line you already prepare — so the line's tail becomes redundant
and can be pruned.

Repo-relative paths: `chess-tools/src/` = `packages/chess-tools/src/`, UI under `apps/ui/src/`.

---

## Motivation (user spec)

> Three seemingly-unrelated lines. Scan them; figure out if one can be **shortened** by a
> transposition move. An **early** transposition cuts the memorization space a lot.
>
> Ideally: walk each of **my** moves on a line; at each spot look at the **top 3–4 engine moves**;
> does any of them lead **back into the repertoire** (a different line)? **Start at the beginning**
> of the line — earliest re-route = most pruning benefit. **Weigh** the transposition against
> staying: compare the engine eval of the line to be pruned vs the line we transpose into.
>
> When getting the top-4, **auto-exclude moves that incur a large eval delta** — multipv can return
> 3 blunders and only one good move, so "in the top-4" is not "good enough to play."

---

## Core idea

For every leaf line `L`, walk `L`'s nodes from the root **earliest first**. At each node `N` where
it is **`color`'s** turn:

1. Engine **multipv** (top 4) at `N`.
2. **Near-best gate** — keep only candidate moves within `cpThreshold` (≈50cp) of the engine's
   **#1** move at `N`. This is the critical filter: multipv surfaces the 4 best *available*, but in
   a sharp position #2–#4 can be losing. A re-route is allowed only if it is a genuinely good move.
3. Among the surviving candidates `m` (≠ `L`'s own next move): does `m` transpose into a position
   already prepared on a **different** line (cross-branch, by `positionKey`)?
4. The **first** such node on `L` is the headline — re-routing there prunes the longest tail.

Two evals, two roles:

- **Gate (hard):** `evalBest − evalTranspose ≤ cpThreshold` — never suggest a re-route through a
  bad move, even if multipv ranked it top-4.
- **Weigh (reported):** `evalStay − evalTranspose` — how much you give up versus your line's own
  next move, surfaced so the user judges the trade; never silently applied.

The re-route is **sound to commit to** because the diverging move is **yours**. Opponent-forced
convergences are out of scope (you can't commit to them — `get_transpositions` already reports
those).

---

## Algorithm — `pruneTranspositions`

New **async** method on `GameTree`, engine injected (keeps `chess-tools` engine-free, mirroring
`extendedBridges` / `decisionNodes`):

```ts
export interface PruneSuggestion {
  linePath: string[];     // SAN path to the leaf line that can be shortened
  atPath: string[];       // SAN path to the re-route node (a prefix of linePath)
  atPly: number;          // == atPath.length
  rerouteMove: string;    // engine SAN that transposes (≠ the line's own next move)
  joinsPath: string[];    // shallowest SAN path on a DIFFERENT line the re-route reaches
  savedPlies: number;     // linePath.length − atPly (the redundant tail)
  evalBest: number;       // cp, mover POV, of the engine's #1 move at the node
  evalStay: number | null;   // cp, mover POV, of the line's own next move (null if not in top-k)
  evalTranspose: number;     // cp, mover POV, of the re-route move (passed the near-best gate)
  evalDelta: number | null;  // evalStay − evalTranspose (cp given up vs staying)
}

// analyse(fen, multipv) → top lines { uci, cp, mate } (white POV). Injected engine.
pruneTranspositions(
  color: Color,
  opts: { multipv?: number; cpThreshold?: number; maxLossCp?: number },
  analyse: (fen: string, multipv: number) => Promise<{ uci: string; cp: number | null; mate: number | null }[] | null>,
): Promise<PruneSuggestion[]>
```

```
keyMap = positionKey → shallowest { path, sanPath, ply }     // all nodes, as in bridges
for each leaf L (sanPath SL, indexPath PL):
  walk nodes N along L from the root (earliest first):
    if N.turn !== color: continue
    lines = await analyse(fen(N), multipv)                    // top-k, white POV
    if !lines: continue
    evalBest = moverCp(lines[0])                              // #1 = objective best
    stayMove = L's own next SAN at N
    evalStay = moverCp of the entry whose SAN == stayMove, else null
    for m in lines:
      if evalBest − moverCp(m) > cpThreshold: continue        // NEAR-BEST GATE (drops blunders)
      if SAN(m) == stayMove: continue                         // that's staying
      key = positionKey(after m)
      tgt = keyMap.get(key)
      if !tgt: continue                                       // leaves the repertoire
      if isPrefix(PL_atN, tgt.path) or isPrefix(tgt.path, PL_atN): continue   // same line
      evalTranspose = moverCp(m)
      if maxLossCp set and evalStay != null and (evalStay − evalTranspose) > maxLossCp: continue
      emit PruneSuggestion{ L, atPath=SL[:N.ply], rerouteMove=SAN(m), joinsPath=tgt.sanPath,
                            savedPlies = SL.length − N.ply, evalBest, evalStay, evalTranspose,
                            evalDelta = evalStay==null ? null : evalStay − evalTranspose }
      break out of L                                          // earliest = best; one per line
rank: savedPlies desc, then smaller evalDelta, then earliest atPly
```

- **`moverCp`**: white-POV cp/mate projected to the side to move (same helper as `gaps.ts`;
  `MATE_CP` for mate).
- **Engine cost**: one multipv search per my-turn node until the first re-route — bounded by line
  length; the eval cache makes positions shared across lines free.
- **Cross-line guard**: `isPrefix` either way → same-line continuation, skip (reuses the bridge
  guard). The target being the *shallowest* occurrence biases toward the most-canonical line.

---

## Tool contract + surfaces

```
find_pruning_transpositions   // MCP (stateful repertoire_id) + PWA chat tool
  args: { limit?, multipv? (default 4), cp_threshold? (default 50), max_loss_cp? }
  → { total, returned, suggestions: PruneSuggestion[] }
```

- **chess-tools**: `pruneTranspositions` + `PruneSuggestion`, exported from `index.ts`.
- **MCP server** (`apps/mcp-server/src/index.ts`): async tool, `analyse = (fen, mpv) => analyseMulti(fen, mpv, 14)`.
- **PWA** (`apps/ui/src/llm/tools.ts`): schema + executor using `analyseMulti`.
- **UI store** (`store/repertoire.ts`): `pruneSuggestions` signal + `scanPrune()` — engine-backed,
  cancellable + per-line progress, same shape as `scanGaps`/`scanBridges`.
- **RepertoirePanel**: a new Tier-A "Shorten" section. Each row:
  `✂ <line> — <reroute> @ply N → joins <other line>  (save N ply, Δ −0.12)`.
  Click → `goto(atPath)` + stage the re-route move as a preview arrow (`stagePreviewLine`) so the
  merge is visible before committing. Applying (cut the tail, keep the re-route) reuses the existing
  `prune` edit (`GameTree.edit("prune", …)` / `modify_repertoire_line`).
- **workflows.ts**: add to the repertoire method — "shorten a line that secretly transposes."

---

## Testing (smoke-gametree.mjs)

`pruneTranspositions` takes an injected `analyse`, so a deterministic stub drives it (no real
engine). Fixture: two lines that converge via a my-move re-route where the engine-best early move
routes line A into line B.
- emits one `PruneSuggestion` for A at the earliest my-turn re-route; `joinsPath` on B; `savedPlies`
  = A's tail; `evalDelta` from stubbed evals.
- **near-best gate**: a stub where the transposing move is ranked top-4 but far below #1 → no
  suggestion (proves blunder exclusion).
- `maxLossCp` filters a re-route whose eval loss vs staying exceeds the cap.
- independent/linear lines → none.

---

## Non-Goals

- **Opponent-forced convergences** — can't commit to the order; `get_transpositions` covers them.
- **Auto-applying the prune** — every suggestion is staged; the user accepts. Reuses the prune edit.
- **Re-routes through engine-bad moves** — excluded by the near-best gate; `evalDelta` surfaces the
  residual cost of the ones that qualify.
- **Multi-line cluster merges** (collapsing 3+ lines to one trunk at once) — v1 is per-line to the
  single best target; clustering is a later refinement.
