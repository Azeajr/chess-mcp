# chess-mcp agent guide

pnpm TypeScript monorepo. `packages/chess-tools` owns shared domain logic and the canonical
application contract, `apps/mcp-server` is the active stdio MCP host, and `apps/ui` is the
SolidJS/Vite PWA. CI uses Node 26.

## Commands

```sh
pnpm --filter @chess-mcp/chess-tools build
pnpm -r typecheck
pnpm docs:check
pnpm check:skills
pnpm check:legacy-imports
node --test scripts/wp020-responsive-tiers.test.mjs scripts/wp036-design-tokens.test.mjs scripts/wp037-primitives.test.mjs
pnpm bench:strategic-fit
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
pnpm --filter @chess-mcp/ui test:chat
pnpm --filter @chess-mcp/ui build
pnpm test:e2e:container
```

`SMOKE_NETWORK=0` skips live provider assertions; `EVAL_CACHE_DIR=0` disables persistent evaluation
caching. The design-contract tests inspect `apps/ui/src`, so CSS changes can fail them.

Use `pnpm test:e2e:container` as the authoritative e2e result. Host runs can fail from missing
WebKit libraries, OS-specific rendering, or the default resource cap. Use the container command to
confirm host failures and `pnpm test:e2e:update-snapshots` to update images. Snapshot copying occurs
only after a completely successful run; numeric geometry baselines must be updated from container
failure output.

For focused host iteration, `pnpm test:e2e -- <path-or-grep>` runs one worker with a 15-minute cap.
`pnpm --filter @chess-mcp/ui test:e2e:host` runs the broader Chromium and Firefox non-visual subset.
Resource limits are configurable through `E2E_CPU_QUOTA`, `E2E_MEMORY_HIGH`, `E2E_MEMORY_MAX`,
`E2E_NICE`, and `E2E_RUNTIME_MAX`.

## Sources of truth

- `packages/chess-tools/src/tool-contract.ts` owns tool identity, metadata, validation, host
  support, and result kinds. Regenerate `docs/TOOL_CATALOG.md` with `pnpm docs:generate`.
- `packages/chess-tools/src/workflow-contract.ts` owns shared workflow invariants and generated
  skill guidance. Run `pnpm sync:skills`; `.claude/skills/` is canonical and `plugin/skills/` is a
  synchronized copy.
- `apps/ui/src/application/browser-commands/registry.ts` is the exhaustive browser execution
  registry. Chat and direct report/export controls call it.
- `packages/chess-tools` must not import SolidJS, MCP SDK, Zod, or OpenRouter types.

## Invariants

- MCP repertoire handles are bounded LRU entries with idle TTL; edits are clone-on-write.
- Node Stockfish uses a child-process pool; `ENGINE_POOL_SIZE=0` selects the in-process fallback.
  Browser Stockfish uses scan workers plus a dedicated live worker.
- Evaluations use White POV unless explicitly converted and labeled. Depth is clamped to 1–30.
- Game review is mainline-only. Multi-game repertoire PGNs merge into one variation tree.
- Browser mutations, inferred profile preferences, plan cards, and replacement choices are staged
  and revision-bound. They become durable only through their existing single writer after explicit
  acceptance.
- A constrained replacement portfolio uses already-retained scoring, safety, change-set, and
  measured-bound evidence. Contradictions are surfaced and missing measurements never satisfy a
  bound.
- Browser chat always receives the complete canonical browser schema. Presets change guidance only.
- Preserve structured errors and per-item illegal results from `compare_moves`.
- Creating a training item registers untrained targets and never records an attempt. Recall uses
  the user's first move only. Drill session state stays in the training store because recording an
  attempt triggers reanalysis and component remounting.

## Work

Preserve unrelated changes. Use `rg` for discovery and `apply_patch` for edits. Keep public contract
changes synchronized across tests, generated catalog and skills, README, and plugin versions. Run
focused checks per task and full gates at phase boundaries. Do not add `Co-Authored-By` trailers.
Release only when requested; tag CI creates releases.
