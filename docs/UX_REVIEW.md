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

Probe and session containers are bounded by `WEB_HARNESS_DOCKER_MEMORY` (3g) and
`WEB_HARNESS_DOCKER_CPUS` (2), so a runaway browser dies instead of the host. The session's Vite
server runs on the host outside that bound and caps its heap through `WEB_HARNESS_SERVER_HEAP_MB`
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
| `observe SELECTOR`   | Return compact JSON for up to five matching elements: rendered text, visibility, boxes, scrolling and clipping.              |
| `state`              | Return document identity/revision, selected path, command statuses and Strategic Fit lifecycle state as compact JSON.        |
| `run REPO_FILE`      | Execute a trusted batch of Playwright actions/assertions with inspection helpers; retain results and failure evidence.       |

Exit 0 means success; exit 1 means invalid input, failed preflight/postcondition, a runtime fault,
or an ownership/cleanup failure. Every command accepts `--help`.

| Option                  | Default / meaning                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--session`             | `chess`; 1–48 lowercase letters, digits, or hyphens. Repeat on later commands.                                        |
| `--browser`, `--device` | `webkit`, `iPhone 13 Mini`; overrides must be compatible. No fallback.                                                |
| `--target`              | `dev` (Vite + `window.__chess`) or `production` (built bundle, `_headers` applied, `--fixture blank` only).           |
| `--port`                | Owned server port, default `4183` (E2E owns 4173); use a distinct port per concurrent session/worktree.               |
| `--url`                 | Known localhost dev server from this worktree, identity-verified and never stopped. Mutually exclusive with `--port`. |
| `--route`               | `/`; must stay on the app origin.                                                                                     |
| `--fixture`             | `rich-repertoire` (dev accessor seed; the checked-in PGN also supplies the E2E helper) or `blank`.                    |
| `--pgn`, `--color`      | Optional repo-contained PGN and `white` (default) or `black`.                                                         |
| `--setup`               | Trusted repo-contained file with one `async page => { ... }` expression.                                              |
| `--workflow`            | `review`; artifact label, not a canned journey.                                                                       |
| `--output`              | `.web-harness`; repeat alternatives on later commands; use a dedicated ignored directory.                             |

Browser/seed/server options apply to start/preflight. Reset reuses the recorded configuration and
refuses changed PGN/setup digests; stop/start establishes a new baseline. Put controller options
before `cli`; everything after it belongs to Playwright:

```sh
pnpm ux:review -- --session chess cli find "Strategic Fit"
pnpm ux:review -- --session chess cli run-code "async page => { await page.getByRole('button', { name: 'Return to repertoire' }).click(); }"
```

## Fast model-driven runs

Reuse one session across a journey. For general desktop iteration, explicitly choose Chromium;
retain the default mobile WebKit profile for mobile review. Both use the existing bounded Docker
image and a warm browser. Use `pnpm exec web-harness` instead of `pnpm ux:review --` when
avoiding package-manager startup overhead matters.

```sh
pnpm exec web-harness start --browser chromium --device "Desktop Chrome"
pnpm exec web-harness observe '.board-wrap'
pnpm exec web-harness state
pnpm exec web-harness run apps/ui/test/harness/strategic-fit.js
pnpm exec web-harness check
pnpm exec web-harness stop
```

`run` accepts a repository-contained file with one `async (page, helpers) => { ... }` expression
(an optional final semicolon is accepted). It is trusted code, with the same authority as `cli
run-code`. Use ordinary Playwright actions and condition-based waits. A batch takes one CLI
execution plus the usual before/after health checks, regardless of its action count. Session
commands remain serialized; independent local browser workloads still share the host resource
budget. The example opens profile setup, chooses a profile and returns; it does not claim to
complete Strategic Fit analysis.

Helpers are:

- `step(name, async () => { ... })`: label an action/assertion group and record its elapsed time.
  An uncaught failure stops the batch; later steps do not execute. Up to 100 named steps are retained.
- `assert(condition, message)`: fail on a false condition. This is immediate, so await the relevant
  locator or bounded `page.waitForFunction` condition before asserting asynchronous state.
- `observe(locatorOrSelector, options)`: inspect only the matching elements. Options are `limit`
  (default 5, maximum 20), `textLimit` (default 300, maximum 2000), and arrays of `css` property names
  and `attributes` (maximum 20 each). Use an existing role/name locator to avoid selector guessing.
  The response includes match count and truncation indicators. Visibility describes layout and CSS
  visibility; it does not prove that another element is not covering the target. Viewport
  intersection and clipping ancestors are reported separately. Inspect an actual screenshot for
  visual judgments; computed state alone cannot prove readability or appearance.
- `state(sections)`: read selected groups (`document`, `commands`, `strategicFit`; all by default)
  in one browser evaluation. Every response carries current document ID and revision. Reports carry
  their own document/revision so stale results can be distinguished. Full PGNs, credentials and
  result bodies are omitted. Command results are indicated by `hasResult`; use an explicit read-only
  `page.evaluate` query for the specific result needed. Metadata status is not proof of a durable
  IndexedDB write, and these development accessors do not replace production persistence tests.

Return a small JSON value from the batch. `run`, `observe` and `state` emit JSON with success/error,
results, timings and artifact paths. Output over 16,000 characters is replaced by a summary linking
to the full report. Source, digest and full result are retained in the run directory. No screenshot
or trace is collected on success. On assertion or browser-fault failure, the batch attempts a
viewport screenshot and state capture, retains the fault report, and exits nonzero. Unavailable
diagnostics are recorded without replacing the original error. A browser/transport crash may prevent
image capture. `check` remains the explicit overlay-overflow check and final journey fault gate.

Keep individual waits and the complete batch below the CLI's 180-second limit. A transport timeout
does not prove browser work stopped; inspect the session before replaying a mutation. For long work,
start it in one batch and inspect completion in a later call. Do not add fixed sleeps. Use native
chooser/dialog event handlers within the batch, or resolve the modal with the existing CLI commands.

Each result records `executionMs` (inside the browser CLI, including failure capture), `totalMs`
(controller startup through health checks/evidence, excluding the outer pnpm launcher),
`transportCalls`, and `transportMs` (CLI calls including Docker ownership inspection). These timings
overlap; do not add them together. Compare equivalent work in a warm session before changing the
transport. The focused Docker acceptance test reports cold start and three separate state queries
versus the same queries in one batch:

```sh
node --test --test-name-pattern='structured batches' scripts/harness.integration.test.mjs
```

Use `cli snapshot TARGET --depth=...` or `cli find` for accessible discovery, and request screenshots
at meaningful visual states. Batch related actions and assertions to reduce model/tool round trips.
Keep traces opt-in (`cli tracing-start`, `cli tracing-stop`); a trace must start before the events it
needs to capture. After a fix, reset and replay the same source/seed, then promote the assertions into
the conventional Playwright suite and run the authoritative container gate.

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
ownership. Git ignores the default `.web-harness` tree; these are not approved regression snapshots.

The development server exposes a worktree identity and a unique server-lifetime token at
`/__web-harness/identity`, also embedded in the page. The controller checks both before and after
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

The controller is [web-harness](https://github.com/Azeajr/web-harness), configured by
`harness.config.mjs`; its own contracts are tested in that repository. Chess Docker acceptance proof:
`node --test scripts/harness.integration.test.mjs` (starts and cleans up its own review session).
If Docker bridge creation is unavailable on the Linux host, stop the review server to free port 4173
and run `WEB_HARNESS_E2E_NETWORK=host pnpm test:e2e:container`. The image and test suite stay identical;
the ordinary bridge mode remains the default.

## Recovery and limits

A failed start attempts cleanup and retains logs. For an interrupted start/reset, inspect `status`,
then `stop` and `start`. Ownership mismatches fail safely; never use broad process kills or Docker
prune. Commands serialize through a session lock. After an uncatchable termination, inspect
`command.lock`, verify its PID/start time is no longer active, then remove that exact stale lock
before `stop`. Retained review artifacts can be removed separately when no longer needed.

Port leases live at `/tmp/web-harness-<uid>-port-<port>.lock` (shared by every project on the host) and identify the session manifest. Use that
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

## Roadmap: complete agent-driven coverage

The development harness already provides warm Docker browser sessions, arbitrary Playwright
interactions, targeted inspection, screenshots, batched assertions, computational summaries and
failure evidence. The shared controller (web-harness) has since shipped the production target,
persistent-profile `restart`, `reload`, scenario-local expected faults for tests and the scenario
inventory; each stage below says what shipped and what remains. Remaining items are planned, not
commands available today. Completion means reproducible coverage of defined scenarios;
browser control alone cannot establish that every possible application state has been tested.

### 1. Production sessions and browser restart persistence

**Status:** shipped in web-harness — `start --target production` builds into the session
directory, records the content digest, serves it with `public/_headers` applied and checks
readiness through visible controls; `state` answers `unsupported` there; `restart` reopens the same
persistent profile with faults retained; `reset` clears the profile and replays the fixture.
**Remaining for chess:** production setup through the visible file-import control (today only
`--fixture blank` runs on production), and the acceptance journey below as a checked-in test.

**Build:**

- Add an explicit development/production target to the controller and its manifest.
  Development remains the default. Production serves a previously built artifact through an owned
  static server; build once and reuse it across journeys. Record its content digest, browser/image,
  origin, viewport and device scale factor. Reject an absent or mismatched artifact before starting.
- Extract the reusable static-serving and build-switching behavior from
  `apps/ui/test/pwa-lifecycle.mjs` into shared test infrastructure. Preserve that script's existing
  assertions while adding controller lifecycle support in web-harness.
- Separate server ownership checks from application readiness checks. Production readiness uses
  visible controls and served artifact identity, with no dependency on `window.__chess` or the
  development identity endpoint. Keep unexpected server replacement a failure. An explicitly
  requested build transition must record the old/new build identities without silently reseeding.
- Add production setup through the visible file-import and side-selection controls. On profile
  resume, verify the saved document instead of importing the seed again. Production `state` should
  report available UI/browser evidence and explicitly mark development-only fields unavailable.
- Add a session-owned profile directory on a writable mount, exclusive ownership/locking, and
  compatibility checks for browser/image/device settings. Test the installed CLI's persistent-profile
  support first; controller-owned profile options must not become arbitrary CLI overrides.
- Implement distinct lifecycle operations: reload the page; restart the browser while preserving
  its profile and origin; reset by clearing the profile and replaying setup; stop while explicitly
  retaining or discarding a persistent profile. Keep existing ephemeral-session defaults. A storage
  JSON export is insufficient for preserving service workers, caches and all browser-managed data.
- Retain evidence across restarts and recover interrupted sessions using the existing ownership
  checks. Failures must not cause the controller to delete an unrelated profile or release a port
  still owned by a live browser.

**Acceptance:** against the ordinary production build, import a fixture, make a visible move, await
the persisted revision, restart the browser, and verify the same document and move in both storage
and the UI. Reset must remove that edit and restore the seed. Run this in Docker with cleanup and
ownership assertions. Confirm development accessors remain absent from production.

### 2. PWA controls and targeted storage inspection

Depends on production sessions and persistent profiles. **Status:** expected-fault declarations
shipped for Playwright tests (`expectPageFault(kind, pattern)`: excused and required); offline
reload of the shipped artifact is proven by `pnpm smoke` in CI. Session-level offline/update
controls and storage inspection remain planned.

**Build:**

- Package the existing Playwright offline/online control and service-worker inspection into the
  session interface. Report registration scope, controller script, installing/waiting/active states
  and the build currently rendered. Preserve controller health checks while browser networking is
  offline; expected offline navigation must not be mistaken for a replaced development server.
- Add selected IndexedDB database/store/key reads and bounded cache inventories. Include capture
  time, missing/unavailable status and truncation indicators. Support polling a specific persisted
  document ID/revision; in-memory metadata readiness is not proof of storage completion. Add OPFS
  inspection when an application feature uses it.
- Support serving build B on the same origin while build A is controlled by a service worker.
  Expose the transition as an explicit test operation and verify waiting, deferred update prompts,
  Later and Reload through the application's visible controls. Reuse existing lifecycle fixtures;
  distinguish an ordinary production build from an instrumented lifecycle-test build in evidence.
- Add scenario-local expected-fault declarations for deliberate offline/provider/worker failures.
  Match kind, relevant request/error identity and expected count or bound. Retain every record;
  unexpected faults and missing expected faults fail the scenario. Update batch and `check` handling
  together so they produce the same verdict.

**Acceptance:** exercise online boot, service-worker control, offline reload, offline edit, browser
restart while offline and reconnection. Verify document continuity and required cached assets.
Exercise A-to-B update during an active operation and after it settles, preserving user work.
Unexpected network/runtime errors must still fail. Extend the existing production lifecycle gate
to run these deterministic assertions; development E2E remains a separate gate.

### 3. Computational observability for uncovered workflows

Can proceed alongside production work. Internal accessors remain development-only.

**Build:**

- Inventory each workflow's required observations against `apps/ui/src/index.tsx` and
  `state.read` in `harness.config.mjs`. Record gaps before adding accessors: current FEN/path, engine and
  worker readiness, operation identity/progress/cancellation, staged mutation revision, training
  session state, result freshness and persistence completion are candidates to assess.
- Add only missing read-only accessors at the store or worker-message owner, then compose them into
  selectable `state` groups. Expose bounded summaries and explicit result-detail queries. Worker
  internals require intentional reporting; a DOM query cannot reveal arbitrary worker memory.
- Carry document/revision and operation/report identifiers with relevant results. Distinguish
  running, completed, cancelled, failed, stale and unavailable states. Keep credentials and full
  documents out of default summaries. Reading an accessor must not start analysis or mutate state.
- Add capture timestamps and shared observation IDs to related state, UI and screenshot artifacts.
  State that captures are sequential; IDs correlate evidence but do not make screenshots and
  asynchronous application state atomic.

**Acceptance:** drive a real visible operation through running and terminal states, cancel and
retry it, then edit the document and demonstrate that stale evidence is identifiable. Tests verify
that inspection causes no mutation. Production journeys continue to assert visible behavior and
durable storage without relying on these accessors.

### 4. Journey recording and complete failure bundles

Reuse CLI tracing, the context fault collector, `step`, batch reports and session events.

**Build:**

- Add optional recording boundaries around a journey, with trace chunks and bounded console,
  request/response metadata and application lifecycle events. Start recording before the actions
  being investigated. Attach page/worker/service-worker diagnostics where supported by the chosen
  engine; report unsupported events explicitly. Network bodies and video remain opt-in.
- Associate each event with its session/run, page, timestamp and active step where available.
  Preserve earlier records across navigation and browser restart; finalize a segment before an
  orderly restart and link the new segment afterward.
- Assemble a failure bundle containing original assertion/error, step history, faults, available
  state, screenshot, trace path and build/seed/profile identities. Record unavailable diagnostics
  without masking the original failure. Detect action batches that outlive a transport timeout and
  prevent blind mutation replay until their status is resolved.
- Add retention/size bounds and exclude credentials from recorded headers and bodies. Keep ordinary
  runs lightweight: targeted queries and existing failure capture by default; recording is selected
  when transient events need to be diagnosed. A traced reproduction is a separate attempt, not a
  recording of the original failure.

**Acceptance:** deliberately fail an assertion, a request and a worker operation. Inspect the
resulting bundles and prove each identifies the failed step and preceding evidence. Verify orderly
reload/restart linkage and partial evidence after a crash. Measure recording overhead and output
size against the same journey with recording off.

### 5. Executable coverage inventory and regression promotion

**Status:** the inventory lives in `harness.config.mjs` (`scenarios`); `pnpm harness scenarios`
checks every mapped test exists, CI runs it, and `--results` joins it to a Playwright JSON report.
It covers a first set of journeys; growing it to the scope below remains planned.

**Build:**

- Add a small versioned scenario inventory beside the existing test fixtures, derived from
  `packages/chess-tools/src/workflow-contract.ts`, this document's completion requirements and
  `ROADMAP.md`. Include UI journeys outside the canonical tool families, such as document
  management, settings, training and PWA lifecycle.
- Give each scenario an ID, fixture/side, prerequisites, target build, browser/viewport requirements,
  observable acceptance conditions and associated Playwright spec or exploratory evidence. Cover
  success, invalid input, dependency failure, cancel/retry, navigation/focus continuity, staged
  accept/reject/undo, file output and persistence where applicable. Record unsupported cases and
  reasons explicitly. A named scenario is not evidence that it passed.
- Extend deterministic provider/engine fixtures for missing branches, including the chat journey,
  Black and larger repertoires, Strategic Fit completion/export, Replacement Lab and worker loss.
  Use reproducible engine fixtures for exact-result assertions and retain separate real-engine
  checks. Keep live-provider health checks distinct from stubbed workflow coverage.
- Add a lightweight report/check that validates inventory references and joins scenario IDs to
  current test results or run evidence. Report passed, failed, not run and unsupported with source
  revision and configuration; old evidence must not imply a pass on the current revision. Map to
  existing Playwright tests instead of introducing another test execution language.
- Add explicit viewport/DPR overrides recorded and replayed by the controller. Select representative
  phone, tablet, desktop and intermediate-width cases, plus relevant browser engines. Reuse existing
  visual baselines, helpers and container snapshot-update rules.
- Document the defect promotion loop: preserve a failing reproduction, write a conventional test
  importing the shared fixtures, observe it fail before the fix, apply the fix, replay the same
  scenario and verify the regression. Route production cases to the production lifecycle gate and
  UI cases to the authoritative container E2E gate.

**Acceptance:** every inventoried scenario has an executable check or an explicit unverified/device
limitation; reports distinguish those states. Demonstrate the full failure-to-fix loop for a UI
defect and a persistence/lifecycle defect. Real installed-PWA and Safari/device behavior remains
separately identified wherever desktop browser emulation cannot establish it.

### Delivery order and performance constraints

First deliver production launch plus persistent restart and prove one saved-document journey end
to end. Next add offline/update/storage controls. Fill observability gaps and add recording where
the scenario inventory demonstrates a need; expand deterministic coverage throughout the work.

Keep the existing Docker image, browser reuse, batch execution and conventional Playwright tests.
Reuse a browser for ordinary independent contexts where isolation permits; persistent-profile
tests require their own lifecycle. Build artifacts once per revision, use condition-based waits,
request bounded state and capture images only at meaningful states or on failure. Run one heavy
local workload at a time and use existing CI sharding for independent suites.

At each stage record cold start, warm action/inspection, reset/restart, journey duration, output
size and peak memory for equivalent scenarios. Measure Vite/static-server resources separately
from the browser container. Establish machine-specific regression budgets from those measurements.
Consider a persistent Playwright worker only if transport overhead remains a material bottleneck
after batching; the roadmap does not require a second browser service or MCP server.
