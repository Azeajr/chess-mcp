# Automated accessibility evidence pipeline

Origin: AG-1 and AG-3 require proof that real NVDA and VoiceOver convey the dialog and move-tree
contracts. This pipeline produces and scores that proof unattended—real screen-reader output, not
a simulator—under the
[automated completion policy](../ui-ux-remediation/AUTOMATED_COMPLETION.md). Reports are diagnostic;
the deterministic command is the gate.

**Status as of this writing:** run 32228856608 is the first fully clean run —
`overallStatus: confirmed-pass`, all nine findings passing, with all three evidence jobs
succeeding. That includes both AT-tier findings: real NVDA output on a real Windows runner and
real VoiceOver output on a real macOS runner, each checked against the control that actually held
DOM focus when it was captured. Getting there took fixing three genuine, previously-undiscovered
accessibility bugs in the dialog, every one of them invisible to Linux CI — see "What's
unverified" below.

## Architecture

```
apps/ui/test/accessibility/
  evidence-schema.ts       Normalized shapes every collector produces and the verdict engine
                             and optional LLM summarizer consume. Nothing downstream reads raw DOM state.
  collectors/
    browser-ax.ts           Playwright ariaSnapshot() (cross-engine) + CDP getFullAXTree
                             (Chromium-only, diagnostic depth: ignored-node reasons)
    axe.ts                  @axe-core/playwright — deterministic rule findings
    keyboard-trace.ts       Drives real key presses, records focus before/after each one
    at-runner.ts             Guidepup (github.com/guidepup/guidepup, MIT) — real NVDA/VoiceOver,
                             not a simulator. Platform-gated: returns an
                             InfrastructureLimitation record on any worker that can't run it,
                             never a fabricated pass.
  scenarios/ag-1-dialog.ts  Dialog definitions for Settings and Strategic Fit.
  scenarios/ag-3-move-tree.ts
                             The branching move-tree definition and deterministic expectations.
  scenarios/dialog-scenario.ts / tree-scenario.ts
                             Run every supported collector and return one EvidenceBundle.
  verdict.ts                Deterministic classification. Every Finding cites an EvidenceRef —
                             an index into the bundle that produced it. Never calls an LLM.
  llm-review.mjs            Opt-in only (A11Y_LLM_REVIEW=1). The reasoning layer, not the source
                             of truth — every finding it returns must cite a real evidence index;
                             citations that don't resolve are rejected before anyone sees them.
  run-context.mjs           Shared run-ID computation (capture.mjs, compute-verdict.ts, and the
                             Playwright spec all import this — one source, not three copies).
  capture.mjs               Entry point. Computes one A11Y_RUN_ID, runs all capture specs (or the
                             A11Y_SPEC selection) locally or via A11Y_CONTAINER=1 through Docker, writes
                             .last-run-id so compute-verdict.ts can find it without the caller
                             propagating the env var.
  compute-verdict.ts        Reads every browser's evidence file for a run, merges them,
                             classifies, writes report.json + report.md. This is the actual gate
                             — exits non-zero on every status except confirmed-pass, including
                             missing or inconclusive evidence. The Playwright specs themselves only
                             assert capture-stage sanity (a dialog opened, axe ran).
```

Evidence flows one direction: collectors → EvidenceBundle → verdict.ts (deterministic) →
optionally llm-review.mjs (reasoning layer, opt-in, cites back into the same bundle). No stage
reads a stage downstream of it.

## Running it

```bash
# Chromium only, locally (needs a local Playwright chromium install)
pnpm --filter @chess-mcp/ui a11y:capture -- --project chromium
pnpm --filter @chess-mcp/ui a11y:verdict

# All three engines, via the repo's existing pinned Docker image — no Firefox/WebKit system
# libraries required locally, no CI involved. This is the proven path (see below).
A11Y_CONTAINER=1 pnpm --filter @chess-mcp/ui a11y:capture
pnpm --filter @chess-mcp/ui a11y:verdict
# or both steps together:
pnpm --filter @chess-mcp/ui a11y:test

# Opt-in LLM synthesis over an already-computed report. Spends real tokens on every invocation —
# never run by pnpm a11y:test, never run by CI, only by explicit request.
A11Y_LLM_REVIEW=1 pnpm --filter @chess-mcp/ui a11y:llm-review
```

Reports land at `apps/ui/test-results/accessibility/<runId>/report.{json,md}`.

`A11Y_SPEC=ag-1-dialog.spec.ts` or `A11Y_SPEC=ag-3-move-tree.spec.ts` isolates capture cost for an
AT worker. The final merge command still requires every registered scenario and every declared
browser/AT source; a focused artifact cannot accidentally resolve the project gate.

## What's proven

Run against the live Strategic Fit dialog, all three engines, via
`A11Y_CONTAINER=1 pnpm a11y:capture` (the same Docker mechanism `pnpm test:e2e:container` already
uses for the main e2e suite):

```
A11Y-001 [confirmed-pass]  Dialog role/name "Strategic Fit" — chromium, firefox, webkit agree
A11Y-002 [confirmed-pass]  Background control "Open PGN" excluded from the AX tree (CDP)
A11Y-003 [confirmed-pass]  Focus returned to "Open Strategic Fit" after Escape
axe: 0 violations, 36 rules passed (chromium)
```

Every citation in that run was checked against the raw evidence file before being trusted — not
assumed correct because the summary line said so. One false positive was caught and fixed this
way during development: the keyboard-trap check originally flagged "focus left the dialog scope
after Escape" as a failure, because it didn't know the scope element (the dialog itself) had
legitimately closed. The raw trace showed focus correctly landing on the opener — exactly right,
not a trap. Fixed in `keyboard-trace.ts` by only flagging escape-from-scope when the scope element
still exists.

The opt-in LLM layer, run once against that same report, found two things the deterministic tier
structurally cannot: an unnamed textbox appearing in the Tab order with no corresponding node in
any ariaSnapshot or CDP tree, and a radio-button accessible name that concatenates its label and
description with no separation. Both citations were verified against the raw
`keyboardTraces`/`ariaSnapshots` arrays before being accepted — real observations, not invented
ones. These are UX findings unrelated to AG-1 itself; worth a look, not yet actioned here.

## Historical rollout notes

The Windows NVDA and macOS VoiceOver jobs are now proven. Docker cannot substitute for either
because they hook into their OS accessibility APIs; GitHub-hosted Windows and macOS workers run the
real AT automation. The notes below preserve the rollout failures that established the required
setup and focus sequence.

The workflow originally required `workflow_dispatch`; it now runs automatically on relevant pull
requests and pushes to `main` or `salvage`. The **first historical triggered run**
(run 32205343813): `browser-evidence` and `merge-report` passed; `at-nvda` and `at-voiceover`
both failed with the same root cause — `guidepup/setup-action` only performs the OS-level
`@guidepup/setup setup` half of Guidepup's own two-step setup. It does not run the
project-scoped `@guidepup/setup install {nvda,voiceover}` half (screen-reader assets matched to
this project's installed `@guidepup/guidepup` version), which both jobs now run as an explicit
step, added directly in response to that run's actual error output rather than guessed in
advance.

**NVDA: proven correct as of run 32208455039, confirmed stable on 32209308823 and 32210865750**
(three consecutive real runs) — `reportCurrentFocus` reports `'Return to repertoire, button,
focused'`, the real, correct DOM focus target. Treat `at-nvda` as trustworthy.

**VoiceOver: proven correct as of run 32210865750** — `describeItemWithKeyboardFocus` reports
`'Return to repertoire button has keyboard focus'`, matching NVDA's real target. Getting here took
several real, wrong intermediate observations, each one diagnosed from actual evidence rather than
guessed: `next()`/`findNextControl` moved VoiceOver's own review cursor, never synced to real DOM
focus (fixed by switching to `describeItemWithKeyboardFocus`); the browser window never had real
macOS focus, reported as `'Desktop group has keyboard focus'` (fixed by calling `macOSActivate`,
ported from `@guidepup/guidepup-playwright`'s own `navigateToWebContent()` reference
implementation); and finally the fix landed in the wrong place and the wrong order —
`page.bringToFront()` ran early in the scenario file, separated from `macOSActivate` in
`at-runner.ts` by an unrelated capture step, reversed from the reference's back-to-back
`macOSActivate` → `bringToFront` order — which produced `'VoiceOver Settings activity'`, still
wrong. Moving both calls together into `captureAtObservation`, in the reference's order,
immediately before the AT command, is what finally produced the correct observation.

**Found and fixed: a real accessibility bug in the dialog itself**, not a pipeline defect.
`keyboardTrace[3]` (webkit, captured by the `at-voiceover` job) showed a real `Tab` press losing
DOM focus (`activeElementAfter: None`) mid-sequence, reproduced identically across six consecutive
runs (4 through 9) and unaffected by every AT-activation fix above, including a tested-and-rejected
teardown-race delay (run 9, `VOICEOVER_TEARDOWN_SETTLE_MS` — 6th identical reproduction, removed).
It never reproduced on the same scenario's headless webkit capture (`browser-evidence`, always
clean) — the one real clue: same DOM, same browser engine family, only the OS's native Tab
semantics differed between headless Linux WebKit and real macOS WebKit.

Root cause, found by reading `StrategicFitWorkspace.tsx`'s own focus-trap `keydown` handler rather
than guessed: it only called `.focus()` explicitly at the wrap boundary (`active === first` /
`active === last`), relying on the browser's native Tab traversal for every press in between.
macOS Safari's default "Full Keyboard Access" setting — off by default on a fresh macOS install,
including GitHub's `macos-latest` runners — makes native Tab skip `<button>` elements entirely,
only stopping on text fields and lists. Real Mac users with default settings would hit this exact
bug: Tab from "Advanced preferences" would jump clean over "Skip for now" and the profile submit
button, landing nowhere. Fixed by making the trap handler always move focus explicitly by
computing the next/previous candidate index itself, for every `Tab` press, not just at the
boundary — removing the dependency on native Tab semantics (and the platform inconsistency between
them) entirely.

Driving Tab explicitly also means the trap's own candidate list has to be exactly right, where
before the browser silently corrected it. Three corrections were needed, each verified against a
live DOM probe in the container rather than reasoned about:

- **Radio groups are one Tab stop, not N.** Inputs sharing a `name` collapse to the checked radio
  (or the first if none is checked); arrow keys, still native, move the selection within the group.
- **A closed `<details>` still lays its content out.** Chromium keeps collapsed content in a
  `content-visibility: hidden` subtree whose descendants report non-empty client rects, so the
  existing rect-based visibility filter left all 16 collapsed "Advanced preferences" controls in the
  list. `.focus()` no-ops silently on them, which parked focus on the summary permanently — every
  further `Tab` did nothing. Only a closed `<details>`'s own `<summary>` is reachable.
- **Roving-tabindex members are not Tab stops.** The unselected stage tabs carry `tabindex="-1"` but
  still match `button:not([disabled])`, so they needed an explicit exclusion.

With the Tab sequence fixed, the macOS trace stopped agreeing with Linux at exactly one more
place: `Escape` closed the dialog but left focus on the document body instead of returning it to
the opener. That failure was present in every earlier macOS run too — the Tab bug had simply been
loud enough to hide it. A temporary probe logged into the job log (added, read, removed) ruled out
every structural explanation: at cleanup time the opener was connected, had no `inert` ancestor,
the dialog was already gone, and an explicit `focus()` from the probe itself took immediately.

**Real cause: macOS browsers do not give a `<button>` DOM focus when it is clicked.** That is a
platform convention both WebKit and Chrome follow on macOS, and one Linux CI never exercises. The
workspace captured `document.activeElement` on mount as its return target, so on macOS it captured
`document.body`, and closing "restored" focus to a body that cannot hold it. Fixed in two places:
the opener focuses itself on click, and the workspace no longer accepts `document.body` as a
return target — accepting it is precisely what kept this invisible, since restoring to the body is
indistinguishable from restoring nothing.

This is exactly the kind of finding this pipeline exists to catch. Three real accessibility bugs,
all in shipped production code, none reachable from a spec-scoped or Chromium-only suite: one from
a macOS keyboard setting, one from a DOM-visibility assumption, one from a macOS pointer
convention.

Not fixed here: `ReplacementLab.tsx` carries the same boundary-only focus trap and is therefore
expected to have the same Tab defect on macOS. It is outside this scenario, has no AT-tier evidence
and no keyboard e2e coverage of its own, and no work package owns it. Deliberately deferred and
recorded under "Known accessibility defects" in `ROADMAP.md`, including the trap that porting only
half the fix would create.

One pipeline defect was found alongside them. The verdict engine never turned an `AtObservation`
into a finding — only the `InfrastructureLimitation` filed by workers that cannot run a given
screen reader. Since every run has at least one such limitation, every run carried at least one
`automation-inconclusive` finding, so `overallStatus` could never reach `confirmed-pass` no matter
what NVDA and VoiceOver actually said: the gate this workflow is written against was unreachable
by construction. `atFindings()` now emits one finding per screen reader per AG-1 claim, and falls
back to the limitation only when no worker covered that source at all. Every expectation resolves
from the bundle or the scenario rather than being hardcoded per screen reader: the focus-report
claim compares against the control the same bundle's keyboard trace recorded as focused, so it
stays a comparison between two real observations. NVDA and VoiceOver phrase everything
differently, so each check asks whether the utterance contains the right real name, never whether
it matches an expected sentence.

## AG-1 status

AG-1 is resolved by automated run `32242062146`. Both dialog scenarios reported
`overallStatus: confirmed-pass`, with browser assertions green and all required NVDA/Windows and
VoiceOver/macOS claims present: name/role announcement, virtual-cursor background exclusion, focus
report, and audible focus return. `docs/ui-ux-remediation/state.json` records that machine result.

The result requires no replay or approval. Any future consumer migration that names AG-1 reruns
the same command; missing AT evidence or any non-pass finding blocks completion.

## AG-3 status

The move-tree browser tier is implemented and confirmed across Chromium, Firefox, and WebKit. It
asserts the named tree, variation-depth level, branch-expanded state, and absence of tree-scoped
axe violations. The first browser capture exposed the pointer-only collapse button as an invalid
tree child; the button is now hidden from the accessibility tree while the branch-owning tree item
retains `aria-expanded` and the Space-key contract.

Separate Windows/NVDA and macOS/VoiceOver jobs capture role, level, expanded/collapsed state, and a
bounded one-item traversal utterance. The deterministic verdict requires all four claims from both
AT sources. Until a merged remote run reports `confirmed-pass`, AG-3 remains unresolved.

## What this MVP is not

The original design brief for this pipeline described a much larger system: autonomous state
exploration (crawl the app's interactive states, not just one hardcoded scenario), changed-code
targeting (map a diff to the scenarios that exercise it), LLM-generated candidate scenarios,
cross-run reliability infrastructure (retries, duplicate-run comparison, stale-AT-output
detection, clean VM snapshots). None of that exists yet. The current concrete coverage is two
dialog scenarios and one move-tree scenario, proving the full evidence → verdict → (optional)
LLM-synthesis pipeline works end to end, with real citations traceable back to real observations
at every layer. Extending it further means writing more files under `scenarios/`, not a different
architecture.
