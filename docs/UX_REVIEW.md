# Interactive UX review

Exercise a real user journey, inspect the mobile UI, fix reproducible friction, and replay it. This
workflow uses the repo-local Playwright CLI in the same version-matched Docker image as the E2E
suite. The default is headless WebKit with `iPhone 13 Mini`. Linux WebKit emulates an iPhone; it is
not genuine Mobile Safari.

## Prerequisites

Run from the repository root with dependencies installed and the shared package built:

```sh
pnpm install --frozen-lockfile
pnpm --filter @chess-mcp/chess-tools build
pnpm ux:review -- preflight
```

The Linux host needs Node/pnpm and access to the existing Docker daemon. No host WebKit libraries,
global Playwright installation, or Playwright MCP are needed. Preflight checks the local version,
device/engine compatibility, matching image, an actual container browser launch, and port 4173.
It removes its temporary probe container and never installs packages or pulls images. If the image
is absent, run the exact `docker pull` command it prints through normal project Docker permissions.

## First review

Define the journey and completion state. For example: open Strategic Fit, choose a profile, inspect
the overview, and return to the repertoire without losing the document.

```sh
pnpm ux:review -- start --workflow strategic-fit
pnpm ux:review -- cli snapshot --depth=6 --boxes
pnpm ux:review -- cli click "getByRole('button', { name: 'Open Strategic Fit' })"
pnpm ux:review -- screenshot profile-setup
pnpm ux:review -- cli click "getByRole('button', { name: 'Use Balanced profile' })"
pnpm ux:review -- screenshot overview
pnpm ux:review -- check
```

Open each printed PNG with an image-capable tool. Creating a screenshot or reading its dimensions
is not visual verification. Record the goal/state, interactions, snapshot/screenshot paths, actual
visible friction, acceptance condition, and after-change observation in the run's `review.md`.
Viewport images are primary evidence; full-page captures supplement them for offscreen content.

Prefer accessible roles/names or references from the latest snapshot. References can change after
rendering. `cli --help` and `cli --help <command>` show the pinned CLI syntax. Direct host CLI calls
do not address the browser in the review container.

## Commands and options

| Command              | Behavior                                                                                |
| -------------------- | --------------------------------------------------------------------------------------- |
| `preflight`          | Probe Docker/WebKit and the default port, or a supplied development URL.                |
| `start`              | Start owned Vite/container, seed a fresh profile, capture and check the baseline.       |
| `reset`              | Save the old fault report, recreate the profile, and replay the same seed in a new run. |
| `screenshot <label>` | Save a numbered viewport PNG; optional `--full-page` and `--hires`.                     |
| `check`              | Write `faults.json`; exit 1 for an unallowed runtime, engine, or network fault.         |
| `status`             | Show ownership/state, seed digest, artifact path, and next commands.                    |
| `stop`               | Close the session and remove only the owned container/server; retain evidence.          |
| `cli <args...>`      | Forward arbitrary interactions to the named in-container CLI daemon.                    |

Exit 0 means success; exit 1 means invalid input, failed preflight/postcondition, a runtime fault,
or an ownership/cleanup failure. Every command accepts `--help`.

| Option                  | Default / meaning                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `--session`             | `chess-ux`; 1–48 lowercase letters, digits, or hyphens. Repeat on later commands.                  |
| `--browser`, `--device` | `webkit`, `iPhone 13 Mini`; overrides must be compatible. No fallback.                             |
| `--url`                 | Omitted: own Vite at `http://127.0.0.1:4173`. Supplied: known localhost dev server, never stopped. |
| `--route`               | `/`; must stay on the app origin.                                                                  |
| `--seed`                | `rich-repertoire`; the checked-in PGN also supplies the E2E helper.                                |
| `--pgn`, `--color`      | Optional repo-contained PGN and `white` (default) or `black`.                                      |
| `--setup`               | Trusted repo-contained file with one `async page => { ... }` expression.                           |
| `--workflow`            | `review`; artifact label, not a canned journey.                                                    |
| `--output`              | `.ux-review`; repeat alternatives on later commands; use a dedicated ignored directory.            |

Browser/seed/server options apply to start/preflight. Reset reuses the recorded configuration and
refuses changed PGN/setup digests; stop/start establishes a new baseline. Put controller options
before `cli`; everything after it belongs to Playwright:

```sh
pnpm ux:review -- --session chess-ux cli find "Strategic Fit"
pnpm ux:review -- --session chess-ux cli run-code "async page => { await page.getByRole('button', { name: 'Return to repertoire' }).click(); }"
```

## State and evidence

The named session keeps the browser alive between commands. Its profile is ephemeral inside the
container. Reset closes/deletes it, clearing local/session storage, IndexedDB, cookies, caches, and
application memory together. Reload preserves browser data and is not deterministic replay.

Vite serves the live host working tree on a strict port. The container uses Linux host networking,
a read-only repository mount, and a writable session artifact mount. CLI state uses a temporary
container home. Commands print exact Docker/CLI invocations and host-readable screenshot paths.
The manifest records image/browser/device values, source commit/worktree status, seed digest, and
ownership. Git ignores the default `.ux-review` tree; these are not approved regression snapshots.

The controller opens `about:blank`, installs routing/fault collection and disables cloud evaluation
before app boot, then waits for the dev harness and metadata restore. It loads PGN through
`window.__chess`, sets the side, and verifies exported PGN, side, route, visible board, and fonts.
Production preview cannot satisfy these checks.

Optional setup functions compose existing harness seams to establish prerequisites such as training
items. Return JSON postconditions. Do not use setup or harness calls to perform the journey being
reviewed. Once seeded, use visible controls. Keep credentials and private data out of fixtures,
arguments, logs, and screenshots.

## Faults and asynchronous work

External HTTP(S) requests receive the E2E policy's CORS-permissive JSON `null` and are recorded as
faults. Console errors, uncaught page exceptions, `[engine]` warnings, crashes, failed requests, and
HTTP responses >= 400 also fail `check`. Only the E2E fixture's narrow ResizeObserver page/console
noise is ignored. There is no broad fault suppression option. For deliberate error scenarios,
retain expected faults in review notes and use scenario-local `allowPageFaults` in promoted tests.

The context-level collector supplements navigation-scoped CLI logs: reload/navigation cannot hide
earlier failures. New pages are watched too. Seed faults fail startup before logs clear. `check`
retains evidence; reset writes the prior report before starting clean. Never erase the collector
to make a review pass.

Await visible status, enabled controls, result rows, or disappearing progress UI. Where needed,
use bounded locator/`waitForFunction` waits or an existing read-only harness accessor. For scans,
observe both running and terminal states so old results cannot satisfy the wait. Do not use fixed
sleeps or generic `networkidle` as proof of completion.

## Edit, replay, and promote

At meaningful states, inspect structure and viewport images, including relevant scrolling, focus,
loading, cancel/back, and recovery. Tie friction to the user's goal and existing design contracts.
After a narrow authorized edit, inspect HMR/reload, check faults, reset, and repeat the same controls
with the same seed. Inspect corresponding after images and update `review.md`. Stop when the stated
journey completes without identified material friction and evidence/checks support the changes.

Promote durable findings to Playwright tests importing `test`/`expect` from
`test/e2e/helpers/fixtures.ts`, using `openApp` and the existing `watchContext` rules. Assert
observable behavior such as reachability, focus return, state continuity, or no overflow. Use
`@mobile-webkit` only when the complete mobile descriptor matters; general tests stay in desktop
projects. Run focused checks, then `pnpm test:e2e:container` as the authoritative final gate.
Approved snapshots change only through `pnpm test:e2e:update-snapshots`. See the
[E2E policy](../AGENTS.md) and [verification commands](../README.md#verify).

```sh
pnpm ux:review -- check
pnpm ux:review -- stop
pnpm ux:review -- status
```

Controller checks: `node --test scripts/ux-review.test.mjs`. Docker acceptance proof:
`node --test scripts/ux-review.integration.test.mjs` (starts and cleans up its own review session).
If Docker bridge creation is unavailable on the Linux host, stop the review server to free port 4173
and run `E2E_DOCKER_NETWORK=host pnpm test:e2e:container`. The image and test suite stay identical;
the ordinary bridge mode remains the default.

## Recovery and limits

A failed start attempts cleanup and retains logs. For an interrupted start/reset, inspect `status`,
then `stop` and `start`. Ownership mismatches fail safely; never use broad process kills or Docker
prune. Commands serialize through a session lock. After an uncatchable termination, inspect
`command.lock`, verify its PID/start time is no longer active, then remove that exact stale lock
before `stop`. Retained review artifacts can be removed separately when no longer needed.

Real Safari/device checks remain separate for virtual keyboards, safe-area integration, installed-PWA
chrome, file pickers/shares, codecs, Apple fonts, platform accessibility, performance/memory, or a
Safari-only defect. They are not prerequisites for every Linux WebKit review.
