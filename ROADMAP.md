# Roadmap

Where chess-mcp is headed and what's left. Current state lives in `README.md`; design rationale in
`docs/design/`. This file is the forward-looking plan — update it as items ship.

## Vision

Grounded chess analysis for AI agents. The agent never guesses a move, FEN, or evaluation — every
position is validated and every line is engine-checked through the MCP tools. Two surfaces share one
TypeScript chess core (`packages/chess-tools`):

1. **The MCP server** (`apps/mcp-server`) — 33 tools for game review and repertoire work, used from
   Claude Code (and any MCP client).
2. **The PWA** (`apps/ui`) — a local-first SolidJS board for building and studying repertoires.

The **primary product direction is repertoire building**: give the model a repertoire PGN (a
branching tree) + the color played, and it judges soundness, finds gaps, prepares the opponent's
critical replies, extends lines, and reasons about structural themes across the whole tree — all
engine-grounded.

## Where it is now (shipped)

- **Node MCP server** — 33 tools over `chessops` + a bundled `stockfish` wasm. Local stdio, no
  Docker, no port, no host engine install.
- **In-process eval cache** (`apps/mcp-server/src/engine.ts`) — `${fen}|${multipv}` keyed, depth-reuse,
  1000-entry FIFO. Per session.
- **Variation-aware repertoire tools** — `GameTree` addresses every position by SAN path, so the
  structural/congruence/gap/transposition tools walk the whole variation tree. (Game review —
  `analyze_game`/`get_game_summary`/`export_annotated_pgn` — is mainline-only.)
- **Repertoire tool suite** — load (incl. by file path), structural profile, system-clustered
  congruence, coverage, engine gap scan, transpositions, complementary/replacement line suggestion,
  illustrative-line classification, the clone-on-write edit loop, and PGN export.
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
      dist with no `tsx`/source-tree/`pnpm install` dependency for end users. (Design rationale:
      `docs/design/NODE_MIGRATION_DESIGN.md` D4 — deferred follow-up.)
- [ ] **npm-publish the server** (e.g. `@chess-mcp/server` with a `bin`) so the plugin can point at
      `npx -y @chess-mcp/server` instead of the checkout, and so non-plugin MCP clients can install it
      directly. Replace/extend the tag-gated CI `release` job to publish on `v*`.
- [ ] **Host the PWA on Cloudflare Pages.** Now unblocked — the chat is fully client-side. Build
      `apps/ui` (root dir = repo, output `apps/ui/dist`, `NODE_VERSION=22`); network tools degrade if
      an API blocks CORS. Optional: a CF Pages Function proxy if a blocked API is wanted.
- [ ] **Official Anthropic plugin marketplace submission** — once the install path no longer needs the
      source checkout.

## Engineering backlog

- [ ] **MCP smoke in CI.** `apps/mcp-server/test/smoke-client.mjs` exercises the tools through the
      engine but hits live Lichess/Chess.com, so it's excluded from CI. Gate the network assertions
      behind an env flag so the engine + non-network paths run in CI.
- [ ] **Manual test: File System Access re-open flow** (PWA). Native picker + handle permission
      re-grant can't run headless — open a PGN, reload, click "Reopen <name>".

## Feature backlog (product)

Engine-grounded, repertoire-first. Open GitHub issues + README roadmap items:

- [ ] **Opponent-popularity weighting for gaps** — rank `find_repertoire_gaps` output by how often
      opponents actually play each uncovered move (a move-frequency dataset), pairing engine
      criticality with real-world frequency so triage hits the holes you'll actually face.
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
