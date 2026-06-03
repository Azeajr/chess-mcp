# chess-mcp

MCP server that gives AI agents (Claude Code, etc.) grounded chess analysis via Stockfish. Eliminates hallucinated moves and illegal lines by letting the agent validate positions and query the engine directly.

## Problem

AI agents reviewing chess games generate moves from pattern-matching, not board state. They have no legal move generator and no engine — so they invent plausible-looking but illegal or nonsensical lines. This MCP fixes that by giving the agent real tools to check its work before stating anything.

## Architecture

```
Claude Code
└── MCP client ──(SSE/HTTP)──► chess-mcp container (FastMCP + python-chess + Stockfish)
```

Runs in Docker on the same machine as Claude Code, or any reachable host over LAN. No relay or proxy needed.

## Tools

| Tool | Input | Output |
|------|-------|--------|
| `get_game_summary` | PGN, depth | Counts, accuracy %, worst 3 moves, opening — call this first |
| `analyze_game` | PGN, depth, min_cp_loss, verbose | Mistake list (cp_loss ≥ min_cp_loss): move, cp_loss, classification, best_move. `verbose=true` adds eval_after + best_pv |
| `get_position` | PGN, move_number, color, depth | One move's detail: FEN, eval, best_move, best_pv, alternatives — drill-down from summary/analyze |
| `evaluate_position` | FEN, depth, multipv | Centipawn score, best move, top line; `multipv>1` adds ranked `candidates` (top-N moves) |
| `validate_line` | FEN, moves[] | Valid bool, which move fails and why |
| `get_legal_moves` | FEN, uci | Legal moves as a SAN string; `uci=true` for a UCI+SAN list |

### Recommended workflow

1. Call `get_game_summary` — small output, gives counts and worst moves.
2. Call `analyze_game` — filtered to moves at or above `min_cp_loss` (default 50).
3. Call `get_position(pgn, move_number, color)` to drill into a specific move from the summary or analysis. It returns that position's **FEN**, so you can then run `evaluate_position` / `validate_line` / `get_legal_moves` on the exact position — the agent never has to reconstruct a FEN itself.

### Move classifications

| Label | CP loss |
|-------|---------|
| good | < 50 |
| inaccuracy | 50–100 |
| mistake | 100–200 |
| blunder | > 200 |

Scores are from white's perspective. Mate scores map to ±10000 cp.

## Skills (Claude Code)

`.claude/skills/` ships workflow skills that drive these tools — they load automatically in Claude
Code and keep every move/line engine-grounded:

| Skill | Use |
|-------|-----|
| `chess-game-review` | review a game (PGN): verdict, key mistakes, validated lines |
| `repertoire-builder` | develop / pressure-test an opening repertoire by color |
| `analyze-position` | single-FEN deep dive (puzzles, "best move here?") |
| `fetch-game` | pull a PGN from Lichess/Chess.com (no manual export) |
| `annotate-pgn` | emit an annotated PGN artifact (`?!`/`?`/`??` + comments) |

## Setup

### Prerequisites

- **Docker + Docker Compose** — runs the server (bundles Stockfish + Python deps; no host install).
- **Claude Code** (`claude` CLI) — the MCP client.
- **Host `python3`** — only for the `fetch-game` skill (Python stdlib, no `pip` installs).

### 1. Start the server

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose up -d          # builds the image (Stockfish + deps), serves SSE on :8000
```

`restart: unless-stopped` keeps it running across reboots. After pulling code changes, rebuild with
`docker compose up -d --build`.

### 2a. Use inside the repo (simplest)

Run Claude Code from the cloned directory:

```bash
claude
```

- Approve the project MCP server when prompted — `.mcp.json` registers `chess-analysis`; it shows
  `⏸ Pending approval` until you approve it once.
- The skills in `.claude/skills/` load automatically.

Works only when Claude Code runs **inside the repo directory**.

### 2b. Use from any directory (user scope)

Register the engine and skills globally instead, so they load in every Claude Code session:

```bash
# engine — all projects:
claude mcp add -s user -t sse chess-analysis http://localhost:8000/sse
# skills — all projects:
mkdir -p ~/.claude/skills && cp -r .claude/skills/* ~/.claude/skills/
```

### Remote host

Run the server on another machine and point the client at it (swap `localhost` → host IP):

```bash
claude mcp add -s user -t sse chess-analysis http://<HOST_IP>:8000/sse
```

For in-repo use instead, edit the URL in `.mcp.json`:

```json
{ "mcpServers": { "chess-analysis": { "type": "sse", "url": "http://<HOST_IP>:8000/sse" } } }
```

### Native (non-Docker, Arch)

Docker is the supported path. For a host install without containers — Stockfish via `pacman`, deps
via `uv` — run `./install.sh` (Arch-only native path), then follow its printed run command
(`uv run chess_mcp.py` from `server/`). The server binds `127.0.0.1` by default; set `FASTMCP_HOST`
to expose it.

### Verify

```bash
claude mcp get chess-analysis     # health-checks the connection
```

Or in Claude Code: ask it to run `get_legal_moves` on the starting position. Then paste a PGN and
invoke `chess-game-review`, or give your repertoire PGN + your color and invoke `repertoire-builder`.

## Configuration

Environment variables (set in `compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `FASTMCP_HOST` | `127.0.0.1` | Bind address. Docker image/compose set `0.0.0.0` so the published port is reachable |
| `FASTMCP_PORT` | `8000` | Listen port |
| `STOCKFISH_PATH` | `/usr/games/stockfish` | Engine binary (Debian path) |
| `ANALYSIS_DEPTH` | `18` | Default search depth (clamped to 1–30) |
| `MAX_PGN_BYTES` | `100000` | Reject PGN larger than this (per-call CPU/memory bound) |
| `MAX_LINE_MOVES` | `500` | Reject `validate_line` move lists longer than this |

> **Trust boundary.** The SSE endpoint has **no authentication**. The code default bind is `127.0.0.1` (local only); the Docker image/compose bind `0.0.0.0` so the published port works — only expose that port on a **trusted LAN, never the public internet**. The server runs Stockfish on caller-supplied PGN/FEN, so `MAX_PGN_BYTES`, `MAX_LINE_MOVES`, and the depth clamp (1–30) bound per-call work.

## Project layout

```
chess-mcp/
├── compose.yml              # Docker Compose: port 8000, env
├── .mcp.json                # Claude Code MCP config (SSE at localhost:8000)
├── .claude/skills/          # Claude Code workflow skills that drive the MCP tools
├── install.sh               # native (non-Docker) Arch install
├── sample-game.pgn          # anonymized fixture for evals
├── MCP_DESIGN.md            # design principles for this server
├── evals/                   # token-measurement harness
│   ├── capture.py           # capture real tool outputs (needs Stockfish → run in Docker)
│   ├── measure.py           # tiktoken token count, engine-free
│   └── snapshots/outputs.json
└── server/
    ├── chess_mcp.py         # All six MCP tools, FastMCP SSE server
    ├── pyproject.toml       # uv project + dependencies
    ├── Dockerfile           # uv+Python3.14 base, apt stockfish
    └── .dockerignore
```

## Dependencies

- [`mcp[cli]`](https://github.com/modelcontextprotocol/python-sdk) — FastMCP server + SSE transport
- [`chess`](https://github.com/niklasf/python-chess) — board state, PGN/FEN parsing, legal move generation, Stockfish subprocess wrapper

## Roadmap

- [ ] **Game handle — reduce PGN re-sends** — every tool call re-sends the full PGN as an input argument (stateless design). A multi-step review (`get_game_summary` → `analyze_game` → `get_position`) re-sends the same game text 3–4×, costing input tokens each time. Consider a `load_game(pgn) → game_id` handle that tools accept in place of `pgn`, trading strict statelessness for fewer input tokens. (Engine re-computation is already avoided via the in-process analysis cache; this addresses only the PGN *text* resend.)
- [ ] **`time_limit` param** — expose `Limit(time=N)` as alternative to depth; useful for slower hardware or faster iteration.
- [ ] **Opening resource** — serve ECO opening names as an MCP resource so `get_game_summary` can return opening name even when PGN headers omit it.
