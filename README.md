# chess-mcp

[![CI](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/Azeajr/chess-mcp/actions/workflows/ci.yml)

Grounded chess analysis through an MCP server and a local-first SolidJS PWA. Both hosts share the
TypeScript domain layer and application contract. Stockfish ships as WebAssembly.

## Run

Requires Node.js 20+ and pnpm.

```sh
pnpm install
pnpm mcp
pnpm dev
```

`.mcp.json` registers the stdio server as `chess-analysis`. `pnpm dev:host` exposes the PWA on the
LAN. The PWA stores its working game in IndexedDB and opens and saves PGN through browser file APIs.
Local engine analysis works offline. Chat requires an OpenRouter key; opening-explorer operations
require a no-scope Lichess token.

## Capabilities

- Position analysis: legal moves, Stockfish and cloud evaluation, candidate comparison, ECO,
  opening popularity, and tablebases.
- Game analysis: summaries, move review, annotated PGN, batch review, and public game history.
- Repertoire analysis: coverage, gaps, prescribed and critical moves, structures, opponent
  preparation, exports, drills, transpositions, shortening, and complementary or replacement lines.
- Strategic Fit: profile-aware findings, bounded evidence retrieval, staged preference and plan
  proposals, constrained replacement portfolios, change previews, archive, undo, and verification.

Engine evaluations use White POV unless a result explicitly labels a conversion. Engine-backed
operations default to depth 20; the PWA can request depth 30.

Chat receives the complete browser command schema on every tool-capable round. Presets change
guidance only. Edits proposed by chat are revision-bound previews and require explicit acceptance.
The browser injects its current document and stages actions; MCP uses repertoire handles and
confined file operations. The generated [tool catalog](docs/TOOL_CATALOG.md) lists exact host
support.

## Repository

```text
packages/chess-tools   domain logic and canonical application contract
apps/mcp-server        MCP adapter, Node engine pool, handles, and confined files
apps/ui                SolidJS PWA, browser workers, chat, and staged actions
```

See [architecture](docs/ARCHITECTURE.md), [PWA behavior](docs/PWA_PRODUCT.md), the generated
[tool catalog](docs/TOOL_CATALOG.md), and the [roadmap](ROADMAP.md).

## Verify

```sh
pnpm --filter @chess-mcp/chess-tools build
pnpm -r typecheck
pnpm docs:check
pnpm check:skills
pnpm check:legacy-imports
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
pnpm --filter @chess-mcp/ui test:chat
pnpm --filter @chess-mcp/ui build
pnpm test:e2e:container
```

The container e2e command is authoritative because screenshot and WebKit results vary by host OS.
Regenerate screenshots only with `pnpm test:e2e:update-snapshots`. Run `pnpm docs:generate` after
changing the canonical tool registry and `pnpm sync:skills` after changing workflow contracts.
