# Roadmap

Where chess-mcp is headed and what's left. Current state lives in `README.md`; design rationale in
`docs/design/`. This file is the forward-looking plan — update it as items ship.

## Vision

Grounded chess analysis for AI agents. The agent never guesses a move, FEN, or evaluation — every
position is validated and every line is engine-checked through the MCP tools. Two surfaces share one
TypeScript chess core (`packages/chess-tools`):

1. **The MCP server** (`apps/mcp-server`) — 38 tools for game review and repertoire work, used from
   Claude Code (and any MCP client).
2. **The PWA** (`apps/ui`) — a local-first SolidJS board for building and studying repertoires.

The **primary product direction is repertoire building**: give the model a repertoire PGN (a
branching tree) + the color played, and it judges soundness, finds gaps, prepares the opponent's
critical replies, extends lines, and reasons about structural themes across the whole tree — all
engine-grounded.

## Where it is now (shipped)

- **Node MCP server** — 38 tools over `chessops` + a bundled `stockfish` wasm. Local stdio, no
  Docker, no port, no host engine install.
- **Engine pool (P1)** — parallel searches on both hosts: Node runs a child-process pool speaking
  UCI over stdio (`ENGINE_POOL_SIZE`, default `min(cores,4)`, in-process fallback); the PWA runs a
  Worker pool plus a dedicated live worker so board browsing never queues behind a scan burst.
  chess-tools scans fire per-position searches concurrently — fixture gap scan 17.1s → 6.4s.
- **Persistent, transposition-keyed eval cache** (`apps/mcp-server/src/engine.ts`, mirrored in the
  PWA engine) — keyed by position (clocks dropped below halfmove 50, full FEN at/above), depth-reuse,
  1000-entry FIFO; write-through to `~/.cache/chess-mcp/evals.jsonl` (Node) / IndexedDB (PWA) so
  evals survive across sessions.
- **Variation-aware repertoire tools** — `GameTree` addresses every position by SAN path, so the
  structural/congruence/gap/transposition tools walk the whole variation tree. (Game review —
  `analyze_game`/`get_game_summary`/`export_annotated_pgn` — is mainline-only.)
- **Repertoire tool suite** — load (incl. by file path), structural profile, system-clustered
  congruence, coverage, engine gap scan, transpositions, complementary/replacement line suggestion,
  illustrative-line classification, the clone-on-write edit loop, and PGN export. **Shorten** is a
  pipeline: `find_pruning_transpositions` (all re-routes per line, `bestSavings`/`bestEval`, deep
  confirm, leaf-cursor paging) → `compare_shortcut_lines` (quality: eval + structural fit) →
  `check_shortcut_coverage` (does the prune open a gap), shared with the PWA's Shorten inspect UI.
- **Claude Code plugin** — `plugin/` + `.claude-plugin/marketplace.json`, v1.0.0, Node stdio, no
  Docker hook. Installable via `claude plugin marketplace add Azeajr/chess-mcp`.
- **PWA** — board, engine-congruence arrows, on-demand gap scan, Lichess cloud eval, OpenRouter chat,
  IndexedDB autosave + File System Access PGN I/O. The chat's full repertoire toolset runs
  client-side (shared `chess-tools` + local wasm engine) — no backend — so it works the same in dev
  and as a static deploy (Cloudflare Pages). The dev-only MCP bridge was removed.

## Near-term: distribution

The plugin runs the server via `node --import tsx` against the **marketplace checkout** — so it
needs the full source tree plus a `pnpm install` at that checkout. The remaining work is to make the
server installable as a self-contained artifact.

- [ ] **Standalone build target for the MCP server.** Add a `build:mcp` that bundles
      `apps/mcp-server` + `packages/chess-tools` + `data/openings.tsv` + the stockfish wasm into a
      dist with no `tsx`/source-tree/`pnpm install` dependency for end users (a deferred follow-up).
- [ ] **npm-publish the server** (e.g. `@chess-mcp/server` with a `bin`) so the plugin can point at
      `npx -y @chess-mcp/server` instead of the checkout, and so non-plugin MCP clients can install it
      directly. Replace/extend the tag-gated CI `release` job to publish on `v*`.
- [ ] **Host the PWA on Cloudflare Pages.** Now unblocked — the chat is fully client-side. Build
      `apps/ui` (root dir = repo, output `apps/ui/dist`, `NODE_VERSION=22`); network tools degrade if
      an API blocks CORS. Optional: a CF Pages Function proxy if a blocked API is wanted.
- [ ] **Official Anthropic plugin marketplace submission** — once the install path no longer needs the
      source checkout.

## Engineering backlog

- [x] **PWA opening-explorer surface** — shipped 2026-07-13: Lichess token field in Settings
      (localStorage, feeds the shared `setExplorerToken()` holder at init), `position_popularity`
      + `find_theory_depth` + `find_repertoire_gaps popularity` in the chat toolset, and
      mode-filtered tool schemas (CHAT_TOOLSET_REVIEW §10 fix (a): each chat mode ships only its
      playbook's tools — 9–22 schemas instead of 30). Deferred: a popularity tag on the panel gap
      scan (`store/gaps.ts` is a hand-tuned port with its own budget/cancel; threading a 1 req/s
      lookup through it triples scan time for a tag the chat already provides).
- [ ] **Perf + missing-tools review** ← **NEXT** — `docs/design/PERF_AND_TOOLS_REVIEW.md`. Shipped:
      ~~persistent transposition-keyed eval cache~~ (P3+P4), ~~warm TT~~ (P2),
      ~~`audit_repertoire_moves`~~ (T1), ~~engine pool~~ (P1, both hosts), ~~Lichess opening
      explorer~~ (T2 — `position_popularity`, `find_theory_depth`, gap popularity weighting;
      needs `LICHESS_TOKEN`), ~~`prep_vs_opponent`~~ (T3), ~~only-move drill export~~ (T4 —
      `find_only_moves` + flashcard CSV). Remaining: opportunistic P5-P8 micro-perf, T5-T7,
      and R2/R3/R5-R9 robustness notes.
- [ ] **PWA chat toolset weak points** — full audit in
      `docs/design/CHAT_TOOLSET_REVIEW.md` (17 items: 4 stale/broken workflow instructions incl. a
      nonexistent `exclude_paths` param and a stripped `best_move` field, token sinks
      (full-PGN previews, PGN-through-context batch_review/history/annotate, 28 schemas per round),
      C3/C4 chat parity, no cancel for long chat tool calls, preview dead ends). Suggested order
      inside.
- [ ] **MCP smoke in CI.** `apps/mcp-server/test/smoke-client.mjs` exercises the tools through the
      engine but hits live Lichess/Chess.com, so it's excluded from CI. Gate the network assertions
      behind an env flag so the engine + non-network paths run in CI.
- [ ] **Manual test: File System Access re-open flow** (PWA). Native picker + handle permission
      re-grant can't run headless — open a PGN, reload, click "Reopen <name>".

## Feature backlog (product)

Engine-grounded, repertoire-first. Open GitHub issues + README roadmap items:

- [x] **Opponent-popularity weighting for gaps** — shipped 2026-07-13 as the `popularity` flag on
      `find_repertoire_gaps` (Lichess opening explorer; `played_pct`/`played_games` per gap,
      frequency re-rank within severity tiers). Requires `LICHESS_TOKEN`.
- [ ] **`compare_repertoires(id_a, id_b)`** — structural + coverage diff between two loaded handles
      (shared themes, divergent lines, relative dangling/gap counts) to support evolving or merging a
      repertoire.
- [ ] **`tactics_drill` tool** (#29) — serve puzzles filtered by pawn structure or opening theme, so
      training targets the positions your repertoire actually produces.
- [ ] **Interactive repertoire tree browser** (#26) — click-through tree + PGN stepper with inline
      eval. Largely subsumed by the `apps/ui` PWA; revisit whether anything is still wanted as an
      MCP-side surface (the standalone-widget design doc was retired in favor of the PWA).
- [ ] **ECO openings as an MCP resource** — expose the 3700-opening table as a resource, not only via
      the `identify_opening` tool.
- [ ] **More pawn structures** — extend the 19-structure classifier (candidates: French Exchange,
      additional Hedgehog forms) via the `scripts/structure-accuracy.mjs` fixture-validated pattern.

## Explicitly out of scope (dropped)

- **PyPI / `pip install` / `uvx`** — the Python server is deleted; the Docker image already solved the
  hard engine dependency and the Node server bundles the wasm.
- **Smithery / Glama listings** — MCP server + skills don't install as one bundle there; cloud hosting
  drops the bundled engine and adds latency. The Claude Code plugin is the distribution target.
- **Docker / SSE deployment** — replaced by the local stdio Node server.
