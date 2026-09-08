# Remaining work after the collective UX remediation

Context: merge commit `a11b540` (PR #58) shipped the confirmed findings of the 2026-09-07 collective
UX audit plus the resource guardrails that followed its host-memory incident. This document records
what that work deliberately left undone.

`UX-COLLECTIVE-FINDINGS.md` is the evidence record and the authority on every verdict. This file is
only the forward list. `ROADMAP.md` holds unshipped product and quality work unrelated to the audit.

## Priority

1. Complete the five journeys. Game review is done; position, annotation, repertoire and Strategic
   Fit remain.
2. Cover the export/download failure path.
3. Promote the clean-checkout link check into CI.
4. Decide the fate of the retained review worktrees.

Recommendation: keep going through the journeys. Game review was the only family with no evidence of
ever having been exercised, and one pass found four defects, so the remaining four are worth the
same treatment. The other three items are small and can ride along with whatever touches their area
next.

## 1. The five completion journeys

**Status: open. Not claimed, not partially credited.**

The shipped fixes carry focused regression coverage, and the container gate passes 685 tests. That
establishes the fixes behave as written. It does not establish that a person can complete each
workflow through visible controls, which is what the audit asked for and what no source report
delivered. The implementation replay in the findings document explicitly disclaims being an
end-to-end review of every family.

Run these through the controller described in `docs/UX_REVIEW.md`. A workflow label is an artifact
name, not an executed journey: record preconditions, the visible steps taken, running **and**
terminal states, and the artifact or result asserted. Every attempt gets named, including failures.

### 1a. Game review — done 2026-09-08

Ran through the controller against `sample-game.pgn` as White, twice: once to find friction and once
to replay it after the fixes. Both attempts completed the journey through visible controls with zero
faults. Evidence is the untracked `.ux-review/game-review/` tree; its `review.md` is the record,
including the two failures kept rather than retried away.

Game review is only reachable through the assistant's tool calls, so the run needs a provider.
`apps/ui/test/fixtures/ux-review/game-review-provider.js` is the `--setup` file: it stubs OpenRouter
and scripts nothing but which tool the model asks for. Both tools then run for real in the browser.

Four defects found and fixed, with regression cover in
`apps/ui/test/e2e/game-review-cards.spec.ts`:

- The chat log collapsed to `clientHeight: 0` on the phone against 1055px of cards. The rows laid
  out over the context chip and `elementFromPoint` returned the chip, so a finished review was
  neither readable nor clickable. The board resizer bought 57px and no more. Cause: the panel's
  fixed furniture — header 53, context chip 46, composer 65, padding and gaps 61 — took ~225px of a
  629px viewport, and the log was the only flexible child, so it absorbed the whole shortfall. The
  header now shares a scroller with the log and the board is capped while the chat tab is open;
  the chip stays by the input per WP-027 AC-1. Measured after: board 164, conversation 111 with
  350px of content, composer and chip pinned, rows clickable, board still on screen so a
  turning-point tap costs no tab switch.
- The current-line ribbon never scrolled the current move into view after a jump, so a long game
  showed move 1 while the board sat on move 39. The move tree had the same problem vertically.
- The summary card showed accuracy and blunders only; mistakes and inaccuracies were in the payload
  but reachable only through the developer-facing Raw JSON toggle. Navigation rows read
  "Move 1 / Ply 78" while `san`, `cp_loss` and `classification` sat unused in the same record.
- The move-findings card took the first eight of 79 moves in game order, so every row was an opening
  move with nothing to review.

Still open, and deliberately not claimed:

- A turning-point row lands on the position _after_ the flagged move, and the card surfaces no
  alternative, so validating a suggested continuation still means stepping back a ply by hand.
- The same seed produced different verdicts across the two runs (worst move 39…Re6+ Δ−2.93, then
  17…Rxf7 Δ−2.44). Browser engine search is time-sensitive; a review is not reproducible run to run.
- Only White, only this fixture, and no game-review error path (engine lost mid-scan, cancel, retry).

### 1b. Position

Done when: a known position is chosen visibly, evaluated to a terminal candidate list, a named legal
candidate is compared, a continuation is validated and its child position shown, and an invalid
input is deliberately rejected. Record scores with White-POV labels. Verify a real pointer or
keyboard move and undo rather than inferring one from a filename — the original P2 claim of a
successful move was not supported by its own snapshot.

### 1c. Annotation

Partially replayed during implementation: progress, cancel, retry and a downloaded artifact were
observed. Still owed: an explicitly chosen branching export whose downloaded result is parsed, with
expected branches and annotations verified and original-document continuity confirmed. A downloaded
file proves delivery, not annotation correctness.

### 1d. Repertoire

Done when: a structural profile or Strategic Fit run and an audit or gaps task complete; one
navigable finding is inspected; a change is staged, rejected, and confirmed to have mutated nothing;
then a separate change is accepted through the existing revision-bound writer. Exercise one
unavailable-data path. No source report completed this set.

### 1e. Strategic Fit

Done when: a profile is chosen, structural analysis runs, a finding and its evidence are inspected,
the workspace returns without document loss, and keyboard focus is tested. Repeat with the CT Black
input if claiming CT-specific coverage — the original run used a white fixture, not the CT input its
report implied.

## 2. Export and download failure path

**Status: open. Small.**

The audit's QA-6 asked for declared error scenarios. Checking the suite rather than the reports
showed most already covered: `explorer_auth_required` in `apps/ui/test/e2e/chat-result-cards.spec.ts`,
malformed preflight data in `apps/ui/test/e2e/strategic-fit-preflight.spec.ts`, illegal moves in
several specs, and `compare_moves` in `apps/ui/test/content.test.ts`. Export and download failure is
the one path with no coverage.

Done when: a failing export or download surfaces a visible, specific error and a supported retry or
recovery route, proven by a test that fails if the error is swallowed.

## 3. Clean-checkout link check in CI

**Status: open. Small, and it prevents a repeat failure.**

PR #58 failed CI twice for the same underlying reason: local checks could not see what a clean
checkout sees. `pnpm docs:check` validates markdown links against the working tree, so links into
gitignored, machine-local evidence resolved locally and broke in CI.

The immediate breakage is fixed — every markdown link in the repository now resolves from tracked
files, and gitignored evidence paths are cited as code spans rather than linked. Nothing prevents
the next document from reintroducing it.

Done when: a `check:links` script resolves every local markdown link against `git ls-files` only,
runs in the Node job, and fails on a link satisfied solely by an untracked or ignored file.

Related and cheap: `pnpm format:check` is a separate gate from `pnpm lint`. Run both before
committing. The first CI failure on PR #58 was a formatting miss.

## 4. Retained review worktrees

**Status: open decision, deliberately deferred. Not a defect.**

Seven secondary worktrees remain registered under a gitignored directory. Each holds an untracked
review report and, for some, retained run evidence totalling roughly 7.5 MB.

Verified: **none has any commit that is not already in `main`.** No code is at risk. The only thing
deletion destroys is the untracked reports and their evidence, which the findings document cites by
path. That makes this purely a retention decision.

Options: keep them; or preserve the reports somewhere tracked and then prune. Do not prune without
preserving first — the reports are the only copies.

## Known limits, accepted rather than outstanding

Recorded so they are not rediscovered later as defects.

- The review server's heap bound caps the **V8 heap only**. Child processes such as esbuild are
  outside it. Container bounds do not apply, because the server runs on the host by design.
- Running one heavy workload at a time is an operative rule, not an enforced one. Concurrent review
  sessions across worktrees still accumulate host-side servers.
- Single-worker execution is the container gate's default and costs little at the present suite
  size: the full matrix ran in 18.0 minutes. Revisit only if that time becomes painful, and raise
  `E2E_DOCKER_MEMORY` alongside any worker increase.

## Do not reopen

The audit denied a set of proposed findings on evidence. Re-implementing them would undo a decision
rather than close a gap. See the product findings table in `UX-COLLECTIVE-FINDINGS.md` for each
verdict, in particular UX-6 through UX-14: the document menu, save confirmation, move-tree keyboard
navigation, last-move highlighting, profile explanation and modal focus trap already exist. UX-10 is
settled by measurement — zero controls fall below the 44px minimum on the phone profile, guarded by
`apps/ui/test/e2e/collective-ux-fixes.spec.ts`.

Tours, global reorganization, profile animations and additional badges were rejected as subjective
preferences rather than demonstrated defects.
