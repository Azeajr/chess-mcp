# HANDOFF — accessibility gates AG-4 / AG-5

> **Temporary file.** Delete once AG-5 is resolved. Not referenced by any check.
> Written 2026-08-26 22:08 EDT. Branch `salvage`, working tree clean at `3184aba`.

---

## 1. Where things stand

| Gate                           | Status                                           | Evidence                                      |
| ------------------------------ | ------------------------------------------------ | --------------------------------------------- |
| **AG-3** `ag-3-move-tree`      | `confirmed-pass`                                 | stable across every run below                 |
| **AG-4** `ag-4-board-keyboard` | **`confirmed-pass`** — closed                    | run `33030807526` @ `e7126d5`, 13/13 findings |
| **AG-5** `ag-5-live-region`    | `confirmed-failure` — **1 of 10 AT claims left** | run `33031997201` @ `3184aba`, 9/10           |

WP-014 is recorded complete, UX-003 is closed in the plan's disposition table, and the AG-4
gate is `resolved` in `docs/ui-ux-remediation/state.json`. Nothing about AG-4 is outstanding.

The accessibility workflow's **`Compute AG-3/AG-4/AG-5 gate verdicts` job still exits non-zero**,
and AG-5 is now the only reason. All three capture jobs (browser, NVDA, VoiceOver) succeed.

### Commits made in this stretch

| SHA       | What                                                                                    |
| --------- | --------------------------------------------------------------------------------------- |
| `e7126d5` | AG-4: `pressAwaitingAnnouncement` — hold VoiceOver's capture open for app announcements |
| `6c9724f` | docs: record AG-4 confirmed-pass, close WP-014 + UX-003                                 |
| `3184aba` | AG-5: clear the live regions between scenarios; open the capture window at first render |

---

## 2. The one remaining failure

Run `33031997201`, finding **A11Y-012**, `at-runner:voiceover:operation-failed`:

```
exerciseAnnouncementScenario(operation-failed): Prescribed-move audit started.
(1 utterances; missing failed).
```

The same claim on **NVDA passes**, and its utterance is the important clue:

```
"Prescribed-move audit started.."
  + "Prescribed-move audit failed: invalid arguments."
  + "alert, Prescribed-move audit failed: invalid arguments"
```

That is **three speech events for one failure**. `AppLiveRegion.tsx` renders:

```jsx
<div data-app-live-region="assertive" aria-live="assertive" class="sr-only">
  <Show when={assertiveMessage()}>
    {(announcement) => <p role="alert">{announcement().message}</p>}
  </Show>
</div>
```

`role="alert"` already implies `aria-live="assertive"`, so this is a **live region nested inside a
live region**. NVDA fires both (the `"alert, …"` prefix is NVDA naming the role), VoiceOver drops
the update entirely.

**This is a real app bug, not a harness bug.** WP-009's stated policy is "every policy event
produces exactly one message" (`apps/ui/src/store/announce.ts` header) — NVDA speaking it twice
violates that directly, and it is now proven by real-AT evidence rather than argued.

### Two candidate causes, both plausible, not yet separated

1. **Nesting** — proven active by NVDA's double utterance.
2. **Insertion** — VoiceOver is known to be unreliable when a `role="alert"` _node is inserted_,
   as opposed to a persistent region whose text changes.

Strong supporting signal for a persistent, role-less region being the right shape: the **polite**
region in this same component has no role at all, just `aria-live="polite"` on a persistent
container — and VoiceOver announces it reliably (`document-restored`, `operation-started`,
`operation-completed`, `operation-cancelled` all pass on VoiceOver).

---

## 3. Fix options, and the constraint that rules most of them out

I had worked through these and had **not** committed to one. Read this before editing — three of
the four obvious fixes break something else.

### Option A — drop `role="alert"` from the `<p>`, keep the container's `aria-live="assertive"`

Gives a persistent, role-less assertive region: exactly the shape the polite region already proves
works on VoiceOver. Removes the nesting. **Most likely to actually fix it.**

**Blocker:** AG-5's browser-tier check `live-region-roles` in `verdict.ts` is

```ts
const regionsExposed = /status/iu.test(snapshotText) || /alert/iu.test(snapshotText);
```

The polite region has no role, so today this passes **only** because of the nested `alert`. The
captured snapshot is literally:

```
- paragraph: Prescribed-move audit started.
- alert: "Prescribed-move audit failed: invalid_arguments"
```

Remove the inner role and **A11Y-002 flips to confirmed-failure.** Playwright's `ariaSnapshot()` is
role/name based and does **not** emit `aria-live`, so the check cannot simply be retargeted at the
attribute. Fixing it properly means either reading live-region properties from the CDP AX tree
(`cdpAxTrees`, **chromium only** — firefox/webkit would go uncovered) or adding a new field to
`EvidenceBundle` in `evidence-schema.ts` that records both regions' measured politeness across all
three browsers. That is the real cost of Option A.

### Option B — remove `aria-live="assertive"` from the container, keep `<p role="alert">`

**One line.** Kills the nesting, so NVDA's double-speak goes away. Snapshot still shows `alert`, so
A11Y-002 keeps passing. Breaks nothing else.

**Risk:** only addresses cause 1. If the real cause is insertion, VoiceOver stays silent.

This was my intended next step — cheapest, provably fixes a confirmed bug, and **diagnostic either
way**: a pass means nesting was it; a continued failure isolates insertion and points at Option D.

### Option C — move `role="alert"` onto the container

**Rejected.** Creates an always-present `role="alert"` in the DOM, which breaks four existing bare
`page.getByRole("alert")` lookups under Playwright strict mode:

- `apps/ui/test/e2e/phase7.spec.ts:247,250`
- `apps/ui/test/e2e/strategic-fit-sidecar.spec.ts:192,207`
- `apps/ui/test/e2e/strategic-fit-metadata.spec.ts:519`

`AppLiveRegion.tsx`'s own header already reasons about exactly this hazard for `role="status"` on
the polite region — same trap.

### Option D — persistent `<p role="alert">` (always rendered, text possibly empty) + no container `aria-live`

Addresses **both** causes at once. Same strict-mode cost as Option C (the alert is always in the
DOM), so it needs those four lookups scoped rather than bare. Scoping them is arguably an
improvement — a page-level `getByRole("alert")` is fragile — but it is four unrelated spec edits.

**Suggested order: B first (one line, one CI round, diagnostic), then D if VoiceOver is still
silent.** Do not do C.

---

## 4. Root causes already found — do not re-derive these

Four CI rounds were burned on AG-4 guessing at symptoms before anyone read the driver's source.
Both root causes below came out of the installed `@guidepup/guidepup@0.33.2` package, not inference.

### 4a. `spokenPhraseLog()` is not a transcript (fixed in `e7126d5`)

`VoiceOverClient` appends **exactly one entry per driver action**, only inside `enqueueAndTap`'s
capture step. `DEFAULT_CAPTURE` is `"initial"` (`lib/constants.js`), and that poll loop `break`s
**unconditionally at the end of its first iteration**. So a plain `press()` reads VoiceOver's
caption **once, ~50 ms after the key goes in**. Anything not spoken by then is never recorded
anywhere, and the _previous_ step's stale caption lands in the next claim's slot.

`{ capture: true }` instead polls `lastSpokenPhrase()` until stable (25 × 50 ms), joining phrases
with `". "`. That is `session.pressAwaitingAnnouncement` in `collectors/at-runner.ts`.

**Rule:** if a claim's evidence is speech the _app_ emits (an `aria-live` announcement), the press
must use `{ capture: true }`. If it is the screen reader's own description of what it just focused,
the default is fine.

NVDA is a different mechanism entirely — a TLS event stream of `speak` messages with a 1 s silence
debounce, listener attached _before_ the action — so it was never blind. **That asymmetry is why
these bugs always present as "passes on NVDA, fails on VoiceOver."**

### 4b. Identical text is not a DOM mutation (fixed in `3184aba`)

`AppLiveRegion` renders through `<Show>`, so Solid keeps the same paragraph node and patches its
text. A write whose text **equals what is already displayed** is not a DOM mutation, fires no
live-region notification, and is spoken by nobody. Nothing was clearing the regions between AG-5
scenarios.

That single cause explained all five original failures:

- `operation-completed` returned `(nothing)` on NVDA because the preceding `operation-started`
  scenario **runs the identical command** and had already left `"…completed: 3 result(s)"` on screen.
- `operation-failed` was silent on both runners because AG-5's own **browser-tier warm-up fires
  `operation-failed` first**, leaving identical text in the assertive region.

`announce()`'s 500 ms de-duplication window elapsing does **not** save you: a fresh `Announcement`
object still patches the paragraph to the value it already holds. The old code comment claiming
otherwise was wrong and has been replaced.

`core-status.spec.ts`'s UX-012 test resets between scenarios and passes; the AT loop did not.

### 4c. Non-obvious scenario facts

- `operation-started` and `operation-completed` **run the same command**. One real
  `audit_repertoire_moves` announces its start via `registerOperation` and its outcome via
  `settleOperation`, so each scenario emits _both_ messages and asserts a different one.
- `operation-failed` emits a **polite** start followed by an **assertive** failure — the only
  scenario that touches the second region. See `apps/ui/src/store/operations.ts:119`:
  `announce(message, { assertive: status === "failed" })`.
- The AG-5 verdict is pure token containment plus an utterance-count bound. `captureExternalAction`
  returns one joined string, so `utterances.length` is always 0 or 1 — the `maxUtterances` bounds
  (4/5) are never the thing that fails.

---

## 5. Verification

### Local (all currently green at `3184aba`)

```bash
pnpm -r typecheck
pnpm lint
pnpm format:check
pnpm docs:check
pnpm check:skills
pnpm --filter @chess-mcp/ui test:chat      # 355 passed
pnpm test:strategic-fit                    # 408 passed
pnpm ux:plan-check
pnpm ux:test WP-014
pnpm test:e2e:container                    # authoritative: 512 passed, 7 skipped, 0 failed
```

Scoped local Playwright (needs Linux/systemd, 15-min cap — always scope it):

```bash
pnpm test:e2e -- apps/ui/test/e2e/core-status.spec.ts --project=chromium --reporter=list
```

### CI — the only place the AT tier can run

Pushing to `origin/salvage` triggers `.github/workflows/accessibility.yml` automatically
(real NVDA on `windows-latest`, real VoiceOver on `macos-latest`). ~12 min.

```bash
gh run list --branch salvage --limit 3 --json databaseId,headSha,status,conclusion
gh run view <id> --json status,conclusion,jobs
gh run download <id> -n a11y-report -D /tmp/rep && jq -r \
  '.reports[] | (.verdict // .) | "\(.scenarioId) -> \(.overallStatus)"' /tmp/rep/report.json
```

Per-claim detail (this is the query that actually tells you what a screen reader said):

```bash
jq -r '.reports[] | (.verdict // .)
  | select(.scenarioId=="ag-5-live-region")
  | .findings[] | select(.assertionId|startswith("at-runner"))
  | "\(.id) [\(.status)] \(.assertionId)\n   \(.actual)"' /tmp/rep/report.json
```

Raw utterances: `gh run download <id> -n a11y-evidence-nvda -n a11y-evidence-voiceover`, then read
`atObservations[].utterances`. **Do this before forming any hypothesis.**

### Validating harness timing without burning a CI round

The AT code path cannot run locally, but the _browser-side_ half can. A throwaway spec that resets
the regions, kicks the scenario off without awaiting it, and logs when each message renders caught
a real problem in seconds. Timings observed locally: 96–815 ms from kickoff to the scenario's own
message rendering.

**Local caveat:** this workstation's `audit_repertoire_moves` returns `engine_unavailable`, so
`operation-completed` cannot be reproduced locally — it renders `"…failed: engine_unavailable"`
instead. CI has the engine and produces `"…completed: 3 result(s)"`. Do not chase that difference.

---

## 6. Doc updates owed once AG-5 goes green

1. `docs/ui-ux-remediation/state.json` → `gates.AG-5`: `"unresolved"` → `"resolved"`, with an
   `evidence` object. **Copy the shape from `gates.AG-4`** (`mode`, `outcome`, `command`, `runId`,
   `decidedAt`, `decision[]`, `source`) — AG-1/AG-3/AG-4 all follow it.
2. Check WP-009's package entry in the same file for a `blockedOn` / `"pending-ci"` outcome to
   clear, and whether its `status` should go `complete`.
3. Check whether UX-012's row in `docs/ui-ux-remediation-plan.md` §7 needs its disposition flipped
   (UX-003's row is at line 2063 for reference — it now reads `Closed`).
4. Re-run `pnpm ux:plan-check`.
5. Confirm the workflow's verdict job finally exits **zero**.

### Two traps in `state.json` that already cost time

- **Do not re-serialize the file with `json.dump`.** It reflows short single-line arrays and
  un-escapes non-ASCII across unrelated entries. Make targeted text edits instead.
- Marking a package `complete` makes `scripts/lib/ux-task-contract.mjs` require an **unnarrowed**
  e2e run in `evidence.validation`. It matches `/\b(?:pnpm\s+test:e2e(?::container)?|playwright\s+test)\b/`
  and **rejects** the string if it also matches `/(?:\.spec\.ts|--grep\b|\s-g\s)/`. Naming the
  underlying script (`node scripts/playwright-container.mjs …`) is rejected, and so is prose that
  merely contains the characters `--grep` — both bit me. Write `pnpm test:e2e:container` and
  describe the scope without those literals.

---

## 7. Explicitly out of scope

- **AG-2** — `MobileTabs`/WP-013 shipped (`31435b0`), but AG-2's scenario, spec, and verdict files
  do not exist at all. `SCENARIO_REGISTRY` in `compute-verdict.ts` holds AG-1/AG-3/AG-4/AG-5 only.
  That is a build, not a fix.
- **UX-005** — the sole remaining `test.fixme` in the e2e suite
  (`apps/ui/test/e2e/core-document.spec.ts:264`, mutation apply/undo/redo PGN fidelity).
  Different work package.

## 8. Conventions

- No `Co-Authored-By: Claude` trailer on commits, and no "Generated with Claude Code" footer on PRs.
- Work is pushed **directly to `origin/salvage`**; no PR is open for this.
- `A11Y_SPEC` in `.github/workflows/accessibility.yml` is comma-separated and load-bearing: every
  spec must run in **one** Playwright invocation per job, because Playwright wipes `outputDir` on
  each invocation and a second invocation destroys the first one's evidence.
