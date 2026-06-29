# Features Design Spec — repertoire gaps, coverage, compare_moves

Status: **implemented and shipped** (three new tools beyond the shipped Roadmap; 126-test suite +
Docker snapshot regen, green). This doc is the design rationale of record; current state lives in
`README.md`.

Design of record for three new tools, written before coding (house convention: assess vs the
codebase, recommend per choice, design doc first). Companion specs: `MCP_DESIGN.md` (lean
~2k-token outputs, stateless contract, closed error codes), `REPERTOIRE_DESIGN.md` (handle
cache, structural layer, Decision D3 SAN-path identity).

Each section leads with the **recommendation** and reasoning, then contract impact, tests, and
verification. Engine-backed paths are verified in Docker (Stockfish is Docker-only here).

---

## Contract invariants (unchanged by all three tools)

- White-POV centipawns; mate → ±10000 (`_score_cp`).
- **Closed error-code set stays closed and unchanged.** Every new failure path reuses an
  existing code (`repertoire_not_found`, `invalid_fen`, `too_many_moves`). No new codes.
- Stateless interface (the `repertoire_id` handle is the one exception).
- Output nesting ≤ 2 levels; no field inferable from another; lean by default, capped lists.
- Engine I/O lives only in `chess_mcp.py`; `structure.py` and `repertoire.py` stay engine-free
  and unit-testable without Stockfish.

Tree/turn semantics used throughout: a node's `board()` is the position **after** its move;
`board().turn` is who moves **next**. For a repertoire of `rep.color`:
- `board().turn == rep.color` → the **player** is to move (the repertoire should prescribe a move).
- `board().turn == (not rep.color)` → the **opponent** is to move (the repertoire covers the
  replies it wants to meet; its children are the covered opponent moves).

---

## 1. `find_repertoire_gaps` — engine completeness scan (engine-backed)

**Recommendation:** add

```python
@mcp.tool()
def find_repertoire_gaps(
    repertoire_id: str,
    depth: int = DEFAULT_DEPTH,
    min_severity: Literal["low", "medium", "high"] = "medium",
    limit: int = 10,
    max_positions: int = 20,
    time_limit: float | None = None,
) -> dict:
    """→ {color, positions_scanned, total_gaps, gaps: [{path, uncovered_move, eval, severity}]}"""
```

At every **opponent-to-move node that already has ≥1 prepared reply** (an internal decision
node, not a frontier leaf), run engine multipv and flag strong opponent moves the repertoire
does **not** cover.

**Why this shape.** Completeness is the central repertoire-building question — "what am I not
prepared for?". `suggest_complementary_lines` extends from a single FEN; nothing scans the whole
tree for holes. Restricting to nodes that *already* have a reply is deliberate: a frontier leaf
(no replies yet) would flag every opponent move as "uncovered" — noise. The valuable signal is
"you answer 3...Nf6 and 3...Bb4 but not 3...Bb5, which the engine rates equal."

**Why the bounds.** Engine cost = `positions_scanned × one multipv analyse`. `max_positions`
(default 20, clamped [1, 60]) caps it; when more decision nodes exist, the **shallowest** are
scanned first (positions nearer the root are reached by more games → matter most). `depth` /
`time_limit` tune each analyse exactly as the other engine tools.

**Engine-free seam (testable without Stockfish), in `repertoire.py`:**

```python
def opponent_reply_nodes(rep) -> list[dict]:
    """Nodes where the OPPONENT is to move and ≥1 reply is prepared, shallowest first.
    → [{'path': [...], 'board': board, 'covered': {uci, ...}}]"""
```

and the pure scoring helper in `chess_mcp.py`:

```python
def _gaps_from_infos(board, infos, covered) -> list[dict]:
    # mover = board.turn (the opponent); best = mover-POV cp of infos[0]
    # for each multipv line whose first move's uci not in `covered`:
    #   loss = best - mover_cp(line); severity = high(<=30) / medium(<=80) / low
    #   → {uncovered_move (SAN), eval (white-POV cp), severity}
```

The tool: resolve handle (`repertoire_not_found` reused), pick nodes via
`opponent_reply_nodes`, cap to `max_positions`, run `engine.analyse(board, _limit(...),
multipv=DEFAULT_MULTIPV)` per node, build gaps via `_gaps_from_infos`, attach `path`, filter by
`min_severity`, sort high→low then by `eval`, cap to `limit`.

**Output size:** capped list, ≤2 nesting; `path` is the drill-down handle for
`get_structural_profile` / `suggest_complementary_lines` (no unreachable handle).

**Tests:** engine-free — `opponent_reply_nodes` selects the right nodes for a White and a Black
repertoire (root handled for Black; frontier leaves excluded); `_gaps_from_infos` flags only
uncovered moves and assigns severity by margin; tool returns `repertoire_not_found` on a bad id.
**Verification:** Docker — a real `find_repertoire_gaps` over `sample-repertoire.pgn`.

---

## 2. `get_repertoire_coverage` — tree-shape hygiene (engine-free)

**Recommendation:** add

```python
@mcp.tool()
def get_repertoire_coverage(repertoire_id: str, limit: int = 20) -> dict:
    """→ {color, leaves, dangling_count, dangling_lines: [{path, ply}],
         frontier_count, max_depth, shallowest_leaf_ply}"""
```

Pure tree analysis (no engine). The headline signal is **dangling lines**: a leaf where it is
the **player's** turn (`leaf.board().turn == rep.color`) — the line stops exactly where *you*
need a move, so there is no prepared reply. That is a concrete repertoire bug. A leaf where the
**opponent** is to move is a natural frontier (you have played your move and paused) → counted
as `frontier_count`, not flagged.

**Why engine-free / its own tool.** Fast, deterministic, unit-testable with no Docker; one job
(coverage), distinct from structural themes (`get_structural_profile`) and thematic consistency
(`analyze_repertoire_congruence`). Complements tool #1: shape holes (a line that just stops) vs
engine-critical holes (a strong move you skipped).

**Engine-free logic, in `repertoire.py`:**

```python
def coverage_report(rep, limit) -> dict:
    # walk leaves: dangling = leaf.board().turn == rep.color
    # depths = [leaf.ply() for leaf in leaves]
    # → {leaves, dangling_count, dangling_lines: [{path, ply}][:limit],
    #    frontier_count, max_depth, shallowest_leaf_ply}
```

The tool resolves the handle (`repertoire_not_found` reused), clamps `limit` ([1, 100]), adds
`color`, returns `coverage_report`.

**Output size:** scalars + one capped list of `{path, ply}`; `path` drills via the other
repertoire tools. Lean.

**Tests:** engine-free — a tree with a known your-move leaf flags exactly one dangling line with
the right path/ply; an all-frontier tree flags none; `dangling_count + frontier_count == leaves`;
bad id → `repertoire_not_found`; `limit` respected.

---

## 3. `compare_moves` — evaluate caller-supplied candidate moves (engine-backed)

**Recommendation:** add

```python
@mcp.tool()
def compare_moves(
    fen: str,
    moves: list[str],
    depth: int = DEFAULT_DEPTH,
    time_limit: float | None = None,
) -> dict:
    """→ {fen, side_to_move, results: [{move, eval, cp_loss, pv}], illegal: [str]}"""
```

Evaluate a caller's **own** list of candidate moves from one position, ranked best→worst.
Implemented with a single `engine.analyse(board, limit, multipv=len(valid), root_moves=valid)` —
the engine searches **only** the supplied legal moves and returns one ranked line per move in one
pass (≈ the cost of one `evaluate_position(multipv)` call).

**Why this shape.** `evaluate_position(multipv)` only ranks the engine's *own* top-N moves — if
your candidate is not in that top-N you get no number for it. `compare_moves` answers "of THESE
moves I'm weighing, which is best and by how much?" — core to game review ("was my move or X
better?") and repertoire choice ("the Bg5 line or the Nf3 line?").

**Field semantics.** `eval` is white-POV cp (server convention). `cp_loss` is from the
**mover's** POV: `best_mover_cp − this_move_mover_cp`, so it is ≥ 0 and the best candidate is 0.
`side_to_move` (`"white"`/`"black"`) lets the model read `eval`'s sign correctly. `pv` is the
engine continuation in SAN.

**Illegal / unparseable inputs.** Partition first (engine-free): legal moves go to `results`,
the rest are listed verbatim in `illegal` — no new error code, no heterogeneous entries. If
`moves` exceeds the cap → `too_many_moves` (reused). Invalid FEN → `invalid_fen` (reused). All
moves illegal → `results: []` with everything in `illegal`. Duplicates among valid moves are
de-duplicated (order preserved).

**Cap.** `MAX_COMPARE_MOVES = MAX_MULTIPV` (10) — one analysed line per move, bounded by the
server's multipv ceiling.

**Tests:** engine-free — `invalid_fen` on garbage; `too_many_moves` past the cap; the
legal/illegal partition + empty-`valid` short-circuit (returns before the engine, asserted by
not needing Stockfish). Engine ranking verified in Docker.

---

## Doc + snapshot updates (as the tools land)

- **README.md:** add the three tool rows (gaps + compare_moves under Game/Repertoire tables;
  coverage under Repertoire); bump tool count 13 → 16; note that the closed error set is
  unchanged; add 2 new prospective Roadmap items.
- **MCP_DESIGN.md:** "Measuring output size" table — add the three tools; refresh the
  tool-count / total-description-token line. Regenerate the snapshot in Docker.
- **evals/capture.py:** add the three tools; regen `evals/snapshots/outputs.json` **in Docker**
  (needs Stockfish). Stale token numbers are worse than none.

## Commit plan (Conventional Commits, no Co-Authored-By, trunk-based)

1. `feat: get_repertoire_coverage tool (engine-free tree hygiene)`
2. `feat: find_repertoire_gaps tool (engine completeness scan)`
3. `feat: compare_moves tool (rank caller-supplied candidate moves)`
4. `docs: document gaps/coverage/compare_moves; regen evals snapshot`
5. `chore: bump version to 0.1.5 (16 tools)`

Each commit builds + lints + passes `pytest`; engine-touching commits are verified in Docker
before push.
