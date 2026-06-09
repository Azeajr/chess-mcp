# AGENTS.md — chess-mcp

MCP server that gives AI agents grounded chess analysis via Stockfish. 22 tools (FastMCP + python-chess).

## Commands

```sh
# run tests (engine-free only; branch coverage via addopts)
cd server && uv run pytest

# run lint (uses ruff ephemerally — no config file)
uv run --with ruff ruff check server evals

# build + start server (Docker)
docker compose up -d --build

# pull prebuilt image + start
docker compose pull && docker compose up -d
```

## Architecture

- **Entrypoint**: `server/chess_mcp.py` — all tools + FastMCP SSE server. Run via `uv run python chess_mcp.py`.
- **Transport**: `MCP_TRANSPORT` env — `sse` (default, networked/Docker) or `stdio` (client spawns).
- **Engine path**: `STOCKFISH_PATH` — `/usr/games/stockfish` on Debian (set in `compose.yml`/`Dockerfile`).
- **Packages**: `server/` only. `mcp[cli]` + `chess` as deps; `pytest`+`pytest-cov` in `[dependency-groups] dev` (excluded from Docker via `uv sync --no-dev`).

## Testing

| Suite | Command | Needs Engine |
|-------|---------|-------------|
| `server/test_structure_repertoire.py` | `uv run pytest` | No |
| `server/test_tools.py` | `uv run pytest` | No |
| Engine-backed paths (`compare_moves`, `find_repertoire_gaps`, `suggest_complementary_lines` ranking, `evals/capture.py`) | Docker only | Yes |

Engine-backed tools are NOT in CI. CI runs only engine-free tests.

## Release

1. Bump version in `server/pyproject.toml`
2. Commit, then `git tag v0.x.y && git push origin v0.x.y` — the tag triggers GHCR publish + GitHub release.

## CI workflow

`.github/workflows/ci.yml`: `test` (engine-free pytest) → `docker` (build + boot, catches runtime ImportError) → `publish` (tag-gated, `needs: [test,docker]`) → `release` (tag-gated, `needs: publish`).

## Key design facts

- **Game review workflow**: `get_game_summary` (overview) → `analyze_game` (mistake list) → `get_position` (drill-down, returns FEN) → `evaluate_position`/`validate_line`/`get_legal_moves`.
- **Repertoire workflow**: `load_repertoire(PGN, color)` → handle → read tools (`get_structural_profile`, `analyze_repertoire_congruence`, `find_repertoire_gaps`, etc.) → `modify_repertoire_line` (clone-on-write, returns NEW id) → repeat → `export_repertoire` (PGN artifact).
- **Engine cache**: `_analyse_tree` is `@lru_cache(maxsize=32)` keyed on `(pgn, depth, multipv, time_limit)`. All game tools pass `DEFAULT_MULTIPV=3` so one pass feeds all.
- **Repertoire cache**: bounded LRU (default 16) + idle TTL (1h). Thread-safe via `threading.Lock`. `MAX_REPERTOIRES`/`REPERTOIRE_TTL_S` env vars.
- **Gap tool depth**: `_GAP_DEFAULT_DEPTH = 20` (higher than the default 18 — depth 18 diverges ~26 cp at gap-critical positions).
- **`compare_moves`**: returns `illegal` list, NOT an error, for unrecognized moves.
- **Closed error codes**: `invalid_pgn`, `invalid_fen`, `invalid_color`, `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`, `variation_not_found`, `invalid_mode`, `invalid_line`, `invalid_edit`.
- **Input caps**: `MAX_PGN_BYTES=100000`, `MAX_REPERTOIRE_BYTES=1000000`, `MAX_LINE_MOVES=500`, depth `[1,30]`, time `[0.01, 60]`, `MAX_MULTIPV=10`.

## Style / conventions

- No Ruff config file — lint is ad-hoc via `uv run --with ruff ruff check server evals`.
- No `Co-Authored-By` in commits.
- Skills: canonical copy is `.claude/skills/` — edit directly.
- Tool contract: docstrings in `chess_mcp.py` are the single source of truth. README has the summary table. Design docs: `REPERTOIRE_DESIGN.md`, `STRUCTURE_CLASSIFIER_DESIGN.md`, `FEATURES_DESIGN.md`, `MCP_DESIGN.md`, `ILLUSTRATIVE_LINE_DESIGN.md`.
- `validate_fen` also rejects illegal-but-parseable positions (two kings, side-not-to-move in check) via `board.status()` — not just syntax.
- `suggest_complementary_lines`: `multipv = MAX_MULTIPV, limit + 2` for soundness slack; engine's best vs mover difference > 100cp → candidate skipped.
- Multi-game PGNs (repertoire exports) are merged by `repertoire.merge_games()` in `load_repertoire`.
