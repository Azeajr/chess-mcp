# AG-3 implementation plan — move-tree assistive-technology evidence

Status at time of writing: `WP-011` is implemented, gated green (409 passed / 14 skipped / 0 failures
in the full container suite) and committed as `4718f2c` on `salvage` and `main`. It is **not**
recorded complete, because `AG-3` is an unresolved completion gate and `ux:plan-check` rejects a
package recorded complete while one is open.

This plan covers only what is needed to put a real, decidable AG-3 verdict in front of its owner.
It does not resolve the gate — that is the user's call (`HANDOFF.md` §3).

---

## 1. What AG-3 actually asks for

From `docs/ui-ux-remediation-plan.md:2408`:

| Field               | Content                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**           | Move tree                                                                                                                                       |
| **Automated proof** | `keyboardReachable` empty; single tab stop; `aria-current` on the active move; `aria-expanded` on toggles                                       |
| **Manual proof**    | NVDA and VoiceOver confirming tree role, level, and expanded state are announced, and that traversal does not read the entire tree on every key |
| **Owner**           | Accessibility reviewer + chess-domain reviewer                                                                                                  |
| **Fails if**        | Tree semantics are mis-announced, or traversal produces speech floods                                                                           |

### 1.1 The automated half is already done

`apps/ui/test/e2e/core-keyboard.spec.ts` covers all four automated clauses and is green in the
container suite:

- `keyboardReachable(app, ".rep-row")` → `[]`
- single roving tab stop inside `role="tree"`
- `aria-current="true"` on the current move
- `aria-expanded` tracking state across collapse/expand, and `aria-level` / `aria-posinset` /
  `aria-setsize` under the D-2 and D-3 models

**No work is required here.** Do not rebuild it in the accessibility engine. (Line numbers are
omitted deliberately — P0 moved them once already.)

### 1.2 The manual half has no pipeline

AG-3's manual column decomposes into **four** distinct claims, none of which the current engine can
capture:

| Claim ID (proposed)   | What a real utterance must show                                                    |
| --------------------- | ---------------------------------------------------------------------------------- |
| `tree-role`           | The screen reader identifies the container as a tree (and the item as a tree item) |
| `item-level`          | The screen reader announces a level for the focused item                           |
| `expanded-state`      | The screen reader announces expanded/collapsed for an item that has variations     |
| `traversal-verbosity` | One traversal key produces speech about **one** item, not the whole tree           |

---

## 2. The ARIA model — decided 2026-08-19

Three properties of the shipped implementation would have produced `confirmed-failure` findings on
the claims above _as designed_, not as a bug in the pipeline. All three were read directly from
`apps/ui/src/components/MoveTree.tsx` and put to the user before any CI round was spent.

**Decisions taken (D-1, D-2, D-3 below): move `aria-expanded` onto the branch-owning tree item; make
`aria-level` variation depth rather than ply depth; establish group ownership with `aria-owns` and
drop the "1 of 1" position noise. Sequencing: fix first, then capture.**

These are implementation-model decisions inside WP-011. **They are not AG-3's resolution** — AG-3
stays unresolved until its owner reads real NVDA and VoiceOver evidence at P5.

### D-1 — `aria-expanded` is on the toggle, not on the tree item

`MoveTree.tsx:208-226` builds every `treeitem` with `aria-level`, `aria-posinset`, `aria-setsize`,
`aria-current` — and **no `aria-expanded`**. The attribute lives instead on the separate
`button.collapse-toggle` (`MoveTree.tsx:267-281`), which is `tabIndex={-1}` and carries
`role=button`, not `treeitem`.

Consequence: during arrow-key traversal the screen reader lands only on tree items, and a tree item
with variations announces nothing about its expanded state. The `expanded-state` claim fails on the
focus path.

It may still pass on the **virtual-cursor** path — browse mode reads the toggle and would say
"Hide variations, button, expanded" — but that is a different interaction than the one AG-3
describes ("traversal").

**Decided:** move `aria-expanded` and `aria-controls` onto the branch-owning tree item — the mainline
child `[...path, 0]`, which is exactly the item `Space` already toggles from
(`MoveTree.tsx:178-188`). The toggle keeps its pointer role and its `aria-label`, which already
states "Show N variation(s)" versus "Hide variations", so its own state stays legible without a
second element advertising `aria-expanded` for the same group.

### D-2 — `aria-level` is ply depth, so it changes on every single move

`aria-level={path.length}` (`MoveTree.tsx:213`). A PGN path grows one index per ply, so mainline move
20 is `aria-level="20"`.

Screen readers announce level **on level change**. Under this model every mainline arrow press is a
level change, so every press produces a level announcement. That is a direct candidate for AG-3's
`traversal produces speech floods` failure condition.

The alternative model — level = variation depth (mainline is level 1 throughout; a variation is
level 2; a variation inside a variation is level 3) — matches both what a repertoire user means by
"level" and the ARIA tree pattern's intent, and it silences the per-move announcement.

This is precisely why AG-3's owner is "Accessibility reviewer **+ chess-domain reviewer**". It is a
domain-semantics decision, not an implementation detail.

**Decided:** variation depth — `aria-level = 1 + (number of path indices >= 1)`. Against the
`core-keyboard.spec.ts` fixture that gives `e4 e5 Nf3 Nc6 Bb5` level 1 throughout, the `d6 d4` and
`Nf6 Nxe5` variations level 2, so four arrow presses along the mainline produce zero level
utterances instead of four.

### D-3 — `role="group"` is a sibling of the tree item, not its child, and `posinset` is per-branch

Two related things:

- At a branch point the variations render into `div[role="group"]` inside `div.variation-group`,
  pushed as a **sibling** of the mainline tree item (`MoveTree.tsx:265-286`), not as its child. The
  ARIA tree pattern expects a `group` to be owned by the `treeitem` it expands.
- `aria-posinset={(path.at(-1) ?? 0) + 1}` with `aria-setsize={cursor.children.length}` means an
  ordinary mainline move reports "1 of 1". Every move. Another verbosity contributor.

Note the levels are internally consistent for variations: a variation at `[...path, 1]` and the
mainline at `[...path, 0]` both compute `aria-level = path.length + 1`, correctly marking them as
siblings — while the DOM nests one inside the other. `aria-level` wins for announcement, so the
announced structure and the visual structure disagree.

**Decided:** `aria-owns` on the branch-owning tree item pointing at the group id, which reparents the
variations under it in the accessibility tree without restructuring the DOM — a tree item here is a
`<button>`, so a `group` cannot legally nest inside it. `aria-posinset`/`aria-setsize` are dropped
from mainline moves entirely and computed over the _variation set_ on variations: with three
children, `d6` becomes "1 of 2" and `Nf6` "2 of 2" rather than "2 of 3" and "3 of 3".

This composes with D-2: once `aria-owns` nests the variations one level deeper, their
variation-depth `aria-level` of 2 matches their announced nesting depth. Announced structure and
visual structure agree for the first time.

### Applying the decisions

The three above are a **code change in `MoveTree.tsx` plus matching assertions in
`core-keyboard.spec.ts`**, re-gated on the full container suite before any AT work begins. Changing
ARIA after evidence is captured invalidates the evidence — which is why sequencing was decided as
fix-first rather than baseline-first.

Test targeting note: with `aria-controls` moving to the tree item, `core-keyboard.spec.ts`'s
`[aria-controls="move-tree-group-…"]` selector would resolve to the wrong element. The toggle
carries a `data-branch-path` attribute for tests instead, matching how `data-move-path` already
separates test targeting from ARIA on the tree items.

**Do not write the AG-3 decision record. Gates are the user's call.**

---

## 3. What in the pipeline is dialog-coupled

Read `docs/accessibility/README.md` before touching any of this. Per-file, with the exact symbols
that need to change.

**P1 status: §3.1 through §3.4 are done.** `collectors/at-tier.ts` and `scenarios/merge.ts` are new;
`at-runner.ts` now splits into `withScreenReader()` (session boilerplate) and
`captureDialogObservations()` (the AG-1 cycle). Verified by re-running capture and verdict and
diffing the full finding list against the pre-refactor run — identical. §3.5 through §3.8 remain.

### 3.1 `evidence-schema.ts`

`AtClaim` is a closed union of the four AG-1 claims (`dialog-announcement`,
`background-unreachable`, `focus-report`, `focus-return`) — line 124.

**Change:** extend the union with the four claims from §1.2. A flat union keeps `AtObservation`
unchanged and lets the verdict engine dispatch per claim. No other schema type is dialog-specific;
`EvidenceBundle`, `Finding`, `ScenarioVerdict`, `KeyboardTraceEvidence` are all already generic.

### 3.2 `collectors/at-runner.ts`

`captureAtObservations(runner, page, steps: AtDialogSteps)` hardcodes one cycle: report focus →
virtual-cursor sweep → refocus → Escape → report focus → Enter (lines 224–272). `AtDialogSteps`
names dialog states (`awaitOpen`, `awaitClosed`, `refocusDialog`).

**Change:** extract the session boilerplate — `screenReader.start()/stop()`, `focusBrowser()`,
the cumulative-log `since()` reader, `observe()` — into a reusable `withScreenReader(runner, page, body)`,
then keep two cycle bodies:

- `captureDialogObservations` — the existing body, byte-for-byte semantics preserved.
- `captureTreeObservations` — new, per §4.

Everything in this module's header comment is hard-won and still applies. Preserve
`macOSActivate` + `page.bringToFront()` back-to-back before every command, the cumulative
`spokenPhraseLog()` slicing, and the `within()` timeout bounding.

### 3.3 `scenarios/dialog-scenario.ts`

Opens by opener name, waits for `role=dialog`, then runs collectors and the AT loop.

**Change:** add `scenarios/tree-scenario.ts`. The AT-runner loop with its `currentPlatformSupports`
check, `infrastructureLimitationFor` fallback, and the try/catch that records a stuck session as
evidence rather than losing the run (lines 71–109) is subtle and should be **extracted to a shared
`collectors/at-tier.ts`** rather than copy-pasted. The browser-tier collector calls are three lines
and can be duplicated.

### 3.4 `scenarios/ag-1-dialog.ts`

Holds `DIALOG_SCENARIOS`, `scenarioById`, and `mergeBundles`.

**Change:** `mergeBundles` and `dedupeLimitations` are fully generic. Move them to a shared module
(`scenarios/merge.ts`) so the tree scenario does not import from an AG-1-named file.

### 3.5 `verdict.ts`

`computeDialogVerdict`, `DialogScenarioExpectation`, `atClaimExpectation`, and the `AT_CLAIMS`
constant are all dialog-shaped.

Already generic and reusable unchanged: `axeFindings`, `checkKeyboardTrapsAndEscapes`,
`overallStatus`, `ref`, `nextFindingId`.

**Change:** add `computeTreeVerdict(bundle, expectation: TreeScenarioExpectation)` alongside, with
its own claim-expectation table. Per §4.3.

**Gotcha:** `computeDialogVerdict` resets the module-level `findingCounter = 0` on entry (line 445).
`computeTreeVerdict` must do the same, or finding IDs collide across scenarios in one report.

### 3.6 `compute-verdict.ts`

Imports `DIALOG_SCENARIOS`/`scenarioById` from `scenarios/ag-1-dialog` and calls
`computeDialogVerdict` with a hardcoded dialog expectation (lines 65–94).

**Change:** replace with a scenario registry — `scenarioId → { definition, computeVerdict(bundle) }` —
so the merge loop becomes generic. Keep "one verdict per scenario, never merged across scenarios";
that invariant is the reason the loop exists at all.

**Gotcha:** the evidence-file filter matches `name.startsWith(`${id}-`)` (line 67). The tree
scenario's id must not be a prefix of any other scenario id.

### 3.7 `capture.mjs`

The container branch hardcodes `apps/ui/test/accessibility/ag-1-dialog.spec.ts` as the only spec it
runs (line 34). The non-container branch runs the whole config, so a new spec file is picked up
there automatically but silently skipped in the container.

**Change:** parameterize the spec selection (`A11Y_SPEC` env, defaulting to all specs). CI needs to
select one spec per AT job — see §5.

### 3.8 `.github/workflows/accessibility.yml`

`at-nvda` runs `--project chromium`, `at-voiceover` runs `--project webkit`. Each currently runs both
dialog scenarios in one job.

**Change:** add tree jobs. See §5 for why they must be separate jobs rather than another scenario in
the existing ones.

---

## 4. The tree AT cycle

### 4.1 Entering the tree

The dialog scenario enters by clicking a named opener. The tree has no opener — focus enters by Tab,
from an unpredictable distance away.

Do **not** try to Tab in with the screen reader. Instead use the pattern the dialog scenario already
proved: put real DOM focus on the entry tree item with Playwright (silent, no announcement needed for
that step), then have the screen reader `perform(focusCommand)` — `reportCurrentFocus` on NVDA,
`describeItemWithKeyboardFocus` on VoiceOver — to _report_ what is focused. That single utterance is
the evidence for `tree-role` and `item-level`.

The fixture is the branching PGN already used by `core-keyboard.spec.ts:9`:

```
1. e4 e5 2. Nf3 Nc6 (2... d6 3. d4) (2... Nf6 3. Nxe5) 3. Bb5 *
```

with `openApp(page, { width: 1280, height: 800, pgn: BRANCHING_PGN })` and the current path set to
the branch point `[0, 0, 0]` — the only position where an expanded-state announcement is even
possible.

### 4.2 The hard unknown: can an AT-pressed arrow key reach the app at all?

**This is the top technical risk in the whole plan, and it has no precedent in the existing
pipeline.** The dialog cycle only ever pressed `Escape` and `Enter`, which both pass straight
through to the page. Arrow keys do not.

- **NVDA** intercepts arrow keys in _browse mode_ for its own virtual cursor. It switches to _focus
  mode_ automatically for some widgets, and `role="tree"` with focusable items normally triggers
  that — but "normally" is not evidence. If NVDA stays in browse mode, `nvda.press("ArrowDown")`
  moves NVDA's review cursor and `MoveTree.onTreeKeyDown` never fires.
- **VoiceOver** intercepts arrows for Quick Nav and requires interacting with a group
  (`VO+Shift+Down`) before arrows reach web content.

Plan for both outcomes, and decide which happened by reading round-1 evidence rather than guessing:

- **If AT-pressed arrows reach the app** — best case. Press `ArrowRight` / `ArrowDown` / `Space`
  through the screen reader, drain the log per key, and every claim including `traversal-verbosity`
  is captured from a genuine key press.
- **If they do not** — fall back to: Playwright moves DOM focus one item (silent), the screen reader
  then `perform(focusCommand)` to report the new item. This still yields real utterances for
  `tree-role`, `item-level`, and `expanded-state`, and utterance **counts** per focus change still
  answer the flood question. It does not prove the app's own arrow handler is what moved focus — but
  `core-keyboard.spec.ts` already proves that deterministically on three engines.

Record whichever path was taken in the evidence itself (the `command` field on `AtObservation`
exists for this), so the verdict's provenance stays honest about what was actually pressed.

### 4.3 Scoring the claims

New expectation type, mirroring `DialogScenarioExpectation`:

```ts
export interface TreeScenarioExpectation {
  readonly treeName: string; // "Repertoire moves"
  readonly entryMoveSan: string; // the move Tab entry lands on
  readonly branchMoveSan: string; // a move whose parent has variations
  readonly expectedLevel: string; // resolved from the decided D-2 model
  readonly floodThreshold: number; // max utterances attributable to one traversal key
}
```

Needle checks, following `atClaimExpectation`'s existing rule — match on a real name, never on an
exact sentence, because NVDA and VoiceOver phrase everything differently:

- `tree-role` — utterance contains `"tree"` (NVDA says "tree view"/"tree item"; VoiceOver says
  "outline"/"row"). **Expect this needle list to need widening after round 1** — VoiceOver maps
  `role=tree` to its outline/table vocabulary and may never say the literal word "tree". Widen it
  from observed output, not from guesses.
- `item-level` — utterance contains `"level"` and the expected level number.
- `expanded-state` — utterance contains `"expanded"` or `"collapsed"`. Capture this at the branch
  item, and capture it a second time after a `Space` toggle so the announcement is shown to _track_
  state rather than merely being present once.
- `traversal-verbosity` — the inverse of every other check: the utterance list captured for one
  traversal key must be **short** and must not contain the SAN of moves other than the one moved to.
  Assert `utterances.length <= floodThreshold` and that no non-target SAN from the fixture appears.
  This is the only claim whose scoring is a count rather than a needle, so it needs its own branch in
  the expectation dispatcher rather than reusing the needle/polarity mechanism.

### 4.4 New spec file

`apps/ui/test/accessibility/ag-3-move-tree.spec.ts`, mirroring `ag-1-dialog.spec.ts`: capture only,
per-browser evidence written to `EVIDENCE_DIR` as `${scenarioId}-${browser}-${jobId}.json`. Keep the
`GITHUB_JOB` component of the filename — it is what stops two CI jobs' evidence for the same
scenario+browser from silently overwriting each other (`ag-1-dialog.spec.ts:36-41`).

Keep the same cheap capture-stage sanity assertions (an aria snapshot exists, axe ran). The verdict,
not the spec, is the gate.

---

## 5. CI budget — the reason tree jobs must be separate

`apps/ui/test/accessibility/playwright.config.ts:29` sets an 8-minute per-test timeout for AT runs,
raised from 5 minutes specifically because run `32238998739`'s VoiceOver worker timed out once each
AT job covered two dialog scenarios instead of one. A session cut off partway leaves the next one
reading a screen reader that never finished its previous command — the failure cascades.

Adding the tree scenario to the existing `at-nvda` / `at-voiceover` jobs makes it a third AT session
in the same job. **Do not.** Add:

- `at-nvda-tree` (windows-latest, `--project chromium`)
- `at-voiceover-tree` (macos-latest, `--project webkit`)

each selecting only `ag-3-move-tree.spec.ts` via the new `A11Y_SPEC` handle from §3.7, each
uploading under the existing `a11y-evidence-*` artifact pattern so `merge-report` picks them up with
no change to its download step. Add both to `merge-report`'s `needs:` list.

Benefits: a hanging tree session cannot destroy the dialog evidence, and either job can be re-run
alone.

The workflow stays `workflow_dispatch`-only. That is the user's explicit standing decision
(`HANDOFF.md` §3).

---

## 6. Traps that will otherwise cost a CI round each

All four are documented in `docs/accessibility/README.md` and
`collectors/at-runner.ts`'s module header, and all four apply to the tree cycle unchanged.

1. **Both guidepup drivers record speech only while one of their own actions is in flight.**
   `NVDAClient.js` pushes into its spoken-phrase log inside the queued-action path; VoiceOver's
   `enqueueAndTap` captures "the logs for the performed action". Speech provoked by a **Playwright**
   key press is emitted and then dropped. Two CI rounds were spent on timing theories before this
   was found by reading the driver source. If an announcement must be captured, the **screen
   reader** presses the key.
2. **The virtual cursor drags DOM focus with it.** After any `next()` sweep, DOM focus must be
   re-established before the next key press, and a sweep must not be the last thing a session does
   or it corrupts the keyboard trace that runs afterwards.
3. **macOS hands focus back to VoiceOver's own UI mid-session.** Re-assert `macOSActivate` +
   `page.bringToFront()`, back-to-back and in that order, before _every_ command — not once per
   session.
4. **`spokenPhraseLog()` is cumulative from `start()`.** Each claim must read only the slice since
   the previous claim, or "did it say X here" degrades into "did it ever say X". For
   `traversal-verbosity` this is not a nicety — the whole claim is a count of that slice.

Also: `guidepup/setup-action` on macOS fails transiently with
`Not authorized to send Apple events to System Events`. Re-run the job; it is a known flake
(`HANDOFF.md` §9), not a regression.

### A pre-existing failure the local run will show you

`pnpm a11y:verdict` reports `ag-1-settings-dialog: overall status = confirmed-failure` on a clean
checkout, from a single WebKit-only axe finding: `axe:color-contrast`, white `#ffffff` on `#c0c0c0`
at 16px, ratio 1.81 against a required 4.5. It is **not** a regression from any AG-3 work — verified
by stashing the whole working tree, re-running capture and verdict on a clean `HEAD`, and diffing
the two reports' full finding lists, which are identical. Do not chase it while working on AG-3; it
belongs to whichever package owns the Settings dialog's palette.

---

## 7. Execution order

| Phase  | Work                                                                                                                  | Gate before moving on                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | ✅ **Done.** D-1/D-2/D-3 decided (§2) and applied to `MoveTree.tsx` + `core-keyboard.spec.ts`.                        | `pnpm test:e2e:container` full, unnarrowed, zero failures                                                                                     |
| **P1** | ✅ **Done.** Schema claims (§3.1), `withScreenReader` extraction (§3.2), `at-tier.ts` + `merge.ts` (§3.3–3.4).        | `pnpm -r typecheck && pnpm lint`; AG-1 verdict still reproduces unchanged                                                                     |
| **P2** | `tree-scenario.ts`, `computeTreeVerdict`, registry in `compute-verdict.ts`, `ag-3-move-tree.spec.ts` (§3.5–3.6, §4).  | `A11Y_CONTAINER=1 node test/accessibility/capture.mjs && pnpm a11y:verdict` produces a browser-tier tree verdict locally on all three engines |
| **P3** | `capture.mjs` spec selection + two new CI jobs (§3.7, §5).                                                            | Workflow parses; dispatch reaches the new jobs                                                                                                |
| **P4** | Dispatch, download, read raw evidence. Expect 2–3 rounds: needle vocabulary (§4.3) and the arrow-key question (§4.2). | Real NVDA **and** real VoiceOver utterances scored for all four claims                                                                        |
| **P5** | Hand the report to the gate owner. **User** resolves AG-3 in `state.json`.                                            | `pnpm ux:plan-check` accepts                                                                                                                  |
| **P6** | Record WP-011 complete with full-suite e2e evidence; delete `HANDOFF.md` and this file.                               | `pnpm ux:plan-check` green; push `salvage` and fast-forward `main`                                                                            |

P1 is the natural stopping point if this needs to be split across sessions: it lands a real
refactor, is verifiable without CI, and leaves AG-1 provably unchanged.

---

## 8. Commands

```bash
# Local, all three engines via Docker, browser tier only (Linux has neither NVDA nor VoiceOver)
cd apps/ui && A11Y_CONTAINER=1 node test/accessibility/capture.mjs && pnpm a11y:verdict

# The production gate for any MoveTree.tsx change — full suite, unnarrowed
pnpm test:e2e:container

# Real AT evidence — CI only
gh workflow run accessibility.yml --ref main --repo Azeajr/chess-mcp
gh run list --workflow=accessibility.yml --limit 3 --repo Azeajr/chess-mcp
gh run download <id> --repo Azeajr/chess-mcp --dir <scratch>   # then read the JSON directly
```

Standing constraints (`HANDOFF.md` §3): **pnpm**, never npm. No `Co-Authored-By` trailer. Commit
messages and code comments in normal prose. Do not stage or commit unless asked. Do not resolve a
gate by writing its decision.

---

## 9. What this plan deliberately does not do

- **It does not resolve AG-3.** It produces the evidence a reviewer needs to resolve it.
- **It does not rebuild AG-3's automated column.** `core-keyboard.spec.ts` already covers it (§1.1).
- **It does not promote `accessibility.yml` beyond `workflow_dispatch`.** Standing user decision.
- **It does not touch `ReplacementLab.tsx`'s deferred focus trap.** Recorded under "Known
  accessibility defects" in `ROADMAP.md`; no work package owns it.
