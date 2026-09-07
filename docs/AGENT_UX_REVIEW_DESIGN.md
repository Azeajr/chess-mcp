# Agent-driven UX review loop

Status: implemented; see [the operating guide](UX_REVIEW.md) for current commands
Audience: the coding agent implementing this design and maintainers reviewing that implementation

Primary environment: existing version-matched Playwright Docker image on Linux, headless WebKit,
emulated `iPhone 13 Mini`

## 1. Outcome

Add a repo-native workflow through which a coding agent can establish a known application state,
use the application as a user, inspect both structural and rendered state, change source, and replay
the same scenario until the result is satisfactory. Durable findings then become ordinary Playwright
tests and pass the existing containerized browser suite.

The intended request is outcome-oriented rather than test-script-oriented:

> Complete a workout from beginning to end on an iPhone 13 Mini. Fix every source of unnecessary
> friction you encounter. After each change, repeat the workflow and visually verify the result.

The delivered capability must support this loop:

```text
agent task
  -> start/reset a named browser session from a deterministic seed
  -> inspect the accessibility snapshot
  -> interact through roles, labels, and snapshot references
  -> await observable completion
  -> capture viewport screenshots
  -> actually inspect the images
  -> inspect console, page, engine, and network faults
  -> edit source
  -> allow Vite HMR or explicitly reload
  -> reset and replay from the same seed
  -> compare behavior and images
  -> encode durable behavior as a Playwright test
  -> run focused tests, then the authoritative container suite
```

This is an exploratory development tool. It does not replace Playwright Test, visual regression
baselines, or CI.

### Non-goals

- Do not add Playwright MCP merely to expose functionality already available through the local CLI.
- Do not build a general workflow language, recorder, autonomous UX grader, or screenshot-diff
  service.
- Do not turn exploratory screenshots into approved regression baselines automatically.
- Do not silently install OS packages, browser binaries, or global npm packages.
- Do not make live Lichess, Chess.com, or OpenRouter responses part of a repeatable review.
- Do not claim that Linux WebKit is genuine Mobile Safari or a real iPhone.
- Do not migrate the existing E2E suite to the CLI.

## 2. Current state

### 2.1 Playwright and application server

- The root package declares `playwright` and the lockfile currently resolves Playwright 1.62.1.
  Always invoke the repo-local executable through `pnpm exec playwright`; do not use
  `@playwright/mcp@latest` or a global installation.
- `pnpm dev` starts the SolidJS/Vite PWA. The E2E config starts it at `127.0.0.1:4173` and reuses an
  existing server outside CI. The new workflow should use that same host and port with Vite's
  `--strictPort` option, rather than the older driver default of `localhost:5173`.
- `apps/ui/playwright.config.ts` defines desktop Chromium, Firefox, and WebKit projects. WebKit is
  currently `devices["Desktop Safari"]`; no project applies a complete mobile device descriptor.
- The installed `iPhone 13 Mini` descriptor exists and currently supplies WebKit, a 375 x 629 CSS
  pixel viewport inside a 375 x 812 screen, device scale factor 3, mobile viewport behavior, touch,
  and an iPhone user agent. Hard-code only the descriptor name, not those derived values, and print
  the resolved values in review metadata so Playwright upgrades are visible.

### 2.2 Existing interactive automation

`apps/ui/.claude/skills/run-ui/` already demonstrates the application-specific path:

- `SKILL.md` explains how to start Vite, load a repertoire, run a scan, inspect results, capture
  screenshots, and notice console errors.
- `driver.mjs` launches headless Chromium directly, loads PGN through `window.__chess`, optionally
  drives a repertoire panel, waits for a result, and captures screenshots.
- `open-workspace.mjs` similarly seeds a repertoire and opens Strategic Fit.

The application knowledge is valuable and must be retained. The implementation should retire the
two canned drivers after their useful seed data and waiting rules have moved into the new controller
and operating guide. Keeping both driver families would create competing setup and fault policies.
The existing `run-ui` skill path should remain as a small compatibility/discovery entry for Claude,
but it should delegate to the new canonical UX-review commands and guide.

Weaknesses that should not be carried forward:

- Chromium is hard-coded.
- The context is a desktop `newPage()` rather than a device descriptor.
- inline PGN data is duplicated in both drivers and the E2E helper.
- fixed delays are used after load and interaction.
- only console errors are collected; engine warnings, uncaught page errors, request failures, and
  unexpected external calls do not share the E2E suite's policy.
- server shutdown uses a broad process-name kill rather than ownership of one exact process.
- arbitrary exploration is awkward because the code dictates the path through the UI.

### 2.3 Development harness and state

In development builds, `apps/ui/src/index.tsx` exposes `window.__chess`. It already includes the
normal game actions (`loadPgn`, `newGame`, `setColor`, navigation, and PGN export) plus guarded test
seams for settings, chat results, Strategic Fit lifecycle and metadata, training state, PWA state,
and other complex UI fixtures. Production builds do not expose it.

Reuse this seam for deterministic setup and observation only. Once setup finishes, the agent must
exercise the workflow through visible user controls. It must not call harness methods to bypass the
interaction under review. Any new `*ForTesting` application seam remains subject to
`apps/ui/test/test-seam.test.ts`; prefer composing existing seams before adding one.

The app persists state in localStorage, sessionStorage, IndexedDB, caches, and in-memory Solid stores.
Loading a different PGN alone is therefore not a complete reset. A deterministic reset must recreate
the ephemeral browser profile, not attempt to enumerate and clear selected keys in a live app.

### 2.4 E2E fixtures and fault policy

Reusable behavior already exists in:

- `apps/ui/test/e2e/helpers/app.ts`: rich repertoire seed, `openApp`, harness evaluation, and current
  PGN/path helpers.
- `apps/ui/test/e2e/helpers/fixtures.ts`: collection of `console.error`, uncaught page errors, and
  `[engine]` warnings; a narrow ResizeObserver allowance; external-response stubbing; and cloud
  evaluation disablement before application boot.
- `apps/ui/test/e2e/helpers/accessibility.ts`: deterministic application-specific accessibility and
  touch-target checks.
- `apps/ui/test/e2e/helpers/viewports.ts`: responsive sizes from compact phones to large desktops.

Do not import Playwright Test fixtures into the CLI daemon. Extract only genuinely shared static
data, and reproduce the same externally observable fault policy in the UX-review controller. Keep
the E2E fixture authoritative for tests.

### 2.5 Host and container verification

- `pnpm test:e2e` uses `scripts/playwright-low-impact.mjs`: one worker, systemd resource limits, and
  visual tests excluded by default.
- `pnpm --filter @chess-mcp/ui test:e2e:host` selects Chromium and Firefox for a broader non-visual
  host run.
- `pnpm test:e2e:container` uses a Playwright image whose version matches the repository package,
  copies the current working tree into a temporary workspace, installs dependencies, builds shared
  code, and runs all configured projects.
- `pnpm test:e2e:update-snapshots` copies snapshots back only after a completely successful
  container run.
- CI shards `pnpm test:e2e:container` six ways and uploads failed reports.

These roles remain unchanged. In particular, the official Playwright MCP image's Chromium-only
limitation is irrelevant to this repository's Playwright Test container.

### 2.6 Documentation and agent discovery

- The root README describes running and verifying the project but not interactive UX review.
- Root `AGENTS.md` documents host and container test policy but not an exploratory browser loop.
- `.mcp.json` exposes only the chess-analysis server. Leave it unchanged.
- The only interactive UI skill is nested under `apps/ui/.claude`; there is no repo-local Codex
  skill under `.agents/skills`.

## 3. Playwright interface decision

### 3.1 Use Playwright CLI named sessions

Use Playwright CLI, not MCP, as the primary browser interface.

Reasons:

- It is already included in the pinned local Playwright package.
- Its short commands avoid loading an MCP tool schema and repeated large tool results into a coding
  agent's context.
- A named session retains the browser between shell commands, so the agent can snapshot, interact,
  inspect, edit, and reload without a monolithic driver.
- It exposes accessibility snapshots and stable element references while still allowing role/test-id
  locators.
- It exposes screenshots, console/page errors, network requests, tracing, and `run-code` for the
  small amount of repo-specific setup that generic commands cannot express.
- The local CLI and Playwright Test use the same package and browser revision.

The review browser and CLI daemon run in a controller-owned container using the same image policy
as `scripts/playwright-container.mjs`: resolve the installed Playwright version and select
`mcr.microsoft.com/playwright:v${playwrightVersion}-noble`. Vite runs against the live host working
tree. Reuse the image and provisioning conventions; the one-shot E2E runner itself is not an
interactive session service and must retain its existing lifecycle.

MCP would become preferable only if a future non-coding agent cannot execute repo commands, or a
long-running external orchestrator requires an MCP transport and shared browser context. Neither is
part of this outcome. Do not add it speculatively.

### 3.2 Named, but not persistent, by default

The terms are distinct:

- A **named session** (`-s=<name>`) identifies one running browser and lets later CLI commands address
  it.
- A **persistent profile** (`--persistent` or `--profile`) saves browser data on disk across browser
  restarts.

Use a named session with the CLI's default in-memory profile. Do not pass `--persistent`. Continuity
is useful within an iteration; disk persistence works against reproducible replay and can retain
tokens or personal data. Reset closes the named session, deletes any associated data, and opens a
fresh in-memory session under the same name.

### 3.3 Verified Playwright 1.62.1 commands

The following forms were verified against the installed CLI help and must be wrapped by/documented
in the implementation. Browser commands execute inside the owned review container, not on the host.
Expose `pnpm ux:review -- cli <args...>` as the transport for arbitrary CLI commands, injecting the
owned session name and forwarding arguments without shell interpolation. The underlying command
forms below describe CLI syntax; the guide must show the controller transport for actual review use:

```sh
# The local versions of Test, CLI, and MCP are all 1.62.1 at design time.
pnpm exec playwright --version
pnpm exec playwright cli --version
pnpm exec playwright mcp --version

# Start or address an isolated named session. CLI is headless unless --headed is supplied.
pnpm exec playwright cli -s=chess-ux open http://127.0.0.1:4173 \
  --browser=webkit --device="iPhone 13 Mini"

pnpm exec playwright cli -s=chess-ux snapshot --depth=6 --boxes
pnpm exec playwright cli -s=chess-ux find "text"
pnpm exec playwright cli -s=chess-ux click e12
pnpm exec playwright cli -s=chess-ux click "getByRole('button', { name: 'Start workout' })"
pnpm exec playwright cli -s=chess-ux eval "() => document.title"
pnpm exec playwright cli -s=chess-ux run-code --filename=path/to/function.js
pnpm exec playwright cli -s=chess-ux screenshot --filename=path/to/state.png --hires
pnpm exec playwright cli -s=chess-ux console warning
pnpm exec playwright cli -s=chess-ux requests
pnpm exec playwright cli -s=chess-ux reload
pnpm exec playwright cli -s=chess-ux close
pnpm exec playwright cli -s=chess-ux delete-data
pnpm exec playwright cli list
```

Useful supported options include `--browser=webkit`, `--device="iPhone 13 Mini"`, `--mobile`,
`--headed`, `--persistent`, `--profile`, `--config`, `--json`, and `--raw`. Snapshot supports
`--filename`, `--depth`, and `--boxes`. Screenshot supports explicit filename, element target,
`--full-page`, and `--hires`. Console and requests both support clearing their retained logs;
requests can filter and omit successful static resources. `run-code` accepts either one function
argument or a file containing a single `async page => { ... }` function expression.

Use explicit `--browser=webkit` even though the iPhone descriptor currently defaults to WebKit. That
makes the intended engine obvious and makes mismatched future descriptors fail during preflight.

### 3.4 Docker preflight and provisioning

The project already uses Docker for Playwright. The Arch Linux host lacks libraries required by the
downloaded host WebKit build, including an older ICU ABI. Those host libraries are not prerequisites
for this workflow: the version-matched Playwright image supplies the browser and runtime libraries.
No additional host packages, global npm packages, or MCP installation are required.

The implementation must provide `pnpm ux:review -- preflight` that:

1. verifies Node/pnpm, the local Playwright version, and Docker daemon access;
2. verifies that the named device descriptor exists and defaults to the requested engine;
3. verifies the matching Docker image is available and its requested browser binary exists;
4. performs a launch-and-close probe inside a temporary owned container using the repo-local
   Playwright package and requested browser/device, then removes that probe container;
5. verifies port availability or ownership; and
6. prints exact remediation without installing host packages or pulling images during preflight.

If the matching image is absent, print `docker pull` with the exact resolved image reference. Image
provisioning follows the existing Docker workflow and applicable execution permissions. Do not
recommend host `install --with-deps`, ICU replacement, or a Chromium fallback to resolve a container
preflight failure. The implementation must not call `sudo`, `apt`, or `install-deps` automatically.

If Docker or WebKit preflight fails, the command fails by default. A user or task may explicitly choose
`--browser=chromium`; do not silently fall back, because doing so would invalidate an asserted
mobile-WebKit review.

### 3.5 Safari limitations

Playwright's WebKit is a patched build derived from upstream WebKit; it is not Apple's branded
Safari. An iPhone descriptor emulates viewport, screen, DPR, touch, mobile behavior, and user agent,
but not iOS hardware, the complete Safari chrome, virtual keyboard behavior, OS text rendering,
safe-area/device integration in every mode, memory pressure, or Apple-specific media behavior.
Linux fonts and graphics further affect screenshots.

Linux WebKit/iPhone emulation is the fast default for interaction, responsive layout, touch target,
WebKit, and gross rendering feedback. Genuine verification is still required when a change depends
on virtual-keyboard/inset behavior, installed-PWA chrome, file pickers/shares, media codecs, Apple
font metrics, platform accessibility APIs, performance/memory, or a defect reproduced only in
Safari. That verification should use Safari/WebKit on macOS or a real iPhone/device service and be
reported separately; it is not a prerequisite for every exploratory pass.

References:

- <https://playwright.dev/docs/getting-started-cli>
- <https://playwright.dev/docs/emulation>
- <https://playwright.dev/docs/browsers#webkit>

## 4. Target architecture

### 4.1 Components and ownership

| Component                  | Proposed location                        | Responsibility                                                                                                                                                                                            |
| -------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lifecycle controller       | `scripts/ux-review.mjs`                  | Preflight, exact Vite process ownership, CLI session lifecycle, deterministic reset/seed, screenshot naming, fault check, status, cleanup                                                                 |
| Controller support         | `scripts/ux-review/`                     | Small modules for argument validation, CLI spawning, seed serialization, fault parsing, and the external-network route function; split only where the controller would otherwise become difficult to test |
| Static seed data           | `apps/ui/test/fixtures/ux-review/`       | Checked-in PGN and optional self-contained setup functions representing realistic starting states                                                                                                         |
| Canonical operating guide  | `docs/UX_REVIEW.md`                      | Human- and agent-readable invocation, lifecycle, operating contract, troubleshooting, and promotion-to-test guidance                                                                                      |
| Codex discovery skill      | `.agents/skills/ux-review/SKILL.md`      | Short trigger and required loop; points to the canonical guide and commands                                                                                                                               |
| Claude compatibility skill | `apps/ui/.claude/skills/run-ui/SKILL.md` | Preserve current discovery terms while directing Claude to the same controller and canonical guide                                                                                                        |
| Package entry point        | `package.json`                           | `ux:review` script invoking the controller                                                                                                                                                                |
| Regression configuration   | `apps/ui/playwright.config.ts`           | Narrow `mobile-webkit` project for explicitly tagged device-specific regression tests                                                                                                                     |
| Existing test helpers      | `apps/ui/test/e2e/helpers/`              | Remain authoritative for Playwright Test setup, faults, accessibility checks, and assertions                                                                                                              |
| Ephemeral artifacts        | `.ux-review/<session>/<run-id>/`         | Session manifest, Vite log, structural snapshots, screenshots, fault reports; gitignored                                                                                                                  |

Do not commit the generic generated Playwright CLI skill. It would vendor a version-specific set of
reference files while still omitting chess-specific setup and policy. The repo-specific skill should
use the local CLI, refer to `--help` for exhaustive generic syntax, and keep application instructions
in `docs/UX_REVIEW.md`.

### 4.2 Public controller commands

Expose one package command with subcommands:

```sh
pnpm ux:review -- preflight [options]
pnpm ux:review -- start [options]
pnpm ux:review -- reset [options]
pnpm ux:review -- screenshot <label> [--full-page]
pnpm ux:review -- check
pnpm ux:review -- status
pnpm ux:review -- stop
pnpm ux:review -- cli <args...>
```

The controller should print the exact underlying CLI command and absolute artifact paths. It should
return nonzero for invalid input, failed preflight, missing/unowned server, failed seed postcondition,
browser/runtime fault, unexpected network activity, or incomplete cleanup.

Minimum options:

| Option       | Default                                  | Meaning                                                                                            |
| ------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `--session`  | `chess-ux`                               | Sanitized CLI session and artifact namespace                                                       |
| `--browser`  | `webkit`                                 | `webkit`, `chromium`, or `firefox`; no implicit fallback                                           |
| `--device`   | `iPhone 13 Mini`                         | Exact Playwright device name; incompatible descriptors fail preflight                              |
| `--url`      | controller-owned `http://127.0.0.1:4173` | Optional already-running app; when supplied, controller does not own/stop it                       |
| `--route`    | `/`                                      | Initial same-origin path after boot                                                                |
| `--seed`     | `rich-repertoire`                        | Checked-in seed name                                                                               |
| `--pgn`      | seed default                             | Optional explicit repo-contained PGN path                                                          |
| `--color`    | `white`                                  | Repertoire side                                                                                    |
| `--setup`    | none                                     | Optional trusted, repo-contained CLI `run-code` function applied after base seed for complex state |
| `--workflow` | task-derived slug                        | Artifact label only; it does not select canned browser actions                                     |
| `--output`   | `.ux-review`                             | Repo-contained, gitignored artifact root                                                           |

Paths must resolve under the repository unless the user explicitly supplies an alternative output
directory. Do not accept secrets in seed manifests, command-line arguments, screenshots, or logs.

`--workflow` deliberately does not implement a workflow registry. The agent must use the UI
arbitrarily. A small setup function may establish a complex starting state, such as a saved training
item, but must not perform the user interaction being evaluated.

### 4.3 Server lifecycle

Vite remains a host process so edits in the current working tree reach HMR immediately. On this
Linux host, the review container uses host networking to reach `127.0.0.1:4173`; no additional port
publication or public Vite bind is needed. An explicit `--url` must be reachable from that container.

For a controller-owned server, `start` should:

1. run preflight;
2. start `pnpm --filter @chess-mcp/ui dev --host 127.0.0.1 --port 4173 --strictPort` as a detached
   child with output captured in the run directory;
3. save PID, start time, working directory, command identity, URL, and ownership in the session
   manifest;
4. poll the exact HTTP endpoint until it returns the app document or a bounded timeout expires; and
5. on partial failure, stop only the process it started.

`status` and `stop` must validate the PID's command and repository working directory before signaling
it. Never use `pkill -f vite`. If the port is already occupied and not represented by a valid
controller manifest, fail with a useful message rather than attaching to an unknown app.

For an explicit `--url`, probe it and record `serverOwned: false`; never stop that process.

### 4.4 Browser/session lifecycle

Create one long-lived, controller-owned review container per session. Use the existing runner's
version-matched image, `--init`, and host UID/GID convention. Mount the repository read-only at its
absolute host path so the pinned local Playwright package and trusted setup files are available;
mount only the validated artifact directory writable at the same absolute path. Keep CLI daemon
state and writable home in the container's ephemeral filesystem. Invoke the repo-local Playwright
JavaScript entry point with container Node if pnpm is unavailable there; do not install a second
Playwright version. Record the exact container ID, image ID/reference, repository path, and ownership
labels in the manifest. Do not mount the Docker socket into the container.

All browser commands, including direct `cli` interactions, must use `docker exec` against the
validated container ID and the same session environment. Screenshots and logs written through the
artifact mount are immediately readable by host image tools. The live host Vite server supplies
updated source; do not use the E2E runner's frozen working-tree copy for interactive review.

Reset preserves the owned container and Vite process while recreating the named browser profile.
Stop closes/deletes the CLI session, removes only the validated owned container, and stops only an
owned Vite process. Partial-start cleanup includes the exact created container. A stale or foreign
container identity must fail ownership validation before any destructive operation.

`start` and `reset` share one browser initialization path:

1. close the named CLI session if it exists;
2. delete its session data;
3. open the app using the explicit browser and device flags, headless by default;
4. install the external-network route before seed-driven position changes;
5. set `chess.cloudeval.enabled=false`, reload, and wait for `window.__chess`;
6. apply the base seed and optional setup function;
7. await seed postconditions and relevant fonts/layout stabilization;
8. clear the CLI console and request logs so later faults belong to the reviewed interaction;
9. capture a structural `00-seeded` snapshot and viewport screenshot; and
10. write resolved Playwright/browser/device/viewport, seed digest, source commit/worktree state,
    route, container/image identity, and host-readable artifact paths to the run manifest.

Reset must create a new run/iteration directory and a fresh in-memory browser profile while keeping
the semantic session name. This clears IndexedDB, local/session storage, caches, cookies, browsing
history, and all application in-memory state together. A plain reload is available for HMR checks,
but it is not accepted as deterministic replay.

### 4.5 Seed model

Version 1 should support a deliberately small seed contract:

- one checked-in PGN path;
- logical file name;
- repertoire color;
- same-origin route;
- non-secret localStorage settings, with cloud evaluation forcibly disabled; and
- an optional self-contained `async page => { ... }` setup function for complex state that cannot be
  represented by PGN and settings.

Extract the existing rich repertoire into
`apps/ui/test/fixtures/ux-review/rich-repertoire.pgn`. Make the E2E helper and compatibility skill use
that file so the existing three inline copies disappear. Add further seeds only when a real review
scenario needs them.

The controller reads and validates seed files in Node, serializes base data safely, and uses
Playwright CLI evaluation to call existing `window.__chess` methods. Optional setup functions are
trusted repository code and must be reviewed like test fixtures. They may create prerequisite state
and assert it, but may not click through or complete the journey being reviewed.

Seed completion must be observable: at minimum assert the harness exists, exported PGN matches the
parsed seed, color matches, the requested route is active, and the app's initial loading/restore work
has settled. Complex setup functions return a small JSON summary of their postconditions for the
manifest.

### 4.6 External network and fault collection

Port the policy, not the test fixture implementation:

- Before seeding, register a page route that fulfills every HTTP(S) request whose hostname is neither
  `127.0.0.1` nor `localhost` with the same CORS-permissive JSON `null` response used by E2E tests.
- Force cloud evaluation off before the seeded app boot.
- Treat `console.error`, uncaught `pageerror`, page crashes, and `[engine]` warnings as failures.
- Preserve the narrow known ResizeObserver allowance from the E2E fixture; no global catch-all
  warnings allowance.
- Treat request failures, unexpected external requests, and unexpected HTTP status >= 400 as
  failures. Permit a status only through a scenario-local, documented allowance.

Playwright CLI 1.62.1 stores uncaught page errors with its console records and records requests,
responses, and request failures. `pnpm ux:review -- check` should request structured CLI output,
normalize it, write `faults.json`, print a concise report, and exit nonzero if policy finds a fault.
Clear logs only at seed completion or explicitly after a successful check; never hide a fault by
navigating away first.

If CLI structured output proves insufficient during implementation, add the smallest `run-code`
listener that records the missing event. Do not switch the whole workflow to MCP or a custom
long-running Playwright library driver for that reason.

### 4.7 Asynchronous work

The operating guide must prohibit fixed sleeps as proof of completion. Use, in order:

1. user-visible roles, labels, status/live-region text, enabled/disabled state, and disappearance of
   progress UI;
2. a stable DOM postcondition inspected through a locator or accessibility snapshot;
3. an existing read-only `window.__chess` state accessor when the state is not exposed visually; or
4. a bounded `run-code` `waitForFunction`/locator wait with an actionable timeout message.

For Stockfish or Strategic Fit operations, wait for both the visible running state and its visible
terminal state so a stale pre-existing result cannot satisfy the check. Treat `[engine]` warnings as
failures even when the UI degrades to an empty result. Do not use `networkidle` as a universal ready
signal; Vite, workers, and background features make application-specific postconditions stronger.

### 4.8 Structural and visual evidence

Structural inspection and visual inspection are complementary:

- Use snapshots/find/role locators to understand names, hierarchy, state, focus, and deterministic
  interaction targets.
- Use screenshots to assess clipping, density, hierarchy, whitespace, alignment, responsive
  composition, overlays, touch affordances, and other rendered qualities absent from the
  accessibility tree.

The controller's `screenshot` subcommand should assign monotonic names such as
`01-workout-start.png` and print the absolute path. Default to the current phone viewport because
that is what the user sees. Offer `--full-page` only as an additional diagnostic and `--hires` for
device-pixel detail; a full-page image must never substitute for checking what is visible without
scrolling.

An image-capable agent must open/inspect the returned image path after every material state. Merely
creating the PNG or reading its dimensions is not visual verification. The agent records a short
observation beside the artifact in `review.md`: state reached, visible friction, intended change,
and after-change result. The controller creates the file skeleton but does not invent critiques.

Exploratory artifacts remain under `.ux-review/` and are not regression snapshots. If an image
baseline is warranted, create or update it only through the existing container snapshot command.

## 5. Exact agent operating contract

The repo-specific skill and guide must require this sequence.

### 5.1 Establish the baseline

1. Read the requested user journey and identify its completion state without assuming which controls
   will be used.
2. Run `pnpm ux:review -- preflight`; do not claim WebKit coverage if it fails or Chromium was used.
3. Run `start` with an explicit workflow label and seed. Record any explicit browser override.
4. Inspect `00-seeded` structural and viewport artifacts. Confirm correct device metrics and expected
   initial state.
5. Run `check`; baseline faults must be resolved or disclosed before UX conclusions are trusted.

### 5.2 Exercise the app as a user

1. Prefer accessible role/name locators or current snapshot references. Use CSS only when the UI has
   no meaningful accessible target, and consider that absence possible friction.
2. Do not use `window.__chess` to perform actions under review.
3. At each meaningful transition, await an observable completion, take a focused structural
   snapshot, take a viewport screenshot, and inspect the actual image.
4. Exercise scrolling, focus, back/cancel/recovery, loading, disabled, empty, success, and error
   states when relevant to the task—not as an automatic exhaustive matrix.
5. Run `check` after major asynchronous operations and at journey completion.

### 5.3 Diagnose friction before editing

For each issue, record:

- the user's goal and state;
- reproducible interaction sequence;
- structural evidence and screenshot path;
- observed friction or rendering defect;
- whether it is product behavior, accessibility, responsive layout, browser-specific behavior, test
  setup, or host-emulation limitation; and
- the narrow acceptance condition for a fix.

Do not equate personal aesthetic preference with a defect without tying it to the user's goal,
readability, hierarchy, consistency, reachability, feedback, recovery, or an established design
contract.

### 5.4 Edit and replay

1. Make the smallest source change that addresses one coherent issue and preserves repository
   invariants.
2. Use the live session to observe Vite HMR where safe; otherwise reload explicitly.
3. Run `check` so HMR/runtime errors are not missed.
4. Run `reset`, which recreates the profile and reapplies the same seed digest.
5. Replay the same user sequence without harness shortcuts.
6. Capture and visually inspect equivalent after-state screenshots; compare viewport visibility and
   interaction count as well as appearance.
7. Update `review.md` with the result. Continue only while a reproducible material issue remains.

Stop when the stated journey completes without identified material friction, before/after evidence
supports the changes, the fault check is clean, and relevant deterministic checks pass. Do not use
the open-ended wording of UX review to redesign unrelated surfaces.

### 5.5 Promote and verify

1. Convert durable behavior—not subjective prose—into the narrowest Playwright assertion. Examples:
   reachability, visible labels, focus restoration, absence of overflow, state continuity, touch
   target size, visible completion feedback, or a stable component screenshot.
2. Import `test` and `expect` from `test/e2e/helpers/fixtures.ts`; use `openApp`/shared fixtures and
   `watchContext` rules rather than recreating setup.
3. A specifically mobile-WebKit regression receives the `@mobile-webkit` tag and runs in that device
   project. General behavior stays in the existing projects.
4. Run the new/focused host test when the host supports it. Run relevant UI unit/design-contract
   checks for the files changed.
5. Run `pnpm test:e2e:container` as the authoritative final E2E result. Update visual baselines only
   with `pnpm test:e2e:update-snapshots` and only when the visual change is intentional.
6. Stop the UX-review session through the controller and verify cleanup.

## 6. Testing strategy

### 6.1 Exploratory UX review

Purpose: discover friction through realistic use and visual judgment.

- Mutable source and Vite HMR are expected.
- The agent chooses actions dynamically from snapshots and the rendered UI.
- Screenshots and notes are evidence, not pass/fail baselines.
- A clean fault check is mandatory, but aesthetic conclusions remain reasoned judgments.
- Default engine/device is Linux WebKit plus `iPhone 13 Mini`.
- Runs live under `.ux-review/` and are not CI inputs.

### 6.2 Deterministic Playwright regression tests

Purpose: preserve observable behavior after a finding is understood.

- Tests live under `apps/ui/test/e2e` and use the custom fixtures.
- Tests control network, state, time, and worker responses as required.
- Assertions express a stable contract, not the exploratory agent's narrative.
- Existing desktop projects remain the default broad matrix.
- Add a `mobile-webkit` project using `devices["iPhone 13 Mini"]`, restricted with
  `grep: /@mobile-webkit/`. Add `@mobile-webkit` to the existing desktop projects' `grepInvert` so
  the tagged test is not redundantly executed with desktop descriptors. Preserve their existing
  `@visual` and `@engine-bound` exclusions.
- Do not migrate every current phone-width test to the new project. Tag only tests whose contract
  depends on the complete mobile WebKit descriptor. Existing breakpoint/geometry tests continue to
  cover multiple widths in desktop browser contexts.

### 6.3 Authoritative verification

Purpose: reproducibility across the version-matched Linux image and approved screenshot environment.

- `pnpm test:e2e:container` remains authoritative and automatically includes the narrowly tagged
  mobile-WebKit project after configuration.
- CI continues sharding the same command.
- Container screenshots, not exploratory host screenshots, own visual baselines.
- Exploratory container sessions cannot override a container test failure.
- Real Safari/device verification is a separately reported manual/external check when the risk list
  in section 3.5 applies.

## 7. Documentation and discoverability

### 7.1 Main README

Add a short `Agent-driven UX review` subsection near `Run` or between `Run` and `Verify`. Keep it to
roughly one paragraph plus a command block. It must state:

- the workflow exists for coding-agent interactive UX iteration;
- when to use it (real user journeys and visual/mobile review, not routine regression execution);
- canonical start command, including the default WebKit/iPhone target;
- that detailed instructions live in `docs/UX_REVIEW.md`; and
- that findings become ordinary Playwright tests and `pnpm test:e2e:container` remains authoritative.

Do not copy troubleshooting or the operating contract into the README.

### 7.2 Root AGENTS.md

Add the UX-review commands to `Commands` and one compact subsection that directs agents to
`docs/UX_REVIEW.md`. State that UX review requires inspecting returned screenshot paths with image
capability, that reset is required for comparison, and that it does not replace the container gate.

### 7.3 Canonical guide

Create `docs/UX_REVIEW.md` during implementation. It is the source of truth for:

- prerequisites and the non-mutating preflight;
- command/options reference;
- first complete example;
- named ephemeral session/reset semantics;
- how to seed PGN and complex state;
- snapshots, screenshots, and image inspection;
- fault policy and allowances;
- async waiting patterns;
- the operating contract in section 5;
- promotion to a tagged or ordinary E2E test;
- cleanup and recovery from stale sessions/processes; and
- Linux WebKit/Safari limitations.

Link to the existing E2E policy instead of restating every test command.

### 7.4 Skills

Add `.agents/skills/ux-review/SKILL.md` with a description that triggers on requests to inspect,
exercise, visually review, screenshot, or iteratively improve the UI. It should be concise but
normative: read `docs/UX_REVIEW.md`, run preflight/start, inspect snapshots and actual images, check
faults, reset/replay after edits, promote durable behavior, and run authoritative verification.

Rewrite `apps/ui/.claude/skills/run-ui/SKILL.md` as the Claude compatibility entry using the same
canonical guide. Remove obsolete invocation details after the old drivers are retired. Do not create
a second full copy of the guide and do not add a root `CLAUDE.md` solely for this feature.

### 7.5 Command help

`pnpm ux:review -- --help` and every subcommand's help must be sufficient for a model that found only
`package.json`: defaults, examples, artifact location, reset semantics, exit codes, and pointers to
the guide. `status` prints the next useful commands.

## 8. Implementation plan

Each step is intended to be one reviewable unit for a fresh coding-agent session. Do not proceed to a
later step while its focused verification fails.

### Step 1: establish shared seed data

Files:

- add `apps/ui/test/fixtures/ux-review/rich-repertoire.pgn`;
- change `apps/ui/test/e2e/helpers/app.ts` to read that fixture;
- temporarily change the existing run-ui drivers to read it until they are retired.

Behavior: one realistic repertoire supplies both exploratory setup and E2E default setup without
duplicated inline strings.

Dependencies: none.

Verification:

- existing helper tests/specs parse the fixture;
- `pnpm --filter @chess-mcp/ui test:chat` if relevant imports move;
- one focused E2E smoke using `openApp` confirms the same PGN and color.

### Step 2: add and unit-test the lifecycle controller core

Files:

- add `scripts/ux-review.mjs`;
- add only necessary modules under `scripts/ux-review/`;
- add `scripts/ux-review.test.mjs`;
- add `ux:review` to root `package.json`;
- add `/.ux-review/` to `.gitignore`.

Behavior: argument parsing, path/session validation, help, manifest schema, safe child spawning, exact
PID ownership, port probing, local Playwright/device/browser inspection, and deterministic artifact
paths. Provide `preflight`, `status`, and safe no-op/error paths before browser orchestration.

Dependencies: step 1 for seed defaults.

Verification:

- Node tests cover invalid session/path/device, occupied port, stale/foreign PID manifest, command
  construction, and no-silent-fallback behavior;
- a dry-run/preflight fixture proves no OS package installation or image pull is attempted;
- preflight covers unavailable Docker, a missing/mismatched image, container WebKit launch, and
  cleanup of the exact probe container;
- format/lint/type-relevant repository checks pass.

### Step 3: implement server and named-session lifecycle

Files:

- change `scripts/ux-review.mjs` and support modules/tests.

Behavior: controller-owned strict-port host Vite server, external URL mode, owned review container,
named ephemeral Playwright CLI open/close/delete inside that container, arbitrary `cli` transport,
partial-failure cleanup, and `start/reset/stop/status`. Write a run manifest with resolved
browser/device values, container/image ownership, and source/seed identity.

Dependencies: step 2 and the existing version-matched Playwright Docker image. Host WebKit libraries
are not required.

Verification:

- start/status/stop leaves no owned Vite process or review container;
- arbitrary CLI commands address the same in-container daemon and ephemeral profile;
- a source edit reaches host Vite HMR and screenshots are readable at their printed host paths;
- reset changes browser/profile identity while keeping the semantic session name;
- local/session storage, IndexedDB, cookies, and in-memory app changes made before reset are absent
  afterward;
- an unowned server or container is never stopped or removed;
- interrupted start cleans up only owned resources.

### Step 4: implement deterministic routing, seeding, and waits

Files:

- add the minimal route/setup function files under `scripts/ux-review/`;
- change controller and tests;
- add a complex example setup under `apps/ui/test/fixtures/ux-review/` only if needed to prove the
  contract.

Behavior: external JSON-null route, cloud-eval disable before seeded boot, development-harness wait,
PGN/color/route application, optional trusted setup function, and explicit seed postconditions. No
fixed sleep is accepted as readiness proof.

Dependencies: step 3 and existing `window.__chess` seam.

Verification:

- the default seed exports the expected PGN and color;
- reset after arbitrary mutations produces the same seed digest and postconditions;
- a probe external request is stubbed and never reaches the public network;
- a malformed PGN/setup failure exits nonzero with an actionable error;
- production preview is rejected because the development harness is intentionally absent.

### Step 5: add structural, screenshot, and fault evidence

Files:

- change controller/support modules/tests.

Behavior: seed snapshot, labeled viewport/full-page screenshot command, absolute path output,
`review.md` skeleton, structured console/page/engine/network fault parsing, `faults.json`, log clear at
the seed boundary, and nonzero check results.

Dependencies: step 4.

Verification:

- snapshot contains expected accessible app landmarks and refs;
- viewport PNG dimensions/DPR correspond to the resolved device descriptor;
- full-page is opt-in and clearly labeled;
- deliberate `console.error`, uncaught page exception, `[engine]` warning, failed request, and HTTP
  error each fail `check`;
- allowed ResizeObserver noise does not fail;
- screenshot output is ignored by Git and its absolute path is printed for an image tool.

### Step 6: expose the repo-native agent capability

Files:

- add `docs/UX_REVIEW.md`;
- add `.agents/skills/ux-review/SKILL.md`;
- rewrite `apps/ui/.claude/skills/run-ui/SKILL.md` as a compatibility entry;
- remove `apps/ui/.claude/skills/run-ui/driver.mjs` and `open-workspace.mjs` after parity is proved.

Behavior: a fresh Codex or Claude session discovers one canonical operating contract and can perform
arbitrary UI actions through Playwright CLI. The old canned Shorten/Strategic Fit paths remain
possible through the new generic loop and seed, not dedicated code.

Dependencies: steps 2-5.

Verification:

- validate skill frontmatter with repository/agent skill checks available at implementation time;
- follow only the committed guide in a fresh-session simulation to start, inspect, screenshot, check,
  reset, and stop;
- run a Shorten or Strategic Fit scenario previously covered by a retired driver.

### Step 7: add narrow mobile-WebKit regression support

Files:

- change `apps/ui/playwright.config.ts`;
- add or tag one focused regression spec under `apps/ui/test/e2e`;
- update affected snapshots only if the chosen proof intentionally uses one.

Behavior: `mobile-webkit` applies `devices["iPhone 13 Mini"]` only to tests tagged
`@mobile-webkit`; desktop projects exclude that tag while retaining current exclusions. The first
test proves a real journey state or defect found through the exploratory loop, not a placeholder.

Dependencies: steps 4-6 provide the workflow from which a durable finding is promoted.

Verification:

- project listing shows the new project;
- the tagged test runs exactly once in that project and not in desktop projects;
- a representative untagged test matrix is unchanged;
- focused container execution passes before any full suite.

### Step 8: complete repository discoverability

Files:

- change `README.md`;
- change root `AGENTS.md`;
- ensure `docs/UX_REVIEW.md` links to E2E/container policy and vice versa where useful.

Behavior: README gives the short entry point; AGENTS gives mandatory agent policy; the detailed guide
holds operational depth without bloating either entry document.

Dependencies: stable command surface from steps 2-7.

Verification:

- a repository search for `UX review`, `screenshot`, `iPhone 13 Mini`, and `Playwright` finds the
  README, AGENTS, skill, command help, and canonical guide;
- `pnpm docs:check` passes if documentation consistency rules apply;
- all documented commands match `--help` output.

### Step 9: end-to-end acceptance and final gates

Files: no new surface unless acceptance exposes a defect.

Behavior: perform one complete fresh-session UX iteration: preflight, start, seed, arbitrary user
journey, snapshot, visual inspection, fault check, harmless source/CSS test change or controlled
fixture change, HMR/reload, reset, replay, focused regression, cleanup. Revert the controlled change
if it was only a harness proof; retain only legitimate product/test changes.

Dependencies: all prior steps and access to the existing Docker runtime and matching Playwright image.

Verification:

- controller/unit tests;
- relevant design-contract tests;
- UI typecheck and build;
- focused promoted Playwright test;
- `pnpm test:e2e:container` as final authority;
- `git status` contains no `.ux-review` artifacts or unintended generated files.

## 9. Acceptance criteria

Implementation is complete only when all statements are objectively true:

1. A fresh coding agent finds the capability from the main README and root `AGENTS.md` without prior
   conversation.
2. The repo-local UX-review skill triggers for an iterative visual UI task and points to one
   canonical guide.
3. `pnpm ux:review -- preflight` verifies Docker access and the exact repo-local Playwright
   browser/device launch inside the matching image, cleans up its probe container, and gives
   actionable remediation without installing host packages or pulling images.
4. On the existing headless Linux Docker host, `start` launches an owned host Vite server and a
   named ephemeral WebKit session inside an owned container with the `iPhone 13 Mini` descriptor;
   no host WebKit libraries are required.
5. The agent can execute arbitrary Playwright CLI snapshot/find/role/ref interactions; it is not
   limited to hard-coded panels or journeys.
6. The initial state is represented by a checked-in seed, verified by postconditions, and recorded by
   digest in a run manifest.
7. `reset` recreates all browser/application state and produces the same seed digest after the prior
   iteration mutates localStorage, sessionStorage, IndexedDB, cookies, and in-memory stores.
8. Asynchronous engine/application workflows are awaited through observable states rather than fixed
   delays.
9. Each screenshot command prints an absolute, image-tool-readable path; the operating contract
   requires an image-capable agent to inspect the image, not only create it.
10. Structural snapshots and viewport screenshots can be captured at corresponding workflow states,
    and review notes associate observations with those artifacts.
11. `check` fails for console errors, uncaught page exceptions, engine warnings, page crashes,
    request failures, unexpected external traffic, and unexpected HTTP errors while retaining only
    narrow documented allowances.
12. Public provider requests are deterministically stubbed during review and cloud evaluation is off
    before seeded application boot.
13. An agent can edit source, observe HMR or reload, then reset and replay the same journey from the
    same seed for before/after comparison.
14. A discovered durable mobile-WebKit defect can be encoded as an `@mobile-webkit` Playwright test
    using the repository fixtures and run under the complete iPhone descriptor.
15. Existing untagged desktop test coverage and the host/container division remain intact.
16. `pnpm test:e2e:container` remains documented and demonstrated as the authoritative E2E and visual
    verification gate.
17. `stop` cleans up only the exact session, container, and server owned by the controller; no broad
    process kill or Docker prune is used.
18. Exploratory profiles, logs, screenshots, and notes are ignored by Git and never enter regression
    snapshot directories automatically.

## 10. Risks and unresolved external decisions

The existing Docker workflow resolves Linux WebKit provisioning. No host dependency installation or
new architecture decision blocks implementation. Docker daemon access and matching-image availability
are checked during preflight using the project's existing execution permissions.

**Genuine Safari coverage:** maintainers must decide which changes justify macOS Safari or a real
iPhone/device service and who runs it. The repo guide can define triggers and a reporting field,
but no such service should be selected or integrated without a concrete need and credentials.
This does not block the Linux WebKit review workflow.

Potential implementation risks and mitigations:

- Playwright CLI output is newer and may change across upgrades: pin usage to the repo package, parse
  structured output defensively, and unit-test command construction/parsing.
- CLI daemon state lives inside the review container: name sessions, record container ownership,
  use exact close/delete commands, and make stale-container recovery explicit.
- HMR can preserve state that a reload would not: use HMR for fast observation, but require full reset
  for comparisons.
- Device screenshots vary with Playwright/browser versions and host fonts: exploratory screenshots
  are evidence only; container-owned snapshots remain the regression contract.
- A powerful dev harness can hide real friction: restrict it to setup/observation and require user
  controls for the journey itself.

## 11. Implementation stop condition

Stop adding infrastructure once one fresh agent can discover the workflow, complete and visually
inspect an arbitrary seeded mobile-WebKit journey, receive deterministic runtime-fault reporting,
reset and replay it after a source edit, promote one material behavior to the narrow tagged test
project, and pass the authoritative container gate. Additional seed types, browsers, orchestration
modes, dashboards, MCP transport, or device services require a separate demonstrated use case.
