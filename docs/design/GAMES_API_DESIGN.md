# Game-History API + Repertoire Cross-Reference Design

Goal: pull a user's real games from Lichess / Chess.com and answer "do I actually reach my
repertoire in practice, and where do I leave it?" Issue #25. Requirements:

- **R1 — fetch tools.** `lichess_games` and `chesscom_games` return a user's recent games
  (metadata always; full PGN on request) from the public APIs, no auth required.
- **R2 — cross-reference.** `repertoire_vs_history` compares a loaded repertoire against the
  user's played games: how often they reach prep, how deep, and the moves where they deviate.

Built on the #28 `apiclient` (rate-limited, offline-safe). Same hard constraint as #28: the
network is best-effort — every failure degrades to empty/`null`, never an exception, and the
engine/repertoire paths never depend on it (`project_stockfish_docker_only`).

---

## Current posture (what already holds)

- **`apiclient.py`** (from #28): `get_json` and `get_ndjson`, 1 req/s global limiter, offline-safe.
  No per-call headers yet (needed for Lichess NDJSON `Accept` and the optional token).
- **Repertoire handles**: every repertoire tool takes a `repertoire_id` from `load_repertoire`
  (`find_repertoire_gaps`, `get_structural_profile`, `coverage_report`, …). `get_repertoire(id)`
  → `_Repertoire{game, color}`.
- **Position identity**: `repertoire._position_key(board)` (placement+turn+castling+ep) is the
  transposition key already used across the module. Cross-referencing reuses it, so a game that
  reaches a prepared position by a different move order still counts as in-book.
- **Multi-game parsing**: `repertoire.merge_games` / `chess.pgn.read_game` already parse a
  multi-game PGN stream — the shape both fetch APIs return.
- **Token discipline**: lean list outputs are byte-budgeted (`_fit_to_budget`, `_MAX_LIST_CHARS`),
  and the proxy pattern (`PROXY_DESIGN.md`) exists precisely to keep big PGNs out of model context.

## Gaps this pass closes

| # | Gap | Req |
|---|-----|-----|
| G1 | No way to fetch a user's games; the user must export+paste manually. | R1 |
| G2 | `find_repertoire_gaps` / congruence work on the static tree only — no contact with reality. | R2 |
| G3 | `apiclient` can't send an `Accept` or `Authorization` header. | R1 |

---

## Decisions

### D1 — `repertoire_vs_history` takes a `repertoire_id`, not a `pgn_path`

The issue signature is `repertoire_vs_history(pgn_path, …)`. **Diverge: take `repertoire_id`**, like
every other repertoire tool. The analysis server never reads files — that is the host-side
`chess_files` proxy's job (`PROXY_DESIGN.md`), and PGNs enter via `load_repertoire`
(`feedback_mcp_owns_fen_pgn`). A path parameter would re-introduce file I/O into the engine server
and break the handle contract. The model (or the proxy) calls `load_repertoire` first, then passes
the id. *(A path-based convenience wrapper can be added to `chess_files` later, mirroring
`load_repertoire_from_file`.)*

### D2 — Fetch tools return metadata by default, PGN on request

```python
@mcp.tool()
def lichess_games(username: str, max_games: int = 20, opening_eco: str | None = None,
                  include_pgn: bool = False) -> dict: ...

@mcp.tool()
def chesscom_games(username: str, year: int, month: int,
                   opening_eco: str | None = None, include_pgn: bool = False) -> dict: ...
```

Each returns `{username, platform, count, games: [GameMeta], truncated}` where

```
GameMeta = {id|url, color (the user's), result ("win"|"loss"|"draw"),
            opponent, user_elo, opp_elo, time_class, eco, opening, n_plies,
            pgn?(only if include_pgn)}
```

**Why metadata-default:** 20–50 full PGNs is multiple KB of model context for no reason — the same
problem the proxy was built to avoid. The model gets a compact, byte-budgeted index
(`_fit_to_budget`) and pulls a specific game's PGN with `include_pgn=true` (or a single-game fetch)
only when it actually needs to analyze one. Diverges from the issue's "return PGN strings" in
*default*, not capability.

- **Lichess**: `GET https://lichess.org/api/games/user/{username}` with
  `max`, `pgnInJson=true`, `opening=true`, `clocks=false`, `evals=false`, `Accept: application/x-ndjson`
  → one JSON object per line (`apiclient.get_ndjson`). User color, result, ratings, `opening.eco`,
  and `pgn` all come from the object.
- **Chess.com**: `GET https://api.chess.com/pub/player/{username}/games/{year}/{month}` → `{games:[…]}`
  (`apiclient.get_json`). Each game has `pgn`, `white/black{username,rating,result}`, `time_class`,
  `eco` (a URL — parse the trailing code), `end_time`.
- **`opening_eco`**: client-side prefix filter on the parsed ECO (Lichess gives `opening.eco`;
  Chess.com via the `eco`/`ECOUrl` tail or the PGN `ECO` header). Lichess has no server-side ECO
  filter on the export, so filter after fetch; `max_games` bounds the *returned* count.
- **Color/result** are computed for the *user*: match `username` case-insensitively against the
  White/Black player; `result` is normalized to win/loss/draw from the user's side. A game where the
  username matches neither player is dropped (alias mismatch).

### D3 — `apiclient` gains optional headers + a Lichess token

Add a `headers: dict | None` param to `get_json`/`get_ndjson`. `lichess_games` sends
`Accept: application/x-ndjson`, and `Authorization: Bearer $LICHESS_TOKEN` when the env var is set
(unlocks private games + higher rate limits; unset → public games still work). Chess.com needs no
auth. Keeps the one HTTP surface in one module (reused again by #30).

### D4 — Cross-reference algorithm (`repertoire_vs_history`)

```python
@mcp.tool()
def repertoire_vs_history(repertoire_id: str, username: str, platform: str = "lichess",
                          max_games: int = 30, year: int | None = None,
                          month: int | None = None) -> dict: ...
```

Fetches the user's games (reusing D2 internally, `include_pgn` forced on; Chess.com needs
`year`/`month`), then for each game whose color matches the repertoire's `color`:

Precompute two engine-free maps from the tree (new helper `repertoire.player_move_map(rep)`):
- `rep_keys`: `{_position_key}` of every node — "is this position in the book?"
- `player_moves`: `{_position_key: {uci}}` for nodes where it's the player's turn — the prep's
  prescribed move(s) there.

Walk each game's mainline, tracking the board, while the current position is in `rep_keys`:
- **player to move**: if the played move ∈ `player_moves[key]` → in-book, go deeper; else record a
  **player deviation** `{fen, prescribed:[san], played:san}` and stop (left prep).
- **opponent to move**: if the next position stays in `rep_keys` → continue; else record an
  **uncovered opponent move** `{fen, played:san}` and stop (a real-world gap — ties to
  `find_repertoire_gaps`).

Aggregate (transposition-aware via the key, so move-order variants count):

```json
{
  "username": "...", "platform": "lichess", "color": "white",
  "games_total": 30, "games_matched_color": 16, "games_reached_prep": 14,
  "coverage_pct": 0.875,            // reached_prep / matched_color
  "avg_in_book_plies": 7.4,
  "player_deviations": [            // most frequent first, byte-budgeted
    {"fen": "...", "prescribed": ["Bg5"], "played": "Be2", "count": 5}
  ],
  "uncovered_opponent_moves": [
    {"fen": "...", "played": "Qb6", "count": 3}
  ]
}
```

`player_deviations` is the actionable output: the positions where the user most often abandons
their own prep — the drill list. `uncovered_opponent_moves` cross-checks `find_repertoire_gaps`
against what opponents *actually* played, not just what the engine fears.

### D5 — Network failure + Docker egress

Any fetch returning `None` (offline, 404 user-not-found, rate-limited) → fetch tools return
`{username, platform, count: 0, games: [], error: "fetch_failed"}`; `repertoire_vs_history` returns
`{..., error: "fetch_failed"}` with no partial analysis. Container needs egress for these tools;
without it they report the error and every other tool is unaffected.

---

## New / changed surface

| Item | Kind | Notes |
|------|------|-------|
| `lichess_games`, `chesscom_games`, `repertoire_vs_history` | new `@mcp.tool` | tool count 19→22 |
| `apiclient.get_json/get_ndjson` | edit | optional `headers` param |
| `repertoire.player_move_map(rep)` | new helper | engine-free; `{key: {uci}}` + key set |
| `repertoire_vs_history` internals | new | walk + aggregate (engine-free) |

## Out of scope / follow-ups

- **Path wrapper** in `chess_files` (`repertoire_vs_history_from_file`) mirroring the load proxy.
- **Pagination / since-until** windows for Lichess; v1 takes the most recent `max_games`.
- **Caching** fetched games (a games cache, distinct from the eval cache) — only if repeat calls
  become a cost.
- evals snapshot + README/version bump at release (tool count 19→22).

## Test plan (engine-free)

- **`player_move_map`**: a small repertoire → correct key set and `{key:{uci}}` for player nodes;
  a transposition maps both orders to one key.
- **Cross-reference** (synthetic games, no network — feed parsed `chess.pgn.Game` objects to the
  pure walk): a game following prep to a leaf → in-book, no deviation; a game diverging at ply 6 →
  one player deviation at the right fen; an opponent off-book move → one uncovered entry; a
  wrong-color game → dropped; transposed move order → still counted in-book.
- **Fetch parsing** (mocked `apiclient`): a Lichess NDJSON fixture → correct `GameMeta` (color,
  result, eco, ratings); a Chess.com JSON fixture → same; `opening_eco` filters; `include_pgn`
  toggles the pgn field; username matching neither player dropped.
- **Offline** (mocked `apiclient` → `None`): fetch tools return `count:0, error`;
  `repertoire_vs_history` returns `error`, no exception.
- All land in `server/test_tools.py` (`make test`); no engine, no live network.
