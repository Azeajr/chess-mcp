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

Probe and session containers are bounded by `UX_REVIEW_DOCKER_MEMORY` (3g) and
`UX_REVIEW_DOCKER_CPUS` (2), so a runaway browser dies instead of the host. The session's Vite
server runs on the host outside that bound and caps its heap through `UX_REVIEW_SERVER_HEAP_MB`
(1024), which does not cover its child processes. Run one heavy workload at a time: concurrent
sessions across worktrees, or a session alongside `pnpm test:e2e:container`, still add up on one
machine.

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
A full-page capture only grows with the page, so content hidden inside a pane that scrolls itself
stays out of the image and the capture comes back identical to the viewport shot. `screenshot
--full-page` names every such pane and how much of it is offscreen; scroll each one and capture it.
Reading the hidden text out of the DOM proves it exists, not that a person can reach or read it —
only a screenshot of the scrolled state does.

Prefer accessible roles/names or references from the latest snapshot. References can change after
rendering. In a repeating list, several entries can legitimately carry the same name; a name-only
locator then resolves to more than one element, and `.first()` silently picks whichever came back
first. Scope such a click by a stable identity attribute instead — finding cards expose
`data-finding-id` — and record which entry you actually opened. `cli --help` and
`cli --help <command>` show the pinned CLI syntax. Direct host CLI calls do not address the browser
in the review container.

## Commands and options

| Command              | Behavior                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `preflight`          | Probe Docker/WebKit and the default port, or a supplied development URL.                                                     |
| `start`              | Start owned Vite/container, seed a fresh profile, capture and check the baseline.                                            |
| `reset`              | Save the old fault report, recreate the profile, and replay the same seed in a new run.                                      |
| `screenshot <label>` | Save a numbered viewport PNG; optional `--full-page` (also reports internally scrolled panes the image omits) and `--hires`. |
| `check`              | Write `faults.json`; exit 1 for an unallowed runtime, engine, or network fault.                                              |
| `status`             | Show ownership/state, seed digest, artifact path, and next commands.                                                         |
| `stop`               | Close the session and remove only the owned container/server; retain evidence.                                               |
| `cli <args...>`      | Forward arbitrary interactions to the named in-container CLI daemon.                                                         |

Exit 0 means success; exit 1 means invalid input, failed preflight/postcondition, a runtime fault,
or an ownership/cleanup failure. Every command accepts `--help`.

| Option                  | Default / meaning                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--session`             | `chess-ux`; 1–48 lowercase letters, digits, or hyphens. Repeat on later commands.                                     |
| `--browser`, `--device` | `webkit`, `iPhone 13 Mini`; overrides must be compatible. No fallback.                                                |
| `--port`                | Owned Vite port, default `4173`; use a distinct port per concurrent session/worktree.                                 |
| `--url`                 | Known localhost dev server from this worktree, identity-verified and never stopped. Mutually exclusive with `--port`. |
| `--route`               | `/`; must stay on the app origin.                                                                                     |
| `--seed`                | `rich-repertoire`; the checked-in PGN also supplies the E2E helper.                                                   |
| `--pgn`, `--color`      | Optional repo-contained PGN and `white` (default) or `black`.                                                         |
| `--setup`               | Trusted repo-contained file with one `async page => { ... }` expression.                                              |
| `--workflow`            | `review`; artifact label, not a canned journey.                                                                       |
| `--output`              | `.ux-review`; repeat alternatives on later commands; use a dedicated ignored directory.                               |

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

Vite serves the live host working tree on a strict port. A host/user port lease remains reserved until
the owning session closes its browser and stops its server, even if the server dies early. Use
`--port 4181`, `--port 4182`, etc. for concurrent reviews; a different session name alone does not
isolate the network address. The container uses Linux host networking,
a read-only repository mount, and a writable session artifact mount. CLI state uses a temporary
container home. Commands print exact Docker/CLI invocations and host-readable screenshot paths.
The manifest records image/browser/device values, source commit/worktree status, seed digest, and
ownership. Git ignores the default `.ux-review` tree; these are not approved regression snapshots.

The development server exposes a worktree identity and a unique server-lifetime token at
`/__ux-review/identity`, also embedded in the page. The controller checks both before and after
interactions. Navigation checks reject a different server before loading its page; HMR paths are
unique per server lifetime. This also applies to supplied `--url` servers: restart requires stop/start
and a fresh seed. Production builds do not expose this review endpoint. A failed health check marks
the run `infrastructure-failed`; it cannot be continued or reset against a replacement server.

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

`check` also scans every visible `menu`/`menuitem`/`dialog`/`alertdialog`/`tooltip`/`listbox`/`option`
for a `layout-overflow` fault: an element whose rendered edges fall outside the current viewport.
This is automated, not a substitute for looking at a screenshot — it only covers popover-shaped
overlays (an anchor-positioning bug like a menu growing off the trailing edge of a control near the
screen edge), not general layout defects. Do not rely on memory or a screenshot alone to catch that
one class of bug; `check` fails on it deterministically.

The context-level collector supplements navigation-scoped CLI logs: reload/navigation cannot hide
earlier failures. New pages are watched too. Seed faults fail startup before logs clear. `check`
retains evidence; reset writes the prior report before starting clean. Never erase the collector
to make a review pass.

`faults.json` includes its check timestamp and run ID. Ordinary console warnings are retained in a
separate `warnings` array (they do not silently count as success or as runtime errors). Seed warnings
remain in the run. Session `events.jsonl` records commands, CLI failures, server PID/start identity,
exit code/signal, and stop/reset/health events. Stop captures a final check before closing the browser;
unavailable collectors preserve the previous evidence and add an infrastructure failure.

Do not interpret a Playwright locator timeout as an application error. Use a role/name from the
current snapshot, scoped to its active dialog or region. For example, branching annotation uses
`getByRole('button', { name: 'Generate annotated repertoire', exact: true })`; `Annotate PGN` is a
separate chat workflow label. The Black repertoire selector sets the prepared side and orientation,
not whose turn it is.

A control that opens a native file chooser (e.g. Open PGN, whose WebKit fallback is a detached
`<input type="file">`) leaves the browser in a modal state: `cli upload <file>` resolves it, and
`dialog-accept`/`dialog-dismiss` resolve an `alert`/`confirm`/`prompt`. While a modal is open,
Playwright's `run-code` tool — which the controller's own health check and `check` use to read
browser state — cannot execute; the controller treats that specific failure as a normal, transient
wait rather than lost server continuity, so open the chooser and resolve it in back-to-back `cli`
calls without a `reset`/`stop` in between. A different health-check failure still marks the run
`infrastructure-failed` as before.

## Completion evidence by workflow

`--workflow` accepts an artifact label; it never runs a canned journey. A baseline screenshot or
zero-fault check cannot establish workflow completion. Record **every attempt**, failed runs included,
with its run ID, inspected images, exact terminal state and missing coverage. Never present a clean
retry as the only attempt. The generated `review.md` provides fields for these observations.

| Journey       | Required visible completion evidence                                                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Position      | Select a known position, await local candidates, compare a named legal move/continuation, and verify the resulting FEN/path. Record a real move and undo; a screenshot filename is not move proof. |
| Game review   | Select a single mainline, obtain accuracy and turning points, navigate to a mistake and inspect a grounded alternative. A branching repertoire does not mean every branch was reviewed.            |
| Annotation    | Choose game or branching artifact explicitly; observe progress, cancel/retry and terminal result; download and parse PGN, verify branches/annotations and unchanged source document.               |
| Repertoire    | Complete a structural review plus an audit or gap scan; inspect a navigable finding; stage/reject a change, then explicitly accept a separate revision-bound change.                               |
| Strategic Fit | Choose a profile, run analysis, inspect a finding and its evidence, and return with document/focus continuity. Profile selection alone is not analysis.                                            |

Include focused negative scenarios: invalid input, illegal candidate, missing explorer authentication,
worker asset failure and recovery, cancelled/failed export. Retain expected faults and separate these
from clean journeys. Provider requests are stubbed; these runs cannot establish live-service health.
Use the same named fixture/side when comparing runs. Existing white `rich-repertoire` evidence cannot
be described as a CT Black review. The canonical four contract families live in
`packages/chess-tools/src/workflow-contract.ts`; Strategic Fit is part of repertoire review, not an
extra canned controller workflow. Direct MCP calls validate tool behavior, not browser discovery.

Await visible status, enabled controls, result rows, or disappearing progress UI. Where needed,
use bounded locator/`waitForFunction` waits or an existing read-only harness accessor. For scans,
observe both running and terminal states so old results cannot satisfy the wait. Do not use fixed
sleeps or generic `networkidle` as proof of completion.

Each forwarded CLI call is killed after 180 seconds, so keep every bounded wait under that and
repeat it rather than asking for one long one; the browser keeps working across the boundary. That
kill prints nothing at all, so a call that addresses a control inside a closed `<details>` looks
identical to a hung application: the action waits for an element that will never become visible
until something opens the section. Click the `summary` first, or drive the section's own button,
which opens it. The same silence hides a wait aimed at a state the panel reaches by another route —
`Extend here` and `Fill this` render candidate rows that must then be clicked to stage, so waiting
on the staged-line card straight after pressing them times out with no output. In
this profile `page.mouse.wheel` throws — mobile WebKit has no wheel — so scroll a container by
focusing or clicking something inside it, and read long content with `textContent`, since a
zero-height scroller yields an empty `innerText`. `textContent` also returns hidden text, so it says
what a section holds, not what the reader can see; check `open`, visibility or a bounding box before
calling something visible.

Anything reached through the assistant needs a provider. `apps/ui/test/fixtures/ux-review/` holds
`--setup` stubs — `game-review-provider.js` and `position-provider.js` — that stand in for the
model's tool choice and nothing else; both tools then run for real in the browser. Copy one for a
new journey. They are listed in `.prettierignore` because the controller evaluates each as a single
expression, and a formatter-added trailing semicolon makes that unparseable.

Editing source mid-session reloads the app through HMR, which clears in-memory state such as a
completed Strategic Fit report and resets every `<details>` to its markup default. That is the
development server, not the application; `reset` and replay rather than reasoning from the state an
edit left behind.

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

Three things about that gate, learned by being caught by each. It buffers all output until it exits,
and a wrapper's reported exit code has been wrong at least once, so read the run's own
"N passed / N failed" line before believing it passed. Host WebKit is not installed, so plain
`pnpm test:e2e` fails its webkit project locally — the environment, not the tests; the container is
the authority. Run the UI unit suite as `pnpm --filter @chess-mcp/ui test:chat`: `node --test` with
a glob from the repository root silently picks up the Playwright specs, which cannot run there.

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

Port leases live at `/tmp/chess-ux-<uid>-port-<port>.lock` and identify the session manifest. Use that
owner's `stop` to release one. After an uncatchable termination, inspect both its recorded server
identity and owned container before manually removing that exact lease; a dead server alone does
not mean the browser is closed. Never delete another session's lease to start a competing server.

Real Safari/device checks remain separate for virtual keyboards, safe-area integration, installed-PWA
chrome, file pickers/shares, codecs, Apple fonts, platform accessibility, performance/memory, or a
Safari-only defect. They are not prerequisites for every Linux WebKit review.

`scripts/playwright-low-impact.mjs` runs under `systemd-run` with `CPUQuota=30%` by default. That
quota starves work the app performs during a test, so a timeout waiting on analysis completing, a
click landing, or `page.evaluate` returning is usually starvation rather than a defect. Five
`strategic-fit-*` specs failed this way and all passed unchanged at `E2E_CPU_QUOTA=200%`, one of
them dropping from a 30s timeout to 4.3s. Re-run with a larger quota, or use
`pnpm test:e2e:container`, before treating such a timeout as a real failure; the runner prints this
hint when a run fails under the default quota.
