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
  population-filtered opening popularity, and tablebase lookup.
- Game: summary and move review, annotated PGN, batch review, and Lichess/Chess.com history.
- Repertoire: prescribed-move audit, missing replies, coverage, critical moves and drill decks,
  theory depth, structure search, practical-history comparison, opponent preparation, and annotated
  export, secret-free Strategic Fit JSON sidecars, and clone-only portable intent PGNs.
- Advanced repertoire: transposition-aware Strategic Fit V2 reports with explicit profiles,
  profile-composed manual/population/personal weighting, empirically shrunk Lichess/Chess.com
  personal-history frequency, bounded custom feature-family weights, persisted browser source
  filters with visible availability, browser-local training-adjusted metrics with source coverage, stable
  cursor paging over large reports,
  provenance; bounded conversation retrieval of an existing
  report's summary, one finding page, or one finding with evidence and navigable paths; a staged
  browser intent interview that turns stated goals into proposed profile preferences shown as an
  exact diff and saved only on explicit acceptance; staged plan cards for retained exceptions whose
  every section cites that finding's own concepts, checkpoints, drills, and validated moves;
  confirmed redesign bounds that select a bounded portfolio of already-generated candidates with the
  measured value behind every bound, and name the binding bound when nothing qualifies;
  transposition
  shortening, shortcut inspection, complete revision-bound
  Strategic Fit V2 candidate/change-set previews with explicit browser staging, atomic archive/undo
  persistence, honest MCP archive/undo limits, complementary lines, and shared best-eval/best-fit gap fills.

Engine-backed position, game, and repertoire operations default to depth 20. The PWA's analysis
selector can enable global Deep analysis at depth 30; it warns that bulk work may take minutes and
shows determinate progress whenever an operation reports completed and total positions.

Chat accepts a natural first message; workflow presets change guidance only. Every tool-capable
round receives the complete stable browser command schema, while the prompt carries only compact
document context and scoped commands retrieve a selected subtree, the full PGN, or one bounded view
of an existing Strategic Fit report when needed; a report identity that is no longer current fails
with a structured error rather than returning older evidence. Long
operations show progress and share Stop/Retry lifecycle handling with streaming. Tool results render
as navigable application data. Proposed edits are staged against a document revision and require
Accept; direct repertoire previews expose Accept line/Cancel controls, and generated PGN/CSV/JSON
artifacts have direct save actions. Profile preferences the assistant infers from conversation are
staged the same way: the exact field-level difference is shown, invalid concepts and out-of-range
values are rejected rather than adjusted, a proposal made against an older revision, profile, or
analysis settings can no longer be applied, and nothing becomes durable intent without an explicit
Accept. A plan card the assistant writes for a retained exception is staged the same way: it is
grounded in that finding's deterministic evidence, shows the support behind every section, and
reaches training metadata only through the existing training path on an explicit Accept. A redesign
goal stated in plain terms becomes explicit bounds that are shown for confirmation before anything is
built from them; any contradiction is put back as a question, the portfolio that follows contains
only candidates the lab already generated with the measured value behind each bound, and choosing one
stages its existing change set for the same revision-bound confirmation.

Direct analysis is available without chat. User-triggered reports and exports invoke the canonical
browser application commands and result models; continuous live board evaluation and a few
multi-step panel workflows remain explicit UI orchestration. MCP and browser host differences are
intentional: MCP uses repertoire handles and confined filesystem operations, while the browser
injects the current document and supplies staged UI actions. See the generated
[tool catalog](docs/TOOL_CATALOG.md) for the exact inventories.

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
pnpm test:e2e:container          # authoritative e2e run — matches CI's image; needs Docker
```

The network-gated MCP smoke still exercises the bundled engine and local paths. CI runs on Node 26.
Use `pnpm docs:generate` after changing the canonical registry; do not edit the generated catalog.

`pnpm test:e2e:container` runs the e2e suite inside `mcr.microsoft.com/playwright:v<ver>-noble` via
`scripts/playwright-container.mjs` — treat what it reports as ground truth. `pnpm --filter
@chess-mcp/ui test:e2e` runs the same suite against whatever browsers are installed on the host
(`pnpm exec playwright install chromium firefox webkit` once, first) and is faster to iterate with,
but on a non-Ubuntu host it can produce false failures: WebKit needs system libs Ubuntu ships and
Arch/others may not (GStreamer, GTK4, an ICU build matching the exact `.so` version, flite,
libmanette, …), and screenshot/pixel-geometry assertions can drift from OS font rendering.
Reproduce any host-only e2e failure with the container command before treating it as real, and
rebaseline screenshots with `pnpm test:e2e:update-snapshots`, not from a host run.

`pnpm test:e2e` runs in a `systemd-run`-capped cgroup by default (Linux/systemd only) so it doesn't
saturate a shared machine; see AGENTS.md's "Interactive validation limits" for the resource caps,
their env-var overrides, and `pnpm --filter @chess-mcp/ui test:e2e:host`, a faster capped subset.

## Repository guide

- [AGENTS.md](AGENTS.md): current commands and operational constraints for coding agents.
- [Architecture](docs/ARCHITECTURE.md): implemented system design.
- [Tool catalog](docs/TOOL_CATALOG.md): generated host inventories and contract metadata.
- [PWA product](docs/PWA_PRODUCT.md): conversation, direct analysis, actions, and artifacts.
- [Roadmap](ROADMAP.md): unshipped work only.
- [Implementation workflow](docs/COORDINATED_IMPLEMENTATION_WORKFLOW.md): single-user, risk-tiered
  task execution and phase verification.
