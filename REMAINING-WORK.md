# Remaining work after the collective UX remediation

Context: merge commit `a11b540` (PR #58) shipped the confirmed findings of the 2026-09-07 collective
UX audit plus the resource guardrails that followed its host-memory incident. This document records
what that work deliberately left undone.

`UX-COLLECTIVE-FINDINGS.md` is the evidence record and the authority on every verdict. This file is
only the forward list. `ROADMAP.md` holds unshipped product and quality work unrelated to the audit.

## Priority

1. Complete the five journeys. Game review, position and annotation are done; repertoire and
   Strategic Fit remain.
2. ~~Cover the export/download failure path.~~ Done alongside 1c, for the annotated-repertoire
   export. Five Strategic Fit call sites still swallow a refused download; settle them with 1e.
3. Promote the clean-checkout link check into CI.
4. ~~Decide the fate of the retained review worktrees.~~ Done: reports preserved under
   `docs/ux-audit-2026-09-07/`, worktrees pruned.

Recommendation: keep going through the journeys. Three passes have now found ten defects between
them, five of which blocked the journey they were found in, so the remaining two are worth the same
treatment. Do 1d before 1e: the staging and revision-bound writer it exercises is the riskiest code
path left, and 1e can then close the Strategic Fit download call sites in the same pass. Item 3 can
ride along with whatever touches CI next.

## How to pick this up

Read this file and `docs/UX_REVIEW.md`. Between them they are enough to continue; nothing else from
the sessions that produced them is needed.

Each journey follows the same shape, and it is worth repeating rather than reinventing:

1. Branch from `main`. Start a session with `pnpm ux:review -- --session <name> --port <free port>
start --workflow <label>`, seeding `apps/ui/test/fixtures/ux-review/rich-repertoire.pgn` unless
   the journey needs a game, in which case use `sample-game.pgn`.
2. Drive only visible controls. Read every result from the rendered cards, then confirm what the
   card dropped by turning on Settings → "Show technical details" and reading the raw JSON. Three of
   the four journeys so far found their worst defects exactly there: the payload carried the answer
   and the card did not show it.
3. Fix, then `reset` and replay the same seed through the same controls.
4. Promote each finding to a test, run `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, the UI
   typecheck and `pnpm --filter @chess-mcp/ui test:chat`, then `pnpm test:e2e:container` as the
   authoritative gate.
5. Record the run in the session's `review.md`, including every failed attempt, then summarise here.

Practical notes earned the hard way:

- Anything reached through the assistant needs a provider. `apps/ui/test/fixtures/ux-review/`
  holds two `--setup` stubs — `game-review-provider.js` and `position-provider.js` — that stand in
  for the model's tool choice and nothing else. Copy one for a new journey. They are listed in
  `.prettierignore` because the controller evaluates them as a single expression and a
  formatter-added trailing semicolon makes them unparseable.
- A forwarded CLI call is killed after 180 seconds. Keep every bounded wait under that.
- `pnpm test:e2e:container` buffers all output until it exits, and the harness task notification's
  exit code has been wrong at least once. Read the run's output and check the "N passed / N failed"
  line before believing it.
- Run the unit suite through `pnpm --filter @chess-mcp/ui test:chat`. Calling `node --test` with a
  glob from the repository root silently picks up the Playwright specs, which cannot run there.
- Host WebKit is not installed, so `pnpm test:e2e` fails its webkit project locally. That is the
  environment, not the tests; the container gate is the authority.

Open pull requests at the time of writing: #62 carries 1c and item 2 and is the branch this section
lives on. #59, #60 and #61 are merged.

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

### 1b. Position — done 2026-09-08

Ran through the controller against `rich-repertoire.pgn` as White, at the position after `6. Bd3`
chosen by clicking it in the move tree. Three runs recorded in the untracked `.ux-review/position/`
tree; its `review.md` is the record, including a run abandoned because of a defect in the review
scaffolding rather than the app. Zero faults throughout.

`apps/ui/test/fixtures/ux-review/position-provider.js` is the `--setup` file: it stubs OpenRouter
and stands in for the model's tool choice only, reading the verb and the SAN tokens from the
reviewer's own message.

Five defects found and fixed, with regression cover in `apps/ui/test/e2e/position-cards.spec.ts`:

- `evaluate_position` had no card. The generic fallback rendered a single navigation row — the bare
  FEN — while the payload carried three ranked lines with SAN, centipawns and depth plus an explicit
  `eval_pov`/`eval_sign`. The White-POV labelling this journey must record was in the payload and
  not on screen.
- `compare_moves` had no card either, so a comparison rendered as the same lone FEN, dropping both
  ranked candidates and their `eval_cp`/`mover_cp`.
- `validate_line` rendered a **completely empty card**: `NavigationRows` looks for
  `path`/`san_path`/`fen`/`ply` and the payload's key is `finalFen`, so nothing matched. The child
  position the journey requires could be neither seen nor reached.
- An illegal candidate was rejected by the engine layer (`{"san":"Ra3","error":"illegal_move"}`) but
  the rejection was invisible: the error sits inside `candidates[]` and `ToolResult` only checks for
  a top-level `error`, so it rendered like a successful comparison.
- A move played on the board could not be undone. `actions.play` called `playMove` and
  `recordDocumentChange` but never `recordMutation`, while every `applyEdit` path did, so Ctrl+Z was
  a no-op for the one kind of change a person makes by hand and there is no visible Undo control. A
  mis-dragged piece stayed in the repertoire.

Still open, and deliberately not claimed:

- `Compare Nxe4` is silently answered as `Ne4`. Lenient SAN parsing is defensible; the new card at
  least prints the canonical SAN so the coercion is visible.
- After undoing back to the saved content the document still reports "1 unsaved change". It counts
  changes rather than comparing content. Predates this work and applies to every mutation type —
  settle it in 1d, where staging and accepting are the subject.
- Two drags were swallowed shortly after switching to the Analysis tab and the same drag succeeded
  after a longer settle. Timing; not isolated, not claimed as a defect.
- One fixture, one position, White prepared. No promotion, no `get_legal_moves`, no cloud-eval or
  tablebase path.

### 1c. Annotation — done 2026-09-08

Ran through the controller against the branching `rich-repertoire.pgn` as White. Two runs recorded
in the untracked `.ux-review/annotation/` tree; its `review.md` is the record. Zero faults
throughout. No provider needed: "Generate annotated repertoire" is a direct command in the
Repertoire panel, not a chat tool call.

The export itself is correct, verified by parsing the downloaded file against the source:

- Branch structure preserved exactly — source 124 nodes / 12 leaves / max depth 13, downloaded
  124 / 12 / 13.
- 16 annotation comments and one NAG across 4,761 bytes, including an audit assessment
  (`4. e3 $6 { audit: inaccuracy — loses 60cp vs Nc3 (+0.43) }`), an only-move note and Strategic
  Fit evidence comments.
- Original-document continuity: `toPgn()` 849 bytes before and after, `dirty()` false.

One defect found, which is also item 2 — see below.

Still open, and deliberately not claimed:

- Cancel was observed as an available control but not exercised to completion in these runs.
- Only the annotated-repertoire export; the metadata JSON and intent PGN exports were not run.

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

**Status: done 2026-09-08, for the annotated-repertoire export.**

Found while running 1c. A failed download was indistinguishable from a successful one:
`saveArtifact` returned `false` when the artifact was missing and the caller dropped the value; it
had no `try`/`catch`, so a browser that refuses the download threw past the click handler; and it
revoked the object URL in the same tick as `link.click()`, which can cancel a download that has not
started reading the blob. A successful export said nothing either, so all of those looked alike.

`saveArtifact` now reports `{ok:true, name}` or `{ok:false, reason:"missing"|"blocked"}`, catches
the refusal, and defers the revoke by a tick. The panel keeps the artifact id so the file can be
downloaded again without recomputing, renders a specific error when a download fails, and shows a
"Download again" control whenever an export exists — which doubles as the confirmation the flow
never had. Proven by `apps/ui/test/artifacts.test.ts` at the source and
`apps/ui/test/e2e/export-download.spec.ts` end to end; both fail if the failure is dropped.

Still open: five other `saveArtifact` call sites — two in `StrategicFitTransfer` and three across
the Strategic Fit components — still ignore the result and so still swallow a refused download.
Settle them with 1e.

For the record, the original entry: the audit's QA-6 asked for declared error scenarios. Checking
the suite rather than the reports showed most already covered — `explorer_auth_required` in
`apps/ui/test/e2e/chat-result-cards.spec.ts`, malformed preflight data in
`apps/ui/test/e2e/strategic-fit-preflight.spec.ts`, illegal moves in several specs, and
`compare_moves` in `apps/ui/test/content.test.ts`. Export and download failure was the one path with
no coverage.

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
