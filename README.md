# chess-mcp

[![CI](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml)

Grounded chess analysis for AI agents (Claude Code, etc.) via Stockfish — plus a local repertoire-building PWA. The MCP server runs as a **single Node.js process** (no Docker, no Python); a **SolidJS web app** shares the same TypeScript chess logic. Eliminates hallucinated moves and illegal lines by letting the agent validate positions and query the engine directly.

> **Note:** The MCP server is now a Node.js/TypeScript implementation (`apps/mcp-server`) with full parity to the original Python server (all 32 tools). `.mcp.json` launches it directly — no container, no port. The Python server under `server/` is kept for reference; the [Setup](#setup) section below documents that legacy deployment.

## Quickstart

**Prerequisites:** [Node.js](https://nodejs.org/) ≥ 20 + [pnpm](https://pnpm.io/) + [Claude Code](https://docs.claude.com/en/docs/claude-code) (`claude`).

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
pnpm install
claude   # approve the `chess-analysis` server when prompted (one-time)
```

`.mcp.json` registers one stdio server, `chess-analysis`, launched as `node --import tsx apps/mcp-server/src/index.ts` — Stockfish (the `stockfish` npm wasm), `chessops`, and the ECO/structure data all bundled. The former `chess-files` proxy is gone: its file-path tools (`load_repertoire_from_file` / `export_repertoire_to_file`) are part of the one server now. Skills in `.claude/skills/` load automatically: `/chess-game-review`, `/repertoire-builder`, `/analyze-position`, `/annotate-pgn`.

### Web app (repertoire builder PWA)

```bash
pnpm dev          # http://localhost:5173  (pnpm dev:host to expose on your LAN)
pnpm --filter @chess-mcp/ui build   # production PWA (installable, offline)
```

A SolidJS board UI for building/studying repertoires: play moves into a variation tree, engine-eval arrows colored by repertoire congruence, on-demand gap scan, Lichess cloud eval, and an in-app chat (OpenRouter — set your key + model in Settings). Working repertoire autosaves to IndexedDB; open/save PGN via the File System Access API.

## Problem

AI agents reviewing chess games generate moves from pattern-matching, not board state. They have no legal move generator and no engine — so they invent plausible-looking but illegal or nonsensical lines. This MCP fixes that by giving the agent real tools to check its work before stating anything.

## Architecture

pnpm monorepo, one shared chess library serving both the MCP server and the web app:

```
packages/chess-tools   shared TypeScript logic (chessops + structure classifier + ECO +
                       congruence + gaps + game review + rate-limited HTTP)
apps/mcp-server        Node MCP server — 32 tools over chess-tools + stockfish (npm wasm)
apps/ui                SolidJS PWA — board, congruence arrows, gaps, cloud eval, chat
server/                legacy Python server (FastMCP + python-chess), kept for reference

Claude Code ──(stdio)──► apps/mcp-server   (node --import tsx; no Docker, no port)
```

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
| `validate_fen` | FEN | Valid bool + **normalized** FEN, side to move, game-over flag; rejects illegal-but-parseable positions. Run on a user-supplied FEN before analysis |
| `validate_pgn` | PGN | Valid bool + mainline ply count, has-variations flag, headers. Run on a user-supplied PGN before analysis |
| `identify_opening` | PGN | ECO code + opening name (deepest named position); 3700-opening table |
| `export_annotated_pgn` | PGN, depth, min_cp_loss | Annotated PGN string: NAG glyphs (?!/?/??) + eval & best-move comments on flagged moves, mainline **and** variations, plus `moves_annotated` count |

### Repertoire analysis

| Tool | Input | Output |
|------|-------|--------|
| `load_repertoire` | PGN (variation tree), color | Handle (`repertoire_id`) + tree stats — call this first; avoids re-sending the full PGN on every call |
| `get_structural_profile` | repertoire_id, variation_path? | Single-node: pawn structure class, confidence, primitives, theme tags, open files. `variation_path=null` → aggregate fingerprint (structures + theme rollup) over all leaves |
| `analyze_repertoire_congruence` | repertoire_id, min_severity, limit | Flags thematic inconsistencies, judged WITHIN each opening system (lines clustered by move-order-robust system, not first move): structure outliers, weakness mismatches, center-handling splits — each with its `cluster` label + drill-down path; plus a `clusters` partition |
| `find_repertoire_gaps` | repertoire_id, depth, min_severity, limit, max_positions | Engine scan for completeness: at every opponent-to-move node you already answer, flags strong opponent replies the tree doesn't cover, each with drill-down path + severity |
| `get_repertoire_coverage` | repertoire_id, limit | Engine-free tree hygiene: dangling lines (a leaf where it's *your* move = no prepared reply) vs natural frontiers, plus depth hints |
| `suggest_complementary_lines` | repertoire_id, FEN, mode, depth, limit | Continuations from an anchor FEN: `low_memorization` ranks by structural overlap with the existing repertoire; `sharp` maximizes imbalance |
| `get_transpositions` | repertoire_id, limit | Positions reached by more than one move order, with the converging SAN paths — study one, cover several |
| `modify_repertoire_line` | repertoire_id, path, action (`prune`/`add`/`reorder`), add_moves?, promote_move? | **Action** — edit one line and get a NEW `repertoire_id` (clone-on-write; the source id is unchanged, so you branch/compare). Drives the single-session edit loop: every read tool works on the new id immediately |
| `export_repertoire` | repertoire_id | The edit loop's escape hatch — serialize the current tree back to a PGN string (one `[Event]`) for you to Write to disk; round-trips through `load_repertoire` |

Structural analysis recognizes **19 canonical pawn structures** — IQP, Carlsbad, Maroczy, French, Stonewall, King's Indian, Benoni, Closed Sicilian, Hanging pawns, Caro-Kann, Slav, Grünfeld Centre, Nimzo-Grünfeld, Hedgehog, Najdorf, Scheveningen, Symmetric Benoni, Lopez, and Benko — each gated on a core skeleton with graduated confidence (a position missing a peripheral pawn still classifies), the open-Sicilian family scored bidirectionally (reversed-English positions included), else `unknown`. The canon is traced to Flores Rios *Chess Structures* and Soltis *Pawn Structure Chess*; every scorer is validated against an engine-verified canonical FEN (see `STRUCTURE_CLASSIFIER_DESIGN.md`). Beyond the named class, every position also carries always-on **theme tags** (fianchetto, space, wing-majority, minority-attack, flank-vs-centre, colour-complex) — these stay informative even when the class is `unknown` (e.g. fianchetto systems), and the aggregate profile rolls them up across all leaves. Opening names come from the [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0).

Every engine-backed tool (`analyze_game`, `get_game_summary`, `get_position`, `evaluate_position`, `compare_moves`, `suggest_complementary_lines`, `find_repertoire_gaps`, `export_annotated_pgn`) also accepts an optional `time_limit` (seconds): when set, the engine searches by wall-clock instead of `depth` — useful on slow hardware or for fast iteration. Depth stays the default and the reproducible path.

Closed error-code set: bad input returns one of `invalid_pgn`, `invalid_fen`, `invalid_color`, `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`, `variation_not_found`, `invalid_mode`, `invalid_line` (an illegal SAN in a supplied line, e.g. `modify_repertoire_line` add_moves), `invalid_edit` (a malformed tree-edit request). `compare_moves` echoes unrecognized/illegal moves in an `illegal` list rather than erroring.

### Repertoire file I/O

Load a repertoire (and write an export) by **file path**, so a large PGN is read off disk and never
piped through the model's context: no client-side truncation, no per-load token cost. In the Node
server these are ordinary tools (the host-side `chess-files` proxy the Python deployment needed is
gone — the one stdio process has the host filesystem directly).

| Tool | Input | Output |
|------|-------|--------|
| `load_repertoire_from_file` | path, color | Reads the PGN file on the host in full, loads it, returns the same handle as `load_repertoire` (`repertoire_id` + tree stats) — the PGN never enters the model's context |
| `export_repertoire_to_file` | repertoire_id, path | Serializes the tree to a host PGN file, returns `{path, bytes, leaves}` only (never the PGN text) |

Paths are confined to `REPERTOIRE_DIR` (default the repo's `repertoires/`). Errors:
`file_not_found` / `not_a_file` / `path_not_allowed` / `pgn_too_large` / `decode_error` (host-side),
`invalid_pgn` / `repertoire_not_found` (relayed), `backend_unreachable`. Registered in `.mcp.json` and `opencode.json`.

### Recommended workflow

**Game review:**

1. Call `get_game_summary` — small output, gives counts and worst moves.
2. Call `analyze_game` — filtered to moves at or above `min_cp_loss` (default 50).
3. Call `get_position(pgn, move_number, color)` to drill into a specific move. Returns that position's **FEN** for `evaluate_position` / `validate_line` / `get_legal_moves`.

**Repertoire analysis:**

1. Call `load_repertoire(pgn, color)` — parse once, get back `repertoire_id`.
2. Call `get_structural_profile(repertoire_id)` (no path) — aggregate structural fingerprint.
3. Call `analyze_repertoire_congruence(repertoire_id)` — inconsistency list clustered by opening system; each item carries a `paths` array for drill-down.
4. Call `get_structural_profile(repertoire_id, variation_path)` to inspect a specific flagged line.
5. Call `suggest_complementary_lines(repertoire_id, fen, mode)` to extend or diversify from any position.

**Single-session edit loop** (no re-download, no new session): from any `repertoire_id`, call
`modify_repertoire_line(repertoire_id, path, action, …)` to prune/add/reorder a line — it returns a
NEW `repertoire_id` for the modified tree (the source id still resolves to the original, so you can
branch and compare). Re-run the read tools above on the new id, iterate, then
`export_repertoire(final_id)` and write the returned `pgn` to disk. The agent passes only paths +
SAN the MCP surfaced — it never authors chess content.

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

## Setup (legacy Python/Docker deployment)

> The current default is the Node server (see [Quickstart](#quickstart)) — it needs no Docker, uv,
> or running container. The deployment below is for the **Python server under `server/`**, kept for
> reference and parity testing. Skip it unless you specifically want the Python/SSE stack.

### Prerequisites

- **Docker** + **Docker Compose** — runs the server (bundles Stockfish + Python deps; no host install)
- **Claude Code** (`claude` CLI) or **OpenCode** (`opencode` CLI) — the MCP client
- **uv** — required for `chess-files` (the host-side file proxy); install via `curl -LsSf https://astral.sh/uv/install.sh | sh`

### In-repo (recommended)

Clone, start the server, open Claude Code:

```bash
git clone https://github.com/Azeajr/chess-mcp
cd chess-mcp
docker compose pull && docker compose up -d
claude
```

- `.mcp.json` registers `chess-analysis` (SSE) and `chess-files` (stdio proxy) — approve both when prompted (once only).
- `.claude/skills/` loads automatically — `/chess-game-review`, `/repertoire-builder`, `/analyze-position`, `/annotate-pgn` are immediately available.
- `.claude/settings.json` includes a `SessionStart` hook that runs `docker compose up -d` automatically on every session open, so you only need to start the server manually the first time.

`restart: unless-stopped` in `compose.yml` keeps the server alive across reboots. After pulling updates: `docker compose pull && docker compose up -d`.

Common commands: `make pull` / `make up` (local build) / `make down` / `make logs` / `make test`.

### User scope (any directory)

Register globally so the engine and skills load in every Claude Code session, not just inside the repo:

```bash
# from the cloned repo:
claude mcp add -s user -t sse chess-analysis http://localhost:8000/sse
claude mcp add -s user chess-files -- uv run --directory "$(pwd)/server" chess_files.py
mkdir -p ~/.claude/skills && cp -r .claude/skills/* ~/.claude/skills/
```

The server still needs to be running (`docker compose up -d` from the repo, or add the `SessionStart` hook to your global `~/.claude/settings.json`).

### Remote host

Run the server on another machine, point the client at it:

```bash
claude mcp add -s user -t sse chess-analysis http://<HOST_IP>:8000/sse
```

For in-repo use, edit `.mcp.json`:

```json
{ "mcpServers": { "chess-analysis": { "type": "sse", "url": "http://<HOST_IP>:8000/sse" } } }
```

`chess-files` always runs on the local host regardless of where `chess-analysis` is — it reads local files and forwards bytes to whatever `CHESS_MCP_URL` points at.

### Quick try (stdio, no server)

No clone, no running server — Claude Code spawns the container on demand:

```bash
claude mcp add chess-analysis -- docker run -i --rm -e MCP_TRANSPORT=stdio ghcr.io/azeajr/chess-mcp:latest
```

Limitations: no `chess-files` (no shared SSE surface), cold cache per session, ~2 s container startup per session. Use the SSE path for real work.

### Native (non-Docker)

Docker is the supported path. For a host install without containers, `./install.sh` installs Stockfish via the detected package manager (**pacman / apt / brew**) and runtime deps via `uv`, then prints the run command. Add `--systemd` to also install a `systemd --user` unit (Linux only):

```bash
./install.sh            # install deps, print the run command
./install.sh --systemd  # also install the systemd unit: systemctl --user enable --now chess-mcp
```

### Verify

```bash
claude mcp get chess-analysis     # health-checks the SSE connection
```

Or ask Claude to run `get_legal_moves` on the starting position, then paste a PGN and invoke `/chess-game-review`.

### Validate plugin / marketplace

```bash
claude plugin validate ./plugin   # validate plugin manifest + skills
claude plugin validate .          # validate marketplace catalog
```

### OpenCode

`opencode.json` registers both `chess-analysis` and `chess-files` automatically when running from the repo — approve the prompt, no manual setup needed. Skills in `.claude/skills/` auto-discover.

```bash
docker compose up -d
opencode
```

**User-scope:** add to `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "chess-analysis": {
      "type": "remote",
      "url": "http://localhost:8000/sse"
    },
    "chess-files": {
      "type": "local",
      "command": ["uv", "run", "--directory", "/path/to/chess-mcp/server", "chess_files.py"],
      "environment": { "CHESS_MCP_URL": "http://localhost:8000/sse" }
    }
  }
}
```

Replace `/path/to/chess-mcp` with the absolute path to your cloned repo. Copy skills:

```bash
make opencode-setup
```

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
| `GAP_BUDGET_S` | `45` | `find_repertoire_gaps` total wall-clock budget (seconds): on a large tree it scans shallowest-first until spent, then returns partial results with `budget_exhausted:true`. Lower it if your MCP client's request timeout is under ~60s |
| `MAX_PGN_BYTES` | `100000` | Reject single-game PGN larger than this (per-call CPU/memory bound) |
| `MAX_REPERTOIRE_BYTES` | `1000000` | Reject `load_repertoire` PGN larger than this (larger cap for variation trees) |
| `MAX_LINE_MOVES` | `500` | Reject `validate_line` move lists longer than this |
| `MAX_REPERTOIRES` | `16` | Max cached repertoires (LRU eviction beyond this) |
| `REPERTOIRE_TTL_S` | `3600` | Idle seconds before a cached repertoire expires |

> **Trust boundary.** The SSE endpoint has **no authentication**. The code default bind is `127.0.0.1` (local only); the Docker image/compose bind `0.0.0.0` so the published port works — only expose that port on a **trusted LAN, never the public internet**. The server runs Stockfish on caller-supplied PGN/FEN, so `MAX_PGN_BYTES`, `MAX_REPERTOIRE_BYTES`, `MAX_LINE_MOVES`, and the depth clamp (1–30) bound per-call work, and the repertoire handle cache is bounded (`MAX_REPERTOIRES` LRU + `REPERTOIRE_TTL_S` expiry) so loaded repertoires can't grow memory without limit.

### `chess-files` proxy env (set in `.mcp.json` / `opencode.json`, not `compose.yml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `CHESS_MCP_URL` | `http://localhost:8000/sse` | SSE URL of the `chess-analysis` backend the proxy forwards to |
| `REPERTOIRE_DIR` | repo `repertoires/` | Base dir that `load_repertoire_from_file` / `export_repertoire_to_file` paths are confined to |

## Project layout

```
chess-mcp/
├── compose.yml              # Docker Compose: GHCR image + local build fallback, port 8000, env
├── Makefile                 # up / pull / down / logs / test / lint / register / install
├── .mcp.json                # Claude Code MCP config: chess-analysis (SSE) + chess-files (stdio proxy)
├── opencode.json            # OpenCode MCP config: chess-analysis (SSE) + chess-files (stdio proxy)
├── .github/workflows/       # ci.yml — test + docker build/boot, plus a tag-gated GHCR publish job
├── .claude/settings.json    # project settings: SessionStart hook (auto-start Docker) + MCP server approvals
├── .claude/skills/          # standalone skills (auto-load when running claude in-repo, no namespace prefix)
├── .claude-plugin/
│   └── marketplace.json     # Claude Code plugin marketplace catalog (plugin install path)
├── plugin/                  # distributable Claude Code plugin
│   ├── .claude-plugin/
│   │   └── plugin.json      # plugin manifest: MCP servers + SessionStart hook + skills
│   └── skills/              # plugin skills (namespaced /chess-mcp:<skill> after install)
├── install.sh               # native (non-Docker) install: pacman/apt/brew + uv, optional systemd unit
├── sample-game.pgn          # anonymized single-game fixture for evals
├── sample-repertoire.pgn    # sample White 1.d4 repertoire tree for evals
├── MCP_DESIGN.md            # design principles for this server
├── REPERTOIRE_DESIGN.md     # design spec for the repertoire analysis feature set
├── PROXY_DESIGN.md          # design spec for the chess-files file-path proxy
├── FEATURES_DESIGN.md       # design spec for gaps, coverage, compare_moves
├── ROADMAP_DESIGN.md        # design spec for shipped roadmap items
├── STRUCTURE_CLASSIFIER_DESIGN.md  # design spec for pawn-structure classifier
├── ILLUSTRATIVE_LINE_DESIGN.md     # design spec for classify_illustrative_lines
├── GROUNDING_DESIGN.md      # grounding principles and skill-authoring decisions
├── ENGINEERING_PASSES.md    # reusable refactor/security/testing execution-loop prompts
├── evals/                   # harnesses (engine-free unless noted)
│   ├── capture.py           # capture real tool outputs (needs Stockfish → run in Docker)
│   ├── measure.py           # tiktoken token count
│   ├── structure_accuracy.py # structural-classifier precision/recall vs labeled FENs
│   ├── build_openings.py    # regenerate server/openings.tsv from lichess-org/chess-openings
│   └── snapshots/outputs.json
└── server/
    ├── chess_mcp.py         # All 22 MCP tools, FastMCP SSE server
    ├── chess_files.py       # chess-files proxy: load/export a repertoire by file path (stdio → SSE)
    ├── structure.py         # engine-free pawn-structure analysis (19 structures + theme tags)
    ├── repertoire.py        # variation-tree walker, LRU handle cache, congruence, transpositions
    ├── openings.py          # ECO opening lookup (EPD → name)
    ├── openings.tsv         # 3700 openings, vendored from lichess-org/chess-openings (CC0)
    ├── test_structure_repertoire.py  # pytest suite (engine-free): structure + repertoire
    ├── test_tools.py                  # pytest suite: tool wrappers (validation, errors, caps)
    ├── test_chess_files.py            # pytest suite: chess-files proxy guards (backend mocked)
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
- [x] **`classify_structure` expansion** — now **19 source-traced structures** (added Hanging pawns, Caro-Kann, Slav, Grünfeld Centre, Nimzo-Grünfeld, Hedgehog, Najdorf, Scheveningen, Symmetric Benoni, Lopez, Benko) with graduated core+bonus confidence and bidirectional open-Sicilian scoring, plus always-on **theme tags** (A) rolled up in the aggregate profile. Each scorer is validated against an engine-verified canonical FEN; see `STRUCTURE_CLASSIFIER_DESIGN.md`.
- [x] **`time_limit` param** — every engine tool takes an optional `time_limit` (seconds) → `Limit(time=N)` instead of depth; clamped to `[0.01, MAX_ENGINE_TIME_S]`. Depth stays the reproducible default.
- [x] **Variation-aware game analysis** — the cached engine pass now walks the whole game tree (mainline + variations) once, keyed by SAN path. The mainline game tools project the mainline unchanged; side lines are analyzed in the same pass.
- [x] **`export_annotated_pgn` tool** — emits an engine-annotated PGN artifact (NAG glyphs + eval/best-move comments on flagged moves, across mainline and variations); the grounded, importable counterpart to the `annotate-pgn` skill.
- [x] **More pawn structures** — added Closed Sicilian (8th); French Advance was already covered by the French pattern. Further structures follow the same `evals/structure_accuracy.py` harness-validated pattern (candidates: French Exchange, Hedgehog).
- [x] **Repertoire completeness + move comparison** — `find_repertoire_gaps` (engine scan for strong uncovered opponent replies), `get_repertoire_coverage` (engine-free dangling-line / tree-shape hygiene), and `compare_moves` (rank your own candidate moves from a FEN). 16 tools; closed error set unchanged.
- [x] **Single-session edit loop** — `modify_repertoire_line` (clone-on-write prune/add/reorder → new `repertoire_id`; source id unchanged, so branch/compare) + `export_repertoire` (tree → PGN string for the agent to Write). Load → mutate → re-analyze the new id → … → export, all in one session, no re-download. New error codes `invalid_line`, `invalid_edit`. See REPERTOIRE_DESIGN.md §9.
- [x] **Thematic-cluster congruence** — `analyze_repertoire_congruence` now clusters lines by move-order-robust opening SYSTEM (not the opponent's first move), so a system reached via several first moves is judged as one and distinct systems under one first move stay separate. Surfaces per-system inconsistencies a Black repertoire previously washed out. See REPERTOIRE_DESIGN.md §10.
- [ ] **Opponent-popularity weighting for gaps** — rank `find_repertoire_gaps` output by how often opponents actually play each uncovered move (a moves-frequency dataset), so triage fixes the holes you'll hit, not just the engine-strong ones. Pairs the engine-criticality signal with a real-world frequency signal.
- [ ] **`compare_repertoires(id_a, id_b)`** — structural + coverage diff between two loaded repertoire handles (shared themes, divergent lines, relative dangling/gap counts) to support evolving or merging a repertoire.

## License

[MIT](LICENSE) © 2026 Antonio Zea.
