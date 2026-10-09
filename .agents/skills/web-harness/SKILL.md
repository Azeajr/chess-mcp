---
name: web-harness
description: Drive, inspect and verify this project's web app with web-harness — owned browser sessions in Docker, batched journeys, failure bundles, production smoke, container E2E and scenario reports. Use when reproducing a UI bug, checking that a change works in a real browser, reviewing a layout, or proving a fix before a PR.
---
<!-- web-harness 0.2.5: installed by `web-harness skill install`; reinstall after upgrading, do not edit. -->

# web-harness

This project uses [web-harness](https://github.com/Azeajr/web-harness): an owned dev or
production server plus a browser in a pinned Playwright Docker image, driven by commands that
print JSON. The full guide is `node_modules/@azeajr/web-harness/docs/HARNESS.md`.

## First

1. `pnpm exec web-harness describe --json` — this project's fixtures, state sections, scenarios,
   targets, ports, environment and smoke hooks. Read it instead of guessing.
2. `free -h`, then `pnpm exec web-harness doctor` — Docker, the pinned image, the port, the memory
   budget, version drift and whether evidence is git-ignored. Fix what it reports first.
3. Read the project's own skills and `CLAUDE.md`/`AGENTS.md` for app-specific journeys.

`pnpm exec web-harness <command> --help` prints that command's usage and runs nothing; read it
rather than guessing flags.

## The loop

```text
start → apply a fixture through the real UI → act through visible controls → observe narrow
state and visible effects → assert a terminal condition → keep the failure bundle → promote the
reproduction into a test → verify the artifact that ships
```

```sh
web-harness start [--fixture NAME] [--target production]   # owned server + browser, seeded
web-harness run batches/journey.js                         # one batched journey, JSON result
web-harness observe '#region' | web-harness state          # narrow reads (state: dev only)
web-harness effect --observe '#saved' --durable --expect change -- click e12
web-harness screenshot LABEL                               # then OPEN the PNG and look at it
web-harness check                                          # faults and off-screen overlays
web-harness check --a11y                                   # plus an accessibility scan
web-harness reload | web-harness restart | web-harness reset
web-harness reconcile                                      # after a batch with an unknown outcome
web-harness promote batches/journey.js --to tests/e2e/journey.spec.ts --title "…"
web-harness stop                                           # always, when done
```

What each proves:

- `start` — the fixture applied through the UI and the page loaded without faults. Not that any
  workflow works.
- `run` — the batch's own `step`s and `assert`s held, and no fault was retained. A batch gets
  `{ step, assert, observe, state, effect, allowFault, expectFault, clock }`.
- `effect` — something watched actually changed (`expect: 'change'`), or nothing did
  (`expect: 'none'`). Catches the click that did nothing. An observed element counts as changed
  when its text, visibility, attributes, css or own scroll offset change, or when it crosses the
  edge of the screen or of a scrolling pane; not when it only shifts on screen or takes focus.
- `reload` keeps memory and storage; `restart` keeps only what persisted (the durability proof);
  `reset` starts over from the same fixture.
- `check --a11y` — axe rules found nothing at or above the configured impact. Automated rules find
  a subset of problems: a clean scan is not an accessibility audit.

## Evidence rules

- **Zero faults is not completion.** A seeded screenshot or a clean `check` does not show that a
  workflow works. Assert the terminal state the user would see.
- **Look at images.** Opening a PNG with an image-capable tool is inspection; writing one is not.
  A full-page capture omits panes that scroll inside themselves; `screenshot --full-page` names them.
- **Record every attempt**, failed ones included, in the run directory's `review.md`: run IDs,
  the images inspected, the exact terminal state. A rerun of the same batch is another attempt; a
  later pass never erases an earlier failure.
- **Read the failure bundle first.** A failed batch prints its `summary` and a `bundle/` path:
  `index.json`, then `timeline.jsonl`, `network.jsonl`, `console.jsonl`, `aria.yml`,
  `storage.json`, `screenshot.png`. `trace.zip` holds bodies and headers — keep it local.
- **Wait on conditions, never sleeps.** Drive running → terminal transitions so a stale result
  cannot satisfy a wait.
- **Unknown outcome:** if a batch's transport failed, it may have mutated state. Run
  `reconcile` and read what it captured before replaying anything.
- **Promote it.** Exploration is not coverage until it lands as a test: `promote` the batch, run
  the suite (`web-harness e2e`), and add the printed `covers` entry to the scenario.

## Host safety

- One heavy job at a time: a session, `e2e` or `smoke` each run a browser. Check `free -h`
  before starting one. The memory budget refuses a start the host cannot hold; do not reach for
  `--force-resources` to get around it. If refused, stop a listed harness run or another heavy
  workload and retry once. Do not poll for memory or repeatedly rerun `doctor`.
- Use distinct `--session` names and `--port`s for concurrent sessions, and `stop` each one.
- Never run a project's browser suite outside `web-harness e2e` while a session is up.

## Proof boundaries

- The browser is emulated (Chromium, WebKit or Firefox on Linux), not a real phone. Installed-PWA
  behaviour, iOS Safari quirks, locked-phone timers and OS notifications need a real device; they
  are `unsupported` scenarios, never claimed as covered.
- The static server applies `_headers` and SPA fallback like Pages, but runs no Pages Functions.
- `state` exists on the dev target only. On production, assert visible UI or durable storage.

## Before a PR

```sh
web-harness e2e                  # the project's suite in the pinned image
web-harness smoke                # the production build: headers, SW, persistence, offline, update
web-harness scenarios --results e2e-results.json
```

Quote only what you ran, with its exact numbers.
