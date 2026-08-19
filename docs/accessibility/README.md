# Automated accessibility evidence pipeline

Origin: AG-1, the dialog accessibility gate in `docs/ui-ux-remediation-plan.md`, requires a human
NVDA session and a human VoiceOver session before the `Dialog` primitive (WP-007) can ship. This
pipeline exists to produce the same evidence automatically — real screen-reader output, not a
substitute for it — so AG-1 can be decided from captured evidence instead of a manual pass.

**Status as of this writing:** the deterministic browser tier is proven, real, and passing. The
AT tier (NVDA, VoiceOver) is designed and typechecked but has never executed — see "What's
unverified" below. AG-1 itself is **not yet resolved**: that requires a real triggered run of
`.github/workflows/accessibility.yml`, not a redefinition of what the gate asks for.

## Architecture

```
apps/ui/test/accessibility/
  evidence-schema.ts       Normalized shapes every collector produces and the verdict engine
                            and LLM reviewer consume. Nothing downstream reads raw DOM state.
  collectors/
    browser-ax.ts           Playwright ariaSnapshot() (cross-engine) + CDP getFullAXTree
                             (Chromium-only, diagnostic depth: ignored-node reasons)
    axe.ts                  @axe-core/playwright — deterministic rule findings
    keyboard-trace.ts       Drives real key presses, records focus before/after each one
    at-runner.ts             Guidepup (github.com/guidepup/guidepup, MIT) — real NVDA/VoiceOver,
                             not a simulator. Platform-gated: returns an
                             InfrastructureLimitation record on any worker that can't run it,
                             never a fabricated pass.
  scenarios/ag-1-dialog.ts  The concrete scenario: open Strategic Fit, run every collector this
                             worker supports, return one EvidenceBundle.
  verdict.ts                Deterministic classification. Every Finding cites an EvidenceRef —
                             an index into the bundle that produced it. Never calls an LLM.
  llm-review.mjs            Opt-in only (A11Y_LLM_REVIEW=1). The reasoning layer, not the source
                             of truth — every finding it returns must cite a real evidence index;
                             citations that don't resolve are rejected before anyone sees them.
  run-context.mjs           Shared run-ID computation (capture.mjs, compute-verdict.ts, and the
                             Playwright spec all import this — one source, not three copies).
  capture.mjs               Entry point. Computes one A11Y_RUN_ID, runs the capture spec under
                             it (locally or via A11Y_CONTAINER=1 through Docker), writes
                             .last-run-id so compute-verdict.ts can find it without the caller
                             manually propagating the env var.
  compute-verdict.ts        Reads every browser's evidence file for a run, merges them,
                             classifies, writes report.json + report.md. This is the actual gate
                             — exits non-zero on confirmed-failure / cross-platform-disagreement
                             / infrastructure-failure. The Playwright specs themselves only
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

## What's unverified

`collectors/at-runner.ts` and `.github/workflows/accessibility.yml`'s `at-nvda` / `at-voiceover`
jobs are written against Guidepup's documented API
(github.com/guidepup/guidepup, github.com/guidepup/guidepup-playwright,
github.com/guidepup/setup-action — all fetched and confirmed real during design, not recalled
from training data). This machine has no Windows or macOS to test on, and Docker cannot
substitute — NVDA and VoiceOver hook into their OS's real UI Automation / Accessibility API;
there is no Linux-container equivalent. `windows-latest` and `macos-latest` GitHub-hosted
runners are real VMs / real Apple hardware, not containers.

The workflow is `workflow_dispatch`-only — nothing runs automatically. **First triggered run**
(run 32205343813): `browser-evidence` and `merge-report` passed; `at-nvda` and `at-voiceover`
both failed with the same root cause — `guidepup/setup-action` only performs the OS-level
`@guidepup/setup setup` half of Guidepup's own two-step setup. It does not run the
project-scoped `@guidepup/setup install {nvda,voiceover}` half (screen-reader assets matched to
this project's installed `@guidepup/guidepup` version), which both jobs now run as an explicit
step, added directly in response to that run's actual error output rather than guessed in
advance. Re-triggering after that fix is the next real signal. Until a clean run has been
inspected, treat those two jobs as designed-not-proven. **Do not promote this workflow to run
on every `pull_request` before that has happened.**

## AG-1 status

Not resolved. The deterministic browser-tier evidence above is real and satisfies the automated
half of AG-1 as originally written (dialog contract suite passing across three browsers,
background inertness, focus return). The manual half — one NVDA session, one VoiceOver session —
is what the `at-nvda`/`at-voiceover` jobs exist to replace with real automated equivalents, and
they have not yet run for real. AG-1 gets marked resolved in
`docs/ui-ux-remediation/state.json` only after a genuine triggered workflow run produces real
NVDA and VoiceOver evidence — not before, and not by redefining the gate to drop that requirement.

## What this MVP is not

The original design brief for this pipeline described a much larger system: autonomous state
exploration (crawl the app's interactive states, not just one hardcoded scenario), changed-code
targeting (map a diff to the scenarios that exercise it), LLM-generated candidate scenarios,
cross-run reliability infrastructure (retries, duplicate-run comparison, stale-AT-output
detection, clean VM snapshots). None of that exists yet. What exists is one scenario
(`ag-1-dialog.ts`) proving the full evidence → verdict → (optional) LLM-synthesis pipeline works
end to end, with real citations traceable back to real observations at every layer. Extending it
to more scenarios means writing more files under `scenarios/`, not a different architecture.
