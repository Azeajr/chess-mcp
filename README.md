# chess-mcp

[![CI](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml)

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

### Game analysis

| Tool | Input | Output |
|------|-------|--------|
| `get_game_summary` | PGN, depth | Counts, accuracy %, worst 3 moves, opening — call this first |
| `analyze_game` | PGN, depth, min_cp_loss, verbose | Mistake list (cp_loss ≥ min_cp_loss): move, cp_loss, classification, best_move. `verbose=true` adds eval_after + best_pv |
| `get_position` | PGN, move_number, color, depth | One move's detail: FEN, eval, best_move, best_pv, alternatives — drill-down from summary/analyze |
| `evaluate_position` | FEN, depth, multipv | Centipawn score, best move, top line; `multipv>1` adds ranked `candidates` (top-N moves) |
| `validate_line` | FEN, moves[] | Valid bool, which move fails and why |
| `get_legal_moves` | FEN, uci | Legal moves as a SAN string; `uci=true` for a UCI+SAN list |

### Repertoire analysis

| Tool | Input | Output |
|------|-------|--------|
| `load_repertoire` | PGN (variation tree), color | Handle (`repertoire_id`) + tree stats — call this first; avoids re-sending the full PGN on every call |
| `get_structural_profile` | repertoire_id, variation_path? | Single-node: pawn structure class, confidence, primitives, open files. `variation_path=null` → aggregate fingerprint over all leaves |
| `analyze_repertoire_congruence` | repertoire_id, min_severity, limit | Flags thematic inconsistencies: structure outliers, weakness mismatches, center-handling splits — each with drill-down path |
| `suggest_complementary_lines` | repertoire_id, FEN, mode, depth, limit | Continuations from an anchor FEN: `low_memorization` ranks by structural overlap with the existing repertoire; `sharp` maximizes imbalance |

### Recommended workflow

**Game review:**

1. Call `get_game_summary` — small output, gives counts and worst moves.
2. Call `analyze_game` — filtered to moves at or above `min_cp_loss` (default 50).
3. Call `get_position(pgn, move_number, color)` to drill into a specific move. Returns that position's **FEN** for `evaluate_position` / `validate_line` / `get_legal_moves`.

**Repertoire analysis:**

1. Call `load_repertoire(pgn, color)` — parse once, get back `repertoire_id`.
2. Call `get_structural_profile(repertoire_id)` (no path) — aggregate structural fingerprint.
3. Call `analyze_repertoire_congruence(repertoire_id)` — inconsistency list; each item carries a `paths` array for drill-down.
4. Call `get_structural_profile(repertoire_id, variation_path)` to inspect a specific flagged line.
5. Call `suggest_complementary_lines(repertoire_id, fen, mode)` to extend or diversify from any position.

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
| `repertoire-builder` | analyze a repertoire tree by color: structural themes, thematic congruence, soundness, gaps, extensions |
| `analyze-position` | single-FEN deep dive (puzzles, "best move here?") |
| `annotate-pgn` | emit an annotated PGN artifact (`?!`/`?`/`??` + comments) |

## Setup

### Prerequisites

- **Docker + Docker Compose** — runs the server (bundles Stockfish + Python deps; no host install).
- **Claude Code** (`claude` CLI) — the MCP client.

### 1. Start the server

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose pull && docker compose up -d   # prebuilt image from GHCR, serves SSE on :8000
```

Prefer to build locally instead of pulling: `docker compose up -d --build`. Either way,
`restart: unless-stopped` keeps it running across reboots; after pulling code changes, rebuild with
`docker compose up -d --build`.

Common commands are wrapped in a `Makefile`: `make pull` / `make up` (build) / `make down` /
`make logs` / `make test` / `make register`.

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

### Native (non-Docker)

Docker is the supported path. For a host install without containers, `./install.sh` installs
Stockfish via the detected package manager (**pacman / apt / brew**) and runtime deps via `uv`
(`uv sync --no-dev`), then prints the run command (it bakes in the right `STOCKFISH_PATH`, which
differs per distro). Add `--systemd` to also generate and load a `systemd --user` unit (Linux only):

```bash
./install.sh            # install deps, print the run command
./install.sh --systemd  # also install the systemd --user unit, then: systemctl --user enable --now chess-mcp
```

The server binds `127.0.0.1` by default; set `FASTMCP_HOST` to expose it.

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
| `MAX_PGN_BYTES` | `100000` | Reject single-game PGN larger than this (per-call CPU/memory bound) |
| `MAX_REPERTOIRE_BYTES` | `1000000` | Reject `load_repertoire` PGN larger than this (larger cap for variation trees) |
| `MAX_LINE_MOVES` | `500` | Reject `validate_line` move lists longer than this |
| `MAX_REPERTOIRES` | `16` | Max cached repertoires (LRU eviction beyond this) |
| `REPERTOIRE_TTL_S` | `3600` | Idle seconds before a cached repertoire expires |

> **Trust boundary.** The SSE endpoint has **no authentication**. The code default bind is `127.0.0.1` (local only); the Docker image/compose bind `0.0.0.0` so the published port works — only expose that port on a **trusted LAN, never the public internet**. The server runs Stockfish on caller-supplied PGN/FEN, so `MAX_PGN_BYTES`, `MAX_REPERTOIRE_BYTES`, `MAX_LINE_MOVES`, and the depth clamp (1–30) bound per-call work, and the repertoire handle cache is bounded (`MAX_REPERTOIRES` LRU + `REPERTOIRE_TTL_S` expiry) so loaded repertoires can't grow memory without limit.

## Project layout

```
chess-mcp/
├── compose.yml              # Docker Compose: GHCR image + local build fallback, port 8000, env
├── Makefile                 # up / pull / down / logs / test / lint / register / install
├── .mcp.json                # Claude Code MCP config (SSE at localhost:8000)
├── .github/workflows/       # ci.yml (pytest + docker build/boot), release.yml (push image to GHCR)
├── .claude/skills/          # Claude Code workflow skills that drive the MCP tools
├── install.sh               # native (non-Docker) install: pacman/apt/brew + uv, optional systemd unit
├── sample-game.pgn          # anonymized single-game fixture for evals
├── sample-repertoire.pgn    # sample White 1.d4 repertoire tree for evals
├── MCP_DESIGN.md            # design principles for this server
├── REPERTOIRE_DESIGN.md     # design spec for the repertoire analysis feature set
├── ENGINEERING_PASSES.md    # reusable refactor/security/testing execution-loop prompts
├── evals/                   # token-measurement harness
│   ├── capture.py           # capture real tool outputs (needs Stockfish → run in Docker)
│   ├── measure.py           # tiktoken token count, engine-free
│   └── snapshots/outputs.json
└── server/
    ├── chess_mcp.py         # All ten MCP tools, FastMCP SSE server
    ├── structure.py         # engine-free pawn-structure analysis (StructuralExtractor)
    ├── repertoire.py        # variation-tree walker, LRU handle cache, congruence checks
    ├── test_structure_repertoire.py  # pytest suite (engine-free): structure + repertoire
    ├── test_tools.py                  # pytest suite: tool wrappers (validation, errors, caps)
    ├── pyproject.toml       # uv project + dependencies
    ├── Dockerfile           # uv+Python3.14 base, apt stockfish
    └── .dockerignore
```

## Dependencies

- [`mcp[cli]`](https://github.com/modelcontextprotocol/python-sdk) — FastMCP server + SSE transport
- [`chess`](https://github.com/niklasf/python-chess) — board state, PGN/FEN parsing, legal move generation, Stockfish subprocess wrapper

## Roadmap

- [x] **Repertoire handle** — `load_repertoire(pgn, color) → repertoire_id` avoids re-sending large variation-tree PGNs. Implemented with bounded LRU + TTL cache (default 16 entries / 1h idle expiry; overridable via env).
- [ ] **`time_limit` param** — expose `Limit(time=N)` as alternative to depth; useful for slower hardware or faster iteration.
- [ ] **Opening resource** — serve ECO opening names as an MCP resource so `get_game_summary` can return opening name even when PGN headers omit it.
- [ ] **`classify_structure` expansion** — current classifier ships IQP / Carlsbad / Maroczy. Extend to French Advance / Closed Sicilian once PGN fixtures are available to validate matching accuracy.
