# AGENTS.md — chess-mcp

pnpm TypeScript monorepo. The active MCP server is `apps/mcp-server`; shared domain logic and the
canonical application contract live in `packages/chess-tools`; `apps/ui` is a SolidJS/Vite PWA.
`.mcp.json` launches the Node server directly over stdio.

## Commands

```sh
pnpm install
pnpm --filter @chess-mcp/chess-tools build
pnpm -r typecheck
pnpm docs:check
pnpm check:skills
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
pnpm --filter @chess-mcp/ui test:chat
pnpm --filter @chess-mcp/ui build
pnpm exec playwright test --config apps/ui/playwright.config.ts
pnpm dev                       # use dev:host for LAN
pnpm mcp
```

CI uses Node 26. `SMOKE_NETWORK=0` skips live Lichess/Chess.com assertions, not engine/local paths.
`EVAL_CACHE_DIR=0` disables the persistent evaluation cache.

## Boundaries and sources of truth

- `packages/chess-tools/src/tool-contract.ts` owns tool identifiers, descriptions, hosts,
  capabilities, defaults, validation metadata, and result kind. Generate
  `docs/TOOL_CATALOG.md` with `pnpm docs:generate`; never edit it by hand.
- `packages/chess-tools/src/workflow-contract.ts` owns shared workflow invariants and method
  boundaries. Generate skill sections with `pnpm sync:skills`; do not hand-edit generated blocks.
- `apps/ui/src/application/browser-commands/registry.ts` is the exhaustive browser execution
  registry. Chat and direct report/export controls must call it instead of adding store switches.
- `packages/chess-tools` must not import SolidJS, MCP SDK, Zod, or OpenRouter types.
- MCP adapters inject repertoire handles, the Node engine pool, network credentials, and confined
  paths. Browser adapters inject the current tree/FEN/PGN, Worker engine, credentials, staged
  actions, and artifacts. Do not claim parity from names alone.
- Tool definitions/contracts are current truth; design history is not. Current architecture is in
  `docs/ARCHITECTURE.md`, product behavior in `docs/PWA_PRODUCT.md`.
- Canonical skill sources are `.claude/skills/`; synchronize `plugin/skills/` with
  `pnpm sync:skills` and verify with `pnpm check:skills`.

## Important behavior

- Repertoire handles are bounded LRU with idle TTL and edits are clone-on-write.
- Node Stockfish uses child processes (`ENGINE_POOL_SIZE`, default `min(cores,4)`); `0` selects the
  in-process fallback. Browser Stockfish has a scan-worker pool plus a dedicated live worker.
- Engine evaluations are white-POV unless explicitly converted and labeled. Depth is clamped 1–30.
- Engine cache keys are transposition-aware below the 50-move boundary, depth/multipv reusable,
  FIFO bounded, and optionally persisted at `EVAL_CACHE_DIR`.
- Game review is mainline-only. Multi-game repertoire PGNs merge into one variation tree.
- Explorer-backed operations require `LICHESS_TOKEN` on Node or the browser Settings token.
- Mutations proposed by chat are staged and require explicit acceptance; filesystem writes and
  browser saves remain explicit actions.
- Browser chat sends the complete canonical browser schema on every tool-capable round. Presets
  change guidance only; do not reintroduce keyword routing or capability expansion.
- Preserve structured error codes and per-item illegal results from `compare_moves`.

## Working conventions

- Preserve unrelated dirty-worktree changes.
- Use `rg`/`rg --files` for discovery and `apply_patch` for edits.
- Planned initiative work follows `docs/COORDINATED_IMPLEMENTATION_WORKFLOW.md` (historical filename):
  direct single-session implementation is the default, focused checks run per task, complete gates
  run at phase boundaries, and separate-agent review is used only when explicitly requested.
- Add behavioral tests with contract changes; update generated catalog, skills, README summary, and
  plugin versions together when the public MCP surface changes.
- No `Co-Authored-By` trailers.
- Release only when requested: commit, tag `v0.x.y`, and push the tag; tag CI creates the release.
