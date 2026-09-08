# Remaining work after the collective UX remediation

Context: merge commit `a11b540` (PR #58) shipped the confirmed findings of the 2026-09-07 collective
UX audit plus the resource guardrails that followed its host-memory incident. This document records
what that work deliberately left undone.

`UX-COLLECTIVE-FINDINGS.md` is the evidence record and the authority on every verdict. This file is
only the forward list. `ROADMAP.md` holds unshipped product and quality work unrelated to the audit.

## Priority

1. ~~Complete the five journeys.~~ Done: game review, position, annotation, repertoire and
   Strategic Fit have all been driven and replayed.
2. ~~Cover the export/download failure path.~~ Done: the annotated-repertoire export alongside 1c,
   and every other save control alongside 1e.
3. ~~Promote the clean-checkout link check into CI.~~ Done: `pnpm check:links` runs in the Node job.
4. ~~Decide the fate of the retained review worktrees.~~ Done: reports preserved under
   `docs/ux-audit-2026-09-07/`, worktrees pruned.

**Every item on this list is now closed.** Five journey passes found nineteen defects between them.
What remains is only the coverage each journey explicitly did not claim, listed under its own
heading below and worth reading before deciding whether another pass is warranted. The largest gaps
are that every journey ran White on one fixture, and that no journey exercised the CT Black input.
This file stays as the record of what was done and what was left; new work belongs in `ROADMAP.md`.

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

Pull requests: #59, #60, #61, #62 and #63 are merged. The Strategic Fit journey is the branch this
section now lives on.

## 1. The five completion journeys

**Status: all five done, 2026-09-08. Each entry states what it does not claim.**

The original entry: the shipped fixes carried focused regression coverage, which establishes that
the fixes behave as written and not that a person can complete each workflow through visible
controls. That is what the audit asked for and what no source report delivered. Each journey below
was therefore driven through the controller and replayed after its fixes.

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

### 1d. Repertoire — done 2026-09-08

Ran through the controller against `rich-repertoire.pgn` as White. Two runs recorded in the
untracked `.ux-review/repertoire/` tree; its `review.md` is the record, including the three failed
attempts kept rather than retried away. No provider needed: every control in this journey is a
direct command in the Repertoire panel.

The set completed: Structure search and Prescribed-move audit reached terminal states, the audit's
one finding navigated the board to its position, a staged line was rejected leaving the PGN
byte-identical, a second was accepted through the revision-bound writer (849 → 865 bytes, revision
1 → 2), and Opponent preparation exercised the unavailable-data path.

Six defects found and fixed, with regression cover in
`apps/ui/test/e2e/repertoire-journey.spec.ts`, `apps/ui/test/history.test.ts` and
`apps/ui/test/chat.test.ts`:

- Connect, Shorten and Extend here delivered their results into a **closed section**. Their scan
  buttons live in the `<summary>` and call `preventDefault`, which stops the native toggle, and
  unlike every `commandButton` tool they never set `open` themselves. Rows, errors and empty states
  all rendered invisibly, and Extend here shows no result count either, so pressing Suggest looked
  like it had done nothing.
- Staging a suggestion put its own controls offscreen: "Staged line / Accept line / Cancel" landed
  at y = −532 in a 629px viewport, so the tap appeared to do nothing.
- A failed command answered with its own error code — "Unable to display this content /
  missing_criteria" — although `ERROR_CONTENT` already maps it and the chat card already hides the
  code behind technical details (WP-026 AC-1).
- Two covered-gap rows both read `d5 covered → Nf6` for different transpositions, and two Shorten
  rows both read `d4 d5 → c4` for different lines; the line was in a `title` no touch device shows.
- Undo restored the content but not the header: a document byte-identical to the saved one still
  read "1 unsaved change". `changesSinceExport` counted mutations rather than comparing content.
  This is the item 1b deferred here. Fixing it failed six `core-document.spec.ts` tests that made
  the document dirty by adding a move the fixture already had — a merge that leaves the PGN
  byte-identical — so their helper now adds one it does not have.
- Opponent preparation reported `0 results` whether the games could not be fetched or the opponent
  had no games in prep, and an empty username fired a request for `/api/games/user/?max=30` and
  reported that answer as a result.

Still open, and deliberately not claimed:

- Only White, only this fixture; no Black run.
- Connect and Shorten results were read but never staged and accepted; the accepted change came
  from Extend here.
- Structure search matched nothing on this fixture, so a populated result was never rendered.
- The collapsed summary still counts `lines` only, so Opponent preparation reads "0 results" beside
  a body that now says how many games were fetched.

### 1e. Strategic Fit — done 2026-09-08

Ran through the controller against `rich-repertoire.pgn` as White. Four runs recorded in the
untracked `.ux-review/strategic-fit/` tree; its `review.md` is the record, including the HMR reload
that wiped a report mid-run and a scripted loop that was wrong rather than the app. No provider
needed.

The set completed: Balanced profile chosen (header moved from `Inferred · provisional` to
`Explicit`), analysis run to a terminal report of 10 findings, a finding and its matched-position
evidence inspected, "Return to repertoire" left the PGN at 849 bytes and revision 1 and restored
focus to the opener, and the workspace reopened, switched stage and closed again from the keyboard.

Three defects found and fixed, with regression cover in
`apps/ui/test/e2e/strategic-fit-journey.spec.ts` and `apps/ui/test/strategic-fit-reanalysis.test.ts`:

- **The first resolution recorded against a report was silently thrown away.** Saving one schedules
  a reanalysis of its cohort; that run recomputes the finding's evidence with the decision applied,
  sees it change, and reopens the decision that asked for the run. `resolutions` stayed empty, the
  counter stayed at 10, and a second identical save then held. The request now names the finding
  whose resolution triggered it and reconciliation leaves that one alone.
- **Recording a resolution said nothing.** The Resolution stage emptied to "No resolution selected"
  because the message the transition composes lives in the finding's card, which unmounts, and in a
  review snapshot that the new report id resets. The last action is now held in the store.
- **Five save controls dropped their result** — item 2's leftovers, plus the drill-deck export and
  the chat artifact card. All save surfaces now report through one status line and one wording.

Also corrected: the reconcile line counted findings with changed evidence and called them reopened.

Still open, and deliberately not claimed:

- White and this fixture only. The CT Black input was not run, so no CT-specific coverage — the
  original source report implied CT coverage it did not have, and this run does not add it.
- The review was never completed (9 findings left unresolved), so "Finish the review" and its
  summary export were not exercised end to end.
- Cancel during analysis was available but never pressed to completion.
- The Replacement Lab was unavailable for every finding in this fixture, so that path is untested.

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

**Closed 2026-09-08 with 1e.** Every remaining call site now reports its result through one shared
status line (`components/primitives/ArtifactSaveStatus.tsx`) and one wording
(`artifactSaveMessage`): `StrategicFitTransfer` (×2), `ReviewSummary`, `ProfileSettings`,
`TrainException` (×2), the drill-deck export in the Repertoire panel, and the chat artifact card —
eight in total, three more than this entry had counted. `apps/ui/test/e2e/strategic-fit-journey.spec.ts`
proves a save reports success and a refused download at the transfer controls.

For the record, the original entry: the audit's QA-6 asked for declared error scenarios. Checking
the suite rather than the reports showed most already covered — `explorer_auth_required` in
`apps/ui/test/e2e/chat-result-cards.spec.ts`, malformed preflight data in
`apps/ui/test/e2e/strategic-fit-preflight.spec.ts`, illegal moves in several specs, and
`compare_moves` in `apps/ui/test/content.test.ts`. Export and download failure was the one path with
no coverage.

## 3. Clean-checkout link check in CI — done 2026-09-08

PR #58 failed CI twice for the same underlying reason: local checks could not see what a clean
checkout sees. `pnpm docs:check` validated markdown links with `stat`, against the working tree, so
links into gitignored, machine-local evidence resolved locally and broke in CI.

`pnpm check:links` (`scripts/check-links.mjs`) now resolves every local link in every tracked
markdown file against `git ls-files` alone — files and their parent directories, with anchors,
query strings, percent-encoding, angle brackets, reference definitions and root-absolute paths all
handled — and reports `file:line` for anything that resolves to no tracked path or climbs out of
the repository. It runs in the Node job right after `docs:check`, and its own contracts run with the
UX review controller tests. The superseded working-tree loop is gone from `docs-consistency.mjs`,
so there is one implementation rather than two that can disagree.

Verified against the original failure mode: adding a link to `.ux-review/strategic-fit/session.json`
— present locally, gitignored — makes `pnpm check:links` exit 1 while `pnpm docs:check` still
passes.

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
