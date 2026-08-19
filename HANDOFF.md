# Handoff: AG-1 accessibility pipeline — VoiceOver + keyboard-trap bug

Branch: `salvage` (also fast-forwarded onto `main` as of commit `68914a4`). **Do not delete
`salvage`.** Uncommitted changes exist on top of `68914a4` — see "Uncommitted state" below.
This doc is a checkpoint for a fresh session; delete it once the work below lands.

## Mission context

Two nested missions:

1. **Original (paused, not abandoned):** salvage the abandoned `hermes-work` branch on `salvage`
   (off `main`), re-landing only reviewed/fixed slices gated on a full container e2e suite.
2. **Current active work:** a fully automated, zero-human accessibility evidence pipeline
   (`apps/ui/test/accessibility/`) targeting **AG-1** — the dialog accessibility gate in
   `docs/ui-ux-remediation-plan.md`, which originally required a human NVDA session and a human
   VoiceOver session before the `Dialog` primitive (WP-007) could ship. Full design/status is in
   `docs/accessibility/README.md` — read that first, it's kept up to date with every real run.

Constraints established this session, still binding:

- pnpm, not npm, for all package operations.
- No `Co-Authored-By` trailer in commit messages (see memory `no-co-authored-by-trailer.md`).
- LLM synthesis layer (`llm-review.mjs`) stays opt-in (`A11Y_LLM_REVIEW=1`), never wired into CI.
- Workflow (`.github/workflows/accessibility.yml`) stays `workflow_dispatch`-only until a clean
  run (`overallStatus: confirmed-pass`) has actually been observed.
- Established loop: diagnose from real evidence → fix → typecheck → verify locally (Docker) →
  full check suite → commit → push `salvage` → fast-forward `main`
  (`git push origin salvage:main`) → retrigger workflow via `gh workflow run accessibility.yml
--ref main --repo Azeajr/chess-mcp`. `workflow_dispatch` workflows must exist on the _default_
  branch to be dispatchable — this is why `main` gets fast-forwarded each time instead of PR'd.

## What's proven solid (do not re-litigate)

- Deterministic browser-tier evidence (Chromium/Firefox/WebKit via Docker,
  `A11Y_CONTAINER=1 pnpm a11y:capture`): stable, green, unchanged across every iteration.
- **NVDA**: proven correct across 4 consecutive real CI runs. `reportCurrentFocus` reports
  `'Return to repertoire, button, focused'` — real, correct, stable. Don't touch `at-runner.ts`'s
  NVDA path.
- **VoiceOver AT observation** (as of run `32210865750`, commit `1c7a34b`): also now correct —
  `describeItemWithKeyboardFocus` reports `'Return to repertoire button has keyboard focus'`,
  matching NVDA's real target, confirmed stable on run `32212195952` too. The fix was ordering:
  `macOSActivate` (app-level) then `page.bringToFront()` (tab-level), back-to-back, immediately
  before the AT command — ported from `@guidepup/guidepup-playwright`'s own
  `navigateToWebContent()` reference implementation. This part is done; do not reopen it.

## The real bug this session found (in progress, not yet verified green)

Every CI run (4 through 9) also showed a **separate, unrelated** failure: `keyboardTrace[3]`
(webkit, captured by the `at-voiceover` job only) — a real `Tab` press losing DOM focus
(`activeElementAfter: None`) mid-sequence. Reproduced identically 6 times, survived every
AT-activation fix, and survived a tested-and-disproven "VoiceOver teardown race" theory (a 1s
settle delay after `screenReader.stop()` — added in run 9, zero effect, already reverted in the
uncommitted diff).

**Root cause, confirmed by reading source, not guessed:** `StrategicFitWorkspace.tsx`'s focus-trap
`keydown` handler (`trapFocus`, originally ~line 339) only called `.focus()` explicitly at the
_wrap boundary_ (`active === first` / `active === last`), relying on native browser Tab traversal
for every press in between. **macOS Safari's default "Full Keyboard Access" setting is OFF by
default** on a fresh install (including GitHub's `macos-latest` runners) — this makes native Tab
skip every `<button>` entirely, only stopping on text fields/lists. So real Mac users with default
settings hit this exact bug in production: Tab from "Advanced preferences" would jump clean over
"Skip for now" and the profile submit button, landing nowhere. **This is a genuine,
previously-undiscovered production accessibility bug**, not a CI/pipeline artifact — exactly the
kind of finding this whole pipeline exists to catch.

## Fix applied so far (uncommitted, in `StrategicFitWorkspace.tsx`)

Rewrote `trapFocus`'s Tab handling to always move focus explicitly (compute next/prev candidate
index itself for _every_ Tab press, not just at the boundary), removing the dependency on native
Tab semantics entirely:

```ts
const active = document.activeElement;
const activeIndex = candidates.findIndex((element) => element === active);
event.preventDefault();
if (event.shiftKey) {
  const prevIndex = activeIndex <= 0 ? candidates.length - 1 : activeIndex - 1;
  candidates[prevIndex]?.focus();
} else {
  const nextIndex =
    activeIndex === -1 || activeIndex === candidates.length - 1 ? 0 : activeIndex + 1;
  candidates[nextIndex]?.focus();
}
```

This first version **broke the real e2e suite** (`pnpm test:e2e:container`): treating every
element matched by the `FOCUSABLE` selector as an independent Tab stop breaks native
**radio-group** semantics — a set of `<input type="radio" name="strategic-fit-profile">` sharing
one `name` is natively ONE Tab stop (the checked radio), not N stops; arrow keys (untouched,
native) move the selection within the group. Fixed by collapsing radio groups to one
representative (checked wins, else first-seen) inside `focusable()`:

```ts
const focusable = () => {
  const raw = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true",
  );
  const groupRepresentative = new Map<string, HTMLInputElement>();
  for (const element of raw) {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
      continue;
    if (element.checked || !groupRepresentative.has(element.name)) {
      groupRepresentative.set(element.name, element);
    }
  }
  return raw.filter((element) => {
    if (!(element instanceof HTMLInputElement) || element.type !== "radio" || !element.name)
      return true;
    return groupRepresentative.get(element.name) === element;
  });
};
```

That fixed the `close → Balanced radio` transition (previously failing). **Still failing after
that fix**, identically across chromium/firefox/webkit (3/3, so a real logic bug, not a
browser-engine quirk):

```
test/e2e/strategic-fit-accessibility.spec.ts:57
test/e2e/strategic-fit-findings.spec.ts:2354
test/e2e/strategic-fit-profile-setup.spec.ts (same pattern)
```

Expected sequence: `close → Balanced radio → "Advanced preferences" summary → "Skip for now"
button → "Use Balanced profile" submit`. The `close → radio → summary` part now passes. The
**next** Tab (`summary → "Skip for now"`) fails: `expect(skipButton).toBeFocused()` times out,
"Received: inactive" — meaning something _other_ than Skip has focus, not necessarily nothing.

**This was not yet diagnosed.** I was about to start a local `pnpm dev` server to inspect the live
DOM/focus state directly (evaluate `focusable()`'s candidate list and `document.activeElement` by
hand in the browser) when the user interrupted to request this handoff doc instead.

## Hypotheses not yet tested, for the next session

1. **`<details>` closed-state content still in `raw`.** `ProfileSetup.tsx`'s `<details open=
{advancedOpen()}>` wraps a large block of range/number inputs (`strategic-fit-profile-fields`).
   `advancedOpen()` defaults to `initial.mode === "custom"` — for the "Balanced" scenario used in
   these tests, that's `false`, so the details should be closed and its children should have
   `getClientRects().length === 0`. **Verify this assumption is actually true in a live browser**
   — if some CSS override (`display: contents`, `visibility` tricks, or a transition) keeps
   children laid-out-but-hidden, `getClientRects()` could still return non-empty rects, which
   would insert a large number of extra "focusable" candidates between summary and Skip, shifting
   every subsequent index and explaining exactly this class of failure. Check
   `apps/ui/src/index.css` or wherever `.strategic-fit-profile-advanced` / `details:not([open])`
   rules live.
2. **Ordering/identity mismatch in `raw` vs what the DOM actually reports as next.** Add a
   temporary `console.log` (or a Playwright `page.evaluate` probe from a scratch script) printing
   `candidates.map(c => c.outerHTML.slice(0,80))` right before the `.focus()` call, run headed
   locally, and read it directly rather than guessing further.
3. Double check `Skip for now` and `Use {mode} profile` aren't themselves inside some element that
   independently reacts to focus-in a way that redirects it (unlikely, but rule out).

**Do not guess further without running it.** The established pattern this whole session used
successfully every time real evidence was available: read the actual DOM/state, don't speculate
from error text alone. A local `pnpm dev --host 127.0.0.1 --port <free port>` plus either the
Playwright MCP tools or a throwaway script under `$CLAUDE_JOB_DIR/tmp` (or wherever this session's
scratch dir is) to evaluate `focusable()`'s logic live in the actual rendered page is the fastest
path — that's what was about to happen when interrupted.

## Uncommitted state right now

```
$ git status --short
 M .github/workflows/accessibility.yml
 M apps/ui/src/components/StrategicFitWorkspace.tsx
 M apps/ui/test/accessibility/collectors/at-runner.ts
 M docs/accessibility/README.md
```

- `.github/workflows/accessibility.yml`: removed the `record: true` diagnostic on
  `guidepup/setup-action` in the `at-voiceover` job (confirmed useless — it only records the
  _setup_ step, not the later test run where the keyboard-trace anomaly happens) and its
  artifact-upload step. Updated the job's header comment to reflect VoiceOver now being proven.
- `apps/ui/test/accessibility/collectors/at-runner.ts`: reverted the disproven 1s
  `VOICEOVER_TEARDOWN_SETTLE_MS` delay (see "teardown race" theory above — tested in run 9,
  disproven, removed). Doc comment updated to record that this bug turned out to be unrelated to
  this module entirely.
- `apps/ui/src/components/StrategicFitWorkspace.tsx`: the focus-trap fix described above — **this
  is the file with the still-failing e2e regression, needs the debugging above before it's safe to
  commit.**
- `docs/accessibility/README.md`: updated to describe the real bug found and the fix (written
  optimistically, before the e2e regression was discovered — **will need a correction pass once
  the fix actually passes the full suite**, since right now it slightly overstates completeness).

## Next steps, in order

1. Diagnose the `summary → Skip for now` Tab failure using live DOM inspection (see hypotheses
   above), fix `StrategicFitWorkspace.tsx`.
2. Full local Docker e2e suite must be 100% green: `pnpm test:e2e:container` (no subset — this
   touched production dialog code, needs the real full-suite gate per this repo's own Phase 0
   requirement, not just the accessibility-scoped specs).
3. `pnpm -r typecheck`, `pnpm lint`, `pnpm format:check` (or `pnpm format` then re-check) — all
   must be clean.
4. Local accessibility capture too, to confirm the keyboard-trace anomaly is actually gone:
   `cd apps/ui && A11Y_CONTAINER=1 node test/accessibility/capture.mjs && pnpm a11y:verdict` — this
   only proves browser-tier (no AT on Linux), so the _real_ confirmation only comes from a fresh
   triggered CI run (step 6).
5. Correct `docs/accessibility/README.md` if needed to match what actually shipped (don't leave it
   overstating a fix that turned out to need more work).
6. Commit (no `Co-Authored-By` trailer), push `salvage`, fast-forward `main`
   (`git push origin salvage:main`), trigger workflow:
   `gh workflow run accessibility.yml --ref main --repo Azeajr/chess-mcp`.
7. Download and inspect real evidence from that run (pattern used all session:
   `gh run download <id> --repo Azeajr/chess-mcp --dir <scratch-dir>`, then read the JSON directly
   — don't trust summaries). Confirm `keyboardTrace[3]`'s anomaly is gone and `overallStatus` is
   `confirmed-pass`.
8. Once genuinely green: update `docs/accessibility/README.md`'s AG-1 status section, and check in
   with the user before marking AG-1 resolved in `docs/ui-ux-remediation/state.json` (that file
   hasn't been touched yet this whole session — it's the actual final step, not done).
9. Delete this `HANDOFF.md` once superseded by the real docs.

## Useful commands from this session

```bash
# Trigger workflow (must target main — workflow_dispatch requires default-branch presence)
gh workflow run accessibility.yml --ref main --repo Azeajr/chess-mcp

# Check status
gh run list --workflow=accessibility.yml --limit 3 --repo Azeajr/chess-mcp
gh run view <id> --repo Azeajr/chess-mcp --json status,conclusion,jobs -q '.status, .conclusion, (.jobs[] | "\(.name): \(.status) \(.conclusion)")'

# Download evidence (explicit --repo and --dir avoid a git-discovery bug in this shell env)
gh run download <id> --repo Azeajr/chess-mcp --dir <scratch-dir>

# Local full Docker e2e (the real gate for any production-code change)
pnpm test:e2e:container

# Local accessibility capture (Docker, all 3 engines, no AT — Linux has neither NVDA nor VoiceOver)
cd apps/ui && A11Y_CONTAINER=1 node test/accessibility/capture.mjs && pnpm a11y:verdict
```
