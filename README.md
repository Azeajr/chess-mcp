# chess-mcp

MCP server that gives AI agents (Claude Code, etc.) grounded chess analysis via Stockfish. Eliminates hallucinated moves and illegal lines by letting the agent validate positions and query the engine directly.

## Problem

AI agents reviewing chess games generate moves from pattern-matching, not board state. They have no legal move generator and no engine — so they invent plausible-looking but illegal or nonsensical lines. This MCP fixes that by giving the agent real tools to check its work before stating anything.

## Architecture

```
Mini PC (Claude Code)
└── MCP client ──(LAN SSE/HTTP)──► XU4 (Arch Linux)
                                    ├── chess-mcp container (FastMCP + python-chess)
                                    └── stockfish (inside container)
```

The MCP server runs in Docker on a dedicated analysis box (XU4 or any host). Claude Code connects over LAN via SSE transport. No relay or proxy needed.

## Tools

| Tool | Input | Output |
|------|-------|--------|
| `analyze_game` | PGN, depth | Per-move: eval, best move, cp loss, classification, best line, alternatives |
| `evaluate_position` | FEN, depth | Centipawn score, best move, top line |
| `validate_line` | FEN, moves[] | Valid bool, which move fails and why |
| `get_legal_moves` | FEN | All legal moves in UCI + SAN |

### Move classifications

| Label | CP loss |
|-------|---------|
| good | < 50 |
| inaccuracy | 50–100 |
| mistake | 100–200 |
| blunder | > 200 |

Scores are from white's perspective. Mate scores map to ±10000 cp.

### `analyze_game` output fields (per move)

`move_number`, `color`, `move`, `move_uci`, `eval_before`, `eval_before_type`, `eval_before_mate_in`, `eval_after`, `eval_after_type`, `eval_after_mate_in`, `eval_relative`, `cp_loss`, `classification`, `best_move`, `best_move_uci`, `best_pv`, `pv`, `alternatives`

## Requirements

- Docker + Docker Compose
- Claude Code (on the machine running the MCP client)

No host Python, no host Stockfish. All engine deps are inside the container.

## Deployment

### Local (same machine as Claude Code)

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose up -d
```

Claude Code auto-connects via `.mcp.json` (`http://localhost:8000/sse`).

### Remote (XU4 or dedicated host)

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

### XU4 (big.LITTLE) performance

Uncomment `cpuset: "0-3"` in `compose.yml` to pin Stockfish to the A15 cores only.

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
├── compose.yml              # Docker Compose: port 8000, env, XU4 cpuset option
├── .mcp.json                # Claude Code project MCP config (SSE at localhost:8000)
├── MCP_DESIGN.md            # Design principles for this server
└── server/
    ├── chess_mcp.py         # All four MCP tools, FastMCP SSE server
    ├── pyproject.toml       # uv project + dependencies
    ├── Dockerfile           # uv+Python3.14 base, apt stockfish
    ├── .dockerignore
    └── chess-mcp.service    # systemd user service (pre-Docker, kept for reference)
```

## Dependencies

- [`mcp[cli]`](https://github.com/modelcontextprotocol/python-sdk) — FastMCP server + SSE transport
- [`chess`](https://github.com/niklasf/python-chess) — board state, PGN/FEN parsing, legal move generation, Stockfish subprocess wrapper

## Roadmap

### Fixes

- [ ] **`analyze_game` output size** — 40-move game returns ~41k chars, exceeds Claude Code context window. Add `min_cp_loss: int = 0` filter param; default to `50` (inaccuracies and worse only) in tool description.

### New tools

- [ ] **`get_game_summary`** — single small-output tool: blunder/mistake/inaccuracy counts, accuracy % per side, worst 3 moves by cp loss, opening name from PGN headers. Model calls this first, drills into `analyze_game` only for moves that need explanation.

### Performance / deployment

- [ ] **XU4 deploy** — ARM build, uncomment `cpuset: "0-3"` in `compose.yml`, update `.mcp.json` URL to `http://XU4_IP:8000/sse`.
- [ ] **Depth tuning on XU4** — depth 18 on Cortex-A15 estimated 5–10s/move. Evaluate `Limit(time=2.0)` per move as alternative; expose as `time_limit` param or auto-switch on `ANALYSIS_DEPTH=0`.

### Quality / design

- [ ] **Redundant field cleanup** — `move_uci` / `best_move_uci` rarely used by model; consider dropping from default output to save tokens.
- [ ] **`multipv` param on `analyze_game`** — expose top-N alternatives count (currently hardcoded to 3) as a parameter.
