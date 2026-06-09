# Repertoire Analysis — Design Spec

Design for the Holistic Repertoire Analysis feature set: a stateful, thematic
repertoire analyzer layered on the existing stateless tactical tools.

Status: **implemented and shipped** (all four tools live; 81-test suite, CI green). This doc is the
design rationale of record; current state lives in `CONTEXT.md` / `README.md`. Build order at the bottom.

**Part II (sections 9–12, below) is the active extension** — the single-session edit loop
(mutation + export tools) and the structural/transposition re-keying of congruence clustering.
Status of Part II: **design signed off** — single-tool surface (M2), single-`[Event]` export
(E2a), opening-system clusters (C1); implementing Phase 1 → 2 → 3. Sections 1–8 are the shipped base.

This doc is the contract. Implementation follows it; if reality forces a change,
change this doc in the same commit. Companion: `MCP_DESIGN.md` (server-wide design
principles — every rule below traces back to it).

---

## 1. Background — why this shape

The original feature ask proposed four tools (`load_repertoire`,
`analyze_repertoire_congruence`, `get_structural_profile`,
`suggest_complementary_lines`) plus a `StructuralExtractor`. That ask was sound in
intent but collided with this codebase's conventions in several places. The
assessment below is preserved so the rationale survives.

### Aligns with the codebase (kept as-is)

- **Handle pattern is pre-blessed.** `MCP_DESIGN.md:80-83` sanctions exactly one
  stateful exception — a large input re-sent on every call becomes `load_x(blob) → id`.
  Already on the `README.md` Roadmap ("Game handle"). `load_repertoire` fits the intent.
- **Structural analysis is engine-free.** `python-chess` bitboards / `SquareSet` give
  static pawn-structure detection with no Stockfish dependency — fast, and only the
  Mode B suggestion path needs the engine.

### Gaps the original ask assumed but the repo lacks

1. **Variation-tree walking was net-new and load-bearing.** Before this feature every tool walked
   `game.mainline()` only (the game tools still do, e.g. `server/chess_mcp.py`) and the
   `repertoire-builder` skill was mainline-only. `python-chess` *parses* variations into
   `node.variations`, but nothing traversed them. Phases 2–3 all sit on tree-walk code
   that does not exist. **Build the walker first.**
2. **No output-size discipline in the new tools.** `MCP_DESIGN.md` mandates ~2k-token
   outputs, `limit`/filter params on lists, and a summary→detail split. A flat
   incongruency list over a "massive tree" blows the budget. Fixed with
   `min_severity` + `limit` and a summary→detail shape that emits the drill-down handle.
3. **New error codes were not enumerated.** The closed set
   (`MCP_DESIGN.md:142`, `CONTEXT.md:72`) must grow to cover bad/expired ids and bad paths.
4. **Cache eviction unspecified → memory leak.** The original "global dict UUID→object"
   is unbounded; the existing shared cache is bounded (`@lru_cache(maxsize=32)`,
   `server/chess_mcp.py:79`). Fixed with bounded LRU + TTL (section 3).

### Misfits with house conventions (corrected)

5. **Input-cap collision.** `MAX_PGN_BYTES=100000` (`server/chess_mcp.py:14`) would
   reject the large trees this feature targets → separate `MAX_REPERTOIRE_BYTES`.
6. **Pydantic vs dict.** All existing tools return plain dicts; outputs documented in
   docstrings. **Decision: plain dict** (see Decision Log). Pydantic's win (schema +
   runtime validation) is outweighed here by error-shape friction (the closed-code
   `{"error","reason"}` pattern does not fit a typed success model without a Union),
   added `outputSchema` tokens in `tools/list`, and a second idiom to maintain.
7. **`mode` must be a closed type** (`MCP_DESIGN.md` "Enum > free strings") → `Literal`.
8. **`suggest_*` `fen` role undefined** → fen is the *anchor to suggest from*; the id
   supplies the *profile*.
9. **Param-name drift** (`target_color` vs `color`) → settle on `color`.

### Correctness cautions

10. **`classify_structure` will misfire** on fuzzy/overlapping named structures.
    **Decision: narrow set + confidence + `unknown` fallback** (Decision Log).
11. **`variation_path` identity** needs a defined encoding. **Decision: SAN move list**
    (Decision Log). A path is a *route*, not a destination FEN — transposition ambiguity
    does not apply; two transposing routes are legitimately distinct repertoire nodes.

### Framing correction

The feature is **not** "stateless → stateful" wholesale. Every tool except
`load_repertoire` stays a pure function of `(repertoire_id, args)` — same in, same out.
The id is an input key, not session state that varies by call order
(`MCP_DESIGN.md:72-79`).

---

## 2. Decision Log

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| D1 | Output type | **Plain dict + `Literal` inputs** | Consistency with 6 existing tools; clean structured-error returns; no added `outputSchema` tokens. Validation covered by `evals/` snapshot + a shape test instead. |
| D2 | `classify_structure` scope | **Narrow set (IQP, Carlsbad, Maroczy) + `confidence` + `unknown` fallback** | A false structure label misleads an LLM cross-referencing it more than `unknown` does. The three chosen are the cleanest pawn-skeleton matches; French Advance / Closed Sicilian hinge on piece placement + move order → brittle under static matching. Expand later with fixtures. **Since expanded to 19 source-traced structures + always-on theme tags — the D2 *principle* (narrow-but-honest, never a false label) is preserved; the set grew under it. See `STRUCTURE_CLASSIFIER_DESIGN.md`.** |
| D3 | `variation_path` encoding | **SAN move list** e.g. `["e4","c5","Nf3"]` | Matches house SAN-first convention; what the model already emits; readable errors. Resolver walks ply-by-ply (`parse_san` per node, follow the matching child). |
| D4 | `variation_path=None` | **Aggregate profile over all leaves** | The repertoire's overall structural fingerprint. A concrete path → single-node profile. |
| D5 | `suggest_*` `fen` | **Anchor position to suggest a continuation FROM** | id supplies profile, fen supplies the where (a leaf, or a gap position). |

---

## 3. Cache lifecycle (leak control)

One in-memory cache per server process. SSE is a single long-lived process with **no
session-close signal**, so eviction is the only reclaim path → it must be bounded.

```python
# module level
_REPERTOIRE_CACHE: "OrderedDict[str, _Repertoire]" = OrderedDict()
_CACHE_LOCK = threading.Lock()
MAX_REPERTOIRES  = int(os.environ.get("MAX_REPERTOIRES", "16"))     # LRU cap
REPERTOIRE_TTL_S = int(os.environ.get("REPERTOIRE_TTL_S", "3600"))  # idle expiry, seconds

@dataclass
class _Repertoire:
    game: chess.pgn.Game     # parsed tree root; holds all variations
    color: chess.Color
    created: float
    touched: float
    nodes: int
    leaves: int
    max_depth: int
```

Rules:

- **Bounded LRU + TTL.** On insert: sweep expired, then evict LRU until
  `len < MAX_REPERTOIRES`. On access: if expired → `repertoire_not_found`; else refresh
  `touched` and move-to-end.
- **Lock all mutation.** SSE can serve concurrent calls; a bare dict races.
- **Distinct from the engine cache.** `@lru_cache(maxsize=32)` (`server/chess_mcp.py:79`)
  keys on PGN text for engine passes; this cache holds parsed trees. Structural work is
  engine-free → no interaction between them.
- **Trust boundary.** `repertoire_id` is an unguessable UUID = a capability token, but
  the cache is shared across all (unauthenticated) LAN clients. Acceptable within the
  documented trusted-LAN boundary (`README.md:144`); noted because it is new stateful
  surface on an unauthenticated port.

---

## 4. Caps and error codes

New input caps (env-overridable, mirroring existing caps):

| Cap | Default | Applies to |
|-----|---------|-----------|
| `MAX_REPERTOIRE_BYTES` | `1_000_000` (1 MB) | `load_repertoire` PGN — separate from the 100 KB single-game cap so real trees load |
| `MAX_REPERTOIRES` | `16` | live cache entries (LRU) |
| `REPERTOIRE_TTL_S` | `3600` | idle entry lifetime |

Closed error-code set grows by three (added to the enumerated set in
`MCP_DESIGN.md`/`CONTEXT.md`):

`repertoire_not_found`, `variation_not_found`, `invalid_mode`

Reused: `invalid_pgn`, `invalid_fen`, `invalid_color`, `pgn_too_large`.

---

## 5. Tool signatures (dict returns, `Literal` inputs)

```python
@mcp.tool()
def load_repertoire(pgn: str, color: Literal["white", "black"]) -> dict:
    """Parse a repertoire PGN ONCE, cache it, return a handle + tree stats.

    Cheap: tree stats only — no engine, no structural pass. All later repertoire
    tools take the returned repertoire_id instead of re-sending the PGN.

    → {repertoire_id, color, nodes, leaves, max_depth}
    errors: invalid_pgn, invalid_color, pgn_too_large (→ MAX_REPERTOIRE_BYTES)
    """


@mcp.tool()
def get_structural_profile(
    repertoire_id: str,
    variation_path: list[str] | None = None,   # SAN route; None = aggregate (D3/D4)
) -> dict:
    """Static pawn-structure profile. Engine-free.

    variation_path given → ONE node:
      {fen, structure_class, confidence, primitives, half_open_files, open_files}
    variation_path None → AGGREGATE fingerprint over all leaves:
      {structures: [{structure_class, confidence, count}], common_primitives, ...}

    errors: repertoire_not_found, variation_not_found
    """


@mcp.tool()
def analyze_repertoire_congruence(
    repertoire_id: str,
    min_severity: Literal["low", "medium", "high"] = "medium",
    limit: int = 10,
) -> dict:
    """Flag logical/thematic incongruencies across the tree. Engine-free.

    Summary→detail shape; each item carries the variation_path(s) so the agent can
    drill via get_structural_profile (no unreachable handle).

    → {total_flagged, by_type: {...}, incongruencies: [
         {type, severity, description, paths: [<variation_path>, ...]}, ...
       ][:limit]}
    errors: repertoire_not_found
    """


@mcp.tool()
def suggest_complementary_lines(
    repertoire_id: str,
    fen: str,                                   # anchor: suggest a continuation FROM here (D5)
    mode: Literal["low_memorization", "sharp"] = "low_memorization",
    depth: int = DEFAULT_DEPTH,
    limit: int = 5,
) -> dict:
    """Suggest continuations from an anchor position, ranked by mode.

    Engine multipv provides a soundness floor; candidates are then re-ranked:
      low_memorization → resulting structure matches the user's existing profile
                         (minimize new middlegame theory)
      sharp            → maximize imbalance / break from the profile

    → {mode, anchor_fen, suggestions: [
         {move, resulting_structure, profile_match | sharpness, eval, pv}, ...
       ][:limit]}
    errors: repertoire_not_found, invalid_fen, invalid_mode
    """
```

Output-size note: every list output is capped (`limit`) and filterable
(`min_severity`); `analyze_repertoire_congruence` is the summary, `get_structural_profile`
the detail, and the summary emits the `variation_path` the detail consumes — the
summary→detail contract from `MCP_DESIGN.md:57-71`.

---

## 6. StructuralExtractor (Phase 2)

New module `server/structure.py` — keeps `chess_mcp.py` tool-only and makes the
extractor unit-testable without an engine.

Primitives (all `(board, color) -> list[str]` of square names, except chains):

- `get_doubled_pawns(board, color) -> list[str]`
- `get_isolated_pawns(board, color) -> list[str]`
- `get_passed_pawns(board, color) -> list[str]`
- `get_pawn_chains(board, color) -> list[list[str]]`
- `get_half_open_files(board, color) -> list[str]`

Macro-classifier:

- `classify_structure(board) -> dict` → `{structure_class, confidence}` where
  `structure_class ∈ {IQP, Carlsbad, Maroczy, unknown}` at the time of this doc (D2). Rule-based
  pattern match on the primitives; never forces a label — weak match → `unknown` with low
  confidence. **The set has since grown to 19 source-traced structures with graded core+bonus
  confidence, plus an always-on `themes(board, color)` descriptor block; see
  `STRUCTURE_CLASSIFIER_DESIGN.md` for the current canon and provenance.**

JSON output (consumed by `get_structural_profile`):

```json
{
  "structure_class": "IQP",
  "confidence": 0.9,
  "primitives": {
    "doubled": ["c2", "c3"],
    "isolated": ["d4"],
    "passed": [],
    "chains": [["e5", "f6"]]
  },
  "half_open_files": ["c"],
  "open_files": ["e"]
}
```

Implementation uses bitboards / `chess.SquareSet`, never per-square Python loops where a
mask works. Nesting stays ≤ 2 levels (`MCP_DESIGN.md:120`).

---

## 7. Variation walker (Phase 1 foundation)

The missing infrastructure everything else needs.

- `walk_leaves(game) -> Iterator[node]` — yield every leaf (variation end).
- `iter_nodes(game) -> Iterator[node]` — pre-order over the whole tree.
- `resolve_path(game, variation_path: list[str]) -> node | None` — follow a SAN route
  ply-by-ply (`parse_san` at each node, descend the matching child); `None` → caller
  returns `variation_path_not_found`.
- `tree_stats(game) -> (nodes, leaves, max_depth)` — for the `load_repertoire` summary.

Tested standalone (engine-free) against a small branching PGN fixture before any tool
wires it in.

---

## 8. Build order

1. Variation walker + SAN `resolve_path` resolver + tests *(foundation — gap #1)*
2. `load_repertoire` + bounded LRU/TTL cache + caps + new error codes
3. `StructuralExtractor` primitives + `classify_structure` (narrow + confidence)
4. `get_structural_profile` (single-node + aggregate)
5. `analyze_repertoire_congruence` (engine-free, capped summary→detail)
6. `suggest_complementary_lines` (engine, both modes)
7. `evals/` snapshots + token measurement for each new tool; update README + CONTEXT

Steps 1–3 are the core requested deliverable (walker + `load_repertoire` +
`StructuralExtractor`).

---

# Part II — Single-session edit loop + thematic-cluster congruence

Two linked goals layered on the shipped base (sections 1–8):

1. **Single-session repertoire-editing loop.** Load → mutate via MCP → re-analyze the
   mutated tree instantly → repeat → export the final PGN — all inside one session, no
   re-download, no fresh session. The net-new surface is *only* mutation + export (the
   handle cache, walker, and every read tool already exist and work on any cached tree).
2. **Thematic-cluster congruence.** Re-key `analyze_congruence`'s grouping so transposing
   systems cluster as one and distinct systems under one first move don't dilute. The
   per-group machinery (`_checks_for`) and transposition-awareness already exist; only the
   grouping key at `repertoire.py:639-641` (`d["path"][0]`) is replaced.

Companion contract rules unchanged: plain-dict returns, `Literal` inputs, closed
`{"error","reason"}` codes, ~2k-token outputs, one-job-one-tool, summary→detail with the
handle the next tool needs. The agent NEVER authors a chess line/FEN/PGN — every position,
move, and edit is server-produced; the agent only passes back paths/SAN the MCP surfaced.

---

## 9. Phase 1 — Mutation + export API

### 9.1 The model: pure clone-on-write (Decision M1)

**Decision M1 — a mutation is a pure handle function: clone → edit clone → cache clone →
return a NEW `repertoire_id`. The source id still resolves to the unmodified tree.**

Recommended. Why:
- It preserves the shipped contract verbatim — *each handle = one immutable tree*, every
  tool a pure function of `(repertoire_id, args)` (section 1, `MCP_DESIGN.md:72-79`). A
  mutation does not change what an existing id means; it mints a new id, exactly as
  `load_repertoire` does for a new PGN.
- It is the cheapest possible add: `store_repertoire(game, color)` already mints a fresh
  UUID + stats from *any* game (`repertoire.py:272-287`). Clone-on-write reuses it as-is.
- It gives the user branch/compare for free: hold both the pre- and post-edit ids and run
  any read tool on each. A re-run of the same `(id, edit)` yields a structurally identical
  tree (a new id each time — these are **action tools**, labelled as such per
  `MCP_DESIGN.md:85-87`; the value is a handle, so a fresh id is correct, not a violation).

Clone mechanism: **`copy.deepcopy(game)`** (verified: produces a fully independent tree —
mutating the clone leaves the source's node count unchanged — and round-trips through
`str(game)` → re-parse with NAGs and comments intact; `promote_to_main` exists for reorder).
Deep-copy is O(tree) and the cache is bounded (≤16 trees, LRU), so cost is negligible.
Rejected alternative: serialize-to-PGN-then-reparse (slower per edit, and PGN export is the
one place that *can* lose exotic annotations); rejected: in-place mutation of the cached tree
(breaks immutability + branch/compare, makes a live id's meaning call-order-dependent = the
"state between calls" anti-pattern).

### 9.2 Tool surface: one `modify_repertoire_line` (Decision M2)

**Decision M2 — ONE action tool `modify_repertoire_line(repertoire_id, path, action, …)`
with a closed `action` enum, over three separate tools.**

Recommended. Why: the job is one thing — *structurally edit a line at a path* — with closed
variants (`prune`/`add`/`reorder`), which is the "Enum > free strings" case, not the "and
also" god-tool case. One tool means one clone→edit→store code path, one set of error
branches, and fewer descriptions in the always-re-read `tools/list` (descriptions are
routing logic paid every call — `MCP_DESIGN.md:242`). Payloads are action-specific but
**typed and named** (no free-form `dict`): `add_moves: list[str] | None` and
`promote_move: str | None`. The wrapper validates action↔payload agreement and returns a
structured error on mismatch.

Alternative (rejected for v1): three tools `prune_repertoire_line` / `add_repertoire_line` /
`reorder_repertoire_line` — tighter per-tool signatures (no unused params) but 3 descriptions
vs 1 and 90% duplicated bodies. Revisit only if a single action grows enough unique params to
strain the shared signature.

### 9.3 `path` semantics per action (Decision M3)

`path` is a SAN route (Decision D3) addressing the **anchor node** the action operates on:

| action | `path` addresses | payload | effect |
|--------|------------------|---------|--------|
| `prune` | the node to remove | — | detach that node + its subtree from its parent |
| `add` | the node to graft **under** | `add_moves` (SAN list) | extend with new plies below the anchor, **merging** into an existing child when the move already exists (mirrors `_merge_into`, so no duplicate siblings) |
| `reorder` | the parent whose children reorder | `promote_move` (one SAN) | `promote_to_main` the child playing `promote_move` → it becomes `variations[0]` (the recommended mainline) |

- `prune` requires a non-empty `path` (the root cannot be pruned → `invalid_edit`). Pruning
  the only child of the root yields a legal empty tree.
- `add` and `reorder` accept `path = []` (the root): grafting a new first move, or
  reordering which first move is the recommended mainline.
- `add` validates every ply server-side: an illegal/unparseable SAN at its position →
  `invalid_line` (the model re-derives from `get_legal_moves`); `add_moves` is capped at
  `MAX_LINE_MOVES` → `too_many_moves`; empty `add_moves` → `invalid_edit`.
- `reorder` with a `promote_move` that is not a child at `path` → `variation_not_found`;
  missing `promote_move` → `invalid_edit`.
- All chess validation is the server's. The agent passes only paths + SAN the MCP itself
  surfaced from a prior tool call.

### 9.4 Export: return-string (Decision E1) and shape (Decision E2)

**Decision E1 — `export_repertoire(repertoire_id) -> {pgn, …}` returns the PGN *string*;
the agent persists it with the Write tool.** Recommended. The server runs as Docker stdio
(and SSE) with no safe, portable handle to the host filesystem; a bind-mount write path is
environment-specific and an arbitrary-host-write footgun on the unauthenticated LAN port.
Returning the string mirrors the shipped `export_annotated_pgn` precedent — the one
sanctioned **artifact** output (`MCP_DESIGN.md:236`). `export_repertoire` is the second:
it is an artifact, not a reasoning primitive, so it may exceed the ~2k-token budget for a
large tree (bounded by `MAX_REPERTOIRE_BYTES`). The skill (Phase 3) MUST write the `pgn`
field straight to disk and never echo it into reasoning/prose — that keeps the loop's
context cost tiny (the whole point: exchange paths/actions + compact reports, never raw PGN).
Rejected: bind-mount write (server cannot safely manage host filesystem; Docker containers have no portable host-path binding).

**Decision E2 — export shape: one merged `[Event]` (E2a, SIGNED OFF).** `load_repertoire`
merges a multi-game export into one variation forest under `games[0]`'s root/headers
(`merge_games`), discarding `games[1:]` headers. Export emits **one `[Event]`** holding the
whole merged tree (via `str(game)`): simplest, and an exact tree round-trip through
`load_repertoire` (re-merge is idempotent). Documented caveat: a multi-chapter source (e.g.
the 4-`[Event]` Black export) returns as a single `[Event]` with the openings as first-move
variations — the user's cloud site re-imports it as one study, not N.

Rejected alternative E2b (one `[Event]` per root child / opponent first move): reproduces the
source event count and still round-trips, but adds code and cannot recover the original
per-event header *text* (lost at merge). Revisit if the single-study re-import proves painful.

### 9.5 Signatures

```python
@mcp.tool()  # ACTION — returns a NEW repertoire_id; the source id is unchanged
def modify_repertoire_line(
    repertoire_id: str,
    path: list[str],
    action: Literal["prune", "add", "reorder"],
    add_moves: list[str] | None = None,      # action="add": SAN plies to graft under `path`
    promote_move: str | None = None,         # action="reorder": SAN child to make mainline
) -> dict:
    """Edit one line and return a NEW repertoire_id for the modified tree (the source
    repertoire_id keeps resolving to the unmodified tree — branch/compare freely).
    … prune/add/reorder semantics (§9.3) … every read tool works on the new id immediately.
    → {new_repertoire_id, action, nodes, leaves, max_depth, summary}
    errors: repertoire_not_found, variation_not_found, invalid_line, invalid_edit, too_many_moves
    """

@mcp.tool()  # read-only artifact output (the second, after export_annotated_pgn)
def export_repertoire(repertoire_id: str) -> dict:
    """Serialize the cached tree back to a multi-variation PGN string for the agent to
    Write to disk at session end. → {pgn, nodes, leaves, max_depth, games}
    errors: repertoire_not_found"""
```

`summary` is a one-line human-readable diff ("pruned subtree at `d4 d5 c4` → −12 nodes, −4
leaves"), built from the new-minus-old tree stats. `games` = `[Event]` blocks emitted (E2a:
always 1). Both return shapes are tiny except `export_repertoire.pgn` (the artifact).

### 9.6 Where the code lives

Tool wrappers (`@mcp.tool`) in `chess_mcp.py`; pure clone/edit helpers in `repertoire.py`
(beside the walker + cache + `_merge_into` they reuse). Matches the shipped split exactly
(`analyze_congruence` logic in `repertoire.py`, thin wrapper in `chess_mcp.py`). New
helpers: `clone_game`, `apply_repertoire_edit(game, action, path, add_moves, promote_move)
-> tuple[game | None, error_code | None]` dispatching to `_prune` / `_add` / `_reorder`.

---

## 10. Phase 2 — Re-key congruence clustering

Keep `_checks_for` and the per-group execution verbatim. Replace **only** the grouping key
at `repertoire.py:639-641`.

### 10.1 Cluster by opening SYSTEM, not by structure (Decision C1)

**Decision C1 — the cluster key is the opening *system* (move-order-robust), NOT the leaf's
`structure_class`.** This is the load-bearing decision and it reinterprets the Phase-2
"split by distinct structures" wording, so it leads here with its reasoning:

The three checks all want the same grain — *lines that should share a plan* — and then they
flag the ones that don't. `structure_outlier` (check #1) specifically finds the leaf whose
`structure_class` deviates from its siblings' dominant structure. **If the cluster key were
`structure_class`, every cluster would be structurally homogeneous and check #1 could never
fire** — and worse, the deviating leaves (e.g. a Black system that mostly reaches a King's
Indian but where one line reaches something else) would land in a *separate* cluster, which
is exactly the per-system inconsistency the user wants *surfaced*, now *hidden*. So the
"distinct canonical structures" the user wants split are realized as check #1 **flags within
a system**, not as silent separate clusters.

The system identity must be move-order-robust (to fix the Black shatter: 1.d4 / 1.Nf3 / 1.c4
into the same setup) and granular enough that a big family (Sicilian, English) isn't one
diluted blob. The anchor that satisfies both is the **named opening** from
`openings.deepest_to_node(leaf)` — it keys on position (EPD), so transposing move orders that
reach the same named position get the same key automatically (this is the `_position_key`
convergence the brief calls for, obtained for free — no parallel DAG, no union-find).

### 10.2 Family granularity = name up to the first comma (Decision C2)

**Decision C2 — cluster label = the opening name truncated at the first comma** (e.g.
`"Sicilian Defense: Najdorf Variation, English Attack"` → `"Sicilian Defense: Najdorf
Variation"`). Recommended: this is variation-level grain — it *splits* Najdorf vs Dragon vs
Sveshnikov (so a multi-system Sicilian doesn't over-merge into one blob that false-flags its
minority systems, the #21 hazard) while *merging* sub-variations and move-order transpositions
within a variation (fixing shatter). Coarser (family before `:`, e.g. all "Sicilian Defense")
over-merges distinct systems; finer (full name) re-shatters into thin sub-sub-variation
groups. The existing dominance gates in `_checks_for` (`dom_share >= 0.5`, `_THEME_DOMINANCE
= 0.66`) remain the backstop against over-flagging a structurally bimodal cluster.

### 10.3 Fallback chain for unnamed leaves (Decision C3)

`openings.deepest_to_node` returns the deepest *named ancestor*, so most leaves are named.
For the remainder, prefer structural convergence over move order (the brief's instruction):

```
_cluster_key(leaf_node, color):
  op = openings.deepest_to_node(leaf_node)
  if op:               return ("opening", op["name"].split(",")[0].strip())
  sc = classify_structure(leaf_node.board())["structure_class"]
  if sc != "unknown":  return ("structure", sc)            # converge transpositions structurally
  th = dominant single bool-theme tag at the leaf, if any
  if th:               return ("theme", th)
  return ("move", path[0] if path else "")                 # last resort = the shipped key
```

The theme-fallback branch already inside `_checks_for` (`:549-581`) then runs **per cluster**
(it is invoked per group), so a mostly-`unknown` cluster (fianchetto English) is judged on its
dominant bool theme, as today — just now per *system* instead of per first move.

### 10.4 Output (Decision C4)

Each incongruency gains a `cluster` field (its system label); the result gains a top-level
`clusters: {label: leaf_count}` so the user sees the partition and the regression test can pin
it. Both are cheap (a handful of clusters). Everything else in the return shape is unchanged;
baselines (outlier/weakness/center) are computed **per cluster**, relative to that cluster's
grain, with each flag carrying its `variation_path(s)` as today.

`repertoire.py` gains `import openings` (no cycle: `openings.py` imports only `chess`,
`functools`, `pathlib`). Per-leaf `deepest_to_node` over a deep tree is hundreds of cached EPD
lookups — engine-free, sub-millisecond.

### 10.5 Validation

Run on `ct-white-repertoire.pgn` (1 event, English) and `ct-black-repertoire.pgn` (4 events):
White stays as informative or better (its English megagroup splits into per-system clusters);
Black surfaces per-system inconsistencies it currently hides. A regression test pins the new
Black clustering (cluster count + labels + that ≥1 per-system flag now appears where the
single-ply key produced none).

---

## 11. Phase 3 — Wire the loop into the skill

Update `repertoire-builder/SKILL.md` and the Repertoire Analysis Loop in
`ENGINEERING_PASSES.md` so the documented workflow IS the single-session edit loop:

```
validate_pgn → load_repertoire(pgn,color)=id0
  → get_structural_profile / analyze_repertoire_congruence(id0)  [clustered]
  → modify_repertoire_line(id0, path, action, …) = id1   (paths/actions only — never PGN)
  → re-run the read tools on id1 … iterate id1→id2→… branching/comparing ids as needed
  → export_repertoire(idN).pgn → Write to disk  (do NOT echo the PGN)
```

Make explicit (it already is the grounding contract, reinforced for mutation): the agent
orchestrates purely with paths + actions + SAN the MCP surfaced, and the ONLY chess content
it ever writes to disk is the `pgn` string `export_repertoire` returned — it never authors,
edits, or hand-writes a line/FEN/variation.

---

## 12. Part II — Decision Log, caps, error codes, build order

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| M1 | Mutation model | **Pure clone-on-write → new id** | Preserves the immutable-handle contract; reuses `store_repertoire`; enables branch/compare. `copy.deepcopy` (verified independent + round-trips with NAGs/comments). |
| M2 | Tool surface | **One `modify_repertoire_line` + `action` enum** | One job (edit a line), closed variants; one code path; fewer `tools/list` tokens. |
| M3 | `path` + payload | **`path`=anchor node; typed `add_moves` / `promote_move`** | Strong-typed payloads (no free dict); per-action validation → closed errors. |
| E1 | Export mechanism | **Return PGN string; agent Writes it** | Docker stdio can't safely write host disk; mirrors `export_annotated_pgn` artifact precedent. |
| E2 | Export shape | **one merged `[Event]` (E2a)** | Round-trip-exact + simplest; multi-chapter source re-imports as one study (documented caveat). |
| C1 | Cluster grain | **Opening system, NOT `structure_class`** | Structure-keying disables check #1 and hides the per-system outliers the user wants surfaced; system-keying surfaces them as flags. |
| C2 | Family granularity | **Name up to first comma (variation-level)** | Splits multi-system families (no #21 over-flag); merges sub-variations + transpositions (fixes shatter). |
| C3 | Unnamed-leaf fallback | **opening → structure → theme → first-move** | Structural convergence over move order; first-move only as last resort (the shipped key). |
| C4 | Output | **`cluster` per flag + `clusters` rollup** | User sees the partition; pins the regression test. |

New caps: none (reuse `MAX_LINE_MOVES`, `MAX_REPERTOIRE_BYTES`).

Closed error-code set grows by **two** (added to `MCP_DESIGN.md` / `CONTEXT.md`):
`invalid_line` (a SAN in `add_moves` is illegal at its ply), `invalid_edit` (the
action/payload request is malformed — empty `add_moves`, missing/garbage `promote_move`,
prune of root, bad `action`). Reused: `repertoire_not_found`, `variation_not_found`,
`too_many_moves`.

Build order (tests + evals at each step):
1. `repertoire.py` clone/edit helpers + `analyze_congruence` re-key (engine-free) + unit tests.
2. `modify_repertoire_line` + `export_repertoire` wrappers + tool tests (round-trip, errors,
   mutated-id works with every read tool).
3. Validate clustering on the two real repertoires; pin the Black regression test.
4. Skill + loop doc; update `CONTEXT.md` / `MCP_DESIGN.md` / `README.md` error-codes + tool
   count (18 → 20); regenerate `evals/` snapshots in Docker; measure the two new outputs.

---

## 13. Forward-transposition gap suppression

### Problem

`find_repertoire_gaps` flags an opponent move `M` at an opponent-to-move node `N` when
`M ∉ covered(N)` and the engine rates `M` strong. Existing transposition-awareness
(`opponent_reply_nodes`, issue #3) is **backward / at-node**: it dedups `N` nodes reached by
several move orders and *unions* their `covered` sets. It does **not** look forward — so when
the opponent reaches a prepared position by a *different move order one or more plies later*,
the move that gets there is flagged as a phantom gap.

Observed on the Black repertoire (ground-truth run, 208 raw gaps): the Caro Advance mainline is
`…3.e5 Bf5 4.Nf3 e6 5.Be2 Nd7 6.O-O Ne7 7.c3`. The gap finder flags `5.c3` (eval +36, medium)
because at ply 5 only `Be2` is a child of `N` — even though `5.c3 … 6.Be2 7.O-O` simply
transposes into the same tabiya the mainline reaches at move 7. Pure move-order noise.

### Insight (cost-free signal)

The engine pass at `N` is already `multipv`, and **each `info["pv"]` is the full principal
variation starting with the candidate move `M`** — the engine's best line for *both* sides after
`M`. We do not need a second engine call: walk that PV and ask whether it re-enters prepared
territory.

### Mechanism

- `repertoire.continued_position_keys(game) -> {position_key: san_path}` — every **interior**
  tree node (`node.variations` non-empty), i.e. a position where the repertoire *continues*.
  Keyed by `_position_key` (placement+turn+castling+ep — the same exact-position identity the
  rest of the tooling uses; collisions are real transpositions, never accidental). Shallowest
  path wins as the human-readable label.
- `repertoire.pv_rejoins_prep(board, pv, continued_keys, max_plies=_FWD_TRANSP_PLIES)` — copy
  `board` (the gap position), push PV moves one at a time (≤ `max_plies`), and return the first
  `continued_keys` path whose position the line transposes into, else `None`. Engine-free, pure.
- `_gaps_from_infos` takes an optional `continued_keys`; when given, a gap whose PV rejoins prep
  gets `transposes_to = <rejoined path>`. `find_repertoire_gaps` partitions: rejoining gaps are
  **removed from `gaps`** (and `total_gaps`) and reported under a new
  `forward_transpositions: [{path, move, transposes_to}]` (capped at `limit`) so suppression is
  transparent, never silent. `transposition_endpoints` (backward dedup) is unchanged.

### Soundness & limits

A key match means the *exact* position is in the tree with a continuation — so the destination
is genuinely prepared. The **heuristic** part: the bridging moves the engine PV plays to get
there may not yet be nodes in the tree, and the PV is the engine's single best line (the
opponent could deviate from it). So suppression means "a sound line transposes back into your
prep within `max_plies`," not "every continuation is memorised." `forward_transpositions` exists
precisely so the user can inspect and, if desired, graft the connector via
`modify_repertoire_line`. Conservative by construction: a short PV or no rejoin keeps the gap.

### Decision log

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| F1 | Where to get the forward line | **Reuse `info["pv"]` from the existing multipv pass** | Zero extra engine cost; the PV is the engine's critical line after `M`. |
| F2 | Rejoin target set | **Interior nodes only (`continued_keys`)** | Rejoining a frontier/dangling leaf is not coverage; an interior node is where prep continues. |
| F3 | Suppress vs demote | **Suppress from `gaps`, list under `forward_transpositions`** | Directly kills move-order noise (the ask) while staying inspectable — mirrors `transposition_endpoints` transparency. |
| F4 | Lookahead depth | **`_FWD_TRANSP_PLIES = 12`** | Covers multi-move transpositions (the Caro case rejoins ~ply 6) while bounded; longer PVs are simply truncated. |
| F5 | New param? | **No toggle — always on** | Tight contract (AGENTS.md); the `forward_transpositions` list is the escape hatch, not a flag. |

Build order: (1) `continued_position_keys` + `pv_rejoins_prep` + unit tests (engine-free);
(2) thread `continued_keys` through `_gaps_from_infos` + partition in `find_repertoire_gaps` +
docstring; (3) Docker: re-run gap finder on the Black repertoire, confirm move-order gaps move
to `forward_transpositions`; regenerate `evals/` snapshot.
