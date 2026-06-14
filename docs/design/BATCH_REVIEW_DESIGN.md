# Batch Review Tool Design

Goal: analyze multiple games and return aggregated statistics (win/draw/loss rates, avg centipawn loss, top blunder moves) grouped by opening classification. Issue #32.

Two user requirements drive this pass:

- **R1** — aggregate `get_game_summary`-style metrics across a bulk PGN export (Lichess, Chess.com)
  without re-running engine analysis on positions already cached (via #28 eval cache).
- **R2** — group results by opening (ECO, pawn structure, or inferred user color) so the user can
  answer "which opening do I blunder in most?" and "what's my win rate from the Sicilian?"

---

## Current posture (what already holds)

- **`get_game_summary` exists and returns per-game stats:** opening, total_moves, accuracy by side,
  worst_moves (top 3 by cp_loss).
- **Eval cache (#28) is warmed by engine analysis.** Identical opening positions share cached
  evals across separate PGN parses, making bulk analysis cheap on a warm cache.
- **Opening identification exists:** `identify_opening` returns ECO + name via `openings.py`.
  `structure.py` has `classify_structure` for pawn-structure grouping.
- **User-color inference exists:** `_user_color(game, username)` matches White/Black headers.
- **Multi-game parsing works:** `_parse_games` reads a repertoire export (one [Event] per opening)
  and returns all games; `repertoire.merge_games` merges them.
- **Result normalization exists:** `_user_result(result, color)` maps PGN Result to
  win|loss|draw from the user's perspective.

---

## Gaps this pass closes

| # | Gap | Req |
|---|-----|-----|
| G1 | No aggregation across multiple games — the user must call `get_game_summary` once per game and count/group manually. | R1 |
| G2 | No bulk grouping by opening — a tool to filter "all Sicilian games" or "all games with a closed pawn structure" doesn't exist. | R2 |
| G3 | No worst_group / best_group summary — which openings are the user's weakest/strongest?  | R2 |
| G4 | Streaming per-game results is not supported by the MCP contract (tools return once). | R1 (partial) |

---

## Decisions

### D1 — Input is a multi-game PGN string (not a filesystem path)

```python
def batch_review(
    pgn: str,
    group_by: Literal["eco", "structure", "color"] = "eco",
    username: str | None = None,
    max_games: int = 100,
    depth: int = DEFAULT_DEPTH,
    time_limit: float | None = None,
) -> dict:
```

The MCP owns FEN/PGN (feedback_mcp_owns_fen_pgn): the host-side proxy (`chess_files.py`) handles
file I/O and passes PGN *content* to the server, not paths. This matches the #25 games tools
(`lichess_games`, `chesscom_games`, `repertoire_vs_history`) which accept `pgn: str` and let
the caller parse them. A path parameter would require the Docker container to mount volumes or
infer host paths — out of scope and breaks the server's self-contained analysis model.

*Rejected:* `batch_review(pgn_path, …)` (requires host I/O in the container);
`batch_review(repertoire_id, …)` (a repertoire is a tree, not games; games have results).

### D2 — Grouping by three dimensions: ECO code, pawn structure, or user color

```python
group_by: Literal["eco", "structure", "color"] = "eco"
```

Each group key is deterministic and engine-free:

- **`"eco"`**: ECO prefix from `identify_opening(pgn)` (via `openings.py`). Groups by opening
  family (e.g., "B12" Caro-Kann, "C60" Italian). Coarse-grained, familiar to players.
- **`"structure"`**: Pawn-structure classification from `structure.classify_structure` at the game's
  final position. Groups by `structure_class` (e.g., "closed_sicilian", "fianchetto"). Thematic.
- **`"color"`**: Infer each game's user color from White/Black headers vs `username` arg, then group
  by user's color ("white" | "black"). Shows color-specific performance.

*Rejected:* `group_by` as a list (["eco", "structure"]) with nested groups (multi-dimensional).
Kept simple: one dimension per call, the user can call twice if needed.

### D3 — Pure aggregator function (engine-free, testable without Stockfish)

Factor out a pure function `_aggregate_games` that takes a list of per-game records and returns
grouped statistics:

```python
def _aggregate_games(
    records: list[dict],  # [{color, group_key, group_name, result, avg_cpl, blunders: [...]}]
    group_by: str,
) -> dict:
    """Aggregate per-game stats into groups: win rates, avg CPL, top blunders per group."""
    return {
        "total_games": ...,
        "groups": [
            {
                "key": "...",
                "name": "...",
                "games": N,
                "win_rate": 0.45,
                "draw_rate": 0.2,
                "loss_rate": 0.35,
                "avg_cpl": 42.5,
                "top_blunders": [
                    {"move": "...", "fen": "...", "frequency": N},
                    ...
                ]
            },
            ...
        ],
        "worst_group": {key, win_rate},  # lowest win rate
        "best_group": {key, win_rate},   # highest win rate
    }
```

The `@mcp.tool()` calls the (cached) `get_game_summary` per game to build per-game records, then
calls `_aggregate_games` to produce the result. This **decouples data fetching from aggregation**,
making the aggregation testable with synthetic data (no engine needed) and the data fetch
testable by mocking `get_game_summary`.

*Rejected:* Aggregation inline in the tool (hard to test without Stockfish); grouping at
parse time before building records (forces re-parsing for each group_by variant).

### D4 — Per-game record shape

Each game's record carries enough info to aggregate:

```python
{
    "pgn": str,                    # original PGN (needed to call get_game_summary)
    "result": str | None,          # "win" | "loss" | "draw" | None (inferred from headers)
    "user_color": str | None,      # "white" | "black" | None (from username match)
    "group_key": str,              # eco code, structure class, or color
    "group_name": str,             # human-readable (opening name, structure name, or "White"/"Black")
    "avg_cpl": float,              # centipawn loss per move (from worst_moves in summary)
    "blunders": [
        {"move": "...", "fen": "...", "classification": "blunder|mistake|inaccuracy"},
        ...
    ],
}
```

### D5 — Max games cap and PGN size limits

- `max_games`: default 100 (issue AC budget ~60s target for 100 games; with a ~100-position
  warm cache, 100 games → ~100–150 engine passes for new positions, ~0.5s/game on a warm cache).
- PGN byte cap: reuse `MAX_PGN_BYTES` (100 KB per constraint, already enforced by input tools).

*Rejected:* Per-group max_games (adds complexity; cap the total instead).

### D6 — Username is optional for color inference

```python
username: str | None = None
```

If `username` is None, **color-based grouping is disabled** (trying `group_by="color"` returns
an error), and all games are analyzed regardless of which side the user played. If provided,
only games where the user played (White or Black, determined by header match) are included in
the output. Win rates are computed from the user's perspective (using `_user_result`).

*Rejected:* Assuming the user always played White (insufficient for bulk-export analysis).

### D7 — Streaming is out of scope; return aggregate once

The issue mentions "streaming (one result per game as it completes)" as an acceptance criterion.
**MCP tools return once (no streaming).** An MCP server cannot return multiple payloads per
call — the protocol synchronously collects results. Streaming would require:
- A follow-up tool returning "next batch of games" (pagination), or
- A long-polling hook into the tool result (outside MCP), or
- Server-Sent Events (MCP transport option, but tools still return once per invocation).

**Decision: return the aggregate for all games in one dict.** If the client needs per-game
detail, it calls `get_game_summary` on individual PGNs. The aggregate is the value-add.

*Note to future work:* A `batch_review_stream` variant with SSE or pagination is feasible
but deferred (out of scope for this issue).

### D8 — Offline / Docker: works on local PGN + local Stockfish

No network calls. The eval cache (#28) and local Stockfish handle all analysis. Works in an
air-gapped container (DOCKER_ONLY).

---

## New / changed surface

| Item | Kind | Notes |
|------|------|-------|
| `batch_review` | new `@mcp.tool()` | Multi-game aggregation by opening/structure/color (tool count 19→20) |
| `_aggregate_games` | new pure function | Engine-free aggregator; testable without Stockfish |
| `_per_game_record` | new helper | Build a record from a game's summary + grouping |
| `server/test_tools.py` | edits | Unit tests for `_aggregate_games` with synthetic data; mock `get_game_summary` for the tool |

---

## Out of scope / follow-ups

- **Streaming per-game results.** MCP tools don't stream; tool returns once with the full
  aggregate. A `batch_review_stream` variant (pagination or SSE) is a follow-up.
- **Cloud-eval as a prefilter.** The issue mentions "skip Stockfish on common positions"
  via Lichess cloud eval. The #28 design (D5) defers cloud-as-prefilter. When the eval cache
  is warm, 100 games run in ~5–15s on modern hardware; cloud prefilt is a nice-to-have,
  not a blocker for this pass.
- **Transposition-aware grouping.** Games can transpose into different openings (e.g., a move
  order in the Closed Ruy Lopez that reaches an Italian Game position). Grouping at the final
  FEN instead of the opening header is a refinement — test that grouping is stable first.
- **Version bump + README tool list** at release.

---

## Test plan

### Engine-free tests (land in `server/test_tools.py`)

1. **`_aggregate_games` with synthetic records** (no engine):
   - Single group: win/draw/loss counts and rates are correct.
   - Multiple groups: each group's stats are computed independently.
   - Win rate = wins / (wins + losses + draws); same for draw/loss.
   - Avg CPL from blunder list (or from worst_moves if available) is correct.
   - Top blunders: ordered by frequency, limited to top N.
   - worst_group / best_group: identified correctly (lowest/highest win rate).
   - Empty groups (zero games): handled gracefully (win_rate = 0 or skipped).

2. **`batch_review` with mocked `get_game_summary`** (no engine):
   - Parse multi-game PGN (test `_parse_games` reuse).
   - `group_by="eco"`: games grouped by ECO code.
   - `group_by="structure"`: games grouped by final FEN's structure class.
   - `group_by="color"`: games grouped by user color (inferred from username).
   - `max_games` cap enforced (only first N games analyzed).
   - `username` match: games where user didn't play (header mismatch) excluded if username given.
   - Bad PGN → `{error, reason}`.
   - `pgn_too_large` error returned early.
   - Color-based grouping with `username=None` → error (or no filter, depending on design choice).

### Docker integration test (optional, needs Stockfish)

- 10–20 real games, warm eval cache: verify aggregation matches manual summaries.
- Warm vs. cold cache: wall-clock comparison (no assertion, log-only).

---

## Implementation notes

- **Call order:** Parse games → build per-game records (loop: `get_game_summary` per game) →
  `_aggregate_games` → return.
- **Error handling:** Invalid PGN, oversized input, unknown grouping mode → closed-set error
  codes (`invalid_pgn`, `pgn_too_large`, `invalid_group_by`).
- **Caching:** `get_game_summary` is already cached via #28. Repeated calls to `batch_review`
  on the same PGN hit the eval cache and are fast.
- **Budget:** Return dict capped by `_fit_to_budget` if needed (blunder lists can grow large
  in slow games). Worst/best groups are single dicts, not lists, so they don't overflow.
