# chess-mcp

MCP server that gives AI agents (Claude Code, etc.) grounded chess analysis via Stockfish. Eliminates hallucinated moves and illegal lines by letting the agent validate positions and query the engine directly.

## Problem

AI agents reviewing chess games generate moves from pattern-matching, not board state. They have no legal move generator and no engine — so they invent plausible-looking but illegal or nonsensical lines. This MCP fixes that by giving the agent real tools to check its work before stating anything.

## Architecture

```
Mini PC (Claude Code)
└── MCP client ──(LAN SSE/HTTP)──► XU4 (Arch Linux)
                                    ├── chess-mcp server (FastMCP + python-chess)
                                    └── stockfish (subprocess)
```

The MCP server runs on the XU4 as a dedicated analysis box. Claude Code on the mini PC connects over LAN via SSE transport. No relay or proxy needed.

## Tools

| Tool | Input | Output |
|------|-------|--------|
| `analyze_game` | PGN string, depth | Per-move: eval, best move, cp loss, classification |
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

## Requirements

### XU4 (Arch Linux)
- `stockfish` (community repo)
- `uv` (Python package manager)
- Python 3.11+

### Mini PC
- Claude Code with MCP support

## Installation

### On XU4

```bash
git clone git@github.com:Azeajr/chess-mcp.git
cd chess-mcp
bash install.sh
```

`install.sh` handles:
- `pacman -S stockfish`
- `uv` install if missing
- `uv sync` to install Python deps

### Run manually

```bash
cd server
uv run chess_mcp.py
```

Server listens on `0.0.0.0:8000` by default.

### Run as systemd user service (autostart)

```bash
cp server/chess-mcp.service ~/.config/systemd/user/
systemctl --user enable --now chess-mcp
systemctl --user status chess-mcp
```

## Configuration

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FASTMCP_HOST` | `0.0.0.0` | Bind address |
| `FASTMCP_PORT` | `8000` | Listen port |
| `STOCKFISH_PATH` | `/usr/bin/stockfish` | Engine binary path |
| `ANALYSIS_DEPTH` | `18` | Default search depth |

Set in the systemd service file or export before running.

### Claude Code (mini PC)

Add to `~/.claude/claude_mcp_config.json`:

```json
{
  "mcpServers": {
    "chess": {
      "url": "http://<XU4_IP>:8000/sse"
    }
  }
}
```

Replace `<XU4_IP>` with your XU4's LAN IP (`ip addr` on XU4 to find it).

## Usage

Once connected, Claude Code can call tools mid-analysis:

```
analyze_game(pgn="1.e4 e5 2.Nf3 Nc6 ...", depth=18)
evaluate_position(fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
validate_line(fen="...", moves=["e2e4", "e7e5", "g1f3"])
get_legal_moves(fen="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")
```

## Project layout

```
chess-mcp/
├── install.sh               # XU4 setup script (Arch Linux)
├── .gitignore
└── server/
    ├── chess_mcp.py         # FastMCP server — all four tools
    ├── pyproject.toml       # uv project + dependencies
    └── chess-mcp.service    # systemd user service
```

## Dependencies

- [`mcp[cli]`](https://github.com/modelcontextprotocol/python-sdk) — FastMCP server + SSE transport
- [`chess`](https://github.com/niklasf/python-chess) — board state, PGN/FEN parsing, legal move generation, Stockfish subprocess wrapper
