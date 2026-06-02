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
| `analyze_game` | PGN, depth, min_cp_loss, multipv | Per-move: cp_loss, classification, eval_after, best_move, best_pv, alternatives (filtered by min_cp_loss) |
| `evaluate_position` | FEN, depth | Centipawn score, best move, top line |
| `validate_line` | FEN, moves[] | Valid bool, which move fails and why |
| `get_legal_moves` | FEN | All legal moves in UCI + SAN |

### Recommended workflow

1. Call `get_game_summary` — small output, gives counts and worst moves.
2. Call `analyze_game` — filtered to moves at or above `min_cp_loss` (default 50). Drill into specific moves from the summary.

### Move classifications

| Label | CP loss |
|-------|---------|
| good | < 50 |
| inaccuracy | 50–100 |
| mistake | 100–200 |
| blunder | > 200 |

Scores are from white's perspective. Mate scores map to ±10000 cp.

### `analyze_game` output fields (per move)

`move_number`, `color`, `move`, `cp_loss`, `classification`, `eval_after`, `best_move`, `best_pv`, `alternatives` (each: `move`, `eval`)

## Requirements

- Docker + Docker Compose
- Claude Code

No host Python, no host Stockfish. All engine deps are inside the container.

## Deployment

### Local (same machine as Claude Code)

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose up -d
```

Claude Code auto-connects via `.mcp.json` (`http://localhost:8000/sse`).

### Remote host

```bash
# On the analysis host
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose up -d --build
```

On the machine running Claude Code, update `.mcp.json`:

```json
{
  "mcpServers": {
    "chess-analysis": {
      "type": "sse",
      "url": "http://<HOST_IP>:8000/sse"
    }
  }
}
```

## Configuration

Environment variables (set in `compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `FASTMCP_HOST` | `0.0.0.0` | Bind address |
| `FASTMCP_PORT` | `8000` | Listen port |
| `STOCKFISH_PATH` | `/usr/games/stockfish` | Engine binary (Debian path) |
| `ANALYSIS_DEPTH` | `18` | Default search depth |

## Project layout

```
chess-mcp/
├── compose.yml              # Docker Compose: port 8000, env
├── .mcp.json                # Claude Code MCP config (SSE at localhost:8000)
├── MCP_DESIGN.md            # Design principles for this server
└── server/
    ├── chess_mcp.py         # All five MCP tools, FastMCP SSE server
    ├── pyproject.toml       # uv project + dependencies
    ├── Dockerfile           # uv+Python3.14 base, apt stockfish
    └── .dockerignore
```

## Dependencies

- [`mcp[cli]`](https://github.com/modelcontextprotocol/python-sdk) — FastMCP server + SSE transport
- [`chess`](https://github.com/niklasf/python-chess) — board state, PGN/FEN parsing, legal move generation, Stockfish subprocess wrapper

## Roadmap

- [ ] **`time_limit` param** — expose `Limit(time=N)` as alternative to depth; useful for slower hardware or faster iteration.
- [ ] **Opening resource** — serve ECO opening names as an MCP resource so `get_game_summary` can return opening name even when PGN headers omit it.
