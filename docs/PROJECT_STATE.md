# chess-mcp project state

Audit date: 2026-09-26. Baseline commit: `e754453` (merge of PR #77) on `main`.
Scope: read-only audit; no source code was changed. Sections 1–4 answer the audit brief; §5 logs
the commands actually run; §6 lists what could not be verified.

## 1. Current testing state

CI is defined in `.github/workflows/ci.yml` (job `node`, job `ui-e2e` sharded 6 ways, job
`ui-checks` via `.github/workflows/ui-checks.yml`). There are no unit-test frameworks beyond
`node:test` (run through `node --test` or `tsx --test`) and Playwright for browsers. Column
"Verified here" refers to this audit's run on 2026-09-26 (Node v26.2.0, pnpm 11.25.0); see §5.

### Test layers

| Layer                                                        | Location                                                                                                                    | Command                                                                                                                                            | Gate / authority                                                               | Verified here                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Build of shared package                                      | `packages/chess-tools/src` → `dist/`                                                                                        | `pnpm --filter @chess-mcp/chess-tools build`                                                                                                       | Prerequisite for smoke scripts, docs/skills checks, tool-contract check        | yes — pass                                                 |
| Typecheck                                                    | all 3 workspace packages                                                                                                    | `pnpm -r typecheck`                                                                                                                                | CI `node` job                                                                  | yes — pass                                                 |
| Lint / format                                                | repo root (`eslint.config.mjs`, oxfmt)                                                                                      | `pnpm lint`, `pnpm format:check`                                                                                                                   | CI `node` job                                                                  | not run                                                    |
| chess-tools core unit                                        | `packages/chess-tools/test/core/*.test.ts` (20 files)                                                                       | `pnpm test:chess-tools`                                                                                                                            | CI `node` job                                                                  | yes — 257/257 pass                                         |
| Strategic Fit domain unit                                    | `packages/chess-tools/test/strategic-fit/*.test.ts` (50 files)                                                              | `pnpm test:strategic-fit`                                                                                                                          | CI `node` job                                                                  | yes — 415/415 pass                                         |
| UI unit (chat, stores, Strategic Fit UI logic)               | `apps/ui/test/*.test.ts` (59 files)                                                                                         | `pnpm --filter @chess-mcp/ui test:chat`                                                                                                            | CI `ui-checks`                                                                 | yes — 412/412 pass                                         |
| Tool-contract parity (contract ↔ browser registry ↔ MCP Zod) | `scripts/tool-contract-inventory.mjs`, `scripts/tool-contract-semantics.mjs`                                                | `pnpm check:tool-contract`                                                                                                                         | CI `node` job; authoritative for public tool surface                           | yes — pass                                                 |
| Generated docs current                                       | `scripts/tool-catalog.mjs`, `scripts/docs-consistency.mjs` → `docs/TOOL_CATALOG.md`                                         | `pnpm docs:check` (regenerate: `pnpm docs:generate`)                                                                                               | CI `node` job                                                                  | yes — pass ("51 canonical; 42 MCP; 45 browser")            |
| Skills in sync                                               | `scripts/workflow-guidance.mjs`; `.claude/skills/` vs `plugin/skills/`                                                      | `pnpm check:skills` (fix: `pnpm sync:skills`)                                                                                                      | CI `node` job (first step)                                                     | yes — pass ("workflow guidance: current", `diff -r` clean) |
| Markdown links                                               | `scripts/check-links.mjs` (+ `check-links.test.mjs`)                                                                        | `pnpm check:links`                                                                                                                                 | CI `node` job                                                                  | yes — pass (17 tracked md files)                           |
| Browser content registry                                     | `scripts/check-content.mjs`                                                                                                 | `pnpm check:content`                                                                                                                               | CI `node` job                                                                  | yes — pass                                                 |
| Legacy import boundary                                       | `scripts/check-legacy-imports.mjs`                                                                                          | `pnpm check:legacy-imports`                                                                                                                        | CI `node` job                                                                  | yes — pass                                                 |
| Design-contract tests (inspect `apps/ui/src` CSS/TSX)        | `scripts/wp020-responsive-tiers.test.mjs`, `scripts/wp036-design-tokens.test.mjs`, `scripts/wp037-primitives.test.mjs`      | `node --test scripts/wp020-responsive-tiers.test.mjs scripts/wp036-design-tokens.test.mjs scripts/wp037-primitives.test.mjs`                       | CI `node` job                                                                  | yes — 13/13 pass                                           |
| Agent-harness adapter (web-harness)                          | `scripts/harness.integration.test.mjs` (Docker, not in CI); controller contracts are tested in the web-harness repo         | `node --test scripts/harness.integration.test.mjs`                                                                                                 | opt-in, local                                                                  | yes — 3/3 pass (2026-09-27)                                |
| Deterministic smoke (engine-free, no network)                | `scripts/smoke-gametree.mjs`, `scripts/structure-accuracy.mjs`                                                              | `node scripts/smoke-gametree.mjs && node scripts/structure-accuracy.mjs`                                                                           | CI `node` job                                                                  | yes — 207 passed; 27/27                                    |
| MCP server unit suites                                       | `apps/mcp-server/test/{confine,cache,handles,perftools}.mjs`                                                                | `node --import tsx apps/mcp-server/test/<name>.mjs`                                                                                                | CI `node` job                                                                  | yes — 10/22/22/40 pass                                     |
| MCP stdio end-to-end smoke                                   | `apps/mcp-server/test/smoke-client.mjs` (spawns `apps/mcp-server/src/index.ts`, checks every tool against `TOOL_CONTRACTS`) | `SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs`                                                                      | CI `node` job; authoritative for MCP host behavior                             | yes — 89 pass, 0 fail, 3 network groups skipped            |
| PWA production build                                         | `apps/ui` Vite build + `apps/ui/scripts/check-worker-boundary.mjs` (postbuild) + `apps/ui/test/pwa-build.test.mjs`          | `pnpm --filter @chess-mcp/ui build && node --test apps/ui/test/pwa-build.test.mjs`                                                                 | CI `ui-checks`                                                                 | not run                                                    |
| PWA offline / SW update lifecycle                            | `apps/ui/test/pwa-lifecycle.mjs` (Chromium against prod build)                                                              | `pnpm exec playwright install chromium && node apps/ui/test/pwa-lifecycle.mjs`                                                                     | CI `ui-checks`                                                                 | not run                                                    |
| Browser e2e (Playwright)                                     | `apps/ui/test/e2e/*.spec.ts` (44 specs), helpers in `apps/ui/test/e2e/helpers/`, config `apps/ui/playwright.config.ts`      | Authoritative: `pnpm test:e2e:container` (CI: `-- --shard=N/6`). Focused host: `pnpm test:e2e -- <path-or-grep>`; `pnpm test:e2e -- --grep @smoke` | CI `ui-e2e`; **the container run is the authoritative e2e result** (AGENTS.md) | **not executed** (deliberately — long suite)               |
| Visual baselines                                             | `apps/ui/test/e2e/*-snapshots/` (`@visual` tag in 4 spec files)                                                             | `pnpm test:e2e:update-snapshots` (container only)                                                                                                  | Part of `ui-e2e`; `@visual` is skipped on host runs (commit `c924020`)         | not executed                                               |
| Strategic Fit benchmark                                      | `scripts/strategic-fit-benchmark.mjs` vs `scripts/strategic-fit-benchmark.baseline.json`                                    | `pnpm bench:strategic-fit`                                                                                                                         | Manual, outside CI (machine timing)                                            | not run                                                    |
| OpenRouter tool-surface eval                                 | `scripts/openrouter-tool-surface-eval.mjs`                                                                                  | `pnpm verify:openrouter`                                                                                                                           | Manual release check; needs credentials                                        | not run                                                    |
| Live provider smoke                                          | same smoke client with network on                                                                                           | `node apps/mcp-server/test/smoke-client.mjs`                                                                                                       | Manual; depends on lichess/chess.com uptime                                    | not run                                                    |

### Playwright project matrix (`apps/ui/playwright.config.ts`)

- `chromium` — everything except `@mobile-webkit`.
- `firefox` — excludes `@visual`, `@engine-bound`, `@mobile-webkit`.
- `webkit` — same exclusions and additionally ignores `strategic-fit-findings.spec.ts` (111 KB, the
  largest spec).
- `mobile-webkit` (`iPhone 13 Mini`) — only `@mobile-webkit` (2 spec files).
- `webServer` is `pnpm dev` on port 4173 — e2e requires the dev server, not `vite preview`
  (test seams sit behind `import.meta.env.DEV`).
- Tags counted in this audit: `@smoke` in 7 spec files, `@visual` in 4, `@engine-bound` in 2,
  `@mobile-webkit` in 2. Browser-conditional `test.skip` occurs in `core-layout.spec.ts:119`,
  `core-a11y.spec.ts:248`, `chat-result-cards.spec.ts:53`.
- `timeout: 30_000`, `fullyParallel: false`; `retries` is unset, so a flaky test fails its shard.

### Which gate is authoritative for what

- **Public tool surface / catalog / skills** — `pnpm check:tool-contract`, `pnpm docs:check`,
  `pnpm check:skills` (sources of truth: `packages/chess-tools/src/tool-contract.ts`,
  `packages/chess-tools/src/workflow-contract.ts`).
- **MCP host behavior** — `apps/mcp-server/test/smoke-client.mjs` (engine on, network gated by
  `SMOKE_NETWORK`).
- **Browser behavior and visuals** — `pnpm test:e2e:container` only. Host runs
  (`pnpm test:e2e`, `pnpm --filter @chess-mcp/ui test:e2e:host`) are for iteration; they skip
  `@visual`, can fail from missing WebKit libraries, and run under a low-impact systemd CPU quota
  (`scripts/playwright-low-impact.mjs`, `E2E_CPU_QUOTA`), which can cause timeouts that are not real
  failures.
- **UI design system** — the three `scripts/wp0*.test.mjs` contract tests (they read
  `apps/ui/src`, so CSS edits can fail them).
- **PWA/offline** — `ui-checks` workflow (`pwa-build.test.mjs`, `pwa-lifecycle.mjs`).
- **Exploratory UX** — `pnpm ux:review` is evidence-gathering, explicitly _not_ a regression gate
  (`docs/UX_REVIEW.md`).

## 2. Development and testing harness for an autonomous agent

An agent can drive both hosts headlessly and capture functional and visual evidence without a
human. The pieces, from cheapest to most expensive:

### 2.1 MCP server (stdio)

- Run the server: `pnpm mcp` (= `tsx apps/mcp-server/src/index.ts`). File access is confined to
  `REPERTOIRE_DIR`; `ENGINE_POOL_SIZE=0` selects the in-process Stockfish fallback.
- Scripted driver: `apps/mcp-server/test/smoke-client.mjs` uses `@modelcontextprotocol/sdk`'s
  `StdioClientTransport` to spawn the server, calls tools via `client.callTool`, and asserts JSON
  results; it also compares the live tool list against `TOOL_CONTRACTS` from
  `packages/chess-tools/dist` (so build chess-tools first). It is the template for any new
  agent-driven MCP check: copy its `call(client, name, args)` helper.
  Command: `SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs`.
- Engine-free, deterministic domain drivers: `node scripts/smoke-gametree.mjs`,
  `node scripts/structure-accuracy.mjs`.
- Claude Code plugin surface: `plugin/` with skills synchronized from `.claude/skills/`
  (`pnpm sync:skills`). The repo's own skills (`analyze-position`, `annotate-pgn`,
  `chess-game-review`, `repertoire-builder`) exercise the MCP tools end to end when the plugin is
  installed — useful for a qualitative agent-level check, but not scripted.

### 2.2 Browser e2e (Playwright)

- Specs import `test`/`expect` from `apps/ui/test/e2e/helpers/fixtures.ts`, which fails a test on any
  uncaught page error, `console.error`, or `[engine]` warning, stubs every off-origin request with
  JSON `null`, and disables cloud eval before boot. Deliberate faults are declared with
  `allowPageFaults(/pattern/)`; extra contexts go through `watchContext(context)`.
- Helpers: `helpers/app.ts` (boot/seed), `helpers/board.ts` (plays real moves on chessground — it
  binds mouse/touch, so synthetic `isTrusted=false` events do not work), `helpers/accessibility.ts`,
  `helpers/viewports.ts`, `helpers/strategic-fit-worker-fixture.ts`.
- The dev build exposes a test seam on `window.__chess` (used by `docs/UX_REVIEW.md` seeding); it is
  absent from production builds.
- Commands: `pnpm test:e2e -- <path-or-grep>` (host, one worker, 15-min cap);
  `pnpm test:e2e -- --grep @smoke` (7 critical-path tests); `pnpm test:e2e:container` (authoritative;
  Docker, 1 worker, 6g/4 CPU bound); `WEB_HARNESS_E2E_NETWORK=host pnpm test:e2e:container` where Docker
  bridge networking is unavailable; `pnpm test:e2e:update-snapshots` to regenerate PNG baselines
  (copied only after a fully green run). Failure artifacts: `apps/ui/playwright-report`.
- Runners: `web-harness e2e` (container gate, via `pnpm test:e2e:container`), `scripts/playwright-low-impact.mjs`
  (host runner under systemd resource limits `E2E_CPU_QUOTA`, `E2E_MEMORY_HIGH`, `E2E_MEMORY_MAX`,
  `E2E_NICE`, `E2E_RUNTIME_MAX`).

### 2.3 Interactive UX review (`pnpm ux:review`) — visual state capture

Documented in `docs/UX_REVIEW.md`; the controller is the shared
[web-harness](https://github.com/Azeajr/web-harness) package, adapted to this app by
`harness.config.mjs`; there is also a scoped skill `apps/ui/.claude/skills/run-ui/SKILL.md` that
points at the same controller. It drives the repo-local Playwright CLI inside the version-matched
Docker image (default headless WebKit, `iPhone 13 Mini`), against an owned host Vite dev server on
port 4183 (or, with `--target production`, the built bundle).

Typical agent loop (from `docs/UX_REVIEW.md` "First review"):

```sh
pnpm --filter @chess-mcp/chess-tools build
pnpm ux:review -- preflight
pnpm ux:review -- start --workflow strategic-fit          # seeds rich-repertoire PGN, baseline capture
pnpm ux:review -- cli snapshot --depth=6 --boxes          # accessibility snapshot with boxes
pnpm ux:review -- cli click "getByRole('button', { name: 'Open Strategic Fit' })"
pnpm ux:review -- screenshot profile-setup                # numbered viewport PNG; --full-page / --hires
pnpm ux:review -- check                                   # writes faults.json; exit 1 on runtime/engine/network fault
pnpm ux:review -- reset                                   # replay same seed after an edit
pnpm ux:review -- stop                                    # remove owned container/server, keep evidence
```

- Evidence lands under `.web-harness/` (git-ignored): manifest (image, device, commit, fixture digest),
  screenshots, `faults.json`, and the agent-written `review.md`.
- Options: `--session`, `--target`, `--port` (use distinct ports per concurrent worktree), `--url`, `--fixture`,
  `--pgn`/`--color`, `--setup` (trusted `async page => {…}` for prerequisites only), `--output`.
- Stubbed providers for journeys needing network: `apps/ui/test/fixtures/ux-review/`
  (`game-review-provider.js`, `position-provider.js`).
- Rules the doc imposes on agents: actually open each PNG with an image-capable tool (writing a
  screenshot is not verification); scroll internally scrolled panes and screenshot them, since
  full-page captures miss them; use visible controls once seeded; `check` also auto-detects
  viewport-overflowing popovers as a `layout-overflow` fault (added in PR #73).
- Resource bounds: `UX_REVIEW_DOCKER_MEMORY` (3g), `UX_REVIEW_DOCKER_CPUS` (2),
  `UX_REVIEW_SERVER_HEAP_MB` (1024). Run one heavy workload at a time.
- Durable findings are promoted into Playwright specs and confirmed with `pnpm test:e2e:container`
  ("Edit, replay, and promote" in `docs/UX_REVIEW.md`).

### 2.4 Suggested autonomous-agent validation ladder

1. `pnpm --filter @chess-mcp/chess-tools build && pnpm -r typecheck` (seconds).
2. Focused unit suite for the touched area (`pnpm test:chess-tools`, `pnpm test:strategic-fit`,
   `pnpm --filter @chess-mcp/ui test:chat`).
3. Contract checks if tool/workflow/docs touched: `pnpm check:tool-contract`, `pnpm docs:check`,
   `pnpm check:skills`; design-contract `node --test scripts/wp0*.test.mjs` if CSS/UI touched.
4. MCP smoke if server/domain touched: `SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs`.
5. Visual/functional exploration: `pnpm ux:review` loop above.
6. Before merge: `pnpm test:e2e:container` (one heavy job at a time).

## 3. Likely next features (inferred)

**Everything in this section is inference**, not a committed plan. Evidence base:

- `ROADMAP.md` ("Only unshipped work belongs here") — the only forward-looking doc. `docs/PWA_PRODUCT.md`
  and `docs/ARCHITECTURE.md` describe shipped behavior only; neither lists future work.
- `gh issue list --state open` and `gh pr list --state open` returned no rows on 2026-09-26; the
  most recent issues (#42, #43, #45) are closed.
- Commit themes since 2026-08-01 (non-merge, by conventional-commit prefix): `fix(a11y)` 25,
  `fix(ui)` 15, `docs` 15, `fix(ux)` 11, `ci(a11y)` 10, `feat(a11y)` 9, `feat(ui)` 6. The last ~15
  merged PRs (#61–#77) are UX-journey fixes, Strategic Fit redesign/honesty fixes, and ux-review
  tooling — i.e. the project is in a polish/hardening phase, not adding tools.
- No `TODO`/`FIXME`/`HACK`/`XXX` markers exist in tracked source, tests, scripts or docs (`rg`
  over the repo excluding the lockfile and generated catalog returned nothing), so in-code markers
  give no signal; `ROADMAP.md` is the de facto backlog.
- 204 commits (177 non-merge) have landed since the last tag `v1.1.19` (2026-07-31; plugin version
  in `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` is still `1.1.19`).

Inferred next work, most to least likely:

1. **A release (`v1.1.20` or `v1.2.0`).** 177 unreleased non-merge commits incl. the Strategic Fit
   redesign (PR #71) and drill runner. `ROADMAP.md` "Release checks" lists the manual gate: natural
   chat requests across workflows, staged accept/reject/undo, IndexedDB restore across a
   production restart, `pnpm verify:openrouter`, plugin workflow exercise. AGENTS.md: "Release only
   when requested; tag CI creates releases."
2. **Large-repertoire Strategic Fit measurement and cancellation** — `ROADMAP.md` "UI/UX pass →
   Still open": cost on a 62-leaf / 265-decision-node tree is unmeasured; Cancel never pressed to
   completion; "Finish the review" + summary export unproven end to end. Likely driven with
   `pnpm ux:review -- start --pgn <CT repertoire> --color black`.
3. **A chat journey with a provider stub** — `ROADMAP.md` "Still open: a chat journey"; needs an
   OpenRouter stub alongside `apps/ui/test/fixtures/ux-review/game-review-provider.js` and
   `position-provider.js`.
4. **Journey coverage for Black / large trees** in game review, position, annotation and Strategic
   Fit (`ROADMAP.md` "Coverage the completion journeys did not claim"), plus untested error paths
   (engine loss mid-scan, promotions, cloud-eval/tablebase, Replacement Lab).
5. **Quality items from `ROADMAP.md` "Quality"**: en-passant normalization before transposition
   keying; digit-zero castling (`0-0`) in proposed SAN lines; summary-to-detail references for
   near-context-limit results; a decision on `flushStrategicFitTrainingPerformance` page-lifecycle
   integration; staged lint-rule additions.
6. **Persistent Strategic Fit report summary** — blocked prerequisite for replacing the cold-start
   pitch (`ROADMAP.md` "Blocked rather than scheduled"); `application/strategic-fit-report-cache`
   is per-session only. Lower likelihood: explicitly blocked.
7. **Preset-weight calibration by a player** — `STRATEGIC_FIT_PRESET_PREFERENCES`
   (`packages/chess-tools/src/strategic-fit/metadata.ts:247` comment says the magnitudes are "a
   reasoned guess"). Needs human input, not code.

Not likely (explicitly settled in `ROADMAP.md` "Settled — do not reopen"): tours, a Strategic Fit
finding rail, shortening the chat setup card, merging the three unavailable-visualization states,
public-tool consolidation without usage evidence.

## 4. Technical debt (priority order)

Ordered by (risk of silent wrong results or broken CI) × (likelihood of being hit). Each item cites
its evidence.

1. **Gap-safety comparison uses truncated gap lists.**
   `packages/chess-tools/src/enginetools.ts:861-885` (`checkShortcutCoverage` path) runs
   `findRepertoireGaps` before/after a prune with the caller's `limit`, then sets
   `before_total: before.total_gaps` / `after_total: after.total_gaps`, where `total_gaps` is
   `gaps.length` _after_ `limit` truncation (`enginetools.ts:303`); the untruncated count
   `gaps_found` (`enginetools.ts:208-209, 304`) exists but is not used here. `ROADMAP.md`
   ("Coverage…") already records that both totals saturate at `limit` and says it was "deliberately
   left alone". _Inference, not verified by a test:_ `introduces_gap` / `new_gaps` are computed from
   the same truncated `gaps` arrays, so a newly introduced gap that sorts past `limit` could be
   missed, which would make a shortening look safe. Why it matters: this feeds the replacement /
   shortening safety evidence that Strategic Fit treats as authoritative. Fix is small (use
   `gaps_found`, compare untruncated sets) but is a public-result change → sync catalog/tests.
2. **Environment-coupled visual baseline.** `strategic-map-print.png` in
   `apps/ui/test/e2e/strategic-fit-visualization-hardening.spec.ts-snapshots/` must be taken from
   CI; rows 0–98 contain pinned app chrome that differs between local container and CI
   (`apps/ui/test/e2e/strategic-fit-visualization-hardening.spec.ts:290`, `ROADMAP.md` "Quality").
   Why it matters: `pnpm test:e2e:update-snapshots` locally produces a baseline CI rejects, so the
   documented regeneration workflow is broken for this one image. Fix: mask the chrome.
3. **Known e2e flake with no retries.** `focusBoardCursor` in
   `apps/ui/test/e2e/core-keyboard.spec.ts:55-64` presses Tab up to 120 times blind until a
   `gridcell` is focused; it is still present. Playwright `retries` is unset
   (`apps/ui/playwright.config.ts`), so one flake fails a CI shard. _Evidence for the flake rate
   (~1/3 on WP-014 AC-3) comes from maintainer notes, not from a run in this audit — unverified._
   Related: host runs under `scripts/playwright-low-impact.mjs` default to a low CPU quota and
   produce timeout "failures" that are starvation (AGENTS.md; re-run with `E2E_CPU_QUOTA=200%`).
4. **Manually synchronized artifacts** (CI catches drift for the first three; the rest rely on
   discipline):
   - `docs/TOOL_CATALOG.md` generated from `packages/chess-tools/src/tool-contract.ts` —
     `pnpm docs:generate`; guarded by `pnpm docs:check`.
   - `plugin/skills/` copy of `.claude/skills/`, and generated guidance from
     `packages/chess-tools/src/workflow-contract.ts` — `pnpm sync:skills`; guarded by
     `pnpm check:skills` (`rm -rf plugin/skills && cp -r` — any file added only under
     `plugin/skills/` is silently deleted).
   - MCP Zod schemas in `apps/mcp-server/src/index.ts` and browser registry
     `apps/ui/src/application/browser-commands/registry.ts` vs the contract — guarded by
     `pnpm check:tool-contract`.
   - **Plugin version** duplicated in `plugin/.claude-plugin/plugin.json:4` and
     `.claude-plugin/marketplace.json:12` — no script checks they match (`rg` over `scripts/`
     found no reference to either file). Unguarded.
   - Visual baselines (`apps/ui/test/e2e/*-snapshots/`) and numeric geometry baselines, which
     AGENTS.md says "must be updated from container failure output" by hand.
   - `scripts/strategic-fit-benchmark.baseline.json` — manual benchmark, not in CI; can go stale
     unnoticed.
   - `scripts/docs-consistency.mjs` forbids hand-written tool counts in any markdown file, so prose
     docs cannot state inventory sizes; counts live only in `docs/TOOL_CATALOG.md`.
5. **Very large files concentrating change risk** (line counts from `wc -l` on tracked source):
   `apps/ui/src/styles.css` 9731 lines (and the three `scripts/wp0*.test.mjs` design contracts read
   it, so edits there can fail CI); `packages/chess-tools/src/strategic-fit/replacement-expand.ts`
   3406; `replacement-score.ts` 2446; `replacement-engine.ts` 2284; `metadata.ts` 1949;
   `packages/chess-tools/src/tool-contract.ts` 1855; `apps/mcp-server/src/index.ts` 1678. On the
   test side `apps/ui/test/e2e/strategic-fit-findings.spec.ts` is 111 KB and is excluded from the
   `webkit` project. Why it matters: merge conflicts and review cost; no evidence of defects.
6. **Uneven browser coverage.** `firefox` and `webkit` skip `@visual` and `@engine-bound`;
   `webkit` skips the whole findings spec; `mobile-webkit` runs only two `@mobile-webkit` specs
   (`apps/ui/playwright.config.ts`). Linux WebKit is an iPhone emulation, not Mobile Safari
   (`docs/UX_REVIEW.md`). Real mobile Safari behavior is untested.
7. **Non-reproducible browser game review.** `ROADMAP.md`: the same seed produced different worst
   moves because browser engine search is time-sensitive — limits deterministic regression tests
   and agent replay for that journey.
8. **Unmeasured heuristics.** Strategic Fit preset weights (`metadata.ts:247`) are a documented
   guess; the gap scan's truncation note is unit-tested but never rendered in a real session
   (`ROADMAP.md`).
9. **Minor doc/config inconsistency.** `README.md` and root `package.json` `engines` say Node
   `>=20`, while CI and AGENTS.md use Node 26; nothing tests Node 20. Low impact, but the
   supported-runtime claim is unverified.

## 5. Verification log

Run on 2026-09-26 in this worktree at `e754453`, Node v26.2.0, pnpm 11.25.0, with existing
`node_modules`. All commands exited 0. `git status` afterwards showed only this file as untracked
(no `packageManager`/lockfile drift from running pnpm).

| Command                                                                                                                      | Result (real output)                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @chess-mcp/chess-tools build`                                                                                 | pass (`tsc -p tsconfig.json`)                                                                                                                                                               |
| `pnpm -r typecheck`                                                                                                          | pass — chess-tools, mcp-server, ui all "Done"                                                                                                                                               |
| `node --test scripts/wp020-responsive-tiers.test.mjs scripts/wp036-design-tokens.test.mjs scripts/wp037-primitives.test.mjs` | 13 tests, 13 pass                                                                                                                                                                           |
| `node --test scripts/ux-review.test.mjs scripts/check-links.test.mjs`                                                        | 14 tests, 14 pass                                                                                                                                                                           |
| `pnpm check:skills`                                                                                                          | pass — "workflow guidance: current", `diff -r` clean                                                                                                                                        |
| `pnpm docs:check`                                                                                                            | pass — "tool catalog: current", "documentation consistency: ok (51 canonical; 42 MCP; 45 browser)"                                                                                          |
| `pnpm check:legacy-imports`                                                                                                  | pass — "no production consumer imports legacy congruence or pivot behavior"                                                                                                                 |
| `pnpm check:links`                                                                                                           | pass — "links: ok (17 tracked markdown files)"                                                                                                                                              |
| `pnpm check:content`                                                                                                         | pass — content registry covers every browser command and 48 browser error codes (exact count phrasing omitted: `scripts/docs-consistency.mjs` rejects hand-written tool counts in markdown) |
| `pnpm check:tool-contract`                                                                                                   | pass — "tool contract inventory: ok", "tool contract semantics: ok"                                                                                                                         |
| `pnpm test:chess-tools`                                                                                                      | 257 tests, 257 pass                                                                                                                                                                         |
| `pnpm test:strategic-fit`                                                                                                    | 415 tests, 415 pass                                                                                                                                                                         |
| `pnpm --filter @chess-mcp/ui test:chat`                                                                                      | 412 tests, 412 pass                                                                                                                                                                         |
| `node scripts/smoke-gametree.mjs`                                                                                            | "207 passed, 0 failed"                                                                                                                                                                      |
| `node scripts/structure-accuracy.mjs`                                                                                        | "structure accuracy: 27/27"                                                                                                                                                                 |
| `node --import tsx apps/mcp-server/test/confine.mjs`                                                                         | 10 passed, 0 failed                                                                                                                                                                         |
| `node --import tsx apps/mcp-server/test/cache.mjs`                                                                           | 22 passed, 0 failed                                                                                                                                                                         |
| `node --import tsx apps/mcp-server/test/handles.mjs`                                                                         | 22 passed, 0 failed                                                                                                                                                                         |
| `node --import tsx apps/mcp-server/test/perftools.mjs`                                                                       | 40 passed, 0 failed                                                                                                                                                                         |
| `SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs`                                                | "89 passed, 0 failed, 3 network group(s) skipped" (cloud_eval/tablebase groups)                                                                                                             |

This report itself was checked with `pnpm docs:check` (pass) and `npx oxfmt --check docs/PROJECT_STATE.md`
(pass, after formatting it with `npx oxfmt docs/PROJECT_STATE.md`).

**Not executed** (deliberately or for time): `pnpm lint`, repo-wide `pnpm format:check`,
`pnpm --filter @chess-mcp/ui build` + `apps/ui/test/pwa-build.test.mjs`,
`apps/ui/test/pwa-lifecycle.mjs`, `pnpm test:e2e`, `pnpm test:e2e:container` (long container
suite — excluded by the audit brief), `pnpm ux:review` (needs Docker session),
`scripts/ux-review.integration.test.mjs`, `pnpm bench:strategic-fit`, `pnpm verify:openrouter`,
and the live-network smoke. The CI-equivalent `node` job is therefore reproduced locally except
lint/format; `ui-checks` is reproduced only for typecheck + `test:chat`; `ui-e2e` not at all.

## 6. Uncertainties and gaps

- The e2e suite (`pnpm test:e2e:container`) was **not executed**; its current pass state is taken
  on trust from CI history, not observed. Lint, format, PWA build/lifecycle, benchmark, OpenRouter
  eval and live-network smoke were also not run (§5).
- `pnpm ux:review` was not exercised; the harness description in §2.3 comes from
  `docs/UX_REVIEW.md` and `scripts/ux-review.test.mjs` (which passed), not from a live session.
- The e2e flake rate in §4.3 and the CI wall-clock figures are from maintainer notes, not measured
  here.
- §4.1's possible missed-gap consequence is reasoned from code reading; no test was written or run
  to confirm it.
- Only the 7 `@smoke`-tagged spec files were counted, not individual `@smoke` tests; AGENTS.md says
  seven tests.
- CI status of `main` at `e754453` was not queried (`gh run list` not run).
- §3 is inference; the maintainer may have plans not recorded in the repo.
