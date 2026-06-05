# Repertoire Analysis — Design Spec

Design for the Holistic Repertoire Analysis feature set: a stateful, thematic
repertoire analyzer layered on the existing stateless tactical tools.

Status: **implemented and shipped** (all four tools live; 81-test suite, CI green). This doc is the
design rationale of record; current state lives in `CONTEXT.md` / `README.md`. Build order at the bottom.

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
