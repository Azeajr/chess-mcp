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

Twenty-two tools: six original game-analysis tools, `compare_moves` (rank caller-supplied candidate
moves from a FEN), `validate_fen` + `validate_pgn` (engine-free validators for user-supplied input —
validate before answering; `validate_fen` also rejects illegal-but-parseable positions via
`board.status()`), `identify_opening` (ECO name from a 3700-entry table), `export_annotated_pgn`
(engine-annotated PGN artifact), and eleven repertoire tools (`load_repertoire`,
`get_structural_profile`, `analyze_repertoire_congruence` (engine-free thematic consistency,
clustered by opening SYSTEM — section "Repertoire clustering" below), `get_transpositions`,
`get_repertoire_coverage` (engine-free dangling-line / tree-shape hygiene), `find_repertoire_gaps`
(engine scan for strong uncovered opponent replies), `suggest_complementary_lines`,
`suggest_replacement_line`, `classify_illustrative_lines`, and the stateful edit-loop pair
`modify_repertoire_line` (clone-on-write tree edit → new repertoire_id) + `export_repertoire`
(serialize a tree back to a PGN string for the agent to Write to disk)). The closed error-code set
grew by two for the edit loop — `invalid_line`, `invalid_edit` (see below). The structural
classifier covers 19 source-traced pawn structures (the original 8 plus Hanging pawns, Caro-Kann,
Slav, Grünfeld Centre, Nimzo-Grünfeld, Hedgehog, Najdorf, Scheveningen, Symmetric Benoni, Lopez,
Benko) with graduated core+bonus confidence and bidirectional open-Sicilian scoring; every position
also carries always-on theme tags (fianchetto/space/wing-majority/minority-attack/flank-vs-centre/
colour-complex), rolled up in the aggregate profile. Canon + provenance in `STRUCTURE_CLASSIFIER_DESIGN.md`.
The cached engine pass walks the whole game
tree (mainline + variations) once, keyed by SAN path; every engine tool also accepts an optional
`time_limit`. All containerized; game tools verified end-to-end in Docker. Repertoire + tool-layer
paths verified engine-free via pytest (`cd server && uv run pytest`; branch coverage
on by default via `addopts`; 134 tests pass). Engine paths (`compare_moves`, `find_repertoire_gaps`,
`suggest_complementary_lines` ranking) and the `evals/capture.py` snapshot are verified in Docker.

**Repo:** https://github.com/Azeajr/chess-mcp
**Release:** v0.2.11 — image published and public at `ghcr.io/azeajr/chess-mcp` (`latest` +
`v0.2.11`); the `docker compose pull` / `docker run` prebuilt install path is verified end-to-end
(pull → boot → tools over SSE). v0.2.11 also fixed a version drift issue — keep `server/pyproject.toml` version updated on every bump.

## Files

| File | Purpose |
|------|---------|
| `server/chess_mcp.py` | All 18 MCP tools, FastMCP SSE server |
| `server/structure.py` | Engine-free pawn-structure analysis: primitives, `themes` (always-on theme tags), `classify_structure` (19 structures, graded core+bonus scorers are the single source of truth, open-Sicilian family bidirectional), `position_profile` |
| `server/repertoire.py` | Variation-tree walker, bounded LRU handle cache, clone-on-write tree mutation (`apply_repertoire_edit` + `export_pgn`, the edit loop), aggregate profile, congruence checks (clustered by opening system via `_cluster_label`), transposition detection, coverage report + opponent-reply-node selection (for gaps) |
| `server/openings.py` | ECO opening lookup (EPD → eco/name); `identify` (exact position) + `deepest_in_line` |
| `server/openings.tsv` | 3700 openings keyed by EPD, vendored from lichess-org/chess-openings (CC0); regen via `evals/build_openings.py` |
| `server/test_structure_repertoire.py` | pytest suite (engine-free) for structure.py + repertoire.py |
| `server/test_tools.py` | pytest suite for the chess_mcp.py tool wrappers (engine-free paths: validation, errors, caps) |
| `server/pyproject.toml` | uv project, deps: `mcp[cli]`, `chess`, Python 3.14; `pytest`+`pytest-cov` in `dev` group (excluded from image via `uv sync --no-dev`); `addopts` enables branch coverage |
| `server/Dockerfile` | Container: uv+Python3.14 base, apt stockfish, uv sync |
| `compose.yml` | Docker Compose: port 8000, env vars |
| `.mcp.json` | Claude Code MCP config: SSE at localhost:8000 |
| `.github/workflows/ci.yml` | Single workflow: `test` (`uv run pytest`, engine-free + branch coverage) + `docker` (build image **and** boot it) + `publish` (tag-gated, `needs: [test, docker]` → push `ghcr.io/azeajr/chess-mcp:latest`+`:<tag>` to GHCR) |
| `Makefile` | Command wrappers: `up`/`pull`/`down`/`logs`/`build`/`test`/`lint`/`register`/`install` |
| `install.sh` | Native (non-Docker) install: detects pacman/apt/brew, `uv sync --no-dev`, optional `--systemd` unit |
| `LICENSE` | MIT, © 2026 Antonio Zea |
| `evals/` | Token harness: `capture.py` (real outputs, needs engine → Docker), `measure.py` (tiktoken, engine-free), `snapshots/outputs.json` |
| `sample-game.pgn` | Anonymized single-game PGN fixture |
| `sample-repertoire.pgn` | Sample White 1.d4 repertoire tree fixture |
| `REPERTOIRE_DESIGN.md` | Design spec for the repertoire analysis feature set |
| `ROADMAP_DESIGN.md` | Design spec for the shipped roadmap items (time_limit, whole-tree analysis, export_annotated_pgn, Closed Sicilian) |
| `FEATURES_DESIGN.md` | Design spec for `find_repertoire_gaps`, `get_repertoire_coverage`, `compare_moves` (post-roadmap tools) |
| `ENGINEERING_PASSES.md` | Reusable refactor/security/testing execution-loop prompts, adapted to this repo |
| `.claude/skills/` | Claude Code workflow skills: `chess-game-review`, `repertoire-builder`, `analyze-position`, `annotate-pgn` |

## Tool contract

Canonical contract = the docstrings in `server/chess_mcp.py` (single source — don't re-type
signatures here, they drift). User-facing tool list + I/O summary is the table in `README.md`.
Non-obvious invariants the docstrings don't spell out are under "Known design notes" below.

## Workflow pattern

Model calls `get_game_summary` first (small output, fast overview), then `analyze_game` for the filtered mistake list (`min_cp_loss=0` returns all moves), then `get_position(move_number, color)` to drill into a specific move. `get_position` returns that move's FEN, which feeds `evaluate_position` / `validate_line` / `get_legal_moves` — so the agent never reconstructs a FEN itself. All three game tools share one cached engine pass per `(pgn, depth)`.

## Deployment

`docker compose pull && docker compose up -d` uses the prebuilt GHCR image; `docker compose up -d --build`
builds locally instead (both work — `compose.yml` has `image:` + `build:`). Remote: point `.mcp.json`
URL at `http://<HOST_IP>:8000/sse`. `make` wraps the common commands. Full deploy steps + the native
(pacman/apt/brew) path live in `README.md`.

**Transport** is selected by `MCP_TRANSPORT` (`chess_mcp.py` `__main__`): `sse` (default — the
networked/Docker/remote server) or `stdio` (the client spawns the process; no port, no long-running
server). The low-friction local install is one command —
`claude mcp add chess-analysis -- docker run -i --rm -e MCP_TRANSPORT=stdio ghcr.io/azeajr/chess-mcp:latest`
— and needs the published image to carry the toggle (v0.1.1+).

## CI

One workflow, `.github/workflows/ci.yml`, runs on push to `main`, on PRs, and on `v*` tags. Four jobs:
- **test** — `cd server && uv run pytest` (engine-free suite, branch coverage via `addopts`). uv
  installs Python 3.14 + project deps; no Stockfish needed.
- **docker** — `docker compose build` then `docker compose up -d`, polling logs for "Application
  startup complete". The boot step catches a runtime `ImportError` (e.g. a module missing from the
  Dockerfile `COPY`) that a build-only check would miss — the class of bug that broke `main` once.
- **publish** — tag-gated (`if: startsWith(github.ref, 'refs/tags/v')`, `needs: [test, docker]`): runs
  only on a tag and only after the other two pass (a tag can never publish a red build). Pushes the
  image to GHCR (`ghcr.io/azeajr/chess-mcp:latest` + `:<tag>`), which `compose.yml`'s `image:` lets
  users pull. Job-scoped `packages: write`.
- **release** — tag-gated, `needs: publish`: `gh release create <tag> --generate-notes` so a tag also
  creates the GitHub release automatically. Job-scoped `contents: write`.

Engine-backed paths (`suggest_complementary_lines` ranking, `evals/capture.py`) are **not** in CI —
they need Stockfish and are verified manually in Docker. Status badge is in `README.md`.

Cutting a release is just: bump the version in `server/pyproject.toml`, commit, then `git tag v0.x.y && git push origin
v0.x.y`. The tag drives the rest (image publish + GitHub release) via the workflow; **the tag itself
is the trigger, so it stays a manual push** (a workflow can't create the tag that starts it).
**v0.1.0–v0.1.8 and v0.2.0–v0.2.11** are published (v0.1.1 has no GitHub release — predates the `release` job).
The GHCR package's visibility was set to **public** once (a manual one-time step in package settings —
no reliable REST endpoint for it), so anonymous `docker compose pull` / stdio `docker run` works.

## Known design notes

- `python-chess` Stockfish wrapper opens engine as subprocess per analysis and holds it open for the full game — correct behavior, one engine instance per analysis.
- `eval` values are centipawns from white's POV. Mate → ±10000.
- `_analyse_tree` is the shared cached engine pass (`@lru_cache(maxsize=32)`, keyed on `(pgn, depth, multipv, time_limit)`): it walks the WHOLE game tree (mainline + variations), analysing each distinct position once, and returns `{san_path: record}` + the parsed game (both **read-only** — callers must not mutate). `_analyse_all_moves` projects the mainline-in-order from it for `get_game_summary`/`analyze_game`/`get_position` (their output is byte-unchanged by the tree generalization — verified against the prior snapshot); `export_annotated_pgn` consumes the full path map, mapping records onto a FRESH parse it owns so the cache stays untouched. All callers pass the canonical `DEFAULT_MULTIPV=3`, so the workflow runs the engine **once** per `(pgn, depth, time_limit)`. Cache is a transparent impl detail — the tool interface stays stateless/idempotent.
- Each record carries `fen` (position before the move, side-to-move = `color`) and `eval_before`, which is what `get_position` returns for the drill-down→engine bridge.
- Invalid/empty PGN: `python-chess` returns an empty `Game` (not `None`) for garbage text, so `_analyse_all_moves` also rejects zero-move games (`game.next() is None`) → structured `{error, reason}`.
- Input caps (networked server, untrusted PGN/FEN): `MAX_PGN_BYTES` (default 100000), `MAX_REPERTOIRE_BYTES` (default 1000000 — separate cap for large variation trees), `MAX_LINE_MOVES` (default 500), and `depth` clamped to `[1, 30]`. Depth is clamped **before** the cache key, which also normalizes cache entries (fewer distinct keys). The optional `time_limit` (seconds) is likewise clamped to `[0.01, MAX_ENGINE_TIME_S]` (default 60) before the cache key; when set it selects `Limit(time=...)` over depth (depth stays the reproducible default — time search is wall-clock dependent). Closed error-code set: `invalid_pgn`, `invalid_fen`, `invalid_color`, `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`, `variation_not_found`, `invalid_mode`, `invalid_line` (illegal SAN in a supplied line, e.g. `modify_repertoire_line` add_moves), `invalid_edit` (malformed tree-edit request — empty add_moves, missing promote_move, prune of root).
- `evaluate_position(fen, depth, multipv=1)`: `multipv>1` (≤ `MAX_MULTIPV`=10) adds a ranked `candidates` list (top-N moves for *any* FEN), exposing engine multipv off-game — the primitive the `repertoire-builder` / `analyze-position` skills use to explore opponent deviations. `multipv=1` keeps the lean single-best shape (backward compatible).

- Repertoire handle cache (`repertoire.py`): `_REPERTOIRE_CACHE` is an `OrderedDict` with bounded LRU eviction (default 16 entries) and idle TTL expiry (default 1h). Controlled by env vars `MAX_REPERTOIRES` and `REPERTOIRE_TTL_S`. A `threading.Lock` guards all mutations (concurrent SSE calls). Distinct from `_analyse_all_moves` lru_cache — the engine cache keys on PGN text; the repertoire cache holds parsed game trees. See REPERTOIRE_DESIGN.md section 3.
- `structure.py` `classify_structure` ships 19 source-traced structures (IQP / Carlsbad / Maroczy / French / Stonewall / King's Indian / Benoni / Closed Sicilian / Hanging pawns / Caro-Kann / Slav / Grünfeld Centre / Nimzo-Grünfeld / Hedgehog / Najdorf / Scheveningen / Symmetric Benoni / Lopez / Benko) with `confidence` + `unknown` fallback. Each scorer is a private `_*_confidence` (single source of truth), gated on a core skeleton and graduated by bonus squares (`_graded` helper) — a position missing a peripheral pawn still classifies, just lower. Returns the highest-confidence candidate, so more-specific structures out-score generic parents (Hedgehog > Maroczy). Never forces a label on a weak match (D2). The open-Sicilian family (Closed Sicilian, Hedgehog, Najdorf, Scheveningen) is bidirectional via `_rel`/`_mirror_name` (reversed-English positions). Beyond the class, `themes(board, color)` returns always-on descriptors that stay informative when the class is `unknown` (fianchetto systems). Canon traced to Flores Rios / Soltis; each scorer validated against an engine-verified canonical FEN. See `STRUCTURE_CLASSIFIER_DESIGN.md` and REPERTOIRE_DESIGN.md Decision D2.
- `variation_path` is a SAN move list (`["e4","c5","Nf3"]`); `resolve_path` walks the tree matching SAN ply-by-ply. `None` → aggregate over all leaves.
- **Stateful edit loop** (`modify_repertoire_line` / `export_repertoire`, REPERTOIRE_DESIGN.md §9): mutation is pure clone-on-write — `copy.deepcopy` the cached tree, edit the copy, `store_repertoire` it under a FRESH id; the source id keeps resolving to the unmodified tree (the immutable-handle contract holds, so you can branch/compare ids). `modify_repertoire_line` is the one **action** repertoire tool (labelled as such); the new id works immediately with every read tool. `export_repertoire` is read-only and returns a PGN string (the second **artifact** output after `export_annotated_pgn`) — the agent Writes it to disk; the server never writes host disk (Docker stdio). `add` merges into an existing child (no duplicate siblings); illegal SAN → `invalid_line`; malformed request → `invalid_edit`.
- **Repertoire clustering** (`analyze_repertoire_congruence`, REPERTOIRE_DESIGN.md §10): congruence groups leaves by opening SYSTEM (`repertoire._cluster_label`), NOT by the opponent's first move (the old `path[0]` key) and NOT by `structure_class` (that would make every cluster structurally homogeneous and disable the structure_outlier check — Decision C1). Key = `openings.deepest_to_node` name truncated at the first colon (FAMILY grain — validated on the two real repertoires: keeps White's English one cohesive cluster, gives Black ~8 well-sized systems; finer grain re-shatters both). EPD-keyed so transposing move orders converge for free. Fallback for unnamed leaves: structure → theme → first-move (namespaced labels). Output gains `clusters` (label→leaf count) and a per-flag `cluster`.

## What's not done

Canonical roadmap = README "Roadmap". All originally-planned items are checked (handle, ECO names,
8-structure classifier, `time_limit`, whole-tree variation-aware analysis, `export_annotated_pgn`),
plus the post-roadmap completeness trio (`find_repertoire_gaps`, `get_repertoire_coverage`,
`compare_moves`). Open prospective items now in the README Roadmap: opponent-move-popularity
weighting for `find_repertoire_gaps` (frequency dataset), and `compare_repertoires(id_a, id_b)`.
Earlier-noted candidates still open: more pawn structures (French Exchange, Hedgehog) via the
`structure_accuracy.py` harness; exposing ECO openings as an MCP *resource* (vs the current tool).
