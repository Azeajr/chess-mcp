# Tablebase Lookup Design

Goal: provide accurate WDL (win/draw/loss) and DTZ (distance to zero) for positions with ≤7 pieces.
Engine analysis degrades in deep endgames without a tablebase; a standalone tool + auto-integration
into `evaluate_position` closes this gap and provides clean endgame answers for study and analysis.

---

## Current posture (what already holds)

- **`evaluate_position` runs Stockfish on any FEN** — it returns score, best move, principal
  variation, and (with multipv>1) candidate moves. Engine is accurate for positions within its
  evaluation horizon but may misguide on tablebase-checkable endgames (e.g., KQK vs KRK, KBBK).
- **`apiclient.py` exists as a shared, rate-limited HTTP client** — D7 from CLOUD_EVAL_DESIGN.md
  already serves `cloud_eval` and is ready for reuse by tablebase and future tools (#25/#30).
  Offline-safe (any failure → `None`), 1 req/s limiter, already a dependency.
- **`_safe_board(fen)` gates FEN legality before engine calls** — reusable for tablebase as well.
- **Lichess tablebase API is public and unauthenticated** — `GET https://tablebase.lichess.ovh/standard?fen={fen}`,
  free, no auth token needed.

## Gaps this pass closes

| # | Gap | Req |
|---|-----|-----|
| G1 | No tool to query tablebases for endgame positions — engine evals in KQK/KBBK/etc. lack DTZ and exact WDL | R1 |
| G2 | `evaluate_position` does not detect/exploit positions where tablebase is available and more precise | R2 |
| G3 | No guard against calling tablebase for 8+ piece positions (cost, server limits) | R1 |
| G4 | Tool result shape not specified — what to return for tablebase data | R1 |

---

## Decisions

### D1 — Endpoint and response mapping

**Lichess Tablebase API:**  
`GET https://tablebase.lichess.ovh/standard?fen={fen}`

Returns (example for KQKR, white to move):
```json
{
  "fen": "8/8/8/8/8/k7/Q7/KR6 w - - 0 1",
  "category": "win",
  "dtz": 5,
  "precise_dtz": 5,
  "dtm": 30,
  "checkmate": false,
  "stalemate": false,
  "moves": [
    {
      "uci": "a2a3",
      "san": "Qa3",
      "category": "win",
      "dtz": 4,
      "precise_dtz": 4,
      "dtm": 29,
      "zeroing": true
    },
    ...
  ]
}
```

**Tool return shape** (TABLEBASE_LOOKUP returns):
```python
{
  "wdl": <int>,           # 2=win, 0=draw, -2=loss from side-to-move
  "dtz": <int>,           # distance to zero (moves until 50-move rule resets)
  "best_move": <str>,     # UCI string (e.g. "a2a3")
  "category": <str>,      # "win"|"draw"|"loss"|"cursed-win"|"blessed-loss"|etc
}
```

**WDL mapping** from category:
- `"win"` or `"cursed-win"` → `wdl=2` (winning for side to move, even if unreachable in 50 moves)
- `"draw"` or `"blessed-loss"` or any stalemate case → `wdl=0`
- `"loss"` → `wdl=-2` (losing for side to move)
- `"maybe-win"` / `"unknown"` → treat as `wdl=0` (can't assert win); include category verbatim so caller can see uncertainty

Keep `category` verbatim so the model/caller sees the nuance (cursed-win is still a win but unreachable
under the 50-move rule, blessed-loss is a loss but drawable via 50-move rule). WDL is the summary
for rapid classification; category is the full story.

*Rejected:* trying to suppress cursed-win (it's still a win, just unreachable in 50 moves; the model
should know this). Rejected: converting "maybe-win" to wdl=2 (it's uncertain, not proven).

### D2 — Piece-count gate (before network call)

Count pieces in the FEN placement field. If **≥8 pieces**, return an error WITHOUT calling the
network (AC requirement: saves bandwidth, fails fast):

```python
{
  "error": "too_many_pieces",
  "reason": "position exceeds 7-piece tablebase limit"
}
```

The Lichess tablebase only serves ≤7-piece positions; 8+ piece queries would either fail with a
5xx or waste bandwidth. This gate is a pre-flight check.

*Rejected:* querying the API and letting it fail (wastes 1 network slot per out-of-range query).

### D3 — Offline and not-found handling (offline-safe)

`apiclient.get_json(url, params)` returns `None` on ANY failure: connection error, timeout, non-200,
unparseable JSON. The tool treats `None` as "unavailable" and returns:

```python
{
  "error": "unavailable",
  "reason": "tablebase service unreachable or position not in database"
}
```

This keeps the tool **offline-safe** (project_stockfish_docker_only). A container with no egress
sees "unavailable," not a crash. The caller (and `evaluate_position` auto-integration) can then
fall back to Stockfish analysis without a hard dependency on Lichess.

*Rejected:* retrying, exponential backoff (apiclient already handles throttle; unnecessary); 
falling back to Stockfish inside tablebase_lookup (breaks the single-responsibility contract —
tablebase_lookup returns tablebase data, period).

### D4 — Auto-integration into evaluate_position

When `evaluate_position` is called with a FEN that has ≤7 pieces:

1. Parse the FEN to count pieces
2. If ≤7 pieces, call `tablebase_lookup(fen)` internally
3. If tablebase call succeeds (no error key), attach the result as `result["tablebase"] = {...}`
4. If tablebase call fails or is skipped, omit the `"tablebase"` key (no error leakage)
5. Return the augmented result (Stockfish evals + optional tablebase WDL/DTZ side-by-side)

This makes endgame positions **richer** without breaking the existing tool. The tablebase data is
clearly labeled so the model knows it's tablebase-derived. A Stockfish depth-18 eval is still
present and can be compared against the tablebase result (useful for study).

*Rejected:* replacing Stockfish eval with tablebase (loses the depth-18 engine analysis, which is
useful context). Rejected: calling tablebase conditionally based on eval score (too implicit;
the model might not realize when tablebase data is present).

### D5 — Shared HTTP client reuse

Use `apiclient.get_json()` verbatim (same module that serves `cloud_eval`, #25, #30). Zero net
new HTTP code. Rate limiter (1 req/s) covers all three tools transparently. Timeout and offline
behavior already tested in D7 of CLOUD_EVAL_DESIGN.md.

---

## New / changed surface

| Item | Kind | Notes |
|------|------|-------|
| `server/chess_mcp.py:tablebase_lookup(fen)` | new `@mcp.tool` | FEN → {wdl, dtz, best_move, category} or error |
| `server/chess_mcp.py:_count_pieces(fen)` | new helper | Parse FEN → piece count |
| `server/chess_mcp.py:evaluate_position` | edit | Add ≤7-piece check and tablebase auto-attach, keeping Stockfish eval intact |
| `server/test_tools.py` | edit | Unit tests for piece-count gate, known positions (KQK, KRK, KBBK), offline case, evaluate_position integration |
| (no new module) | — | Reuses existing `apiclient`, `_safe_board`, error code set |

---

## Out of scope / follow-ups

- **Syzygy 7-piece vs 6-piece optimization.** Lichess tablebase is fast; explicit tier
  selection (`--min-pieces 6`) not needed v1.
- **Caching tablebase results.** Position-keyed via `evalcache` would require a new tier
  (tablebase lookup is fast enough that SQLite overhead may not pay). Revisit if profiling
  shows repeated queries.
- **Variant endgames** (atomic, antichess, horde). Lichess /standard endpoint only. Out of scope.

## Test plan

**Engine-free, mocked HTTP:**

- **Known wins** (KQK, KRK, KBBK with white to move): verify `wdl=2`, correct `dtz`, `best_move`
  from top `moves[]` entry.
- **Known draws** (KRKB, stalemate case): verify `wdl=0`, correct `category`.
- **Piece-count gate**: an 8-piece FEN returns `{"error":"too_many_pieces"}` **without calling**
  `apiclient.get_json` (monkeypatch assertions verify the mock was not invoked).
- **Offline**: `apiclient.get_json → None` → `{"error":"unavailable"}`.
- **evaluate_position integration**: a ≤7-piece position returns both Stockfish eval AND
  `result["tablebase"]` (when tablebase succeeds); >7-piece position omits tablebase key.
- **WDL mapping**: "win"/"cursed-win" → 2, "draw"/"blessed-loss" → 0, "loss" → -2, "maybe-win" → 0.

All tests land in `server/test_tools.py` (engine-free, mocked HTTP).

---

## Rationale summary

- **D1 (endpoint mapping)** — Lichess public API is free, fast, and well-specified. WDL summary
  + category detail balances simplicity with the nuance (cursed-win, blessed-loss) needed for
  endgame study.
- **D2 (piece gate)** — Fails fast, saves bandwidth, is testable (mock never called).
- **D3 (offline-safe)** — Honors project_stockfish_docker_only: the engine path never depends on
  network; tablebase is a pure acceleration path, not a hard requirement.
- **D4 (auto-integration)** — Endgame positions in `evaluate_position` become richer (both Stockfish
  and tablebase context) without breaking the existing interface or hiding the data source.
- **D5 (apiclient reuse)** — One HTTP client, one rate limiter, zero code duplication across
  tools.
