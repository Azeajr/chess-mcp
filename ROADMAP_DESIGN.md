# Roadmap Implementation — Design Spec

Status: **implemented and shipped** (all four items + a uncovered `_move_accuracy` crash fix;
113-test suite + Docker snapshot regen, green). This doc is the design rationale of record; current
state lives in `README.md` / `CONTEXT.md`.

Design of record for the four open `README.md` Roadmap items. Written before coding
(house convention: assess vs the codebase, recommend per choice, design doc first).
Companion specs: `MCP_DESIGN.md` (lean ~2k-token outputs, stateless contract, closed
error codes), `REPERTOIRE_DESIGN.md` (Decision D2 on structure scope).

Each section leads with the **recommendation** and the reasoning behind it, then the
contract impact, tests, and verification. Engine-backed paths are verified in Docker
(Stockfish is Docker-only here), never on the host.

Sequencing note: items 1–3 edit `server/chess_mcp.py`; item 4 edits `server/structure.py`
+ `evals/structure_accuracy.py`. A structural-refactor pass is in flight on those same
files, so implementation lands **after** that refactor (rebased onto it) to avoid
clobbering. This doc is parse-only and conflict-free.

---

## Contract invariants (unchanged by all four items)

- White-POV centipawns; mate → ±10000.
- Closed error-code set stays closed: `invalid_pgn`, `invalid_fen`, `invalid_color`,
  `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`,
  `variation_not_found`, `invalid_mode`. **No new error codes are required** — every new
  failure path reuses an existing code.
- Stateless interface (the `repertoire_id` handle is the one exception).
- Output nesting ≤ 2 levels; no field inferable from another; lean by default.
- The three existing game tools (`analyze_game`, `get_game_summary`, `get_position`)
  keep byte-identical output shapes and their `(move_number, color)` identifier.

---

## 1. `time_limit` param — engine search by wall-clock instead of depth

**Recommendation:** add an optional `time_limit: float | None = None` to every
engine-backed tool. When set (and > 0) use `chess.engine.Limit(time=time_limit)`;
otherwise keep the depth-based `Limit(depth=depth)` default. Clamp to
`[MIN_TIME, MAX_TIME]` = `[0.01, 60]` s (`MAX_ENGINE_TIME_S` env override). Depth stays
the default so existing callers and snapshots are unaffected.

**Why this shape.** It mirrors `python-chess`'s own `Limit(time=…)` vs `Limit(depth=…)`,
adds no new tool, and keeps depth as the deterministic default. A single optional param
per tool is the smallest surface that delivers "faster iteration / slower hardware."

**Affected tools (5):** `analyze_game`, `get_game_summary`, `get_position`,
`evaluate_position`, `suggest_complementary_lines`.

**Engine-cache impact.** The shared `@lru_cache` key grows to include `time_limit`
(`float | None`, both hashable). Helper:

```python
def _clamp_time(t: float) -> float:
    return max(MIN_TIME, min(MAX_TIME, t))

def _limit(depth: int, time_limit: float | None) -> chess.engine.Limit:
    if time_limit is not None:
        return chess.engine.Limit(time=time_limit)
    return chess.engine.Limit(depth=depth)
```

Tools clamp `time_limit` (when not None) before threading it into the cached analysis,
exactly as `depth` is clamped before the cache key today (normalizes keys).

**Determinism caveat (documented, not fixed).** Time-based search is wall-clock
dependent → not bit-reproducible across runs/hardware. Within one process the lru_cache
still returns one consistent result per `(pgn, depth, multipv, time_limit)`, so a
summary→analyze→get_position workflow stays internally consistent. Depth remains the
reproducible default; `time_limit` is opt-in best-effort. Noted in each docstring.

**Output shapes:** unchanged. `evaluate_position`'s `depth` field already reports the
*depth reached* from the engine `info` (works under a time limit too).

**Tests (engine-free):** `_clamp_time` bounds; `_limit(None)` → depth limit,
`_limit(0.5)` → time limit (assert on the `Limit` object's fields, no engine). Tool-layer
guard tests don't change.

**Verification:** Docker — one `analyze_game(..., time_limit=0.1)` call to confirm a real
time-limited pass returns the same record shape.

---

## 2. Variation-aware engine analysis — one pass over the whole tree

**Recommendation:** generalize the cached engine pass from a `game.mainline()` walk to a
**whole-tree** walk that analyses every distinct node position once, keyed by the node's
**SAN-path tuple** (stable across re-parses). The three existing game tools consume the
**mainline projection** of that map → their output is byte-identical. The new
`export_annotated_pgn` (item 3) consumes the full map. This is the "analyze side lines
correctly in one pass" the roadmap asks for, with **zero change** to the existing tools'
contract.

**Why not just recurse the current flat list.** Records are addressed by
`(move_number, color)`, which is unique on the mainline but **collides** across variations
(mainline 5.♔ and a side-line 5.♔ share the key). Recursing into the flat list would
break `get_position`'s lookup and muddle `analyze_game`'s output. Keying by SAN-path
(a route is unique — `REPERTOIRE_DESIGN.md` D3) sidesteps the collision and reuses the
existing `repertoire.san_path` convention.

**Why SAN-path keys (not node identity).** The analysis is `@lru_cache`d and so is the
parsed `game`. `export_annotated_pgn` must **mutate** a tree to attach NAGs/comments;
mutating the cached game would corrupt the cache for every other caller. Path keys let
export re-parse its own fresh tree and look records up by path — the cache stays
read-only. (Mainline tools never mutate `game`, so they can keep sharing it.)

**Algorithm (one analysis per distinct position, same cost as today on a linear game):**

```
analyse every node's board() once (root included) → info_by_node[node]  # multipv list
for each move-node:
    parent       = node.parent (root for first moves)
    parent_infos = info_by_node[parent]
    eval_before  = score(parent_infos[0])           # = parent's own eval
    best/best_pv/alternatives  ← parent_infos       # computed on the parent position
    eval_after   = score(info_by_node[node][0])
    color        = side to move at parent
    cp_loss      = max(0, (eval_before - eval_after) if white else (eval_after - eval_before))
    fen/move_number ← parent.board(); move ← parent.board().san(node.move)
```

For a linear mainline this reproduces today's records *exactly* (parent == prev position,
node == pushed position → identical evals and cp_loss). Analyses = nodes + 1, unchanged
for a mainline; = tree-nodes + 1 for a tree. One engine pass.

**Structure:**

```python
@lru_cache(maxsize=32)
def _analyse_tree(pgn, depth, multipv, time_limit) -> tuple[dict[tuple[str, ...], dict], game]:
    ...  # path-tuple -> record, plus the parsed game (read-only)

def _mainline_records(pgn, depth, multipv, time_limit) -> tuple[list[dict], game]:
    records_by_path, game = _analyse_tree(...)
    # project the mainline (first variation at each step) in order
```

The existing three tools call `_mainline_records` (drop-in for today's `_analyse_all_moves`)
→ no behavior change. `time_limit` (item 1) threads through both.

**Output shapes:** unchanged for the three game tools. New surface is item 3 only.

**Tests (engine-free where possible):** mainline projection over a branching PGN equals
the mainline-only record list (shape/order); path keys present for side-line nodes.
Engine-touching record values verified in Docker.

**Verification:** Docker — analyze a small PGN with one variation; confirm side-line nodes
get records and the mainline output is unchanged from the prior snapshot.

---

## 3. `export_annotated_pgn` — grounded, importable annotated PGN

**Recommendation:** add one tool

```python
@mcp.tool()
def export_annotated_pgn(
    pgn: str,
    depth: int = DEFAULT_DEPTH,
    min_cp_loss: int = 50,
    time_limit: float | None = None,
) -> dict:
    """→ {"pgn": <annotated PGN string>, "moves_annotated": <int>}"""
```

It re-parses the PGN into a **fresh** game, walks every node, looks each up in
`_analyse_tree`'s path-keyed map (item 2), and attaches:

- **NAG glyph** when `cp_loss >= min_cp_loss`: inaccuracy → `$6` (`?!`,
  `chess.pgn.NAG_DUBIOUS_MOVE`), mistake → `$2` (`?`, `NAG_MISTAKE`), blunder → `$4`
  (`??`, `NAG_BLUNDER`). `good` moves get nothing.
- **Inline comment** on flagged moves only (keeps output lean): white-POV eval after the
  move + best move, e.g. `+0.35 best Nf3`. Played == best → eval only.

Then export with `chess.pgn.StringExporter` (comments + variations + NAGs). Because every
node is annotated, **side lines are annotated too** — the payoff of item 2.

**Why this output.** The `pgn` field is an **artifact** (importable into a board GUI),
not a reasoning primitive — the one justified exception to "reshape, don't dump." It is
bounded by `MAX_PGN_BYTES` input; comments are gated behind `min_cp_loss` so good moves
add no bytes and the artifact stays close to the input size. `moves_annotated` is a cheap
non-inferable summary count. Complements the `annotate-pgn` *skill* with a server-side,
engine-grounded equivalent.

**Why a tool, not a resource.** It runs the engine on caller input with parameters →
tool, per `MCP_DESIGN.md` (resources are for static/slow reference data).

**Errors:** reuse `pgn_too_large` (size cap) and `invalid_pgn` (no-move parse) — no new
code. Mutation is on the fresh parse, never the cached tree (item 2 rationale).

**Tests:** engine-free shape test on the **annotation/serialization** path by feeding a
hand-built record map (or a tiny stub) — assert NAGs land on the right moves, comments
only on flagged moves, output re-parses as valid PGN and preserves the variation. Full
engine run in Docker.

**Verification:** Docker — `export_annotated_pgn(sample-game.pgn)`; re-parse the returned
PGN to confirm validity and that glyphs/comments appear on the known mistakes.

---

## 4. More pawn structures — add **Closed Sicilian** (8th structure)

**Recommendation:** add **Closed Sicilian** to `classify_structure`. Note the roadmap also
lists "French Advance" — that skeleton is **already covered** by the existing `French`
pattern (`e5/d4` vs `e6/d5`), so the genuinely-new structure here is Closed Sicilian.

**Why conservative.** `REPERTOIRE_DESIGN.md` D2 explicitly flags Closed Sicilian as
"hinges on piece placement + move order → brittle under static matching," and the design
rule is *a wrong label misleads an LLM more than `unknown`*. So: a tight pawn-only
signature, **lower confidence (0.7)**, and a precision guard (must not fire on any
existing negative fixture).

**Signature (White Closed Sicilian / Grand Prix skeleton):**
White pawns `{e4, d3, f4}` AND Black pawns `{c5, d6}` → `("Closed Sicilian", 0.7)`.
The `d3` (small center, *not* `d4`) distinguishes it from the Open Sicilian (White d-pawn
gone) and from `d4` structures; the `f4` pins it to the Closed/Grand Prix family and
avoids colliding with a King's-Indian-Attack-vs-Sicilian read. No mirrored Black variant
(vanishingly rare; would only add false-positive surface).

**Why this won't regress precision.** None of the current negatives (start, 1.e4 e5,
QGD/Slav tension, Ruy Lopez) contain the `{e4,d3,f4}` White trio, so the
`structure_accuracy.py` "false positives on negatives = 0" guard holds.

**Harness + tests:**
- Add a real Closed Sicilian FEN to `evals/structure_accuracy.py` `FIXTURES` (positive)
  and keep all negatives.
- Add the FEN constant + a `classify_structure` parametrize case in
  `test_structure_repertoire.py`, and include it in the `confidence >= 0.7` parametrize.
- `evals/structure_accuracy.py` must stay at **0 misclassifications** (its exit code).

**Docs:** bump "7 structures" → "8" and the structure list (README Tools note,
`structure.py` docstring + `classify_structure` patterns list, CONTEXT.md).

**Engine-free:** entirely static bitboard work; no Docker needed for item 4 (run the
accuracy harness + pytest locally).

---

## Doc + snapshot updates (done as the items land)

- **README.md:** check off the four roadmap items; add `time_limit` to the relevant Tools
  rows; add the `export_annotated_pgn` row (Game analysis table); bump structures 7 → 8.
- **CONTEXT.md:** tool count (12 → 13), structure count (7 → 8), file-purpose lines.
- **MCP_DESIGN.md:** "Measuring output size" table — add `export_annotated_pgn`; refresh
  the tool-count / total-description-token line. Regenerate the snapshot.
- **evals/capture.py:** add `export_annotated_pgn`; regen `evals/snapshots/outputs.json`
  **in Docker** (needs Stockfish). Stale token numbers are worse than none.

## Commit plan (Conventional Commits, no Co-Authored-By, trunk-based)

1. `feat: time_limit search option on engine tools` (item 1)
2. `feat: whole-tree engine analysis pass (variation-aware)` (item 2)
3. `feat: export_annotated_pgn tool (engine-annotated PGN artifact)` (item 3)
4. `feat: add Closed Sicilian to the structural classifier` (item 4)
5. `docs: roadmap items shipped; regen evals snapshot` (docs + snapshot)

Each commit builds + lints + passes `pytest`; engine-touching commits are verified in
Docker before push.
