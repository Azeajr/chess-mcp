# chess-mcp

[![CI](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml)

Grounded chess analysis for MCP clients and a local-first repertoire PWA. The Node/TypeScript MCP
server and SolidJS app share chess logic, application contracts, and result semantics. Stockfish
ships as WebAssembly; no Python, Docker, server port, or host engine install is required.

## Install and run

Requirements: Node.js 20 or newer and pnpm.

```sh
pnpm install
pnpm mcp                       # MCP server over stdio
pnpm dev                       # PWA at http://localhost:5173
pnpm dev:host                  # expose the PWA on the LAN
```

`.mcp.json` registers the server as `chess-analysis`. Claude Code also discovers the workflows in
`.claude/skills/`: game review, position analysis, PGN annotation, and repertoire building.

The PWA stores the working game in IndexedDB, opens and saves PGN with browser file APIs, and can be
installed for offline use. Local engine analysis works without an API key. Chat uses OpenRouter's
OpenAI-compatible API; set an OpenRouter key and model in Settings. Opening-explorer operations need
a no-scope Lichess personal token because the explorer requires authentication.

## Product capabilities

- Position: legal-move grounding, local and cloud evaluation, candidate comparison, ECO lookup,
  opening popularity, and tablebase lookup.
- Game: summary and move review, annotated PGN, batch review, and Lichess/Chess.com history.
- Repertoire: prescribed-move audit, missing replies, coverage, critical moves and drill decks,
  theory depth, structure search, practical-history comparison, opponent preparation, and annotated
  export.
- Advanced repertoire: thematic congruence, transpositions and shortening, shortcut inspection,
  engine-vetted replacement or complementary lines, and shared best-eval/best-fit gap fills.

Chat accepts a natural first message; workflow presets are optional. It routes a bounded capability
bundle, can expand that bundle during a conversation, retrieves document data only when needed, and
shows progress with Stop/Retry controls. Tool results render as navigable application data. Proposed
edits are staged against a document revision and require Accept; direct repertoire previews expose
Accept line/Cancel controls, and generated PGN/CSV artifacts have direct save actions.

Direct analysis is available without chat and invokes the same browser application commands and
result models. MCP and browser host differences are intentional: MCP uses repertoire handles and
confined filesystem operations, while the browser injects the current document and supplies staged
UI actions. See the generated [tool catalog](docs/TOOL_CATALOG.md) for the exact inventories.

## Architecture

```text
packages/chess-tools   domain logic + dependency-free canonical tool/application contract
apps/mcp-server        MCP SDK/Zod adapter + Node Stockfish process pool + handle/file adapters
apps/ui                SolidJS/Vite PWA + browser Stockfish workers + OpenRouter chat
```

The hosts share identifiers, descriptions, defaults, validation semantics, capabilities, and core
operations. Transport and state remain explicit adapters. For runtime boundaries, state, caches,
and engine behavior, read [Architecture](docs/ARCHITECTURE.md). For the browser experience, read
[PWA product](docs/PWA_PRODUCT.md).

## Verification

```sh
pnpm --filter @chess-mcp/chess-tools build
pnpm -r typecheck
pnpm docs:check
pnpm check:skills
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
pnpm --filter @chess-mcp/ui test:chat
pnpm --filter @chess-mcp/ui build
```

The network-gated MCP smoke still exercises the bundled engine and local paths. CI runs on Node 26.
Use `pnpm docs:generate` after changing the canonical registry; do not edit the generated catalog.

## Repository guide

- [AGENTS.md](AGENTS.md): current commands and operational constraints for coding agents.
- [Architecture](docs/ARCHITECTURE.md): implemented system design.
- [Tool catalog](docs/TOOL_CATALOG.md): generated host inventories and contract metadata.
- [PWA product](docs/PWA_PRODUCT.md): conversation, direct analysis, actions, and artifacts.
- [Tool disposition](docs/TOOL_SURFACE_DISPOSITION.md): evidence-backed keep/group decisions.
- [Roadmap](ROADMAP.md): unshipped work only.
- [Archive](docs/archive/README.md): superseded design rationale and review records.
