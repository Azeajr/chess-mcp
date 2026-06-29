# chess-mcp

[![CI](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml)

Grounded chess analysis for AI agents (Claude Code, etc.) via Stockfish — plus a local repertoire-building PWA. The MCP server runs as a **single Node.js process** (no Docker, no Python); a **SolidJS web app** shares the same TypeScript chess logic. Eliminates hallucinated moves and illegal lines by letting the agent validate positions and query the engine directly.

> **Note:** The MCP server is a Node.js/TypeScript implementation (`apps/mcp-server`, all 33 tools). `.mcp.json` launches it directly — no container, no port, no host Stockfish install (the engine ships as a bundled wasm).

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

**In-app chat tools (client-side).** The chat's tools run entirely in the browser against the shared `chess-tools` logic + the local Stockfish wasm — the same repertoire toolset the MCP server exposes (`find_repertoire_gaps`, `get_structural_profile`, `analyze_repertoire_congruence`, `suggest_*`, game review, gaps, …), reimplemented with no backend. So the chat is fully featured in `pnpm dev` **and** in the deployed/built PWA (e.g. on a static host like Cloudflare Pages — no Node process required). The engine-dependent orchestration is the shared implementation the Node server uses too (`packages/chess-tools/src/enginetools.ts`), so server and PWA stay in lockstep. Only the host-filesystem tools (`*_from_file`/`*_to_file`) are MCP-only — the PWA uses the File System Access picker instead.

A **workflow mode** selector in the chat panel (General / Repertoire / Game review / Position / Annotate) injects the matching playbook into the system prompt — the PWA counterpart of the Claude Code skills (`apps/ui/src/llm/workflows.ts`), telling the assistant which tools to call in what order plus the grounding rules. The skills under `.claude/skills/` remain the Claude Code version (handle-based); the PWA prompts are adapted to its handle-free, current-tree tools.

## Problem

AI agents reviewing chess games generate moves from pattern-matching, not board state. They have no legal move generator and no engine — so they invent plausible-looking but illegal or nonsensical lines. This MCP fixes that by giving the agent real tools to check its work before stating anything.

## Architecture

pnpm monorepo, one shared chess library serving both the MCP server and the web app:

```
packages/chess-tools   shared TypeScript logic (chessops + structure classifier + ECO +
                       congruence + gaps + game review + rate-limited HTTP)
apps/mcp-server        Node MCP server — 33 tools over chess-tools + stockfish (npm wasm)
apps/ui                SolidJS PWA — board, congruence arrows, gaps, cloud eval, chat

Claude Code ──(stdio)──► apps/mcp-server   (node --import tsx; no Docker, no port)
```

## Tools

### Game analysis

| Tool | Input | Output |
|------|-------|--------|
| `get_game_summary` | PGN, depth | Counts, accuracy %, worst 3 moves, opening — call this first |
| `analyze_game` | PGN, depth, verbose | Per-move cp_loss + classification (blunder/mistake/inaccuracy/good). `verbose=true` adds eval_cp + best_move + best_eval |
| `get_position` | FEN | Normalized FEN, side to move, and legal moves — convenience wrapper for `validate_fen` + `get_legal_moves` |
| `evaluate_position` | FEN, depth, lines | Local Stockfish analysis (white-POV): top `lines` moves (default 3), each with SAN, cp, mate, depth |
| `compare_moves` | FEN, moves[], depth | Ranks YOUR candidate moves (best→worst): each move, eval, cp_loss vs best, pv; unrecognized inputs returned in `illegal`. Scores the exact moves you pass — even ones the engine wouldn't pick |
| `validate_line` | FEN, moves[] | Valid bool, which move fails and why |
| `get_legal_moves` | FEN | Legal moves in SAN at the given position |
| `validate_fen` | FEN | Valid bool + **normalized** FEN, side to move, game-over flag; rejects illegal-but-parseable positions. Run on a user-supplied FEN before analysis |
| `validate_pgn` | PGN | Valid bool + mainline ply count, has-variations flag, headers. Run on a user-supplied PGN before analysis |
| `identify_opening` | PGN | ECO code + opening name (deepest named position); 3700-opening table |
| `export_annotated_pgn` | PGN, depth | Annotated PGN string: NAG glyphs ($2/$4/$6) + best-move/eval comments on flagged moves |
| `cloud_eval` | FEN | Lichess cloud eval (white-POV cp + best move), or `available: false` if uncached/offline |
| `tablebase_lookup` | FEN | Lichess tablebase result for ≤7-piece FEN, or `available: false` |
| `batch_review` | PGN (multi-game), group_by, username?, max_games, depth | Aggregate review grouped by ECO or player color: avg cp-loss + blunder list per group (color grouping needs `username`) |

### Game history

| Tool | Input | Output |
|------|-------|--------|
| `lichess_games` | username, max_games, opening_eco?, include_pgn | Recent Lichess games — metadata or full PGN; filter by ECO prefix |
| `chesscom_games` | username, year, month, opening_eco?, include_pgn | Chess.com games for a calendar month — metadata or full PGN |

### Repertoire analysis

| Tool | Input | Output |
|------|-------|--------|
| `load_repertoire` | PGN (variation tree), color | Handle (`repertoire_id`) + tree stats — call this first; avoids re-sending the full PGN on every call |
| `get_structural_profile` | repertoire_id, variation_path? | Single-node: pawn structure class, confidence, primitives, theme tags, open files. `variation_path=null` → aggregate fingerprint (structures + theme rollup) over all leaves |
| `analyze_repertoire_congruence` | repertoire_id, min_severity, limit, acknowledged_weaknesses?, exclude_paths? | Flags thematic inconsistencies, judged WITHIN each opening system (lines clustered by move-order-robust system, not first move): structure outliers, weakness mismatches, center-handling splits — each with its `cluster` label + drill-down path; plus a `clusters` partition |
| `find_repertoire_gaps` | repertoire_id, depth, min_severity, limit, max_positions | Engine scan for completeness: at every opponent-to-move node you already answer, flags strong opponent replies the tree doesn't cover, each with drill-down path + severity |
| `get_repertoire_coverage` | repertoire_id, limit, connect_stubs? | Engine-free tree hygiene: dangling lines (a leaf where it's *your* move = no prepared reply) vs natural frontiers. `connect_stubs=true` engine-checks whether each stub bridges to existing prep — resolved stubs report `connects_via` + `joins_path` |
| `suggest_complementary_lines` | repertoire_id, FEN, mode, depth, limit | Continuations from an anchor FEN: `low_memorization` ranks by structural overlap with the existing repertoire; `sharp` maximizes imbalance |
| `get_transpositions` | repertoire_id, limit | Positions reached by more than one move order, with the converging SAN paths — study one, cover several |
| `modify_repertoire_line` | repertoire_id, path, action (`prune`/`add`/`reorder`), add_moves?, promote_move? | **Action** — edit one line and get a NEW `repertoire_id` (clone-on-write; the source id is unchanged, so you branch/compare). Drives the single-session edit loop: every read tool works on the new id immediately |
| `export_repertoire` | repertoire_id | The edit loop's escape hatch — serialize the current tree back to a PGN string (one `[Event]`) for you to Write to disk; round-trips through `load_repertoire` |
| `find_pruning_transpositions` | repertoire_id, limit, depth/movetime_ms, cp_threshold, confirm_depth, leaf_start/leaf_count, budget | Shorten lines by routing earlier into existing prep via transposition. Returns **all** viable re-routes per line, each tagged `bestSavings` (biggest tail cut) / `bestEval` (best resulting eval, deep-confirmed via `confirm_depth`); reports `savedPlies` + eval trade (`evalStay` vs `evalTranspose`). A full (no-cursor) call is the authoritative global ranking (`partial:false`); `leaf_start`/`leaf_count` page for progress only |
| `compare_shortcut_lines` | repertoire_id, line_path, at_ply, joins_path, depth?, eval_tiebreak_cp? | Quality of a shortcut: judges the line you'd **adopt** (transpose into `joins_path`) vs the one you'd **abandon** (stay) on eval at the fork + structural fit with the repertoire (subtree distribution + mainline-leaf structure labels); recommends one, flags eval/fit disagreement |
| `check_shortcut_coverage` | repertoire_id, line_path, at_ply, depth?, min_severity?, max_positions? | Coverage safety of a shortcut: prunes the tail on a copy, re-runs the gap scan, returns the gaps it would open (`introduces_gap` + `new_gaps`) |
| `suggest_replacement_line` | repertoire_id, outlier_variation_path, mode, depth | Single-call fix for a congruence outlier: pivots at the weakness move, suggests engine-validated alternatives ranked by structural fit or eval (`structural_fit` / `low_memorization` / `solid`) |
| `classify_illustrative_lines` | repertoire_id, limit | Flag side lines marked with NAG glyphs ($2/$4/$6) — these inflate leaf/gap counts and should be excluded from coverage scans |
| `repertoire_vs_history` | repertoire_id, username, platform, max_games, year?, month? | Compare prep against real games: coverage %, player deviations (your off-book moves), uncovered opponent moves |

Structural analysis recognizes **19 canonical pawn structures** — IQP, Carlsbad, Maroczy, French, Stonewall, King's Indian, Benoni, Closed Sicilian, Hanging pawns, Caro-Kann, Slav, Grünfeld Centre, Nimzo-Grünfeld, Hedgehog, Najdorf, Scheveningen, Symmetric Benoni, Lopez, and Benko — each gated on a core skeleton with graduated confidence (a position missing a peripheral pawn still classifies), the open-Sicilian family scored bidirectionally (reversed-English positions included), else `unknown`. The canon is traced to Flores Rios *Chess Structures* and Soltis *Pawn Structure Chess*; every scorer is validated against an engine-verified canonical FEN (see `STRUCTURE_CLASSIFIER_DESIGN.md`). Beyond the named class, every position also carries always-on **theme tags** (fianchetto, space, wing-majority, minority-attack, flank-vs-centre, colour-complex) — these stay informative even when the class is `unknown` (e.g. fianchetto systems), and the aggregate profile rolls them up across all leaves. Opening names come from the [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) dataset (CC0).

Engine-backed tools accept `depth` (integer, clamped 1–30; per-tool default 12–16). `find_pruning_transpositions` additionally accepts `movetime_ms` (ms per position) as a time-based alternative — a tighter knob for sharp positions or slower hardware — and `confirm_depth` to deep-confirm each line's best-eval re-route. Its candidate-node pre-filter (only positions with an actual cross-branch transposer reach the engine) plus a transposition-keyed scan memo keep a full-tree scan cheap, so chunking (`leaf_start`/`leaf_count`) is for progress display, not coverage.

Closed error-code set: bad input returns one of `invalid_pgn`, `invalid_fen`, `invalid_color`, `move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`, `variation_not_found`, `invalid_mode`, `invalid_line` (an illegal SAN in a supplied line, e.g. `modify_repertoire_line` add_moves), `invalid_edit` (a malformed tree-edit request), `path_not_found` (`compare_shortcut_lines` given a `line_path`/`joins_path` that doesn't resolve), `invalid_prune` (`check_shortcut_coverage` given an `at_ply` that leaves nothing to prune). `compare_moves` echoes unrecognized/illegal moves in an `illegal` list rather than erroring.

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
2. Call `analyze_game` — per-move cp_loss and classification; add `verbose=true` for eval + best_move per move.
3. Call `validate_line` from the start FEN with the game's SAN moves up to the target ply — `finalFen` in the response is the position FEN. Then call `evaluate_position` or `get_legal_moves` on it.

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

## Validate plugin / marketplace

```bash
claude plugin validate ./plugin   # validate plugin manifest + skills
claude plugin validate .          # validate marketplace catalog
```

### OpenCode

`opencode.json` registers `chess-analysis` (the same stdio Node server as `.mcp.json`) automatically
when running from the repo — approve the prompt, no manual setup needed. Skills in `.claude/skills/`
auto-discover. Just run `opencode` from the repo.

## Configuration

The Node server runs as a local stdio process — no port, no transport setting, no `STOCKFISH_PATH`
(the `stockfish` wasm is bundled). Environment variables it reads:

| Variable | Default | Description |
|----------|---------|-------------|
| `REPERTOIRE_DIR` | repo `repertoires/` | Base dir that `load_repertoire_from_file` / `export_repertoire_to_file` paths are confined to |
| `MAX_REPERTOIRES` | `16` | Max cached repertoires (LRU eviction beyond this) |
| `REPERTOIRE_TTL_S` | `3600` | Idle seconds before a cached repertoire expires |

Search depth is per-tool (default 12–16, clamped 1–30); `find_pruning_transpositions` also takes a
`movetime_ms` knob and a `budget` cap. The `find_repertoire_gaps` budget and the input caps
(PGN/repertoire bytes, line length, candidate-line count) are compiled-in constants.

> **Trust boundary.** The server runs Stockfish on caller-supplied PGN/FEN. The input caps and the
> depth clamp (1–30) bound per-call work, and the repertoire handle cache is bounded
> (`MAX_REPERTOIRES` LRU + `REPERTOIRE_TTL_S` expiry) so loaded repertoires can't grow memory without
> limit. As a local stdio process it exposes no network surface.

## Project layout

```
chess-mcp/
├── .mcp.json                # Claude Code MCP config: chess-analysis (stdio Node server)
├── opencode.json            # OpenCode MCP config: chess-analysis (stdio Node server)
├── .github/workflows/       # ci.yml — build, typecheck, smoke; tag-gated GitHub release
├── .claude/skills/          # standalone skills (auto-load when running claude in-repo, no namespace prefix)
├── .claude-plugin/
│   └── marketplace.json     # Claude Code plugin marketplace catalog (plugin install path)
├── plugin/                  # distributable Claude Code plugin
│   ├── .claude-plugin/
│   │   └── plugin.json      # plugin manifest: stdio Node MCP server + skills
│   └── skills/              # plugin skills (namespaced /chess-mcp:<skill> after install)
├── packages/
│   └── chess-tools/         # shared TS lib: GameTree, structure classifier, congruence, gaps, ECO, HTTP
├── apps/
│   ├── mcp-server/          # Node MCP server (@modelcontextprotocol/sdk, stdio) — 33 tools + stockfish wasm
│   └── ui/                  # SolidJS + Vite PWA: board, congruence arrows, gap scan, cloud eval, chat
├── scripts/                 # engine-free smoke: smoke-gametree.mjs, structure-accuracy.mjs
├── docs/design/             # design specs (repertoire, structure classifier, node migration, …)
├── sample-game.pgn          # anonymized single-game fixture
├── sample-repertoire.pgn    # sample White 1.d4 repertoire tree
└── ENGINEERING_PASSES.md    # reusable refactor/security/testing execution-loop prompts
```

## Dependencies

- [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk) — MCP server + stdio transport
- [`chessops`](https://github.com/niklasf/chessops) — board state, PGN/FEN parsing, legal move generation
- [`stockfish`](https://www.npmjs.com/package/stockfish) — bundled Stockfish wasm engine (no host install)

## Roadmap

Forward-looking plan (distribution, engineering, and feature backlog) lives in
[`ROADMAP.md`](ROADMAP.md). Shipped to date:

- [x] **Repertoire handle** — `load_repertoire(pgn, color) → repertoire_id` avoids re-sending large variation-tree PGNs. Implemented with bounded LRU + TTL cache (default 16 entries / 1h idle expiry; overridable via env).
- [x] **Opening names (ECO)** — `identify_opening(pgn)` names the opening from a 3700-entry table vendored from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings); `get_structural_profile` nodes carry the opening too.
- [x] **`classify_structure` expansion** — now **19 source-traced structures** (added Hanging pawns, Caro-Kann, Slav, Grünfeld Centre, Nimzo-Grünfeld, Hedgehog, Najdorf, Scheveningen, Symmetric Benoni, Lopez, Benko) with graduated core+bonus confidence and bidirectional open-Sicilian scoring, plus always-on **theme tags** (A) rolled up in the aggregate profile. Each scorer is validated against an engine-verified canonical FEN; see `STRUCTURE_CLASSIFIER_DESIGN.md`.
- [x] **Time-based engine budget** — `find_pruning_transpositions` takes a `movetime_ms` knob (ms per position) instead of depth, plus a `budget` cap on total positions analysed. Depth stays the reproducible default elsewhere.
- [x] **Cached single-pass game analysis** — `analyze_game` / `get_game_summary` / `export_annotated_pgn` share one engine pass over the game's mainline (one eval per position, cp_loss from consecutive white evals), keyed and cached so the summary and per-move tools don't re-search.
- [x] **`export_annotated_pgn` tool** — emits an engine-annotated PGN artifact (NAG glyphs + eval/best-move comments on flagged mainline moves); the grounded, importable counterpart to the `annotate-pgn` skill.
- [x] **More pawn structures** — added Closed Sicilian (8th); French Advance was already covered by the French pattern. Further structures follow the same `scripts/structure-accuracy.mjs` harness-validated pattern (candidates: French Exchange, Hedgehog).
- [x] **Repertoire completeness + move comparison** — `find_repertoire_gaps` (engine scan for strong uncovered opponent replies), `get_repertoire_coverage` (engine-free dangling-line / tree-shape hygiene), and `compare_moves` (rank your own candidate moves from a FEN). 16 tools; closed error set unchanged.
- [x] **Single-session edit loop** — `modify_repertoire_line` (clone-on-write prune/add/reorder → new `repertoire_id`; source id unchanged, so branch/compare) + `export_repertoire` (tree → PGN string for the agent to Write). Load → mutate → re-analyze the new id → … → export, all in one session, no re-download. New error codes `invalid_line`, `invalid_edit`. See REPERTOIRE_DESIGN.md §9.
- [x] **Thematic-cluster congruence** — `analyze_repertoire_congruence` now clusters lines by move-order-robust opening SYSTEM (not the opponent's first move), so a system reached via several first moves is judged as one and distinct systems under one first move stay separate. Surfaces per-system inconsistencies a Black repertoire previously washed out. See REPERTOIRE_DESIGN.md §10.
- [x] **Shorten / transposition-pruning pass** — `find_pruning_transpositions` now pre-filters to candidate nodes only (one real repertoire went 385 → 16 engine analyses), returns **all** re-routes per line tagged `bestSavings`/`bestEval` with `confirm_depth` deep-confirm, and pages by leaf cursor (the full call owns the global ranking; chunks are progress-only). Two new tools vet a chosen shortcut: `compare_shortcut_lines` (quality — eval at the fork + structural fit) and `check_shortcut_coverage` (does the prune open a gap). Both share one chess-tools core with the PWA, whose Shorten rows now carry `↓`/`★` pick badges, a cancel button, and a "?" inspect verdict. 33 tools; new error codes `path_not_found`, `invalid_prune`. See `SHORTEN_SEMANTICS_DESIGN.md` + `SHORTEN_IMPROVEMENTS_TODO.md`.

## License

[MIT](LICENSE) © 2026 Antonio Zea.
