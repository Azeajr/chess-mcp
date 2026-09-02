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
pnpm check:legacy-imports
pnpm bench:strategic-fit         # --record to rebaseline; --scale large needs a raised heap
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
pnpm --filter @chess-mcp/ui test:chat
pnpm test:e2e:container          # authoritative e2e run (see below)
pnpm --filter @chess-mcp/ui build
pnpm dev                       # use dev:host for LAN
pnpm mcp
```

CI uses Node 26. `SMOKE_NETWORK=0` skips live Lichess/Chess.com assertions, not engine/local paths.
`EVAL_CACHE_DIR=0` disables the persistent evaluation cache. `pnpm bench:strategic-fit` reads the
UI's exported render bounds from source, so it needs a Node release that strips TypeScript types.

### e2e: which command to trust

`pnpm test:e2e:container` (root, needs Docker) is the **authoritative** e2e run — it executes
`scripts/playwright-container.mjs`, which runs the suite inside `mcr.microsoft.com/playwright:v<ver>-noble`,
the same image family CI uses. Treat any failure it reproduces as real.

`pnpm test:e2e` (root or `apps/ui`, needs `pnpm exec playwright install chromium firefox webkit`
once, locally) is faster to iterate with but runs on whatever the host OS actually has. On
non-Ubuntu hosts (e.g. Arch) this is a known source of false signal:

- WebKit may fail outright with missing system libs (`libgstreamer`, `libgtk-4`, `libicudata.so.74`,
  `libavif`, `flite`, `libmanette`, `enchant`, `hyphen`, …) — an environment gap, not a bug.
  `icu`/`flite`/`libmanette` in particular can be unavailable or version-mismatched via `pacman`.
- `toHaveScreenshot` and pixel-geometry assertions can fail on font/AA rendering differences from
  the OS the baselines were captured on.
- Under the `systemd-run`-capped profiles below, iteration-heavy tests (e.g. the 320–2560px width
  sweeps in `core-layout.spec.ts`) can hit Playwright's fixed 30-second per-test timeout: CPU
  throttling slows wall-clock execution, but the timeout budget doesn't scale with it. Confirmed
  2026-08-23: the same tests pass cleanly in `test:e2e:container` (unthrottled).

Before reporting an e2e failure found via the host command as a real bug, reproduce it with
`pnpm test:e2e:container` first. To rebaseline screenshots, use
`pnpm test:e2e:update-snapshots` (also container-based) — never regenerate baselines from a host run.

`pnpm --filter @chess-mcp/ui test:e2e:host` is a capped, chromium+firefox-only, non-`@visual`
subset — the fastest way to get trustworthy behavioral signal locally without Docker or a webkit
install. See "Interactive validation limits" below for how it's capped and why.

### Interactive validation limits

`pnpm test:e2e -- [Playwright args]` (root or `apps/ui`) runs one worker inside a `systemd-run
--user` cgroup capped at 30% CPU, 2 GiB `MemoryHigh`, 3 GiB `MemoryMax`, nice level 15, and a
15-minute hard runtime limit — requires Linux/systemd. Those defaults are calibrated for a
`--grep`- or path-scoped run of one package's tests, not the full suite; an unscoped `pnpm test:e2e`
will hit the 15-minute wall on this codebase's current size and get SIGTERM'd mid-run. Scope it
(`pnpm test:e2e -- apps/ui/test/e2e/core-layout.spec.ts` or `-- --grep WP-NNN`), or override
`E2E_RUNTIME_MAX` deliberately for a broader pass.

`pnpm --filter @chess-mcp/ui test:e2e:host` runs the same wrapper with a profile suited to its
broader (chromium+firefox, non-`@visual`) scope: `E2E_CPU_QUOTA=60%`, `E2E_RUNTIME_MAX=45min`,
same 2 GiB/3 GiB memory caps and nice 15.

Override any of `E2E_CPU_QUOTA`, `E2E_MEMORY_HIGH`, `E2E_MEMORY_MAX`, `E2E_NICE`, `E2E_RUNTIME_MAX`
as env vars. The named user service is `chess-mcp-playwright-low-impact`; stop it with
`systemctl --user stop chess-mcp-playwright-low-impact.service` if needed, or inspect it with
`systemctl --user status chess-mcp-playwright-low-impact.service`.

## Boundaries and sources of truth

- `packages/chess-tools/src/tool-contract.ts` owns tool identifiers, descriptions, hosts,
  capabilities, defaults, validation metadata, and result kind. Generate
  `docs/TOOL_CATALOG.md` with `pnpm docs:generate`; never edit it by hand.
- `packages/chess-tools/src/workflow-contract.ts` owns shared workflow invariants, method
  boundaries, and the Strategic Fit explanation/exploration contract, whose cited fields are typed
  against the bounded retrieval projection. Generate skill sections with `pnpm sync:skills`; do not
  hand-edit generated blocks.
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
  browser saves remain explicit actions. Profile preferences the assistant infers are staged the
  same way, shown as an exact diff, and become durable only through the single profile-state writer
  in `apps/ui/src/store/strategic-fit-profile.ts`; a staged proposal is void once the document
  revision, effective profile, or analysis settings change.
- Assistant-written plan cards for retained exceptions are staged and evidence-bound: each section
  must cite a concept, checkpoint, or drill from that finding's deterministic training record, and
  every move its text mentions must be on a validated path. Acceptance goes through the existing
  training writer in `apps/ui/src/store/strategic-fit-training.ts`, which re-validates the card.
- Constrained portfolio redesign parses bounds the assistant states, shows them for confirmation, and
  binds nothing until the user confirms; a contradiction is put to the user, never relaxed. Options
  are Replacement Lab candidates that already have Task 8.6 scoring, Task 8.7 safety, and a Task 8.8
  change set, and every reported value is read out of that retained evidence — unmeasured evidence is
  an elimination reason, never a satisfied bound. Selecting an option stages through the existing
  change review path in `apps/ui/src/store/strategic-fit-replacement.ts`; it adds no second staging,
  scoring, or generation path.
- Browser chat sends the complete canonical browser schema on every tool-capable round. Presets
  change guidance only; do not reintroduce keyword routing or capability expansion.
- Preserve structured error codes and per-item illegal results from `compare_moves`.
- Strategic Fit performance budgets live in `scripts/lib/strategic-fit-benchmark.mjs` and are gated by
  `scripts/strategic-fit-benchmark.mjs`. The benchmark observes analysis and never changes it: it
  scans generated deterministic repertoires through the ordinary entry points, proves each scan
  returns what an unmeasured run returns, and asserts paging, mounted-window, and cache limits
  against the constants the product already exports. Costs that depend on the machine are budgeted as
  ratios; a recorded baseline is compared only when its environment, analysis manifest, and fixture
  digests match.

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

## UI/UX remediation (retired)

The UI/UX remediation program (WP-000–WP-038, `pnpm ux:task`/`ux:test`/`ux:plan-check`) shipped in
full — 39/39 packages, 20/20 gates (commit `5f9f856`) — and its docs and tooling were removed. A
`WP-<three digits>` reference in a request now refers to closed historical work only.

That program's accessibility evidence pipeline (`AG-1`–`AG-5`, real NVDA/VoiceOver capture on
Windows and macOS runners, `apps/ui/test/accessibility/`) was removed along with its
`.github/workflows/accessibility.yml` workflow — this is a single-user personal project and the
gate proved more expensive to keep green than the assurance was worth. An `AG-<digit>` reference
now refers to closed historical work only; the rationale and what it once caught are in that
removal commit.

The deterministic checks in `apps/ui/test/e2e/helpers/accessibility.ts` are NOT part of that
removal and remain live. Despite the filename, most of what they assert is general UI
correctness — document overflow, raw identifiers leaking into visible text, contrast ratios,
duplicate DOM ids, touch-target floors — and eight functional e2e specs depend on them.

## Training drills

`TrainException` creates a training item, which registers each drill position as an **untrained
target**. `DrillRunner` is the surface that attempts one: it shows the position, takes a single
move, and records the outcome through `recordStrategicFitDrillAttempt`.

Two rules hold that apart, and both are load-bearing rather than stylistic:

- **Never record an attempt from drill creation.** Registration establishes an untrained state;
  only a move the user really played may supply recall, response-time, lapse, confidence, or
  spacing evidence. Recording on creation fabricates evidence and corrupts every mastery figure
  derived from it. Pinned by "training targets remain explicitly untrained until a real attempt
  exists" (chess-tools) and "creating a training item registers targets but records no attempt"
  (apps/ui).
- **Recall is first-attempt only.** A wrong move is revealed and recorded as a miss, with no retry,
  because a retry that overwrote the first result would make recall rate meaningless.

Drills are rebuilt from current evidence via `strategicFitDrillsFor`, not cached: creating an item
triggers reanalysis, which remounts the panel and discards component state.

That remount is also why the drill _session_ — which position is showing, what has been answered —
lives in the training store keyed by training id, not in `DrillRunner`. Recording an attempt
changes mastery evidence, which schedules a reanalysis, which unmounts the resolution column. Held
in the component, the session would be destroyed by the user's own first move, and re-answering the
same drill would write a second attempt for that target.
