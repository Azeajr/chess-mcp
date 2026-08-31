# Code review findings

Forensic review of the UI/UX remediation program and its surrounding subsystems, covering the
work from the initial design document (`91be083`, 2026-08-01) through the docs prune (`815d16d`).
That span is 123 commits, ~500 files, and roughly 48,000 lines of changed source.

**Reviewed at:** `815d16d` (`main`), with every file:line below re-verified against that commit.
**Method:** static reading plus real gate execution. Findings were checked against a pinned
`git worktree` rather than the live tree, because the tree changed twice mid-review.

## Status of the gates at `815d16d`

| Gate                                               | Result                                           |
| -------------------------------------------------- | ------------------------------------------------ |
| `pnpm lint`                                        | pass — 0 errors, 0 warnings                      |
| `pnpm format:check`                                | pass — 474 files                                 |
| `pnpm -r typecheck`                                | pass — 0 errors                                  |
| `pnpm --filter @chess-mcp/ui test:chat`            | pass — 371/371                                   |
| `pnpm test:strategic-fit`                          | pass — 408/408                                   |
| `pnpm docs:check`                                  | pass — 51 canonical, 42 MCP, 45 browser          |
| `pnpm check:skills`                                | pass                                             |
| `pnpm check:legacy-imports`                        | pass                                             |
| `pnpm check:tool-contract`                         | **was crashing (F2) — fixed in `0758c34`**       |
| `node --test scripts/wp036-design-tokens.test.mjs` | **was 2 of 4 failing (F3) — fixed in `0758c34`** |
| `pnpm test:e2e:container`                          | not run in this review                           |

Two of those failures were invisible to CI because the commands were not wired into any workflow.
That was the subject of F1.

## Progress

F1, F2, and F3 were fixed together in `0758c34` — wiring the gates is what turned the other two
red, so all three had to land in one change.

| ID      | Status                                                                                                                                                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1      | **Fixed** — `test:strategic-fit`, `check:tool-contract`, `check:legacy-imports`, the three `scripts/wp*.test.mjs` suites, and both WP-019 PWA tests are now steps in `ci.yml` |
| F2      | **Fixed** — `chatTransport`/`toolExecutor` are thunks, so the cycle no longer reads `runTool` in its temporal dead zone                                                       |
| F3      | **Fixed** — 16 raw colours tokenised across 5 groups, bare `z-index` replaced, and the AC-3/AC-4 scanners no longer match inside comments                                     |
| F4      | **Fixed** — `a85ca7c` keeps reconstructed entries consistently oriented and committed; RED→GREEN unit proof plus UX-005 exact-PGN coverage across all three engines           |
| F5      | **Fixed** — `9049974` settles superseded and rejected live-analysis operations so the registry drains and the PWA prompt cannot remain suppressed                             |
| F6      | **Fixed** — `2bd4dd6` lets an explicit durability flush write through a reactive pause; proven RED by a 3 s timeout on the old call and GREEN in 2.9 ms                       |
| F7      | **Fixed** — `5cd4229` validates ordered SAN against one retained path and restricts drill-anchored sections to the cited drill path                                           |
| F8      | **Fixed** — `260dea1` requires the Analyze and disclosure controls instead of skipping them; the one legitimate alternate state now has its own explicit assertions           |
| F9      | **Fixed** — `260dea1` asserts literal command and argument objects for all five repertoire controls via the read-only `lastDirectCommandRequest()` DEV projection             |
| F10     | **Fixed** — `5cd4229` rejects preferred/avoided conflicts after merging a one-sided patch with confirmed profile intent                                                       |
| F11     | **Fixed** — `5cd4229` preserves canonical `+`/`#` SAN suffixes from prose through evidence validation                                                                         |
| F12     | **Fixed** — `5cd4229` uses overflow-safe normalization, scaled means, and scale-invariant ESS while preserving moderate-input output exactly                                  |
| F13     | **Fixed** — `MAX_TOOL_RUNS` caps retained runs at 200 with oldest-first eviction, matching the tool-result and undo-history budgets                                           |
| F14     | **Fixed** — the documented safe-by-default invariant is now real: `game.ts`'s single `setPath` writer clears the marker for every navigation route                            |
| F15     | **Fixed** — AC-1 seeds a known persisted width and compares unconditionally; AC-5's constant-`true` expression is replaced by its two real halves                             |
| F16     | **Fixed** — AC-2 now selects a finding and asserts `toHaveCount(1)`; it had been counting zeros, so deleting all three controls would have kept it green                      |
| F17     | **Fixed** — `a85ca7c` re-enabled UX-005; the large-report paging scenario now asserts its multi-page precondition instead of skipping on it                                   |
| F18     | **Fixed** — Firefox/WebKit exclude by `@visual`/`@engine-bound` tag rather than by file; 125 tests now run cross-browser, with 5 measured engine-bound exceptions             |
| F19     | **Fixed** — the four `localeCompare` sorts in `metadata-sidecar.ts` use code-unit ordering, so exports are byte-identical across locales                                      |
| F20–F22 | Open                                                                                                                                                                          |

## Severity summary

| ID  | Severity | Area        | One line                                                          |
| --- | -------- | ----------- | ----------------------------------------------------------------- |
| F1  | Critical | CI          | Test suites that gate nothing, including 408 passing domain tests |
| F2  | Critical | UI store    | `check:tool-contract` crashes on a real import cycle              |
| F3  | High     | CSS         | `wp036` design-token contract fails 2 of 4 assertions             |
| F4  | Critical | UI store    | Undo is dead after a redo                                         |
| F5  | High     | UI store    | Cancelled live analysis leaks a permanently running operation     |
| F6  | High     | UI store    | Autosave flush can spin forever while paused                      |
| F7  | High     | chess-tools | Plan-card moves validated against a union, not a path             |
| F8  | High     | e2e         | Conditional clicks silently skip the behaviour under test         |
| F9  | High     | e2e         | "Argument equivalence" test never compares arguments              |
| F10 | Medium   | chess-tools | Preference conflict check only sees the patch                     |
| F11 | Medium   | chess-tools | Valid check/mate SAN moves rejected                               |
| F12 | Medium   | chess-tools | Weight normalisation overflows to zero or NaN                     |
| F13 | Medium   | UI store    | `toolRuns` grows without bound                                    |
| F14 | Medium   | UI store    | Navigation-marker comment contradicts the code                    |
| F15 | Medium   | e2e         | Tautological and dead assertions in `chat-setup`                  |
| F16 | Medium   | e2e         | "Renders exactly once" also passes on zero                        |
| F17 | Medium   | e2e         | Disabled and self-skipping coverage                               |
| F18 | Medium   | e2e         | Cross-browser exclusion is file-scoped                            |
| F19 | Low      | chess-tools | Locale-dependent ordering in "stable" JSON                        |
| F20 | Low      | e2e         | Fixed sleeps instead of conditions                                |
| F21 | Low      | UI store    | Test seams without a DEV guard                                    |
| F22 | Low      | repo        | Three orphaned work-package scripts                               |

---

## F1 — Critical — Test suites that gate nothing

**Location:** `.github/workflows/ci.yml`

`ci.yml` runs `check:skills`, `lint`, `format:check`, the chess-tools build, `docs:check`,
`check:content`, `typecheck`, two smoke scripts, `smoke-client.mjs`, the UI typecheck,
`test:chat`, and `test:e2e:container`. Everything below exists, is runnable, and is invoked by
no workflow:

| Command                                                                            | What it covers                                                                                                                                    | Current result               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `pnpm test:strategic-fit`                                                          | 50 files, ~856 KB, **408 tests** — scoring, replacement generation, safety, plan synthesis, metadata, weighting, portfolio, confidence, causality | passes                       |
| `pnpm check:tool-contract`                                                         | tool identifier/schema parity between contract, browser registry, and MCP server                                                                  | **crashes (F2)**             |
| `node --test scripts/wp036-design-tokens.test.mjs`                                 | WP-036 design-token contract                                                                                                                      | **2 of 4 fail (F3)**         |
| `node --test scripts/wp020-responsive-tiers.test.mjs`                              | WP-020 responsive tiers                                                                                                                           | passes                       |
| `node --test scripts/wp037-primitives.test.mjs`                                    | WP-037 primitives                                                                                                                                 | passes                       |
| `pnpm --filter @chess-mcp/ui build && node --test apps/ui/test/pwa-build.test.mjs` | production build stays installable, precaches Stockfish wasm                                                                                      | not runnable via `test:chat` |
| `node apps/ui/test/pwa-lifecycle.mjs`                                              | the only real Workbox A→B service-worker lifecycle test                                                                                           | not runnable via `test:chat` |

The two PWA tests cannot run even locally through the package script: `apps/ui/package.json`
defines `test:chat` as `node --no-experimental-webstorage --import tsx --test test/*.test.ts`,
and that `.ts` glob cannot match `pwa-build.test.mjs` or `pwa-lifecycle.mjs`. Playwright does not
pick them up either, because its `testDir` is `apps/ui/test/e2e`. `pwa-lifecycle.mjs` states in
its own header that a mocked update cannot prove Workbox leaves the second build waiting — so the
only WP-019 verification that actually executes is `pwa-update.spec.ts`, the dev-seam simulation
that comment calls insufficient.

**Why this matters more than a coverage gap:** F2 and F3 are real, reproducible failures sitting
in the repository right now. They are not new. They are invisible because the commands that catch
them never run. A green required-checks list currently means less than it appears to.

**Fix.** Add to the `node` job in `ci.yml`:

```yaml
- name: Strategic Fit domain suite
  run: pnpm test:strategic-fit
- name: Tool contract parity
  run: pnpm check:tool-contract
- name: Work package contract suites
  run: node --test scripts/*.test.mjs
```

And to the `ui` job, after the build step:

```yaml
- run: pnpm --filter @chess-mcp/ui build
- run: node --test apps/ui/test/pwa-build.test.mjs
- run: node apps/ui/test/pwa-lifecycle.mjs
```

Alternatively widen the glob to `test/*.test.{ts,mjs}` so `pwa-build.test.mjs` is reachable from
`test:chat`; `pwa-lifecycle.mjs` still needs its own line because it is a script, not a test file.

Expect the first run to be red. F2 and F3 must be fixed alongside this change, not after it.

> Historical note: the deleted `docs/ui-ux-remediation/manifest.json` recorded the correct command
> for every one of these. When it was pruned in `815d16d`, this document became the only place
> that knowledge survives — which is the argument for wiring the commands in now.

---

## F2 — Critical — `check:tool-contract` crashes on an import cycle

**Location:** `apps/ui/src/store/chat.ts:44`, cycle entered from
`apps/ui/src/application/browser-commands/default-context.ts:24`

```
ReferenceError: Cannot access 'runTool' before initialization
    apps/ui/src/store/chat.ts:44
    let toolExecutor: typeof runTool = runTool;
```

The cycle:

```
scripts/tool-contract-inventory.mjs
  → application/browser-commands/registry.ts
  → application/browser-commands/default-context.ts   (line 24: import { history as chatHistory } from "../../store/chat")
  → store/chat.ts                                     (line 3: import { toolSchemas, runTool } from "../llm/tools")
  → llm/tools.ts                                      (line 19: export const runTool = executeBrowserCommand)
  → application/browser-commands/registry.ts          ← cycle closes
```

`chat.ts:44` reads `runTool` at module-evaluation time. When entry is through the registry, the
binding is still in its temporal dead zone.

**Proven pre-existing.** Reproduced identically on a clean `6e8dd67` worktree, so PR #44 did not
introduce it. The `default-context.ts:24` edge was added by WP-028 (`32408ca`) to let a
chat-proposed line record its source message index.

Vite's browser build tolerates this ordering today, so the app works. The Node-loaded contract
check does not, and neither would any future Node-side consumer.

**Fix — break the cycle by deferring the binding:**

```ts
// apps/ui/src/store/chat.ts
let toolExecutorOverride: typeof runTool | null = null;
const toolExecutor: typeof runTool = (...args) => (toolExecutorOverride ?? runTool)(...args);

export function setChatToolExecutorForTesting(executor?: typeof runTool) {
  toolExecutorOverride = executor ?? null;
}
```

Reading `runTool` inside the call rather than at module scope removes the TDZ hazard while keeping
the existing seam behaviour. Apply the same treatment to `chatTransport` at `chat.ts:43` for
consistency.

**Better structural fix:** remove the `default-context.ts → store/chat.ts` edge entirely. The
context layer importing a UI store to read `history().length` inverts the intended dependency
direction. Pass the message index in through the injected dependency instead, so
`browser-commands` never imports a store.

---

## F3 — High — `wp036` design-token contract fails 2 of 4

**Location:** `scripts/wp036-design-tokens.test.mjs:87` and `:100`, against `apps/ui/src/styles.css`

```
✖ WP-036 AC-3 confines raw core-app colors to the token block
    actual: [ '#69717d', '#565d68', … ]   expected: []
✖ WP-036 AC-4 confines z-index literals to the layering token scale
    actual: [ 'z-index: 1' ]              expected: []
```

AC-4 is a single literal at `styles.css:646`:

```css
.bkl-cell:focus-visible {
  outline: var(--focus-ring) !important;
  outline-offset: -2px !important;
  z-index: 1; /* ← should be var(--z-content) */
}
```

`--z-content: 1` is already defined at `styles.css:133`, so the fix is a one-token substitution
with no visual change.

AC-3 is a set of raw hex colours outside the token block. The test deliberately allows retained
Strategic Fit colours (bounded by the `WP-036_STRATEGIC_FIT_START` marker) but not core-app ones.

**Proven pre-existing** — identical failures on a clean `6e8dd67` worktree.

**Fix.** Replace `z-index: 1` at `styles.css:646` with `var(--z-content)`. For AC-3, either move
each reported colour into the token block as a named variable, or extend the retained-colour
marker if the colours are genuinely deferred — but extending the marker is a decision to record,
not a silencing move.

---

## F4 — Critical — Undo is dead after a redo

**Location:** `apps/ui/src/store/history.ts:219-232` (missing flag), `:182-183` (swapped paths),
guard at `:157`

`undo()` refuses any entry that is not committed:

```ts
// history.ts:157
if (!entry?.committed) return; // never undo an uncommitted placeholder
```

`commitAfterMutation` sets `committed: true` at `:144`. But the undo entry that `redo()` pushes
at `:219-232` never sets it:

```ts
setUndoStack((entries) => [
  ...entries,
  {
    id: (nextId += 1),
    pgnBefore,
    pgnAfter,
    pathBefore,
    pathAfter,
    revisionBefore,
    revisionAfter,
    colorBefore,
    colorAfter,
    type, // ← no `committed: true`
  },
]);
```

**Reproduction:** apply a mutation → undo → redo → undo. The final undo silently does nothing.

A second defect sits in the same reconstruction. `undo()` swaps the paths when building the redo
entry:

```ts
// history.ts:182-183
pathBefore: pathAfter,
pathAfter: pathBefore,
```

`redo()` then restores with `restoreSnapshotForHistory(entry.pgnAfter, entry.pathAfter)` — the
post-edit PGN paired with the pre-edit path. Redo can show the right tree with the cursor on the
wrong node.

The stored `revisionBefore`/`revisionAfter` are also meaningless on these reconstructed entries.
`version` is monotonic (`game.ts:27`, `bump = () => setVersion((v) => v + 1)`, and
`restoreSnapshotForHistory` itself calls `bump()`), so a recorded revision is a number the counter
has already passed and can never match a live `version()` again. Nothing reads those fields today
(verified: no consumer outside `history.ts`), so this is latent rather than active.

**Why the tests missed it.** `apps/ui/test/history.test.ts:31-45` covers apply → undo → redo and
asserts only that `version()` increased. It never performs the second undo, and never compares
PGN or path after a redo. The e2e test that would have caught it — `UX-005 mutation application,
undo, and redo preserve exact PGN` — is disabled (F17).

**Fix:**

```ts
// history.ts — in redo(), the pushed undo entry
{
  id: (nextId += 1),
  pgnBefore, pgnAfter, pathBefore, pathAfter,
  revisionBefore, revisionAfter, colorBefore, colorAfter,
  type,
  committed: true,          // this entry describes a completed state change
}
```

For the path swap, the redo entry must describe the same before→after orientation as a normal
entry. In `undo()`:

```ts
{
  id: (nextId += 1),
  pgnBefore: pgnAfter,      // state to return to on redo
  pgnAfter: pgnBefore,
  pathBefore: pathAfter,
  pathAfter: pathBefore,
  …
}
```

then have `redo()` restore from `pgnBefore`/`pathBefore`. Whichever convention is chosen, the
invariant is that `restoreSnapshotForHistory` receives a PGN and the path belonging to that same
PGN.

**Required regression test** — add to `history.test.ts`:

```ts
test("undo works again after a redo, and each step restores its own path", () => {
  actions.loadPgn(START_PGN);
  clearHistory();
  const basePgn = actions.toPgn();
  const basePath = [...currentPath()];

  assert.equal(actions.applyEdit("add", ["d4"], { addMoves: ["e6"] }).ok, true);
  const editedPgn = actions.toPgn();
  const editedPath = [...currentPath()];

  undo();
  assert.equal(actions.toPgn(), basePgn);
  assert.deepEqual([...currentPath()], basePath);

  redo();
  assert.equal(actions.toPgn(), editedPgn);
  assert.deepEqual([...currentPath()], editedPath, "redo must restore the post-edit path");

  undo(); // the step that currently no-ops
  assert.equal(actions.toPgn(), basePgn, "undo must work after a redo");
  assert.deepEqual([...currentPath()], basePath);
});
```

---

## F5 — High — Cancelled live analysis leaks a permanently running operation

**Location:** `apps/ui/src/store/analysis.ts:148` (register), `:158` (early return), `:192-195`
(cleanup)

```ts
const operationId = registerOperation({ kind: "live-analysis", … });   // :148
void analyseLive(f, MULTIPV, depth).then((res) => {
  if (cancelled) return;                                               // :158  ← returns first
  setAnalysing(false);
  settleSilent(operationId, res ? "completed" : "failed");             // :160  ← never reached
  …
});

onCleanup(() => {
  cancelled = true;                                                    // :193
  clearTimeout(t);
});
```

Once the 180 ms debounce has elapsed and the search is in flight, navigating to another position
sets `cancelled = true` but neither aborts the worker nor settles the registry entry. When the
stale result arrives the callback returns immediately and the operation stays `running` forever.

**Consequences, in order of severity:**

1. **WP-019's update prompt is permanently suppressed.** `pwa/updates.ts:31` derives visibility as
   `updatePending() && !dismissedForPage() && runningOperations().length === 0`. One leaked
   operation makes that count permanently non-zero, so the user is never offered the update.
2. The Activity Strip (`ActivityStrip.tsx:13-15`) shows a stale analysis forever.
3. Every superseded position can leak another entry. Browsing a game leaks steadily.

**Fix:**

```ts
// analysis.ts
void analyseLive(f, MULTIPV, depth).then(
  (res) => {
    if (cancelled) {
      settleSilent(operationId, "completed");   // superseded, not failed; settle quietly
      return;
    }
    setAnalysing(false);
    settleSilent(operationId, res ? "completed" : "failed");
    …
  },
  (error) => {
    settleSilent(operationId, "failed");        // a rejected search must settle too
    throw error;
  },
);
```

The rejection handler matters independently: today a thrown search leaves the same stuck entry.

Consider also passing an `AbortSignal` into `analyseLive` and aborting it in `onCleanup`, so a
superseded search stops consuming the live worker rather than merely having its result discarded.

---

## F6 — High — Autosave flush can spin forever while paused

**Location:** `apps/ui/src/store/persist.ts:390` (loop), `:309` (early return)

```ts
function executePendingAutosave(): Promise<void> {
  if (autosavePauseDepth > 0) return autosaveTail;   // :309 — returns without clearing
  const saved = pendingAutosave;
  …
}

export async function flushWorkingRepertoire(): Promise<void> {
  while (pendingAutosave !== null) await executePendingAutosave();   // :390
  await autosaveTail;
}
```

When autosave is paused and a reactive document change has queued a pending save,
`executePendingAutosave()` returns the already-settled `autosaveTail` without clearing
`pendingAutosave`. The `while` condition never becomes false and the loop spins on a resolved
promise indefinitely.

**Reachable participants:**

- `store/strategic-fit-changes.ts:947` — `beforePersist` calls `pauseWorkingRepertoireAutosave()`
  and holds it across the persist.
- `store/strategic-fit-sidecar.ts:245` — `flush` calls `flushWorkingRepertoire()` before
  confirming a sidecar import.

A sidecar import confirming while a Strategic Fit change set holds the pause — or any future
caller pairing these — hangs.

**Fix:** make the flush pause-aware rather than looping blindly:

```ts
export async function flushWorkingRepertoire(): Promise<void> {
  while (pendingAutosave !== null && autosavePauseDepth === 0) {
    await executePendingAutosave();
  }
  await autosaveTail;
}
```

That terminates, but silently skips the flush while paused, which would break the sidecar's
durability requirement. The stronger fix is for `flushWorkingRepertoire` to write through the
pause, since a flush is an explicit durability demand:

```ts
export async function flushWorkingRepertoire(): Promise<void> {
  const saved = pendingAutosave;
  pendingAutosave = null;
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  if (saved !== null) {
    autosaveTail = autosaveTail
      .catch(() => undefined)
      .then(() => idbSet(WORKING_REPERTOIRE_STORAGE_KEY, saved))
      .then(() => {
        setLastAutosaveAt(Date.now());
      });
  }
  await autosaveTail;
}
```

This mirrors what `pauseWorkingRepertoireAutosave` already does at `:330-336`, which flushes the
in-flight save before handing back its release function.

---

## F7 — High — Plan-card moves validated against a union, not a path

**Location:** `packages/chess-tools/src/strategic-fit/plan-synthesis.ts:341-349`, set built at
`:407-410`

```ts
const moves = new Set(evidence.moves);          // :410 — every move from every path/drill
…
for (const mention of strategicFitPlanMoveMentions(text)) {   // :342
  if (!moves.has(mention)) throw new StrategicFitPlanError("strategic_fit_plan_unsupported_move", …);
  citedMoves.push(mention);
}
```

The evidence builder in `apps/ui/src/store/strategic-fit-training.ts` flattens all paths and
drills into one sorted array, which this converts to a single `Set`. Validation therefore checks
only that each SAN token appears _somewhere_ in the finding. It never checks that:

- a mentioned sequence occurs together on one validated path,
- the moves belong to the drill or checkpoint that section cites,
- the moves appear in a legal order.

A model can assemble a line that exists nowhere by combining individually valid moves from
mutually exclusive branches, and the card is accepted as evidence-bound.

This contradicts the contract in `AGENTS.md`: _"every move its text mentions must be on a
validated path."_ A union of all paths is not a path.

**Fix.** Retain per-path and per-drill sequences in the evidence rather than flattening:

```ts
export interface StrategicFitPlanEvidence {
  …
  /** Ordered SAN sequences, one per validated path; drills keyed by drill_id. */
  readonly move_sequences: readonly (readonly string[])[];
  readonly drill_sequences: ReadonlyMap<string, readonly string[]>;
}
```

Then validate the ordered mentions as a subsequence of at least one retained sequence:

```ts
const mentions = strategicFitPlanMoveMentions(text);
const candidates =
  kind === "model-position" || drillIds.length > 0
    ? drillIds.map((id) => evidence.drill_sequences.get(id) ?? [])
    : evidence.move_sequences;

const onOnePath = candidates.some((seq) => isOrderedSubsequence(mentions, seq));
if (mentions.length > 0 && !onOnePath) {
  throw new StrategicFitPlanError(
    "strategic_fit_plan_unsupported_move",
    `${path}.text combines moves that never occur together on one validated path.`,
  );
}
```

Drill-anchored and model-position sections should validate against the cited drill only, not the
global union.

---

## F8 — High — Conditional clicks silently skip the behaviour under test

**Location:** `apps/ui/test/e2e/strategic-fit-evidence.spec.ts:71` and `:168`;
`apps/ui/test/e2e/strategic-fit-preflight.spec.ts:64`, `:71`, `:73`

```ts
if (await action.isVisible()) await action.click();
```

If the control is missing, renamed, or simply not yet mounted, the click is skipped and the test
proceeds to assert against whatever state already exists. A test that claims "analysis ran and
produced state X" degenerates into "the page happened to be in state X" — with no failure.

`locator.isVisible()` is also an instantaneous, non-retrying check, so it returns `false` during
the mount frame. This is race-prone as well as false-passing.

**Fix:**

```ts
await expect(action).toBeVisible();
await action.click();
```

If a path is genuinely optional, assert the alternative explicitly rather than branching silently:

```ts
expect(await action.count()).toBe(0);
await expect(dialog.getByTestId("already-complete")).toBeVisible();
```

---

## F9 — High — "Argument equivalence" test never compares arguments

**Location:** `apps/ui/test/e2e/repertoire-taxonomy.spec.ts:65`

The test is titled _"AC-2 each tool records the same command with the same arguments"_, and its
file header promises argument-equivalence assertions "so a tool that silently loses an argument
during the move is caught". It is the stated rollback safety net for the WP-022 refactor.

It reads the recorded state, declares the type `{ args?: unknown }` — and then asserts only:

```ts
expect(recorded, `${command} was dispatched`).not.toBeNull();
```

The arguments are typed and discarded. Dropping `depth`, flipping `color`, or passing `{}` all
leave this test green. The one assertion the file's premise rests on does not exist.

**Fix:**

```ts
const EXPECTED_ARGS: Record<string, Record<string, unknown>> = {
  find_repertoire_gaps: { depth: 18, limit: 12 },
  // …one literal entry per command in COMMAND_TOOLS
};

for (const command of COMMAND_TOOLS) {
  const recorded = await page.evaluate(…);
  expect(recorded, `${command} was dispatched`).not.toBeNull();
  expect(recorded?.args, `${command} argument equivalence`).toEqual(EXPECTED_ARGS[command]);
}
```

---

## F10 — Medium — Preference conflict check only sees the patch

**Location:** `packages/chess-tools/src/strategic-fit/intent-interview.ts:262-273`

```ts
const preferred = patch.preferred_concept_ids as readonly string[] | undefined;
const avoided = patch.avoided_concept_ids as readonly string[] | undefined;
if (preferred && avoided) {                       // ← only when BOTH are in this patch
  const overlap = preferred.filter((concept) => avoided.includes(concept));
  if (overlap.length) throw new StrategicFitIntentError("strategic_fit_intent_conflicting_concepts", …);
}
```

A patch that adds a concept to `avoided_concept_ids` while that concept already sits in the saved
`preferred_concept_ids` passes validation, and vice versa. The caller in
`apps/ui/src/store/strategic-fit-intent-interview.ts` then merges the patch into the existing
profile without re-checking.

Downstream, `replacement-score.ts` evaluates the avoided match first and forces intent fit to
zero. A concept the user still explicitly prefers is silently treated as disqualifying.

**Fix.** Validate the merged result, not the patch:

```ts
export function preferencePatch(input: unknown, base: StrategicFitPreferences) {
  const patch = /* …existing parsing… */;
  const merged = { ...base, ...patch };
  const overlap = (merged.preferred_concept_ids ?? [])
    .filter((concept) => (merged.avoided_concept_ids ?? []).includes(concept));
  if (overlap.length) {
    throw new StrategicFitIntentError(
      "strategic_fit_intent_conflicting_concepts",
      `${overlap.join(", ")} cannot be preferred and avoided at the same time. …`,
    );
  }
  return patch;
}
```

---

## F11 — Medium — Valid check and mate moves are rejected

**Location:** `packages/chess-tools/src/strategic-fit/plan-synthesis.ts:215` (tokenizer) vs
`:342` (lookup)

```ts
const token = raw.replace(/[+#]+$/, ""); // :215 — strips check/mate from prose
```

The evidence set is built from canonical SAN, which retains those suffixes. Prose mentioning a
genuinely validated `Qxd8+` is looked up as `Qxd8`, is absent from the set, and is rejected as an
invented move.

Users cannot save evidence-grounded plan sections or titles that mention checking or mating moves
— exactly the moves a training card is most likely to discuss.

**Fix.** Canonicalise both sides identically. Preferred: keep the suffix in extracted mentions and
widen `SAN_PATTERN` to accept trailing `+`/`#`. Otherwise strip the suffix from every evidence
move when constructing the lookup set, so both sides are suffix-free:

```ts
const moves = new Set([...evidence.moves].map((san) => san.replace(/[+#]+$/, "")));
```

Note the first option is stricter and therefore better: it distinguishes `Qxd8` from `Qxd8+`.

---

## F12 — Medium — Weight normalisation overflows to zero or NaN

**Location:** `packages/chess-tools/src/strategic-fit/weights.ts:197-200` (validation),
`:318-324` (decision normalisation), `:515-537` (route normalisation);
`packages/chess-tools/src/strategic-fit/metadata.ts:678-690`, `:716-725` (persisted acceptance)

```ts
function validateWeight(weight: number, identity: string): void {
  if (!Number.isFinite(weight) || weight < 0) throw new Error(…);   // any finite value passes
}
```

Two accepted weights of `1e308` are each finite, but their sum is `Infinity`:

- `weights.ts:324` — `normalized_weight: value.raw / siblingTotal` → `1e308 / Infinity` → **0**.
  The zero-total fallback at `:307` does not fire, because `Infinity !== 0`.
- `weights.ts:515-521` — `rawUnitTotal` becomes `Infinity`, and `unit.score / unitDenominator`
  yields `Infinity / Infinity` → **NaN**.
- `calculateEffectiveSampleSize` (`:246`) squares raw inputs without scaling, overflowing sooner.

Persisted metadata accepts the same values, so an imported or restored sidecar with large but
contract-valid weights can silently erase opponent probabilities or emit NaN route weights.

**Fix.** Normalise scale-invariantly — divide by the finite maximum before summing:

```ts
function normalizeShares(values: readonly number[]): number[] {
  const max = Math.max(...values);
  if (!Number.isFinite(max) || max === 0) return values.map(() => 1 / values.length);
  const scaled = values.map((value) => value / max);
  const total = scaled.reduce((sum, value) => sum + value, 0);
  return scaled.map((value) => value / total);
}
```

Additionally reject non-finite intermediates explicitly rather than letting them propagate, and
consider applying the documented upper bound that tool arguments already use to persisted weights.

---

## F13 — Medium — `toolRuns` grows without bound

**Location:** `apps/ui/src/store/chat.ts:321`

WP-027 deliberately removed the per-turn `setToolRuns([])` from `send()`, on the correct reasoning
that runs are conversation history rather than scratch state. But nothing replaced it with a
budget. `executeCalls` only appends, and the sole reset is `clearChat()` (`:47`), behind a manual
button.

This is inconsistent with the surrounding code: tool _results_ are capped by
`MAX_TOOL_RESULT_CHARS` in `compactToolResult`, and `history.ts` has a full byte budget with
eviction. The run list got the persistence half of the change without the budget half.

**Fix.** Cap on append, mirroring the history budget:

```ts
const MAX_TOOL_RUNS = 200;

setToolRuns((runs) => {
  const next = [
    ...runs,
    ...calls.map((tc) => ({ id: tc.id, name: tc.function.name, status: "queued" as const })),
  ];
  return next.length > MAX_TOOL_RUNS ? next.slice(next.length - MAX_TOOL_RUNS) : next;
});
```

Trim from the front so the newest runs — the ones the UI shows — always survive.

---

## F14 — Medium — Navigation-marker comment contradicts the code

**Location:** `apps/ui/src/store/ui.ts:63` versus `apps/ui/src/store/game.ts:162`

The doc comment states:

> …rather than trying to enumerate every other way to navigate, `actions.goto` clears this on
> every call and the card that navigated re-sets it immediately afterwards. Anything that does not
> opt in therefore clears it by default.

`actions.goto` (`game.ts:162`) never touches `lastNavigationSource`. The only writers are the two
lines in `AnalysisPanel.tsx` (`:46`, `:136`). The actual mechanism is a `createEffect` diffing a
`markedPath` closure variable (`AnalysisPanel.tsx:26-48`).

The effect works for the common case, but the safe-by-default invariant the comment promises does
not exist. Any future navigation route added elsewhere will keep a stale "Showing on board"
marker, and the next reader will assume a guarantee the code does not provide.

**Fix — implement the documented behaviour, which is the more robust design:**

```ts
// game.ts
goto(p: Path) {
  setLastNavigationSource(null);   // every navigation clears by default
  …
}
```

Then the card re-sets the marker synchronously after calling `actions.goto`, and the
`createEffect` in `AnalysisPanel.tsx` can be deleted. If the import direction is undesirable, fix
the comment instead — but the two must agree.

---

## F15 — Medium — Tautological and dead assertions in `chat-setup`

**Location:** `apps/ui/test/e2e/chat-setup.spec.ts:41` and `:127`

The file header states that `openApp` leaves localStorage empty. Given that premise:

```ts
if (Number.isFinite(persisted) && persisted > 0) {
  // :41 — Number(null) === 0, always false
  // the AC-1 "width equals persisted width" assertion lives here and never runs
}
```

and:

```ts
expect(storedBefore === null || storedAfter !== null).toBe(true); // :127
```

With `storedBefore === null` guaranteed by the same premise, the expression is the constant
`true`. The AC-5 claim — that the unconfigured state never wrote the persisted width — is not
tested at all.

**Fix.** Seed a known width, then assert unconditionally:

```ts
await page.addInitScript(
  ([key, value]) => localStorage.setItem(key, value),
  [CHAT_WIDTH_KEY, "420"],
);
await openApp(page);
expect(Math.round(await renderedChatWidth(page))).toBe(420);

// AC-5: only the deliberate resize writes the key
expect(storedBefore).toBeNull();
await chatDivider.press("ArrowLeft");
expect(Number(storedAfter)).toBeLessThan(Number(beforeWidth));
```

---

## F16 — Medium — "Renders exactly once" also passes on zero

**Location:** `apps/ui/test/e2e/strategic-fit-stage-layout.spec.ts:88` and `:93`

```ts
expect(count, `${selector} at ${viewport.label}`).toBeLessThanOrEqual(1);
```

The test is titled _"WP-033 AC-2 resolution controls render exactly once at every width"_, and the
header calls the duplicate-render assertions "the point of this file". A one-sided bound cannot
distinguish "exactly once" from "not at all": deleting `ResolutionActions`, `TrainException`, and
`CohortEditor` outright would make all four viewports report `0` and the suite stay green.

**Fix.** Use a per-viewport expectation table:

```ts
const EXPECTED: Record<string, Record<string, number>> = {
  "phone-360": { "[data-resolution-actions]": 1, "[data-cohort-editor]": 0 },
  "desktop-1440": { "[data-resolution-actions]": 1, "[data-cohort-editor]": 1 },
  // …
};
expect(count, `${selector} at ${viewport.label}`).toBe(EXPECTED[viewport.label][selector]);
```

---

## F17 — Medium — Disabled and self-skipping coverage

**Location:** `apps/ui/test/e2e/core-document.spec.ts:264`;
`apps/ui/test/e2e/strategic-fit-large-report.spec.ts:125`

```ts
test.fixme("UX-005 mutation application, undo, and redo preserve exact PGN", …)   // core-document:264
```

The body (lines 265-288) contains real PGN round-trip assertions and never executes. This is the
test most likely to have caught **F4**. PR #44 carries it forward as a known limitation, which is
honest — but it means undo/redo PGN fidelity has no automated verification at all.

```ts
test.skip(total <= 6, "this fixture produced a single page of findings"); // large-report:125
```

A data-dependent runtime skip. If the fixture stops producing multiple pages, the paging-selection
scenario silently stops running and the suite still reports green.

**Fix.** For `large-report`, assert the precondition instead of skipping on it:

```ts
expect(total, "fixture must produce multiple pages of findings").toBeGreaterThan(6);
```

For `core-document`, fix and re-enable alongside **F4** — the fix and the test belong in one
change, since the test is the proof the fix works.

---

## F18 — Medium — Cross-browser exclusion is file-scoped

**Location:** `apps/ui/playwright.config.ts:16-17` (Firefox), `:25-26` (WebKit)

```ts
testIgnore: /strategic-fit-(findings|map|visualization-hardening|large-report|profile-setup|sidecar)\.spec\.ts/,   // firefox
testIgnore: /strategic-fit-(findings|map|visualization-hardening|large-report|lifecycle|sidecar)\.spec\.ts/,       // webkit
```

The stated reasons — chromium owns visual baselines, some scans are engine-bound — justify
excluding the `@visual`-tagged tests. But the exclusion is **file**-scoped, so hundreds of
non-visual behavioural assertions are dropped on two of three engines.

`strategic-fit-findings.spec.ts` is ~3,200 lines, the largest behavioural spec in the repository,
and runs on Chromium only. WP-035's new PD-5 journey evidence lives in that file, so the
no-split decision's automated proof is single-engine.

Evidence citing `pnpm test:e2e:container` should not be read as cross-browser verification for
these packages.

**Fix.** Tag-scope rather than file-scope:

```ts
{ name: "firefox", grepInvert: /@visual|@engine-bound/, use: { ...devices["Desktop Firefox"] } },
```

and mark the genuinely engine- or baseline-bound tests individually:

```ts
test("strategic map renders the chart @visual", …);
test.skip(({ browserName }) => browserName !== "chromium", "engine-bound reanalysis timing");
```

---

## F19 — Low — Locale-dependent ordering in "stable" JSON

**Location:** `packages/chess-tools/src/strategic-fit/metadata-sidecar.ts:92`

```ts
function stableJson(value: unknown): string {
  …
  return `{${Object.entries(value as RecordLike)
    .sort(([left], [right]) => left.localeCompare(right))   // :92
```

`localeCompare` uses the runtime's default collation, which varies with locale and ICU build. For
non-ASCII keys the "stable" serialisation can differ byte-for-byte across supported environments,
undermining deterministic exports and byte-level comparison.

Other deterministic modules in the same package already use explicit code-unit comparison —
`weights.ts:185-187` defines exactly the right helper.

**Fix:**

```ts
.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
```

The same substitution applies to `metadata-sidecar.ts:326`, `:504`, and `:531`, which sort
resolutions and finding IDs with `localeCompare` for the same deterministic purpose.

---

## F20 — Low — Fixed sleeps instead of conditions

**Location:** `apps/ui/test/e2e/chat-result-cards.spec.ts:224`;
`apps/ui/test/e2e/phase7.spec.ts:234`

```ts
await page.waitForTimeout(500); // "give it enough time" before asserting toBeFocused()
await page.waitForTimeout(550); // outwait the autosave debounce before reload()
```

Both pass today but are timing-coupled. Under the documented throttled runner (30% CPU cap in
`scripts/playwright-low-impact.mjs`) the focus rAF or the 400 ms autosave debounce can exceed the
sleep, producing environmental failures. Worse, a genuine regression that pushes the work to
600 ms is indistinguishable from flake.

`core-a11y.spec.ts:89`'s 160 ms sleep is legitimate — it proves nothing changes over an interval.

**Fix:**

```ts
// chat-result-cards — the assertion already auto-retries
await expect(tokenField).toBeFocused();

// phase7 — poll the real durable state
await expect
  .poll(() => indexedDbValue(page, "workingRepertoire"))
  .toMatchObject({ pgn: expectedPgn });
await page.reload();
```

`strategic-fit-profile-setup.spec.ts:97-106` already uses the polling pattern correctly and is
worth copying.

---

## F21 — Low — Test seams without a DEV guard

**Location:** ten exports across `apps/ui/src/store/`

Twelve `*ForTesting` exports throw when `import.meta.env.DEV` is false. Ten do not:

`analysis.ts::announceEngineOfflineForTesting`, `announce.ts::resetAnnouncementsForTesting`,
`announce.ts::announcementLogForTesting`, `board-cursor.ts::resetCursorForTesting`,
`chat.ts::setChatTransportForTesting`, `chat.ts::setChatToolExecutorForTesting`,
`chat.ts::appendToolResultForTesting`, `files.ts::setReopenHandleForTesting`,
`history.ts::getStacksForTesting`, `operations.ts::resetOperationsForTesting`.

**Not currently exploitable**: the `window.__chess` surface is correctly DEV-gated at
`index.tsx:122`, so these are not reachable from a production build. They remain public module
exports that survive tree-shaking analysis and are inconsistent with their guarded siblings —
notably `setChatTransportForTesting`, which can replace the LLM transport wholesale.

**Fix.** Add the same guard the other twelve use:

```ts
export function setChatTransportForTesting(transport?: typeof streamChat) {
  if (!import.meta.env.DEV) throw new Error("Test-only function");
  chatTransport = transport ?? streamChat;
}
```

---

## F22 — Low — Three orphaned work-package scripts

**Location:** `scripts/wp020-responsive-tiers.test.mjs`, `scripts/wp036-design-tokens.test.mjs`,
`scripts/wp037-primitives.test.mjs`

The docs prune in `815d16d` removed `docs/ui-ux-remediation/`, the `ux:task`/`ux:test`/
`ux:plan-check` scripts, `scripts/lib/ux-task-contract.mjs`, and
`scripts/wp035-strategic-fit-journeys.mjs`. These three survived.

They still work — they read `styles.css` and component sources directly and reference no deleted
docs — but nothing can invoke them: no manifest declares them, no runner exists, no CI entry names
them. And `wp036` fails 2 of 4 (**F3**).

They are currently in the worst state available: present, failing, and unreachable.

**Fix — pick one:**

1. **Keep**: wire `node --test scripts/*.test.mjs` into `ci.yml` (part of **F1**) and fix **F3**.
   Note these are structural-lint-grade assertions — `wp037` checks that a source file contains
   the string `primitives/Status"`, which passes on an unused import.
2. **Delete**: complete the retirement, accepting that the design-token and primitive boundaries
   become conventions rather than enforced contracts.

Option 1 is recommended: the token boundary is exactly the kind of thing that decays silently, and
`styles.css:646` is proof it already has.

---

## Suggested order of work

1. **F1** — wire the orphaned commands into CI. Do this first; it makes F2 and F3 visible and
   prevents the next regression from hiding the same way.
2. **F2**, **F3** — fix the two failures that F1 exposes. These must land with F1 or CI goes red.
3. **F4** — undo-after-redo, together with re-enabling UX-005 from **F17**.
4. **F5** — settle the leaked analysis operation. Small fix, and it unblocks the PWA update prompt.
5. **F6** — the flush/pause hang.
6. **F7**, **F10**, **F11**, **F12** — chess-tools correctness.
7. **F8**, **F9**, **F15**, **F16** — false-passing tests. Fixing these may surface further real
   defects, so schedule them before the remaining cleanup rather than after.
8. **F13**, **F14**, **F18**, **F19**, **F20**, **F21**, **F22** — bounded cleanup.

## What is genuinely good

Worth recording, because it sets the standard the findings above are measured against.

- **`Dialog.tsx`** is exemplary. Comments cite specific CI run IDs and explain _why_: the
  `stopImmediatePropagation`-versus-`stopPropagation` note, the WebKit re-assert loop for focus
  restoration, and the macOS "Full Keyboard Access" behaviour that makes native Tab skip buttons.
  The `openDialogs` stack added in PR #44 correctly ensures only the topmost surface answers
  Escape.
- **WP-027's context chip** is honest by construction. `chatContextSnapshot()`/`chatContextBlock()`
  feed both the chip and `systemMessage()`, so the UI cannot claim a context the prompt does not
  carry. That is a structural guarantee, not a test.
- **Per-run abort controllers** in `chat.ts` are correct: a child abort does not touch the turn,
  the turn aborts every child, and the listener is removed in `finally`.
- **`pushShortcutScope`** removes its own entry by identity rather than popping the stack top, so
  out-of-order overlay teardown cannot strand the count.
- **`operations.ts`** guards against double settlement before mutating state, and separates
  announcing from quiet settles per the WP-009 policy.
- **The accessibility work in PR #44** self-reported that AG-1 had been silently absent from CI and
  that AG-2 had never been built, then proved a VoiceOver failure pre-existing before attributing
  it. It also empirically determined that scenario _order_ within one AT session affects results,
  and documented the run IDs. That is the correct methodology.
- **`packages/chess-tools` boundary discipline** holds: no SolidJS, Zod, MCP SDK, or OpenRouter
  imports anywhere in the package. Replacement cache keys correctly switch from transposition key
  to full FEN at the 50-move boundary, and depth validation stays within 1-30.
- **The docs prune (`815d16d`)** corrected forward-looking claims that shipped work had falsified
  rather than merely deleting files, left zero dead relative links across all surviving markdown,
  and added the durable rule to `COORDINATED_IMPLEMENTATION_WORKFLOW.md` that an initiative's
  design/plan/progress documents are removed once it ships.

## Method and limits

- Reviewed from a detached `git worktree` pinned to a known commit, because the working tree
  changed twice during the review. Findings were re-verified after each move.
- "Pre-existing" is claimed only where proven by running the same command against a clean worktree
  at the earlier commit. F2 and F3 were verified this way at `6e8dd67`.
- Gates listed at the top were executed. `pnpm test:e2e:container` was **not** run; no claim in
  this document depends on it.
- The e2e findings are static analysis of test _code_, not observations of test failures. Each
  cites the specific assertion that is missing or vacuous.
- Not audited: `apps/mcp-server` beyond its smoke suite, the engine worker pool implementations,
  and the ~160 exported symbols with no callers outside their defining file (mostly `as const`
  type sources in `packages/chess-tools/src/strategic-fit/`, but including some real functions —
  worth a deliberate pass, not a blind delete).
