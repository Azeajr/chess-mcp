# Session Context

Enough context to resume work on this project in a new session.

## What this is

MCP server that grounds AI chess game review with real Stockfish analysis. Built because AI agents hallucinate illegal moves and bogus lines when reviewing games — not from lack of chess knowledge but from having no legal move validator or engine at analysis time.

## Physical setup

| Machine | Role | OS |
|---------|------|----|
| Mini PC (x86) | Runs Claude Code | (user's daily driver) |
| ODROID XU4 (ARM) | Dedicated analysis server | Arch Linux |

The XU4 runs the MCP server + Stockfish. Claude Code on the mini PC connects to it over LAN via SSE (`http://XU4_IP:8000/sse`).

## Key decisions made

**Why build own instead of existing repos:**
- `jiayao/mcp-chess` — no engine eval, only move validation + board viz for interactive play
- `sonirico/mcp-stockfish` — raw UCI passthrough (Go), local-only, agent must speak UCI manually
- Building own with `python-chess` gives high-level tools suited for game review, not just raw UCI

**Why MCP server on XU4 not mini PC:**
- XU4 is dedicated, always-on
- Keeps Stockfish off the mini PC
- Mini PC x86 would actually be faster but XU4 as dedicated box was user preference

**Why python-chess + FastMCP:**
- `python-chess` is the best chess library available (any language) — handles PGN, FEN, legal moves, Stockfish subprocess
- FastMCP gives SSE transport with minimal boilerplate
- uv for package management (user preference, rejected pip/requirements.txt)

**No Co-Authored-By in commits** — user preference.

## Current state

All four tools implemented and pushed to `main`. Not yet deployed or tested on XU4.

**Repo:** https://github.com/Azeajr/chess-mcp

## What's not done yet

- [ ] Test on actual XU4 (Arch, ARM Stockfish binary)
- [ ] Verify `mcp[cli]` SSE transport works with `FASTMCP_HOST`/`FASTMCP_PORT` env vars
- [ ] Test Claude Code connecting to XU4 MCP via `http://IP:8000/sse`
- [ ] Tune `ANALYSIS_DEPTH` — depth 18 on XU4 Cortex-A15 may be slow for full game analysis
- [ ] Consider `multipv` option in `analyze_game` to show top N alternatives per move
- [ ] Consider timeouts — `chess.engine.Limit(depth=18)` can be slow; `Limit(time=2.0)` per move might be better UX
- [ ] Add `get_game_summary` tool — aggregate blunder/mistake counts, accuracy %, worst moves

## Files

| File | Purpose |
|------|---------|
| `server/chess_mcp.py` | All four MCP tools, FastMCP SSE server |
| `server/pyproject.toml` | uv project, deps: `mcp[cli]`, `chess` |
| `server/chess-mcp.service` | systemd user service for autostart on XU4 |
| `install.sh` | Arch Linux setup: pacman stockfish + uv sync |

## Tool signatures

```python
analyze_game(pgn: str, depth: int = 18) -> list[dict]
# Returns per-move: move_number, color, move, move_uci, eval_before, eval_after,
#                   cp_loss, classification, best_move, best_move_uci, pv

evaluate_position(fen: str, depth: int = 18) -> dict
# Returns: fen, score_cp, best_move, best_move_uci, pv, depth

validate_line(fen: str, moves: list[str]) -> dict
# moves: UCI or SAN strings
# Returns: valid, error_at_index, error_move, reason, fen_at_error

get_legal_moves(fen: str) -> dict
# Returns: fen, turn, move_count, moves[{uci, san}]
```

## Potential issues to watch

- `python-chess` Stockfish wrapper opens engine as subprocess per call — fine for occasional queries, but `analyze_game` on a long game holds it open for the duration (correct behavior)
- XU4 has 8 cores (4× A15 + 4× A7 big.LITTLE) — Stockfish will use all A15 cores by default; may want to set `Threads` UCI option
- FastMCP SSE host/port env var names (`FASTMCP_HOST`, `FASTMCP_PORT`) — verify these are correct for the installed `mcp` package version; if not, may need to pass as kwargs to `mcp.run()`
