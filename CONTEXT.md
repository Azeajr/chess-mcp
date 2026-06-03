# Session Context

Enough context to resume work on this project in a new session.

## What this is

MCP server that grounds AI chess game review with real Stockfish analysis. Built because AI agents hallucinate illegal moves and bogus lines when reviewing games — not from lack of chess knowledge but from having no legal move validator or engine at analysis time.

## Key decisions

**Why build own instead of existing repos:**
- `jiayao/mcp-chess` — no engine eval, only move validation + board viz for interactive play
- `sonirico/mcp-stockfish` — raw UCI passthrough (Go), local-only, agent must speak UCI manually
- Building own with `python-chess` gives high-level tools suited for game review, not just raw UCI

**Why Docker:**
- Stockfish + deps bundled, no host install needed
- Base image: `ghcr.io/astral-sh/uv:python3.14-trixie-slim` (uv + Python 3.14 + Debian trixie-slim)
- Stockfish installed via apt; installs to `/usr/games/stockfish` on Debian — set via `STOCKFISH_PATH` in compose.yml
- `FASTMCP_HOST`/`FASTMCP_PORT` passed to FastMCP constructor (not `mcp.run()` — ignored there)

**Why python-chess + FastMCP:**
- `python-chess` is the best chess library available — handles PGN, FEN, legal moves, Stockfish subprocess
- FastMCP (part of official `mcp` package) gives SSE transport with minimal boilerplate
- uv for package management

**No Co-Authored-By in commits** — user preference.

## Current state

Ten tools implemented: six original game-analysis tools + four new repertoire-analysis tools
(`load_repertoire`, `get_structural_profile`, `analyze_repertoire_congruence`,
`suggest_complementary_lines`). All containerized; game tools verified end-to-end in Docker.
Repertoire tools verified engine-free via pytest (`cd server && uv run pytest`, 81 tests pass;
branch coverage on by default via `addopts` — `structure.py` 98%, `repertoire.py` 100%, `chess_mcp.py`
37% with the remainder being engine-dependent game tools that need Docker). Engine path needs Docker
re-run for `suggest_complementary_lines` ranking and the `evals/capture.py` snapshot update.

**Repo:** https://github.com/Azeajr/chess-mcp

## Files

| File | Purpose |
|------|---------|
| `server/chess_mcp.py` | All ten MCP tools, FastMCP SSE server |
| `server/structure.py` | Engine-free pawn-structure analysis: primitives, `classify_structure` (IQP/Carlsbad/Maroczy), `position_profile` |
| `server/repertoire.py` | Variation-tree walker, bounded LRU handle cache, aggregate profile, congruence checks |
| `server/test_structure_repertoire.py` | pytest suite (engine-free) for structure.py + repertoire.py |
| `server/test_tools.py` | pytest suite for the chess_mcp.py tool wrappers (engine-free paths: validation, errors, caps) |
| `server/pyproject.toml` | uv project, deps: `mcp[cli]`, `chess`, Python 3.14; `pytest`+`pytest-cov` in `dev` group (excluded from image via `uv sync --no-dev`); `addopts` enables branch coverage |
| `server/Dockerfile` | Container: uv+Python3.14 base, apt stockfish, uv sync |
| `compose.yml` | Docker Compose: port 8000, env vars |
| `.mcp.json` | Claude Code MCP config: SSE at localhost:8000 |
| `evals/` | Token harness: `capture.py` (real outputs, needs engine → Docker), `measure.py` (tiktoken, engine-free), `snapshots/outputs.json` |
| `sample-game.pgn` | Anonymized single-game PGN fixture |
| `sample-repertoire.pgn` | Sample White 1.d4 repertoire tree fixture |
| `REPERTOIRE_DESIGN.md` | Design spec for the repertoire analysis feature set |
| `.claude/skills/` | Claude Code workflow skills: `chess-game-review`, `repertoire-builder`, `analyze-position`, `annotate-pgn` |

## Tool contract

Canonical contract = the docstrings in `server/chess_mcp.py` (single source — don't re-type
signatures here, they drift). User-facing tool list + I/O summary is the table in `README.md`.
Non-obvious invariants the docstrings don't spell out are under "Known design notes" below.

## Workflow pattern

Model calls `get_game_summary` first (small output, fast overview), then `analyze_game` for the filtered mistake list (`min_cp_loss=0` returns all moves), then `get_position(move_number, color)` to drill into a specific move. `get_position` returns that move's FEN, which feeds `evaluate_position` / `validate_line` / `get_legal_moves` — so the agent never reconstructs a FEN itself. All three game tools share one cached engine pass per `(pgn, depth)`.

## Deployment

`docker compose up -d` (local; add `--build` after code changes). Remote: point `.mcp.json` URL
at `http://<HOST_IP>:8000/sse`. Full deploy steps + native-Arch path live in `README.md`.

## Known design notes

- `python-chess` Stockfish wrapper opens engine as subprocess per analysis and holds it open for the full game — correct behavior, one engine instance per analysis.
- `eval` values are centipawns from white's POV. Mate → ±10000.
- `_analyse_all_moves` is the shared internal helper for `get_game_summary`, `analyze_game`, and `get_position`. It is `@lru_cache(maxsize=32)` keyed on `(pgn, depth, multipv)`; all three tools call it with the canonical `DEFAULT_MULTIPV=3`, so a summary→analyze→get_position sequence runs the engine **once** per `(pgn, depth)` instead of repeating the full pass. Cache is a transparent impl detail — the tool interface stays stateless/idempotent. Records are read-only (callers must not mutate them).
- Each record carries `fen` (position before the move, side-to-move = `color`) and `eval_before`, which is what `get_position` returns for the drill-down→engine bridge.
- Invalid/empty PGN: `python-chess` returns an empty `Game` (not `None`) for garbage text, so `_analyse_all_moves` also rejects zero-move games (`game.next() is None`) → structured `{error, reason}`.
- Input caps (networked server, untrusted PGN/FEN): `MAX_PGN_BYTES` (default 100000), `MAX_REPERTOIRE_BYTES` (default 1000000 — separate cap for large variation trees), `MAX_LINE_MOVES` (default 500), and `depth` clamped to `[1, 30]`. Depth is clamped **before** the cache key, which also normalizes cache entries (fewer distinct keys). Closed error-code set: `invalid_pgn`, `invalid_fen`, `invalid_color`, `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`, `variation_not_found`, `invalid_mode`.
- `evaluate_position(fen, depth, multipv=1)`: `multipv>1` (≤ `MAX_MULTIPV`=10) adds a ranked `candidates` list (top-N moves for *any* FEN), exposing engine multipv off-game — the primitive the `repertoire-builder` / `analyze-position` skills use to explore opponent deviations. `multipv=1` keeps the lean single-best shape (backward compatible).

- Repertoire handle cache (`repertoire.py`): `_REPERTOIRE_CACHE` is an `OrderedDict` with bounded LRU eviction (default 16 entries) and idle TTL expiry (default 1h). Controlled by env vars `MAX_REPERTOIRES` and `REPERTOIRE_TTL_S`. A `threading.Lock` guards all mutations (concurrent SSE calls). Distinct from `_analyse_all_moves` lru_cache — the engine cache keys on PGN text; the repertoire cache holds parsed game trees. See REPERTOIRE_DESIGN.md section 3.
- `structure.py` `classify_structure` ships a **narrow** set (IQP / Carlsbad / Maroczy) with `confidence` + `unknown` fallback. Returns the highest-confidence candidate; ties broken by first-match order. Never forces a label on a weak match. See REPERTOIRE_DESIGN.md Decision D2.
- `variation_path` is a SAN move list (`["e4","c5","Nf3"]`); `resolve_path` walks the tree matching SAN ply-by-ply. `None` → aggregate over all leaves.

## What's not done

Canonical roadmap = README "Roadmap" (`time_limit` param, ECO opening resource,
`classify_structure` expansion). Not repeated here — single source.
