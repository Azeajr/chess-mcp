# chess-mcp

[![CI](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml)

MCP server that gives AI agents (Claude Code, etc.) grounded chess analysis via Stockfish. Eliminates hallucinated moves and illegal lines by letting the agent validate positions and query the engine directly.

## Quickstart

**Prerequisites:** [Docker](https://docs.docker.com/get-docker/) and [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`).

Install the **plugin** — it bundles the chess engine (MCP server) *and* the skills in one step, no clone. In Claude Code:

```text
/plugin marketplace add azeajr/chess-mcp
/plugin install chess-mcp@azeajr
```

The `chess-analysis` server runs on demand via Docker (stdio); the first call pulls the image. Then paste a PGN and invoke `/chess-mcp:chess-game-review`, give your repertoire PGN + color for `/chess-mcp:repertoire-builder`, or hand it a FEN for `/chess-mcp:analyze-position`.

Prefer a long-running / shared / remote server, or a one-line server-only install without the plugin? See [Setup](#setup).

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
| `compare_moves` | FEN, moves[], depth | Ranks YOUR candidate moves (best→worst): each move, eval, cp_loss vs best, pv; unrecognized inputs returned in `illegal`. Scores the exact moves you pass — even ones the engine wouldn't pick |
| `validate_line` | FEN, moves[] | Valid bool, which move fails and why |
| `get_legal_moves` | FEN, uci | Legal moves as a SAN string; `uci=true` for a UCI+SAN list |
| `identify_opening` | PGN | ECO code + opening name (deepest named position); 3700-opening table |
| `export_annotated_pgn` | PGN, depth, min_cp_loss | Annotated PGN string: NAG glyphs (?!/?/??) + eval & best-move comments on flagged moves, mainline **and** variations, plus `moves_annotated` count |

### Repertoire analysis

| Tool | Input | Output |
|------|-------|--------|
| `load_repertoire` | PGN (variation tree), color | Handle (`repertoire_id`) + tree stats — call this first; avoids re-sending the full PGN on every call |
| `get_structural_profile` | repertoire_id, variation_path? | Single-node: pawn structure class, confidence, primitives, open files. `variation_path=null` → aggregate fingerprint over all leaves |
| `analyze_repertoire_congruence` | repertoire_id, min_severity, limit | Flags thematic inconsistencies: structure outliers, weakness mismatches, center-handling splits — each with drill-down path |
| `find_repertoire_gaps` | repertoire_id, depth, min_severity, limit, max_positions | Engine scan for completeness: at every opponent-to-move node you already answer, flags strong opponent replies the tree doesn't cover, each with drill-down path + severity |
| `get_repertoire_coverage` | repertoire_id, limit | Engine-free tree hygiene: dangling lines (a leaf where it's *your* move = no prepared reply) vs natural frontiers, plus depth hints |
| `suggest_complementary_lines` | repertoire_id, FEN, mode, depth, limit | Continuations from an anchor FEN: `low_memorization` ranks by structural overlap with the existing repertoire; `sharp` maximizes imbalance |
| `get_transpositions` | repertoire_id, limit | Positions reached by more than one move order, with the converging SAN paths — study one, cover several |

Structural analysis recognizes IQP, Carlsbad, Maroczy, French, Stonewall, King's Indian, Benoni, and Closed Sicilian pawn skeletons (else `unknown`); opening names come from the [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0).

Every engine-backed tool (`analyze_game`, `get_game_summary`, `get_position`, `evaluate_position`, `compare_moves`, `suggest_complementary_lines`, `find_repertoire_gaps`, `export_annotated_pgn`) also accepts an optional `time_limit` (seconds): when set, the engine searches by wall-clock instead of `depth` — useful on slow hardware or for fast iteration. Depth stays the default and the reproducible path.

The closed error-code set is unchanged by these tools: bad input still returns one of `invalid_pgn`, `invalid_fen`, `invalid_color`, `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`, `variation_not_found`, `invalid_mode`. `compare_moves` echoes unrecognized/illegal moves in an `illegal` list rather than erroring.

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

- **Docker** — runs the server (bundles Stockfish + Python deps; no host install). Docker **Compose** is only needed for the long-running SSE server path below.
- **Claude Code** (`claude` CLI) — the MCP client.

### Recommended: install the plugin (server + skills, one step)

The plugin bundles the `chess-analysis` MCP server (stdio over Docker) **and** the four skills. In Claude Code:

```text
/plugin marketplace add azeajr/chess-mcp
/plugin install chess-mcp@azeajr
```

Restart (or `/reload-plugins`) to activate. The server is spawned on demand via Docker — the first call pulls the image. Skills are namespaced under the plugin: `/chess-mcp:chess-game-review`, `/chess-mcp:repertoire-builder`, `/chess-mcp:analyze-position`, `/chess-mcp:annotate-pgn`.

> This path is verified end-to-end: marketplace add → install → a live tool call routed through the plugin's Docker-stdio server. Requires Docker.

### Server only, one command (stdio, no plugin)

Just the MCP server, no skills, nothing to clone — Claude Code spawns it on demand over **stdio**:

```bash
claude mcp add chess-analysis -- docker run -i --rm -e MCP_TRANSPORT=stdio ghcr.io/azeajr/chess-mcp:latest
```

Confirm by asking Claude to run `get_legal_moves` on the start position. For a long-running / shared / remote server, use the SSE path below instead.

### 1. Start the server (SSE — for a shared or remote host)

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose up -d --build   # build locally (Stockfish + deps), serves SSE on :8000
```

A prebuilt image is published to GHCR (public) — skip the build and pull it instead (tags:
`latest`, `v0.1.4`):

```bash
docker compose pull && docker compose up -d
# or standalone: docker run -p 8000:8000 ghcr.io/azeajr/chess-mcp:v0.1.4
```

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
| `MCP_TRANSPORT` | `sse` | Transport: `sse` (networked server) or `stdio` (client spawns the process — no port; the one-command local install) |
| `FASTMCP_HOST` | `127.0.0.1` | Bind address (SSE only). Docker image/compose set `0.0.0.0` so the published port is reachable |
| `FASTMCP_PORT` | `8000` | Listen port (SSE only) |
| `STOCKFISH_PATH` | `/usr/games/stockfish` | Engine binary (Debian path) |
| `ANALYSIS_DEPTH` | `18` | Default search depth (clamped to 1–30) |
| `MAX_ENGINE_TIME_S` | `60` | Ceiling for the optional per-call `time_limit` (seconds; floor 0.01) |
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
├── .github/workflows/       # ci.yml — test + docker build/boot, plus a tag-gated GHCR publish job
├── .claude-plugin/          # marketplace.json — lists the chess-mcp plugin (this repo as a marketplace)
├── plugin/                  # the distributable plugin: .claude-plugin/plugin.json, .mcp.json (stdio), skills/
├── .claude/skills/          # standalone skills (auto-load when running claude in-repo, SSE workflow)
├── install.sh               # native (non-Docker) install: pacman/apt/brew + uv, optional systemd unit
├── sample-game.pgn          # anonymized single-game fixture for evals
├── sample-repertoire.pgn    # sample White 1.d4 repertoire tree for evals
├── MCP_DESIGN.md            # design principles for this server
├── REPERTOIRE_DESIGN.md     # design spec for the repertoire analysis feature set
├── ROADMAP_DESIGN.md        # design spec for the shipped roadmap items (time_limit, tree analysis, export, structures)
├── ENGINEERING_PASSES.md    # reusable refactor/security/testing execution-loop prompts
├── evals/                   # harnesses (engine-free unless noted)
│   ├── capture.py           # capture real tool outputs (needs Stockfish → run in Docker)
│   ├── measure.py           # tiktoken token count
│   ├── structure_accuracy.py # structural-classifier precision/recall vs labeled FENs
│   ├── build_openings.py    # regenerate server/openings.tsv from lichess-org/chess-openings
│   └── snapshots/outputs.json
└── server/
    ├── chess_mcp.py         # All 16 MCP tools, FastMCP SSE server
    ├── structure.py         # engine-free pawn-structure analysis (8 structures)
    ├── repertoire.py        # variation-tree walker, LRU handle cache, congruence, transpositions
    ├── openings.py          # ECO opening lookup (EPD → name)
    ├── openings.tsv         # 3700 openings, vendored from lichess-org/chess-openings (CC0)
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
- [x] **Opening names (ECO)** — `identify_opening(pgn)` names the opening from a 3700-entry table vendored from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings); `get_structural_profile` nodes carry the opening too.
- [x] **`classify_structure` expansion** — now 8 structures (French, Stonewall, King's Indian, Benoni, Closed Sicilian), measured by `evals/structure_accuracy.py`. More can follow the same harness-validated pattern.
- [x] **`time_limit` param** — every engine tool takes an optional `time_limit` (seconds) → `Limit(time=N)` instead of depth; clamped to `[0.01, MAX_ENGINE_TIME_S]`. Depth stays the reproducible default.
- [x] **Variation-aware game analysis** — the cached engine pass now walks the whole game tree (mainline + variations) once, keyed by SAN path. The mainline game tools project the mainline unchanged; side lines are analyzed in the same pass.
- [x] **`export_annotated_pgn` tool** — emits an engine-annotated PGN artifact (NAG glyphs + eval/best-move comments on flagged moves, across mainline and variations); the grounded, importable counterpart to the `annotate-pgn` skill.
- [x] **More pawn structures** — added Closed Sicilian (8th); French Advance was already covered by the French pattern. Further structures follow the same `evals/structure_accuracy.py` harness-validated pattern (candidates: French Exchange, Hedgehog).
- [x] **Repertoire completeness + move comparison** — `find_repertoire_gaps` (engine scan for strong uncovered opponent replies), `get_repertoire_coverage` (engine-free dangling-line / tree-shape hygiene), and `compare_moves` (rank your own candidate moves from a FEN). 16 tools; closed error set unchanged.
- [ ] **Opponent-popularity weighting for gaps** — rank `find_repertoire_gaps` output by how often opponents actually play each uncovered move (a moves-frequency dataset), so triage fixes the holes you'll hit, not just the engine-strong ones. Pairs the engine-criticality signal with a real-world frequency signal.
- [ ] **`compare_repertoires(id_a, id_b)`** — structural + coverage diff between two loaded repertoire handles (shared themes, divergent lines, relative dangling/gap counts) to support evolving or merging a repertoire.

## License

[MIT](LICENSE) © 2026 Antonio Zea.
