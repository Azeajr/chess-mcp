# Handoff: hermes-work salvage — AG-3 remains

Branch: `salvage`, fast-forwarded onto `main`. HEAD `25a863b`. **Do not delete `salvage`.**
This file is tracked (it last changed in `cf5e83c`). Delete it once S4 and S5 have been committed
and AG-3 is resolved.

---

## 1. Mission

Salvage the abandoned `hermes-work` branch onto `salvage` (branched off `main`), re-landing only
reviewed and fixed slices, each gated on a **full** container e2e suite.

`hermes-work` still exists and is untouched — it is the record. 16 of its commits are still
unsalvaged. Nothing is cherry-picked: every slice is rebuilt, reviewed, and gated.

### Why this salvage exists

`hermes-work` shipped 12 e2e regressions. The root cause was structural, not carelessness:
`scripts/ux-test.mjs` runs only the commands a package's manifest lists — typically
`--grep "WP-0NN"` against its own spec. There was no full-suite regression gate anywhere in the
`ux:task` → implement → `ux:test` → record-complete loop, so two packages passed their own greps,
were recorded complete with "validation evidence", and regressed two previously-completed packages.

That gate now exists (`validateCompletionEvidence` in `scripts/lib/ux-task-contract.mjs`) and
rejects any completion whose evidence names no e2e run, or only spec-scoped ones.

The branch also relaxed its own governance mid-run (auto-commit/auto-push in AGENTS.md, four design
gates self-resolved by the agent). `salvage` branched fresh off `main`, so none of that came along.

---

## 2. The salvage plan

The original plan was never written to a file — it lives in a previous Claude session transcript
(`~/.claude/projects/-home-spark343-github-chess-mcp/1ed4bb32-*.jsonl`, line 463). Transcribed here
so it stops being lost.

| Phase | Content                                                                                            | State                                            |
| ----- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 0     | regression gate; revert governance changes; reopen self-resolved gates; drop `settings.local.json` | done (`6e56085` + branching off `main`)          |
| 1     | baseline on `salvage` — the real baseline is **zero** container failures                           | done                                             |
| 2     | six gated slices, S1–S6                                                                            | **6 of 6 implemented; WP-011 awaits AG-3**       |
| 3     | drop `playwright-low-impact.mjs`, prototype HTML                                                   | done by construction (never on `salvage`)        |
| 4     | phone default tab decision                                                                         | **decided: keep Analysis**, drop hermes's change |

### Slice ledger

| Slice  | What                                                      | State                                        |
| ------ | --------------------------------------------------------- | -------------------------------------------- |
| S1     | `docs-consistency.mjs` query-string fix                   | ✅ `fafa3b5`                                 |
| S2     | Arrow legend (WP-038)                                     | ✅ `5021ee3`                                 |
| S3     | `Dialog` primitive + shortcut registry (WP-007)           | ✅ `cf5e83c`, AG-1 resolved, WP-007 complete |
| S4     | Document-close guard + snapshot recovery (WP-003, WP-004) | ✅ working tree, uncommitted — see §4        |
| **S5** | **WP-011 keyboard + `InteractiveRow`**                    | **gated green, AG-3 owed — see §5**          |
| S6     | Chat/tool content registry (WP-025)                       | ✅ `2d6a662`, WP-025 complete                |

Also landed opportunistically: WP-023 (`db8dfd3`).

---

## 3. Standing constraints

- **pnpm**, never npm.
- **No `Co-Authored-By` trailer** in commit messages (memory: `no-co-authored-by-trailer.md`).
- Commit messages and code comments: normal prose, not caveman.
- **The gate for any production change is the full container suite**, unnarrowed:
  `pnpm test:e2e:container`. Current baseline: **409 passed, 14 configured skips, zero failures**
  (361 before S4 and S5 added their checks).
  A package-scoped run cannot show whether a package regressed another one, and `ux:plan-check`
  rejects completion evidence that names only scoped runs.
- Do not stage or commit unless asked.
- The accessibility workflow stays `workflow_dispatch`-only (user's explicit decision).
- Do not resolve a gate by writing its decision yourself. Gates are the user's call.

### Established loop

```
pnpm ux:task WP-NNN          # capsule: readiness, ACs, allowed files, protocol
… implement …
pnpm -r typecheck && pnpm lint && pnpm format && pnpm ux:plan-check
pnpm test:e2e:container      # the real gate, full suite
… record completion evidence in docs/ui-ux-remediation/state.json …
pnpm ux:plan-check
git push origin salvage && git push origin salvage:main
```

`main` gets fast-forwarded because `workflow_dispatch` workflows must exist on the default branch
to be dispatchable.

---

## 4. S4 — WP-003 and WP-004 (DONE, uncommitted)

Both packages are implemented, gated, and recorded complete in `state.json`. Nothing is staged or
committed: the working tree holds the whole slice, ready for two commits (WP-003, then WP-004).

Gate runs, both full and unnarrowed in the version-matched Playwright container:

- WP-003: **379 passed, 14 skipped, zero failures**
- WP-004: **382 passed, 14 skipped, zero failures** — the current baseline

The first WP-003 gate run failed six times (`core-dialogs.spec.ts` × three engines). The guard makes
`Open PGN` a two-step flow, and that spec's colour-picker fixture clicked straight through to the
picker. That is the regression class the full-suite gate exists to catch, and it was invisible to
any package-scoped run.

### What was fixed relative to hermes

Of the five known defects in §4b of the previous handoff:

1. **The two lint errors are avoided by construction.** They appear when `continueDocumentClose`
   becomes async in WP-004; both call sites are wrapped in `void`.
2. **Idle snapshots now have change detection** — an `idle` capture whose PGN matches the last
   captured one is skipped, so the ring no longer fills with copies and evicts `before-replace`.
3. **`deleteSnapshot` no longer races `captureSnapshot`** — every snapshot mutation, and
   `listSnapshots`, runs through one queue.
4. **A malformed index entry can no longer make `trimSnapshotIndex` compute `NaN`** — the index is
   normalized on read, and rows without an id are dropped.
5. **The false reversibility copy does not exist on `salvage`.** `apps/ui/src/content/chat.ts` is a
   hermes-only file; S6 rebuilt that content without the claim. Nothing to fix — verified by
   grepping for the sentence and for `undo` across `apps/ui/src/content`.

Defects 2–4 each have a test in `apps/ui/test/persist-snapshots.test.ts` that fails when its fix is
reverted; that was verified by probe, not assumed.

### Environment note that will cost you an hour otherwise

On Node 25 (this host), ~40 of the `apps/ui` unit suites fail at import with
`TypeError: localStorage.getItem is not a function`. Node 25 defines a `localStorage` global with no
Web Storage methods, so the store modules feature-detect it as present and then call it. This is
**pre-existing and unrelated** — confirmed by stashing the whole working tree and reproducing it on
a clean `HEAD`. To run the unit suites here, preload a shim:

```js
// localstorage-stub.mjs — anywhere outside the repo
const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => store.set(String(key), String(value)),
    removeItem: (key) => store.delete(String(key)),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  },
});
```

```bash
cd apps/ui && pnpm exec tsx --import /path/to/localstorage-stub.mjs --test test/*.test.ts
```

With the shim: **300 passed, zero failures**, including the two Strategic Fit suites that hold the
document-transaction pause/rollback contract.

## 5. S5 — WP-011 keyboard + `InteractiveRow` (IMPLEMENTED, uncommitted, AG-3 owed)

The implementation is in the working tree and gated: **409 passed, 14 skipped, zero failures** in
the full container suite. WP-011 is **not** recorded complete, and must not be: `AG-3` is an
unresolved completion gate, and `ux:plan-check` rejects a package recorded complete while one is
open. Its `state.json` status is still `not-started` — `in-progress` is invalid for an executable
package, which this one still is.

Source commit: `dd7dc12`, applied with `git apply --3way` (clean except `styles.css`, which had to
be merged by hand because S3/S6 moved it).

### What the four "known defects" turned out to be

1. **The WP-002 AC-2 regression does not reproduce on `salvage`.** `core-layout.spec.ts` is
   byte-identical to hermes's, and it passes on all three engines in the container with WP-011
   applied. Measured directly: the lowest `.rep-section button` at 768×1024 ends at y=992 of 1024,
   so there is 32 px of headroom — and the 11 buttons are scan/action buttons, not rows, so the row
   target floor does not move them at all. The failure was specific to hermes's own layout state.
   The 32 px margin is thin and owned by WP-002/WP-017, not by this package.
   Note this test fails **locally** on this host (one violation, "Suggest") both with and without
   WP-011 — a host font-metric difference, not a regression.
2. **Unreachable tab stop when `currentPath()` is `[]` — fixed.** `entryPath()` falls back to the
   first move, because the root has no rendered item and `[]` matches nothing.
3. **Focus lost on Enter — fixed.** Navigation rebuilds every item, so activation re-focuses the
   item it activated.
4. `InteractiveRow` was taken as-is, with one change: the opponent-prep summary rows are **not**
   buttons. hermes made them `InteractiveRow` with an `aria-label` and no handler purely to satisfy
   the `.rep-row` reachability check — a Tab stop that announces "button" and does nothing. They are
   `.rep-row-static` divs here.

Two further defects surfaced only by running it, both fixed with a test that fails without the fix:

- **Collapsing a branch had become pointer-only.** The collapse toggle is `tabIndex={-1}` (a tree
  with one tab stop cannot also hand out one per branch), so hermes's port left no keyboard path to
  it at all — in the package whose objective is keyboard operability. `Space` on a move whose parent
  has variations now toggles that branch; on any other move it falls through to native activation.
  DV-2's arrow semantics are untouched.
- **hermes's `accessibility.ts` change exempted every scoped region from the `h1` rule, dialogs
  included**, which quietly undid a WP-007 finding (a dialog root is its own heading outline). The
  exemption here covers panels but still requires an `h1` for `[role='dialog']`.

### Discharging AG-3 — NOT DONE, and bigger than it looks

AG-3 needs NVDA + VoiceOver confirming tree role, level, and expanded state are announced, and that
traversal does not read the entire tree on every key.

The previous handoff said "the scenario runner is already parameterized; add a move-tree scenario
definition". That is optimistic. `scenarios/dialog-scenario.ts` is parameterized **over dialogs**:
it opens by opener name, waits for `role=dialog`, and hands the AT collector `awaitOpen` /
`awaitClosed` / `refocusDialog`. `collectors/at-runner.ts` drives one fixed cycle (report focus →
Escape → Enter → virtual-cursor sweep) and emits `AtObservation`s tagged with **AG-1's** claims.
`verdict.ts` scores those claims specifically.

A move-tree scenario therefore needs, at minimum:

- a tree scenario runner (no opener, no dialog, focus enters via Tab),
- an AT cycle that presses `ArrowRight` / `ArrowDown` / `Space` **with the screen reader** and keeps
  one utterance per key (see §6 — a Playwright key press produces speech that is dropped),
- new claim identifiers in `evidence-schema.ts` and matching checks in `verdict.ts`,
- an `ag-3-move-tree.spec.ts`, plus `capture.mjs`'s container branch, which hardcodes
  `ag-1-dialog.spec.ts` as the only spec it runs,
- a `.github/workflows/accessibility.yml` job wiring so the NVDA and VoiceOver runners capture it.

None of that is salvage — hermes never built it. It is also only meaningful once dispatched on CI,
and **the gate is the user's to resolve**, so it was deliberately left for a decision rather than
started.

---

## 6. The accessibility evidence pipeline (built this session, working)

Full design and history: `docs/accessibility/README.md`. Read it before touching the pipeline.

State: **`confirmed-pass`**, run `32242062146`, both dialog scenarios, 15 findings each, all four
AG-1 claims scored on real NVDA (Windows) and real VoiceOver (macOS).

```bash
# Local, all three engines via Docker, no AT (Linux has neither NVDA nor VoiceOver)
cd apps/ui && A11Y_CONTAINER=1 node test/accessibility/capture.mjs && pnpm a11y:verdict

# Real AT evidence — CI only
gh workflow run accessibility.yml --ref main --repo Azeajr/chess-mcp
gh run list --workflow=accessibility.yml --limit 3 --repo Azeajr/chess-mcp
gh run download <id> --repo Azeajr/chess-mcp --dir <scratch>   # then read the JSON directly
```

### The one thing that will waste your time if you don't know it

**Both guidepup drivers record speech only while one of their own actions is in flight.**
`NVDAClient.js` pushes into its spoken-phrase log inside the queued-action path;
`VoiceOverClient.enqueueAndTap` captures "the logs for the performed action". Speech provoked by a
**Playwright** key press is emitted and then dropped. Two CI rounds were spent on timing theories
before this was found by reading the driver source. If you need an announcement captured, the
**screen reader** must press the key (`screenReader.press(...)`), never Playwright.

Related: the virtual-cursor sweep (`next()`) drags DOM focus with it, so DOM focus must be
re-established before any key press that follows a sweep, and the sweep must not be the last thing
a session does or it corrupts the keyboard trace that runs next.

---

## 7. Production accessibility bugs found and fixed this session

All macOS-only. None reachable from Linux CI. Listed because they are the pattern to expect:

1. **Focus trap relied on native Tab.** macOS ships Safari's "Full Keyboard Access" off by default,
   which makes native Tab skip every `<button>`. Fixed by driving Tab explicitly (`85b3e2a`).
2. **A closed `<details>` still reports client rects**, so its contents stayed in the focus-trap
   candidate list where `.focus()` silently no-ops, parking focus on the summary forever.
3. **macOS browsers do not focus a `<button>` on click**, so a pointer-opened dialog stored no
   focus-return target and restored focus nowhere on close. Fixed as a class in the `Dialog`
   primitive via a last-pointer-activated fallback (`72242cf`).
4. A `copy`-event listener race in `core-a11y.spec.ts` (real test flake, fixed).

---

## 8. Deferred, recorded, not lost

- **`ReplacementLab.tsx` focus trap** — same macOS defect as #1 above, deliberately deferred.
  Recorded under **"Known accessibility defects"** in `ROADMAP.md`, including the trap that porting
  only half the fix would create (it has two `<details>`; explicit Tab without the collapsed-details
  exclusion parks focus on the first `<summary>` permanently). No work package owns it.
- **AG-1 scope note** — the automated contract suite covers all three overlays; the AT tier covers
  Settings plus Strategic Fit, not Promotion or Colour picker. Recorded in `state.json`.

---

## 9. Known flakes (not regressions — verify before chasing)

Each failed once in a full run and passed alone and on rerun:

- `strategic-fit-sidecar.spec.ts:206` — "Confirm metadata import" not enabled.
- `strategic-fit-profile-setup.spec.ts:339` — webkit.
- `guidepup/setup-action` on macOS — transient TCC failure
  (`Not authorized to send Apple events to System Events`). Rerun the failed job.

---

## 10. Gate and package state

```
gates:    AG-1 resolved · DV-2 resolved · PD-1 resolved · PD-2 resolved · 16 unresolved
packages: 16 complete of 39
ready:    WP-011 (S5) — implemented and gated in the working tree; AG-3 owed before completion
blocked:  WP-015 (needs WP-011) · WP-005 and WP-018 (need WP-009, held by AG-5; WP-005 also PD-3)
```

`completionGates` is a mechanism landed this session (`507d295`, `559d266`): a gate whose own
required evidence is produced by the package it guards is checked at **completion** rather than at
start. It changes _when_ a gate is checked, never _whether_. `ux:plan-check` rejects any package
recorded complete while one of its completion gates is unresolved — verified by probe.
