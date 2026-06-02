# Session Context

Enough context to resume work on this project in a new session.

## What this is

MCP server that grounds AI chess game review with real Stockfish analysis. Built because AI agents hallucinate illegal moves and bogus lines when reviewing games — not from lack of chess knowledge but from having no legal move validator or engine at analysis time.

## Key decisions

**Why build own instead of existing repos:**
- `jiayao/mcp-chess` — no engine eval, only move validation + board viz for interactive play
- `sonirico/mcp-stockfish` — raw UCI passthrough (Go), local-only, agent must speak UCI manually
- Building own with `python-chess` gives high-level tools suited for game review, not just raw UCI

**Why Docker:**
- Stockfish + deps bundled, no host install needed
- Base image: `ghcr.io/astral-sh/uv:python3.14-trixie-slim` (uv + Python 3.14 + Debian trixie-slim)
- Stockfish installed via apt; installs to `/usr/games/stockfish` on Debian — set via `STOCKFISH_PATH` in compose.yml
- `FASTMCP_HOST`/`FASTMCP_PORT` passed to FastMCP constructor (not `mcp.run()` — ignored there)

**Why python-chess + FastMCP:**
- `python-chess` is the best chess library available — handles PGN, FEN, legal moves, Stockfish subprocess
- FastMCP (part of official `mcp` package) gives SSE transport with minimal boilerplate
- uv for package management

**No Co-Authored-By in commits** — user preference.

## Current state

All six tools implemented, containerized, tested end-to-end against real Chess.com games. Fully working.

**Repo:** https://github.com/Azeajr/chess-mcp

## Files

| File | Purpose |
|------|---------|
| `server/chess_mcp.py` | All six MCP tools, FastMCP SSE server |
| `server/pyproject.toml` | uv project, deps: `mcp[cli]`, `chess`, Python 3.14 |
| `server/Dockerfile` | Container: uv+Python3.14 base, apt stockfish, uv sync |
| `compose.yml` | Docker Compose: port 8000, env vars |
| `.mcp.json` | Claude Code MCP config: SSE at localhost:8000 |

## Tool signatures

```python
get_game_summary(pgn: str, depth: int = 18) -> dict
# Returns: opening, total_moves,
#          white/black: {blunders, mistakes, inaccuracies, good_moves, accuracy_pct},
#          worst_moves: [{move_number, color, move, cp_loss, classification, best_move}]
# On bad input: {error, reason}

analyze_game(pgn: str, depth: int = 18, min_cp_loss: int = 50, verbose: bool = False) -> list[dict] | dict
# Returns moves where cp_loss >= min_cp_loss (default: inaccuracies and worse)
# Lean (default) per move: move_number, color, move, cp_loss, classification, best_move
# verbose=True adds: eval_after, best_pv
# alternatives + per-move FEN moved to get_position (not returned here)
# On bad input: {error, reason}

get_position(pgn: str, move_number: int, color: str, depth: int = 18) -> dict
# Drill-down detail for one move; identify by move_number + color from summary/analyze
# Returns: fen (position with `color` to move), eval_cp, move_played,
#          best_move, best_pv, alternatives[{move, eval}]
# fen is the bridge to evaluate_position / validate_line / get_legal_moves
# On bad input / no such move: {error, reason}

evaluate_position(fen: str, depth: int = 18) -> dict
# Returns: score_cp, score_type, mate_in, best_move, pv, depth
# (dropped fen echo + best_move_uci vs old version)
# On invalid FEN: {error, reason}

validate_line(fen: str, moves: list[str]) -> dict
# moves: UCI or SAN strings
# Success: {valid: True, moves_validated, final_fen}
# Failure: {valid: False, error_at_index, error_move, reason, fen_at_error}
# On invalid FEN: {error, reason}

get_legal_moves(fen: str, uci: bool = False) -> dict
# Returns: turn, move_count, moves
# moves = space-separated SAN string (default); uci=True → [{uci, san}]
# On invalid FEN: {error, reason}
```

## Workflow pattern

Model calls `get_game_summary` first (small output, fast overview), then `analyze_game` for the filtered mistake list (`min_cp_loss=0` returns all moves), then `get_position(move_number, color)` to drill into a specific move. `get_position` returns that move's FEN, which feeds `evaluate_position` / `validate_line` / `get_legal_moves` — so the agent never reconstructs a FEN itself. All three game tools share one cached engine pass per `(pgn, depth)`.

## Deployment

```bash
docker compose up -d        # local, auto-connects via .mcp.json
docker compose up -d --build  # after code changes
```

For remote host, update `.mcp.json` URL to `http://<HOST_IP>:8000/sse`.

## Known design notes

- `python-chess` Stockfish wrapper opens engine as subprocess per analysis and holds it open for the full game — correct behavior, one engine instance per analysis.
- `eval` values are centipawns from white's POV. Mate → ±10000.
- `_analyse_all_moves` is the shared internal helper for `get_game_summary`, `analyze_game`, and `get_position`. It is `@lru_cache(maxsize=32)` keyed on `(pgn, depth, multipv)`; all three tools call it with the canonical `DEFAULT_MULTIPV=3`, so a summary→analyze→get_position sequence runs the engine **once** per `(pgn, depth)` instead of repeating the full pass. Cache is a transparent impl detail — the tool interface stays stateless/idempotent. Records are read-only (callers must not mutate them).
- Each record carries `fen` (position before the move, side-to-move = `color`) and `eval_before`, which is what `get_position` returns for the drill-down→engine bridge.
- Invalid/empty PGN: `python-chess` returns an empty `Game` (not `None`) for garbage text, so `_analyse_all_moves` also rejects zero-move games (`game.next() is None`) → structured `{error, reason}`.

## What's not done

(See README "Roadmap" for the canonical list.)

- [ ] Game handle to cut PGN re-sends — every tool re-sends the full PGN as input; a multi-step review re-sends the same text 3–4× (input-token cost). Consider `load_game(pgn) → game_id`. Engine recompute is already solved by the analysis cache; this is only the PGN *text* resend. Trade-off: adds session state vs strict statelessness.
- [ ] `time_limit` param — expose `Limit(time=N)` as alternative to depth
- [ ] Opening resource — serve ECO table as MCP resource so `get_game_summary` returns opening name even when PGN headers omit it
