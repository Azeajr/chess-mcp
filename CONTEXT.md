# Session Context

Enough context to resume work on this project in a new session.

## What this is

MCP server that grounds AI chess game review with real Stockfish analysis. Built because AI agents hallucinate illegal moves and bogus lines when reviewing games — not from lack of chess knowledge but from having no legal move validator or engine at analysis time.

## Physical setup

| Machine | Role | OS |
|---------|------|----|
| Mini PC (x86) | Runs Claude Code | (user's daily driver) |
| ODROID XU4 (ARM) | Dedicated analysis server | Arch Linux |

Intended deployment: XU4 runs the container, Claude Code on mini PC connects via SSE (`http://XU4_IP:8000/sse`). Currently running locally on mini PC for development.

## Key decisions made

**Why build own instead of existing repos:**
- `jiayao/mcp-chess` — no engine eval, only move validation + board viz for interactive play
- `sonirico/mcp-stockfish` — raw UCI passthrough (Go), local-only, agent must speak UCI manually
- Building own with `python-chess` gives high-level tools suited for game review, not just raw UCI

**Why MCP server on XU4 not mini PC:**
- XU4 is dedicated, always-on
- Keeps Stockfish off the mini PC
- Mini PC x86 would actually be faster but XU4 as dedicated box was user preference
- Container makes migration trivial if XU4 is too slow — stop there, start on mini PC, same image

**Why Docker:**
- Stockfish + deps bundled, no host install needed
- Same image runs on mini PC (x86) and XU4 (ARM) — build on target machine
- Base image: `ghcr.io/astral-sh/uv:python3.14-trixie-slim` (uv + Python 3.14 + Debian trixie-slim)
- Stockfish installed via apt (needs distro for shared lib deps)
- `FASTMCP_HOST`/`FASTMCP_PORT` passed to FastMCP constructor (not `mcp.run()` — ignored there)
- Stockfish on Debian installs to `/usr/games/stockfish`, not `/usr/bin/stockfish` — set via `STOCKFISH_PATH` in compose.yml

**Why python-chess + FastMCP:**
- `python-chess` is the best chess library available (any language) — handles PGN, FEN, legal moves, Stockfish subprocess
- FastMCP (now part of official `mcp` package) gives SSE transport with minimal boilerplate
- uv for package management (user preference)

**No Co-Authored-By in commits** — user preference.

## Current state

All four tools implemented, containerized, tested locally on mini PC, and wired to Claude Code. **Fully working end-to-end** — analyzed a real Chess.com game successfully (40-move game, per-move eval + classification returned correctly).

**Repo:** https://github.com/Azeajr/chess-mcp

## What's not done yet

- [ ] Deploy and test on XU4 (ARM build, uncomment `cpuset: "0-3"` in compose.yml for A15 cores; Stockfish path `/usr/games/stockfish` same on Debian ARM)
- [ ] Tune `ANALYSIS_DEPTH` — depth 18 on XU4 Cortex-A15 may be slow; consider `Limit(time=2.0)` per move
- [ ] Consider `multipv` option in `analyze_game` to show top N alternatives per move
- [ ] Add `get_game_summary` tool — aggregate blunder/mistake counts, accuracy %, worst moves

## Files

| File | Purpose |
|------|---------|
| `server/chess_mcp.py` | All four MCP tools, FastMCP SSE server |
| `server/pyproject.toml` | uv project, deps: `mcp[cli]>=1.27.2`, `chess>=1.11.2`, Python 3.14 |
| `server/Dockerfile` | Container: uv+Python3.14 base, apt stockfish, uv sync |
| `compose.yml` | Docker Compose: port 8000, ANALYSIS_DEPTH env, cpuset comment for XU4 |
| `server/.dockerignore` | Excludes systemd service, .venv, pycache |
| `.mcp.json` | Claude Code project MCP config: SSE at localhost:8000 |
| `server/chess-mcp.service` | systemd user service (pre-Docker, kept for reference) |
| `install.sh` | Arch Linux setup (pre-Docker, kept for reference) |

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

## Deployment

**Local (mini PC):**
```bash
docker compose up -d
```
Claude Code auto-connects via `.mcp.json` (`http://localhost:8000/sse`).

**XU4:**
```bash
git clone https://github.com/Azeajr/chess-mcp
docker compose up -d --build
```
Uncomment `cpuset: "0-3"` in `compose.yml` to pin Stockfish to A15 cores.
Update `.mcp.json` URL to `http://XU4_IP:8000/sse`.

## Potential issues to watch

- `python-chess` Stockfish wrapper opens engine as subprocess per call — fine for occasional queries, but `analyze_game` on a long game holds it open for the duration (correct behavior)
- XU4 has 8 cores (4× A15 + 4× A7 big.LITTLE) — Stockfish will use all A15 cores by default; `cpuset: "0-3"` in compose pins to A15 only
- depth 18 on Cortex-A15 may be 5-10s/move; full game analysis could take minutes — consider `Limit(time=2.0)` if UX is bad
