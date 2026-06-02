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

All five tools implemented, containerized, tested end-to-end against real Chess.com games. Fully working.

**Repo:** https://github.com/Azeajr/chess-mcp

## Files

| File | Purpose |
|------|---------|
| `server/chess_mcp.py` | All five MCP tools, FastMCP SSE server |
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

analyze_game(pgn: str, depth: int = 18, min_cp_loss: int = 50, multipv: int = 3) -> list[dict]
# Returns moves where cp_loss >= min_cp_loss (default: inaccuracies and worse)
# Per move: move_number, color, move, cp_loss, classification, eval_after,
#           best_move, best_pv, alternatives[{move, eval}]

evaluate_position(fen: str, depth: int = 18) -> dict
# Returns: fen, score_cp, score_type, mate_in, best_move, best_move_uci, pv, depth

validate_line(fen: str, moves: list[str]) -> dict
# moves: UCI or SAN strings
# Returns: valid, error_at_index, error_move, reason, fen_at_error

get_legal_moves(fen: str) -> dict
# Returns: fen, turn, move_count, moves[{uci, san}]
```

## Workflow pattern

Model should call `get_game_summary` first (small output, fast overview), then call `analyze_game` to drill into specific moves. `min_cp_loss=0` returns all moves.

## Deployment

```bash
docker compose up -d        # local, auto-connects via .mcp.json
docker compose up -d --build  # after code changes
```

For remote host, update `.mcp.json` URL to `http://<HOST_IP>:8000/sse`.

## Known design notes

- `python-chess` Stockfish wrapper opens engine as subprocess per `analyze_game` call and holds it open for the full game — correct behavior, one engine instance per analysis.
- `eval` values are centipawns from white's POV. Mate → ±10000.
- `_analyse_all_moves` is a shared internal helper used by both `get_game_summary` and `analyze_game` to avoid running the engine twice.

## What's not done

- [ ] `time_limit` param — expose `Limit(time=N)` as alternative to depth
- [ ] Opening resource — serve ECO table as MCP resource so `get_game_summary` returns opening name even when PGN headers omit it
