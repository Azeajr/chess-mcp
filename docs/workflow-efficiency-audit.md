# Workflow and interaction efficiency audit — chess-mcp UI

Date: 2026-09-28 (code trace), 2026-09-29 (live session) · Scope: `apps/ui` (SolidJS/Vite PWA) ·
Source revision: `3bc467f` (`origin/main`; runs 1–4 read `469986f`, and nothing under `apps/` or
`packages/` changed between the two)

Scope is workflow friction only: extra interactions, navigation, repetition, confirmations,
manual state management, defaults, and missing automatic transitions. Accessibility is out of
scope and is not assessed here.

## Read this first: how these findings were gathered

Runs 1–4 could not start a web-harness session: the host had 3.2–5.0 GiB usable against a 6.5 GiB
budget and no swap. Those runs traced every finding through `apps/ui/src` instead. **Run 5
(2026-09-29) ran a live session.** The host then had 15 GiB of swap, and web-harness 0.2.2 needed
1.8 GiB plus a 1.5 GiB margin, against 3.6 GiB usable, so `doctor` passed without
`--force-resources` and without lowered bounds.

The live session used the project default: WebKit emulating an `iPhone 13 Mini` (375×629, touch),
dev target, starting from the `blank` fixture. Every journey began at a visible control. Only the
OS file chooser was stubbed, because the container cannot drive it. The stub is the
`showOpenFilePicker` seam the app's own tests use, and it returns a PGN. The session made 33 batch
attempts across three run directories: 25 passed and 8 failed. The failures were wrong assumptions
in the batches themselves, such as desktop-only selectors and a finding kind with no form; each was
corrected and replayed. Every batch, `start`, `reset`, `reload` and `stop` reported 0 faults. The
full list is in the attempt log below and in the run's `review.md`.

The **Validation** column separates the two kinds of evidence:

- **Live** — the claim was reproduced in run 5, and the finding has a "Live evidence (run 5)"
  bullet with batch IDs and the screenshots that were opened and inspected.
- **Live (partial)** — part of the claim was reproduced and part was not exercised; the bullet says
  which part.
- **Code trace** — not exercised live. The finding rests on the interaction graph in `apps/ui/src`,
  with `file:line` citations.

Evidence lives in the git-ignored `.web-harness/chess/` run directories
`2026-09-29T14-34-22-875Z-53f2c2bf`, `2026-09-29T14-40-52-791Z-fedeb347` and
`2026-09-29T14-46-33-930Z-4820b7f1`. The last one holds `review.md` and the named PNGs cited below.
Batch IDs are abbreviated to their first 8 hex digits.

## Summary

| Priority | Count |
| --- | --- |
| High | 7 |
| Medium | 12 |
| Low | 7 |

26 findings: 12 live-validated, 3 partly live-validated, 3 found only by the live run (F24–F26),
and 8 code-trace only.

Findings, ordered by practical impact. IDs are stable across revisions of this document, so later
findings sit in impact order rather than numeric order.

| ID | Workflow | Priority | Validation |
| --- | --- | --- | --- |
| F1 | Game review / move comparison | High | Live (`batch-129228eb`) |
| F2 | Trying a move on the board | High | Live (`batch-0a4dd047`) |
| F3 | Correcting the tree (undo, delete, promote) | High | Live (`batch-0a4dd047`) |
| F4 | Opening / reopening / starting a repertoire | High | Live (`batch-a084a5d5`, `batch-21cb6177`); Reopen not exercised |
| F5 | Finding and filling gaps | High | Live (`batch-568baf2f`, `batch-d7b722ba`) |
| F24 | Gaps: "No gaps found" with unanswered replies | High | Live only, new in run 5 (`batch-d3b8d6ed`, `batch-beca9c51`) |
| F6 | Training and recall drills | High | Code trace |
| F7 | Live engine evaluation | Medium | Live (`batch-d1c12045`, `batch-c02872a3`) |
| F8 | Adding an engine or candidate move | Medium | Live (partial): engine lines only (`batch-0a4dd047`) |
| F21 | Scan results after edits or a new document | Medium | Live (`batch-0c63dd6c`) |
| F25 | Gap fill on the phone jumps away from the list | Medium | Live only, new in run 5 (`batch-d7b722ba`, `batch-912cc2a9`) |
| F9 | Strategic Fit first run | Medium | Live (`batch-eb333ece`) |
| F10 | Strategic Fit → board → back | Medium | Live (`batch-c11ed687`) |
| F11 | Strategic Fit finding triage | Medium | Code trace; form not reachable on the fixture (see F26) |
| F26 | Strategic Fit Review queue not actionable | Medium | Live only, new in run 5 (`batch-706cad8b`, `batch-c11ed687`) |
| F12 | Saving on the default (WebKit/iPhone) target | Medium | Live (`batch-4157da9a`) |
| F13 | Only-move drill deck export | Medium | Code trace |
| F14 | Exports: inconsistent one-step vs two-step | Medium | Code trace; corroborated by `strategic-fit-journey.spec.ts` (read, not run) |
| F15 | Configuration scattered across three places | Medium | Code trace |
| F16 | Chat starters | Low | Live (partial): hard-coded "White" only (`batch-129228eb`) |
| F17 | Opponent prep / structure search inputs | Low | Live (partial), claim revised: near-misses show an error (`batch-1930b8b4`) |
| F18 | Accepting several chat suggestions | Low | Code trace (needs an OpenRouter key) |
| F19 | Extend here off-turn | Low | Code trace |
| F20 | "Save status" menu entry | Low | Live (`batch-4157da9a`) |
| F22 | Recovering a snapshot | Low | Live (`batch-3646cfe2`) |
| F23 | Replacement Lab start | Low | Code trace |

---

## Workflow traces

The shortest reasonable path is given with each finding. In the counts, "click" means any
click or tap.

### W1 — Review a game I just played (single mainline PGN)

- **Goal:** accuracy, turning points, jump to mistakes, see better moves.
- **Current path, no key yet:**
  1. Open PGN.
  2. Continue the replace dialog.
  3. Pick the file.
  4. Load in the colour dialog.
  5. Open Chat (phone tab).
  6. Set up the assistant.
  7. Paste an OpenRouter key.
  8. Close Settings.
  9. Type a request.
  10. Send.
  11. Wait for the model to choose `get_game_summary` and `analyze_game`.

  That is at least 10 interactions, typing, and a paid third-party key, on every first use.
- **With a key saved:** Open PGN → Continue → pick → Load → Chat → type → Send = 7 interactions
  plus typing and LLM latency.
- **Shortest reasonable path:** Open PGN → pick → **Review game** = 3.
- **Details:** F1, F4.

### W2 — Open an existing repertoire

- **Current path:** Open PGN → Continue (the dialog shows even with nothing unsaved) → pick file →
  Load (the side is often already detected) = 4.
- **Reopen last:** Reopen → Continue → permission prompt → Load = 4.
- **Shortest reasonable path:** Open PGN → pick = 2. Reopen = 1 plus any browser permission
  prompt.
- **Live (run 5, phone):** File → Open PGN → Continue → pick → Load = 5, because Open PGN sits in
  the File menu at phone width (`batch-a084a5d5`).
- **Details:** F4.

### W3 — Explore and edit lines

- **Goal:** try a candidate move, see its evaluation, keep it or throw it away.
- **Current path:** turn evaluation on (1, every session) → drag the move (1; this writes it into
  the repertoire) → read the evaluation → to discard, press Ctrl/Cmd+Z. There is no on-screen
  control for this, so it cannot be done by touch.
- **Deleting an older side line:** the UI offers no control at all. It needs the chat or Strategic
  Fit.
- **Shortest reasonable path:** drag (1) → the evaluation shows automatically → Keep or Discard (1).
- **Details:** F2, F3, F7, F8.

### W4 — Close repertoire holes (Gaps)

- **Current path:** Scan (1) → wait → Fill this (1) → wait → pick a fill row (1) → Accept line (1)
  = 4 per gap.
- **What happens after accepting:** the filled gap stays in the list and nothing marks it done. The
  scan covers only 12 decision positions, so the rest of the tree needs another path (chat).
- **Shortest reasonable path:** Scan (1) → **Add best fill** on the row (1). The row clears itself,
  and **Scan next 12** continues the sweep.
- **Live (run 5, phone):** the Gaps section is in the Analysis tab, below the engine card and six
  other tool sections. Scanning 12 of 45 positions took 27.4 s. One fill took 3 clicks, then a
  scroll back down, because the staged card sits 412 px above the list. The filled row stayed
  listed. On a White repertoire the scan can say "No gaps found" while the main reply is
  unanswered.
- **Details:** F5, F24, F25.

### W5 — Strategic Fit review and train an exception

- **Current path:**
  1. Open Strategic Fit.
  2. First run only: choose a profile and click Use … profile (1–2).
  3. Analyze strategic fit.
  4. Review stage.
  5. Review finding.
  6. Radio button (optional) + Save resolution.
  7. Next result.

  Steps 5–7 are 2–4 clicks per finding. To train, add Create training item → Drill N positions,
  then for each position a move plus Next position.
- **Checking a line on the board:** Go to line closes the workspace. Coming back is Open Strategic
  Fit again, and on the phone also the Analysis tab and a scroll.
- **Live (run 5, phone, rich fixture):** steps 1–3 took 3 clicks, and the analysis finished in
  2.5 s. The Review queue held 10 findings, none with a resolution form (9 "needs more moves", 1
  transposition), so steps 5–7 could not be performed. The board button is labelled **Show on
  repertoire board**. It closed the workspace, and the way back was off-screen.
- **Details:** F6, F9, F10, F11, F26.

---

## Findings

### F1 — Game review and position comparison exist only through the paid chat assistant

- **Workflow:** Review a single game (accuracy, turning points, better moves). The same applies to
  comparing candidate moves, importing Lichess/Chess.com games, and checking the repertoire
  against your own game history.
- **Current behavior:** The panel-callable command set is limited to `audit_repertoire_moves`,
  `find_only_moves`, `find_structures`, `export_annotated_repertoire`, the two Strategic Fit
  exports, and `prep_vs_opponent` (`apps/ui/src/store/commands.ts:26-33`). The game commands
  `analyze_game`, `get_game_summary`, `export_annotated_pgn`, `batch_review`, `lichess_games`,
  `chesscom_games` and `repertoire_vs_history` (`application/browser-commands/game.ts:17-118`)
  and the position commands `compare_moves`, `tablebase_lookup` and `position_popularity`
  (`browser-commands/position.ts:44-86`) are registered but have no direct control. The project's
  own ux-review fixture states this: "The game review workflow is only reachable through the
  assistant's tool calls" (`apps/ui/test/fixtures/ux-review/game-review-provider.js:6`). Without a
  key, the chat shows a setup card (`components/ChatPanel.tsx:131-150`). All of these commands run
  locally in the browser engine; the LLM only chooses which one to call.
- **Friction:** Reviewing a game costs about 10 interactions plus typing the first time and 7 plus
  typing afterwards (W1). It requires a third-party API key and spends model tokens and round-trip
  latency. Success depends on the model picking the right tool. It is the highest-frequency chess
  task the app supports, yet the deterministic engine work sits behind a nondeterministic
  intermediary.
- **Recommendation:**
  - When the document is a single mainline, show a **Review game** button in the Analysis panel
    header. It calls `get_game_summary` + `analyze_game` directly and renders the existing
    `ToolResult` game-review cards inline.
  - When a position is selected, add **Compare moves** (current child moves plus engine top 3 →
    `compare_moves`).
  - Put **Import my games** (Lichess/Chess.com username → `lichess_games`/`chesscom_games` →
    `batch_review`) in the Prepare group.
  - Keep chat for open questions.
- **Expected improvement:** First-use review drops from about 10 interactions plus a key to 3
  (Open → pick → Review). It removes the credential dependency, token cost, and model latency, and
  makes results deterministic.
- **Live evidence (run 5):** Confirmed. With a repertoire loaded, the Analysis tab, the Moves tab
  and the File menu contain no control matching review game, game review, compare moves or import
  games (0 in each). The Chat tab offers three starters and "Set up the assistant … It needs an
  OpenRouter API key to run." (`batch-129228eb`).
- **Priority: High**

### F2 — Trying a move on the board permanently edits the repertoire

- **Workflow:** Explore a candidate ("what if I play …?") without committing it.
- **Current behavior:** Every legal drag calls `actions.play` (`components/Board.tsx:33-36`).
  `play` appends the move to the document tree and records a document change
  (`store/game.ts:149-164`). This marks the document dirty, increments "unsaved changes",
  triggers autosave, and invalidates any Strategic Fit report built on that revision. The app has
  no analysis, scratch, or sandbox mode.
- **Friction:** Each exploratory move needs a cleanup step: undo, or a deletion the UI does not
  offer (see F3). Forgotten explorations are saved into the user's repertoire file. The same drag
  means "try" and "commit", so users must manage document state by hand.
- **Recommendation:**
  - Make moves that leave the existing tree **provisional**: draw them on the board and in the move
    list as a ghost/preview (the `preview`/`previewedKeys` machinery in `store/suggestions.ts`
    already does this for staged lines).
  - Offer inline **Keep line / Discard** controls, and commit automatically on Save or when the
    user plays a further move with "auto-keep" on.
  - Alternatively, add an explicit **Explore** toggle next to the side selector.
- **Expected improvement:** One interaction to discard instead of one keyboard-only undo per
  exploratory move, and no accidental repertoire pollution. Strategic Fit and scan results stop
  going stale from mere exploration.
- **Live evidence (run 5):** Confirmed on the phone target. With evaluation on, tapping e2 then e4
  at the root of the 1.d4 fixture added 1.e4 as a tree item, moved the revision from 1 to 2, set
  `dirty`, and changed the status from "Saved" to "1 unsaved change". The only sign that the move is
  new is the engine row "Outside repertoire (out)" (`batch-0a4dd047`, `effect-0-after.png`).
- **Priority: High**

### F3 — Undo, delete-line and promote-variation have no visible controls

- **Workflow:** Fix a mis-drag, remove an unwanted side line, or promote a variation to the
  mainline.
- **Current behavior:** Undo/redo is registered only as the `z` shortcut (`App.tsx:81-88`).
  `canUndo`/`canRedo` are exported (`store/history.ts:47-53`) but no button uses them. Prune and
  reorder are available only through `applyEdit`, which the chat's staged edits and Strategic Fit
  call (`store/game.ts:174-203`). The move tree offers navigation and collapse only
  (`components/MoveTree.tsx:232-234`, `297-312`). The default review device is an iPhone, which has
  no keyboard.
- **Friction:** On touch devices a mis-dragged move cannot be taken back at all. On desktop,
  deleting a side line or reordering variations requires writing a chat request or running a
  Strategic Fit change set, which is a multi-screen detour for a one-click edit.
- **Recommendation:**
  - Add Undo/Redo buttons, enabled from `canUndo()`/`canRedo()`, next to the move list.
  - Add a per-move context action (long-press or right-click, plus a small "⋯" on the current move)
    with **Delete from here**, **Promote variation**, and **Make mainline**. These call the existing
    `applyEdit("prune" | "reorder")`, which already records history for undo.
- **Expected improvement:** Deleting or promoting a line becomes 2 interactions instead of a chat
  round trip (type + send + accept, at least 3 plus a key) or impossible. Undo on touch goes from
  impossible to 1 tap.
- **Live evidence (run 5):** Confirmed. `.app-main` has 0 visible buttons matching undo, redo, take
  back, delete, remove line or promote. The try-move from F2 came back out only through Ctrl/Cmd+Z
  (revision 2→3, status back to "Saved"). The default review device is a touch phone with no
  keyboard, so on it there is no way back at all (`batch-0a4dd047`).
- **Priority: High**

### F4 — Opening, reopening, or starting a document always passes through two modal dialogs

- **Workflow:** Open a PGN, reopen the last file, or start a new repertoire.
- **Current behavior:** `openFile`, `reopenLast`, and the New actions call
  `requestDocumentClose` unconditionally (`store/files.ts:111-118`, `187-189`, `266-281`;
  `TopBar.tsx:66-76`). The "Replace current repertoire?" dialog appears even when there are no
  unexported changes. In that state its only content is "There are no unexported changes." with
  Continue (`DocumentCloseDialog.tsx:58-84`). It also appears on an empty board. Before replacing,
  a recoverable `before-replace` snapshot is captured anyway (`files.ts:131`). After the file is
  picked, the colour dialog always blocks loading behind an extra **Load** click, even when the side
  was detected from the headers (`ColorPickerModal.tsx:10`, `43-56`; `files.ts:146-151`).
- **Friction:** 4 interactions where 2 suffice. The clean-state confirmation guards nothing,
  because the snapshot already makes the replace recoverable. The colour question is asked even
  when it has already been answered from the file.
- **Recommendation:**
  - Skip the replace dialog when `dirty()` is false. Keep it, unchanged, when there are unexported
    changes.
  - When `detectedColor` is non-null, load straight away and show a non-blocking toast: "Loaded as
    White · Change". Show the colour dialog only when the side cannot be detected.
  - Keep the top-bar side selector as the correction path.
- **Expected improvement:** Open goes from 4 interactions to 2, Reopen from 4 to 1–2, and New on a
  clean document from 2 to 1. The recovery guarantee is unchanged.
- **Live evidence (run 5):** Confirmed, with one more click on the phone. Open PGN sits inside the
  File menu there, so opening a PGN from a blank draft took 5 interactions: File → Open PGN →
  Continue → pick → Load. The replace dialog appeared on an untouched "Untitled repertoire · Draft".
  It said "There are no unexported changes." and still showed a red Continue and a "Recover an
  earlier repertoire" button. There is nothing to recover, because empty trees are never snapshotted
  (`store/persist.ts:179`). The colour dialog said "Detected from file headers" and still required
  Load (`batch-a084a5d5`, `effect-0-after.png`). With unsaved changes the dialog correctly switches
  to Keep working / Save to file first / Discard and open PGN (`batch-21cb6177`).
- **Priority: High**

### F5 — Gap scanning covers 12 positions, cannot continue, and leaves fixed gaps listed

- **Workflow:** Find and fill unanswered opponent replies across the whole repertoire.
- **Current behavior:**
  - `scanGaps` is hard-limited to `MAX_POSITIONS = 12` decision nodes and `LIMIT = 12` gaps
    (`store/gaps.ts:28-33`). The panel says so (`RepertoirePanel.tsx:668`, `724-748`) but offers no
    way to scan the next slice.
  - Filling a gap takes Fill this (1) → wait → choose a fill row (1), which stages a preview at the
    top of the panel → Accept line (1) (`RepertoirePanel.tsx:775-802`, `338-352`, `379-408`;
    `store/suggestions.ts:222-238`).
  - Nothing in `gaps.ts` reacts to document edits, so the filled gap stays in the list with the
    same Fill button. Its stored index path can also point at a different node after the tree
    changes.
- **Friction:** A 265-position repertoire, the case the scope note was written for, cannot be
  swept from the panel. Each gap costs 3 clicks plus 2 waits. After each fill the user must work
  out by hand which rows are still open, or rescan and lose their place.
- **Recommendation:**
  - Add **Scan next 12**, or a cursor-based continuation (the Node tools already paginate with
    `leaf_start`/`next_leaf`).
  - Add a one-click **Add best fill** on each gap row that stages and accepts `bestEval` in one
    step, and keep the two-option view behind "Choose fill…".
  - After an accept, remove or mark the filled gap and re-resolve the remaining paths by SAN (each
    gap already carries `sanPath`).
- **Expected improvement:** 1 click per gap instead of 3. The whole tree can be covered without
  leaving the panel, and there is no manual bookkeeping of which gaps are done.
- **Live evidence (run 5):** Confirmed. On the rich fixture the scan took 27.4 s and reported "No
  gaps found. Every checked reply is answered. Checked the first 12 of 45 positions; the rest were
  not scanned." It offered 0 controls to continue (`batch-568baf2f`, `08-gaps-result.png`). The bold
  headline reads as an all-clear even though 33 positions were never checked. On a thin Black
  repertoire with 6 gaps, Fill this → pick a row → Accept line took 3 clicks and 5.4 s. After Accept
  the list still had 6 rows, and the filled `· d4` row still offered Fill this (`batch-beca9c51`,
  `batch-d7b722ba`). See also F24 and F25.
- **Priority: High**

### F24 — "No gaps found" hides unanswered replies below the severity threshold

- **Workflow:** Close repertoire holes (Gaps), especially in a White repertoire.
- **Current behavior:** A missing reply is reported only if it is within 80 cp of the opponent's
  best move and scores at least +25 cp for the opponent (`packages/chess-tools/src/gaps.ts:59-69`).
  Anything weaker becomes `low`, and the panel asks for `min_severity: "medium"`
  (`store/gaps.ts:29`, `192`), so it is dropped without trace. In a White repertoire, Black's
  normal replies are usually slightly worse for Black, so they fall under the floor.
- **Live evidence (run 5):** `thin-white.pgn` (`1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5`) answers only
  1…d5. The scan took 8.1 s and showed "✓ No gaps found. Every checked reply is answered. Checked
  all 3 positions." with 0 gap rows and 0 covered rows, although 1…Nf6 is unanswered
  (`batch-d3b8d6ed`, `11-gaps-thin.png`). The same scan on a thin Black repertoire
  (`1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6`) returned 6 medium gaps: 1.d4, 1.Nf3, 2.Nc3 and 3.h3
  among them (`batch-beca9c51`). The effect depends on the side.
- **Friction:** The tool says every checked reply is answered when the most common one is not, so
  the user stops looking. The missing main replies can then only be found by walking the tree
  position by position with the engine on.
- **Recommendation:**
  - Word the result by what was measured, for example "No strong unanswered replies · 2 playable
    replies not prepared", with those replies listed under a disclosure rather than dropped.
  - Consider measuring severity against the prepared reply's evaluation instead of an absolute
    +25 cp floor, so sound but unprepared replies surface for either colour. This changes the
    shared `find_repertoire_gaps` contract, so it needs its own design note.
  - Keep the scope sentence from F5.
- **Expected improvement:** The same 1 click answers "what am I missing?" for both colours. A hole
  the size of 1…Nf6 is found without a manual tree walk.
- **Priority: High**

### F6 — Training and recall are buried inside one finding at a time

- **Workflow:** Practise prepared moves ("drill my repertoire", "drill what I got wrong").
- **Current behavior:**
  - The only in-app drill runner sits inside Strategic Fit → Review → a finding → Branch →
    "Decide" (`StrategicFitWorkspace.tsx:806-836`, `TrainException.tsx`).
  - Per finding: Create training item (1) (`TrainException.tsx:134-136`), then a separate
    **Drill N positions** button (1) (`:163-178`).
  - Per position: a move, then **Next position** (1), even after a correct answer
    (`DrillRunner.tsx:115-123`).
  - There is no list of all training items and no entry from the main workspace.
  - The "Only moves & drills" section finds the critical positions but can only export an external
    CSV deck (`RepertoirePanel.tsx:486-513`). It cannot drill them in the app.
- **Friction:** Drilling 5 findings means about 5 × (navigate to the finding, 2–3 clicks,
  create, start) plus N "Next" taps. There is no way to resume practice across items. The positions
  the app already calls most worth memorising (only moves) cannot be drilled in the app.
- **Recommendation:**
  - Add a top-level **Practice** entry: a phone tab or a top-bar button. It runs `DrillRunner` over
    all saved training items and, optionally, the latest only-move findings, weakest first.
  - In `TrainException`, make Create training item start the drill immediately.
  - Advance automatically about 800 ms after a correct recall. Keep **Next** only after a miss, so
    the user can read the correction.
- **Expected improvement:** Starting practice goes from about 6 interactions per finding to 1 for
  all items, and per-position overhead falls from 2 interactions to 1 on correct answers.
  Only-move findings become drillable in the app.
- **Priority: High**

### F7 — Engine evaluation starts off every session

- **Workflow:** See the evaluation and best lines while browsing the repertoire.
- **Current behavior:** `evalEnabled` is a plain in-memory `createSignal(false)`
  (`store/analysis.ts:55`) with no persistence, while the cloud-evaluation setting beside it is
  persisted (`store/settings.ts:59-60`). Every launch shows "off", and the user must press Turn on evaluation
  or the eval bar (`AnalysisPanel.tsx:57-61`, `EvalBar.tsx:38-45`).
- **Friction:** One wasted interaction on every session. On the phone the Analysis tab must be
  selected first, which makes 2. The preference is re-entered forever.
- **Recommendation:** Persist `evalEnabled` in `localStorage` next to the cloud-evaluation setting.
  Consider defaulting it to on for desktop viewports.
- **Expected improvement:** Removes 1–2 interactions per session. Evaluation is visible on the
  first position the user opens.
- **Live evidence (run 5):** Confirmed. Evaluation was turned on (3 engine lines showed). After a
  `reload`, which keeps storage, the panel again read "Engine evaluation is off." (`batch-d1c12045`,
  `batch-c02872a3`).
- **Priority: Medium**

### F8 — Engine lines and extension candidates cannot be played or added directly

- **Workflow:** Add the engine's suggestion (or an "Extend here" candidate) to the repertoire.
- **Current behavior:** Engine lines render as static `div.line` rows with no handler
  (`AnalysisPanel.tsx:70-86`). To use one, the user reads the SAN and drags the same move on the
  board. "Extend here" rows stage a preview, and **Accept line** sits at the top of the panel
  (`RepertoirePanel.tsx:1129-1146`, `379-408`), so each extension is 2 clicks plus a scroll back
  up.
- **Friction:** Read-then-reproduce on the board is error-prone on a phone-sized board and costs a
  precise drag. Extension acceptance needs the user to move attention to a card at the other end of
  the panel.
- **Recommendation:** Make each engine line a button that previews the move (arrow plus ghost node)
  with inline **Add** and **Play**. Give Extend rows an inline **Add** that accepts directly, and
  keep row-click for preview.
- **Expected improvement:** Adding an engine or extension move becomes 1 click instead of a drag or
  2 clicks plus scroll. It also removes transcription errors.
- **Live evidence (run 5):** Engine lines confirmed; extension candidates not exercised. The three
  engine rows ("e4 +0.47", "d4 +0.37", "Nf3 +0.29") contain 0 buttons or `role=button` elements
  (`batch-0a4dd047`).
- **Priority: Medium**

### F21 — Audit, Only-moves and Structure results outlive the document they describe

- **Workflow:** Run a prescribed-move audit, only-move scan or structure search, fix what it
  reports, then act on the rest of the list. The same applies after opening a different PGN.
- **Current behavior:** `CommandState` holds `status`, `result`, `error`, `progress` and
  `completedAt`, and no document ID or revision (`store/commands.ts:35-41`). The states live in a
  module-level signal (`:44-52`). Only `executeCommand`, `cancelCommand` and a test seam write to
  it, so neither an edit nor a document replacement clears or marks it. The collapsed section
  summary shows age only, as in "4 results · 3m ago" (`RepertoirePanel.tsx:118-125`). Result rows
  navigate by SAN path through `indexPathOfSan`, and when the line no longer exists they do nothing
  (`:302-305`). Gap rows navigate by stored index path (`:327-330`), which can point at a different
  node once the tree has changed (see F5).
- **Friction:** After each edit the user must remember which results still apply and re-run the
  scan to be sure. That costs 1 click plus the scan time, and the scan covers up to 60 engine
  positions for only moves. After opening another repertoire, the previous file's findings are
  still listed under the new file's name. A click on a row whose line was removed does nothing and
  gives no reason, which reads as a broken control.
- **Recommendation:**
  - Stamp each command result with the `documentId` and revision it ran against.
  - Clear results when the document ID changes.
  - When only the revision has changed, label the section "Out of date — re-run" beside the count,
    with a one-click **Re-run** using that command's last arguments. `lastDirectCommandRequest()`
    already records the most recent request; this needs one entry per command.
  - Disable or strike through rows whose SAN path no longer resolves, rather than leaving them
    clickable with no effect.
- **Expected improvement:** The user no longer tracks by hand which results apply. Re-running is 1
  click from the section summary, without re-entering depth or structure. There are no dead clicks,
  and no findings from another file appear.
- **Live evidence (run 5):** Confirmed. A Structure search result ("1 result · just now") survived a
  tree edit (revision 1→2) and survived replacing the document with `other.pgn` (revision 3).
  Clicking the leftover row changed nothing: path `[]` before and after, same document
  (`batch-0c63dd6c`). The typed query and its note ("0 results · 2m ago") were still showing after
  two more document switches (`batch-d7b722ba`, `effect-0-after.png`).
- **Priority: Medium**

### F25 — On the phone every gap fill jumps away from the Gaps list

- **Workflow:** Fill several gaps in a row on the phone.
- **Current behavior:** Choosing a fill row stages the line in a card at the top of the Repertoire
  panel. The app scrolls that card into view so Accept line can be reached
  (`RepertoirePanel.tsx:379-393`).
- **Live evidence (run 5):** On `iPhone 13 Mini` the Gaps section sits 412 px, two-thirds of the
  629 px viewport, below that card. In between are Prescribed-move audit, Only moves, Structure
  search, Opponent preparation, Annotated repertoire and Strategic Fit portability
  (`batch-912cc2a9`). After Accept line the viewport stays at the top: `effect-0-after.png` of
  `batch-d7b722ba` shows Structure search, not Gaps. The board, now on the staged line, is above
  the fold too.
- **Friction:** Each gap costs an automatic jump up and a manual scroll back down to find the next
  row. The user decides without seeing the line on the board. Combined with F5, where filled rows
  stay listed, the user also has to remember which rows are done.
- **Recommendation:** On the phone, show the staged-line card as a sticky bottom sheet over the
  panel, or inline under the row that produced it. After Accept, keep the Gaps row in view and
  mark it done (F5).
- **Expected improvement:** No scrolling per gap. A 6-gap sweep saves about 12 scroll gestures and
  keeps the user's place in the list.
- **Priority: Medium**

### F9 — Strategic Fit first run stops after the profile choice

- **Workflow:** Get a first Strategic Fit assessment.
- **Current behavior:** Open Strategic Fit (1) → pick a profile (0–1) → **Use Balanced profile**
  (1). The footer then says the choice "will not … start the review"
  (`ProfileSetup.tsx:150-158`), and `onComplete` only focuses the **Analyze strategic fit** button
  (`StrategicFitWorkspace.tsx:306-310`, `847`) → Analyze (1). The base scan is engine-free and does
  not edit the repertoire (`ProfileSetup.tsx:176-179`).
- **Friction:** An extra confirm-then-start step for an action that is cheap, cancellable and
  non-mutating. Users coming from the Repertoire panel asked to open the analysis and get a second
  gate.
- **Recommendation:** After **Use … profile** or **Skip for now**, start `analyzeStrategicFit()`
  automatically; the lifecycle already shows **Cancel analysis**. Once a profile exists, start
  analysis on open when there is no current report for this revision (status `idle` or `stale`).
- **Expected improvement:** First assessment takes 2–3 interactions instead of 3–4. Later opens of
  a changed repertoire take 1 instead of 2.
- **Live evidence (run 5):** Confirmed. Open Strategic Fit → Use Balanced profile left the lifecycle
  at `data-analysis-state="idle"`, and it took a third click, Analyze, to start. The analysis then
  finished in 2.5 s on the 12-line fixture, so the separate start step saves no waiting
  (`batch-eb333ece`).
- **Priority: Medium**

### F10 — "Go to line" from Strategic Fit closes the workspace

- **Workflow:** Look at a finding's line on the real board, then continue reviewing findings.
- **Current behavior:** `onGoToLine` calls `actions.goto(target)` and then `close()`
  (`StrategicFitWorkspace.tsx:781-796`). The workspace is a full modal dialog, so the board is
  hidden while the workspace is open. To continue, the user must press **Open Strategic Fit** again
  in the Repertoire panel. On the phone that also means selecting the Analysis tab and scrolling to
  the entry (`RepertoirePanel.tsx:358-378`; `App.tsx:199-208`). The stage and finding are kept in
  memory (`store/ui.ts:27-29`), so the user does land back on the same finding.
- **Friction:** 2 extra interactions per inspected line, or 3 or more on the phone. The user
  toggles between two screens for what is one comparison task.
- **Recommendation:** Keep the workspace open. On desktop, render it beside the board (non-modal
  side sheet), or show a floating **Back to Strategic Fit** chip after Go to line that reopens the
  workspace on the same finding in one tap. The existing ReadOnlyBoard/ComparisonBoards components
  could show the line inside the Branch pane so leaving is optional.
- **Expected improvement:** The round trip goes from 3–4 interactions to 1–2, with no hunting for
  the entry point on the phone.
- **Live evidence (run 5):** Confirmed. The live button is **Show on repertoire board**, inside the
  Branch pane. One tap moved the board to the finding's line (path `[]` → 13 plies deep) and closed
  the workspace. The Open Strategic Fit entry was then outside the viewport, below the engine card
  (`inViewport: false`; `06-after-board-jump.png`), so getting back takes a scroll and a tap.
  Reopening restored the same stage (`evidence`) and the same finding (`batch-c11ed687`).
- **Priority: Medium**

### F11 — Resolving findings is a form with no automatic advance

- **Workflow:** Triage a queue of findings (keep / defer / exclude).
- **Current behavior:** For each finding the user chooses a radio (keep is preselected, so 0–1
  clicks; two options sit behind a `<details>`, so +1 for those), optionally types, and presses
  **Save resolution** (1) (`ResolutionActions.tsx:181-259`). The finding leaves the queue, a status
  line says what was recorded, and moving on is a separate **Next result** press (1)
  (`StrategicFitWorkspace.tsx:723-741`, `756-765`; confirmed by `strategic-fit-journey.spec.ts:58-72`).
- **Friction:** 2–4 clicks per finding for decisions that are usually one-word. The queue does not
  advance after a decision.
- **Recommendation:** Replace radio + Save with direct action buttons (**Keep**, **Defer**,
  **Exclude**, **Invalid comparison**) that save immediately; the optional note/reason stays as an
  expandable field. After a successful save, select the next unresolved finding automatically
  (the "Next result" logic already computes `remainingUnresolved()[0]`) and show "Recorded · Undo"
  in the status line.
- **Expected improvement:** 1 click per finding instead of 2–4. A 10-finding triage drops from
  about 30 interactions to about 10.
- **Live evidence (run 5):** Not reachable on this fixture. The rich fixture's 10 findings are 9
  "This line ends before there is enough to compare" and 1 "These move orders reach the same
  position". Neither kind renders the resolution form (`StrategicFitWorkspace.tsx:798-806`), so
  **Save resolution** never appeared (`batch-c11ed687`, `batch-2359603f`, `batch-706cad8b`). The
  counts above therefore remain a code trace. F26 describes what the queue actually offered.
- **Priority: Medium**

### F26 — Strategic Fit's Review queue is full of findings the user can't act on there

- **Workflow:** Work through the Strategic Fit Review queue.
- **Current behavior:** Findings of the "gap" story kind and transpositions render no resolution
  form (`StrategicFitWorkspace.tsx:798-806`). A "Needs more moves" card gives advice but offers only
  Review finding / Continue review, which opens the Branch pane.
- **Live evidence (run 5):** On the 12-line rich fixture the stage tab read **Review 10**. 9 of the
  10 findings were "This line ends before there is enough to compare" and 1 was "These move orders
  reach the same position". The queue is paged 6 + 4 behind Previous/Next findings
  (`batch-706cad8b`, `06-review-queue.png`). Every "Needs more moves" card says "What to do: Add more
  moves to this line, then run the review again." Walking page 1 for something to decide took 11
  clicks and found nothing (`batch-c11ed687`). Acting on one card means: open it → scroll → Show on
  repertoire board, which closes the workspace (F10) → extend the line in the Analysis tab → reopen →
  Analyze again.
- **Friction:** The badge suggests 10 decisions and there are none. The same advice repeats 9 times
  across two pages, and each attempt to act costs the F10 round trip plus a re-analysis.
- **Recommendation:**
  - Collapse "Needs more moves" findings into one row ("9 lines are too short to compare") that
    lists the lines. Give each one an **Extend on board** action that jumps there and runs Extend
    here for that leaf.
  - Count only decidable findings in the badge, for example "Review 0 · 9 too short".
  - Show transpositions as information, not queue items.
- **Expected improvement:** The queue shows only what needs a decision. The short lines become one
  checklist with a direct action, instead of 9 identical cards across 2 pages.
- **Priority: Medium**

### F12 — On the default WebKit target every Save downloads a new file and raises a notice

- **Workflow:** Save repertoire changes repeatedly while working.
- **Current behavior:** Without `showSaveFilePicker` (WebKit and Firefox; the project's default
  review device is `webkit` / `iPhone 13 Mini`), `saveFile` downloads a fresh copy every time. It
  then sets a persistent notice, "Downloaded … This browser cannot re-link that file for future
  saves.", which stays until the user dismisses it with × (`store/files.ts:218-230`,
  `TopBar.tsx:30-42`). The notice repeats on every save. The same applies to the unsaved-changes
  path "Save to file first" (`files.ts:242-259`).
- **Friction:** 2 interactions per save (Save + dismiss) and a growing pile of `repertoire (n).pgn`
  downloads the user must reconcile by hand. The same explanation is repeated each time.
- **Recommendation:** Show the "cannot re-link" explanation once per session as a transient toast
  that dismisses itself. On browsers without file handles, present autosave as the primary
  persistence ("Saved in this browser") and relabel the button **Export PGN**, so it is clear that
  each press creates a copy.
- **Expected improvement:** 1 interaction per save instead of 2, and less confusion from duplicate
  files.
- **Live evidence (run 5):** Confirmed. Two Save presses with no change between them downloaded
  `rich-repertoire.pgn` twice and raised "Downloaded rich-repertoire.pgn. This browser cannot
  re-link that file for future saves." That notice was still showing after the user switched to
  another document (`thin-black.pgn`) (`batch-4157da9a`, `20-recover-list.png`).
- **Priority: Medium**

### F13 — "Create drill deck" re-runs the whole only-move scan

- **Workflow:** Find only moves, then export them as a drill deck.
- **Current behavior:** Find (1) runs `find_only_moves` over up to 60 positions. **Create drill
  deck** (1) runs `find_only_moves` again with `export_deck: true` and the same depth
  (`RepertoirePanel.tsx:486-513`), which repeats the engine work already shown on screen.
- **Friction:** The user waits a second time for the same analysis, which takes up to 60 engine
  positions.
- **Recommendation:** Build the deck from the retained `find_only_moves` result, or pass the result
  to the export path. Alternatively, offer "Find and create deck" as one action.
- **Expected improvement:** Deck export becomes close to instant instead of a second full scan, and
  task time for this workflow roughly halves.
- **Priority: Medium**

### F14 — Exports use two different interaction patterns

- **Workflow:** Produce and download an artifact.
- **Current behavior:** Annotated repertoire and drill deck are one-click (generate and download)
  (`RepertoirePanel.tsx:231-239`, `498-505`; the WP-029 AC-3 comment explains why a second button was
  removed). Strategic Fit portability still needs **Generate metadata JSON** → **Save metadata JSON**
  and **Generate intent PGN** → **Save intent PGN** (`StrategicFitTransfer.tsx:72-122`). Drill JSON
  in `TrainException` is also a separate save.
- **Friction:** Two clicks where the rest of the app uses one. The user must notice a new button
  appearing to finish a job they already asked for, which is the exact problem WP-029 fixed
  elsewhere.
- **Recommendation:** Apply the same generate-then-download-in-one-click pattern, with the existing
  `ArtifactSaveStatus` and a **Download again** retry, to both portability exports.
- **Expected improvement:** 1 click per export instead of 2, and one consistent pattern.
- **Priority: Medium**

### F15 — Configuration is split across three unrelated places

- **Workflow:** Set up the app: engine, depth, cloud evaluation, assistant key/model, explorer
  token, chat mode.
- **Current behavior:**
  - Engine on/off, depth and cloud evaluation live in a collapsed `<details>` inside the Analysis
    panel header (`AnalysisSettings.tsx`).
  - API key, model, Lichess token, technical details and recovery live in the Settings drawer
    (`SettingsDrawer.tsx`).
  - Chat workflow mode is a select in the chat header (`ChatPanel.tsx:81-90`).
  - The explorer-dependent tools say they need a token but give no link to it.
- **Friction:** Users hunt across panels. On the phone that means switching tabs, expanding a
  disclosure, or opening a drawer depending on the setting, which adds 1–3 navigation steps per
  setting.
- **Recommendation:** Make the Settings drawer the single home, with an **Engine** section for
  toggle, depth and cloud. Keep the analysis-header disclosure as a shortcut that opens the drawer
  at that section (the `setSettingsFocusTarget` mechanism already exists). Anywhere a missing
  credential blocks a tool, deep-link to the right field, as chat already does for the API key.
- **Expected improvement:** A known location for every setting and 1–2 fewer navigation steps per
  change.
- **Priority: Medium**

### F16 — Chat starters fill the box but don't send, and assume White

- **Workflow:** Ask a quick question about the position.
- **Current behavior:** Clicking a starter only calls `setInput(starter)`
  (`ChatPanel.tsx:116-127`), even when a key is configured, so Send is a second click. The first
  starter is hard-coded "What is the plan for White in this position?" (`content/chat.ts:11`),
  regardless of the repertoire side. There is no starter for game review, although that is only
  reachable through chat (F1).
- **Friction:** 2 clicks where 1 suffices once a key exists. Black repertoires must edit the text.
- **Recommendation:** With a key configured, starters send immediately; without one, they keep
  today's fill-and-wait behaviour. Interpolate the prepared side, and add "Review this game" when the
  document is a single mainline.
- **Expected improvement:** 1 click instead of 2, and no editing for Black users.
- **Live evidence (run 5):** Partly confirmed. With the Black repertoire `thin-black.pgn` loaded,
  the first starter still read "What is the plan for White in this position?" (`batch-129228eb`).
  Whether a starter sends once a key exists needs an OpenRouter key and was not exercised.
- **Priority: Low**

### F17 — Opponent username and structure search are forgotten

- **Workflow:** Re-run opponent prep or a structure search across sessions.
- **Current behavior:** `opponent` and `structure` are component-local signals
  (`RepertoirePanel.tsx:86-87`) and are lost on reload. The structure search is free text with no
  list of known structure names (`:528-535`). `searchStructures` accepts only an exact,
  case-insensitive match of the full class name (`packages/chess-tools/src/structure.ts:654-661`).
  The classes include "King's Indian", "Grünfeld Centre" and "Nimzo-Grünfeld"
  (`structure.ts:441-455`). So "Kings Indian", "Grunfeld" or "Carlsbad structure" fail. The live
  run showed that they fail with a visible "unknown structure" error listing the valid names, not
  with an empty result.
- **Friction:** The username is retyped every session. Structure names must match down to the
  apostrophe and the umlaut. A near-miss fails with a list of the valid names, so the user retypes
  or copies one from the error, and each retry is a separate search.
- **Recommendation:**
  - Remember the last few opponent usernames in a `datalist`.
  - Turn the structure input into a pick-list of the classes `classifyStructure` can return.
  - Normalise the query so that "grunfeld" or "kings indian" still match, by folding accents and
    apostrophes.
  - Offer the closest valid name in the error ("Did you mean Grünfeld Centre?") as a one-tap
    retry. The error already distinguishes an unknown name from "0 results".
- **Expected improvement:** Typing drops to one pick, and there are no failed searches from unknown
  or misspelt names.
- **Live evidence (run 5):** Refined, and partly refuted. A near-miss is not silent. "Grunfeld",
  "grunfeld centre" and "Kings Indian" each show a red **unknown structure** panel listing all 19
  valid names (`09-structure-near-miss.png`). Exact names work: "Grünfeld Centre" returned 1 row and
  "King's Indian" returned "0 results" (`batch-0c63dd6c`, `batch-1930b8b4`). Keeping the query
  across a reload was not exercised.
- **Priority: Low**

### F18 — Chat suggestions are accepted one at a time

- **Workflow:** Accept a batch of lines the assistant proposed.
- **Current behavior:** Each card has Go to line / Accept / Reject; there is **Clear all** but no
  **Accept all** (`AnalysisPanel.tsx:94-173`).
- **Friction:** N clicks for N proposed lines, even when the user has already reviewed them in
  chat.
- **Recommendation:** Add **Accept all**, applied as one undoable history entry.
- **Expected improvement:** 1 click instead of N.
- **Priority: Low**

### F19 — "Extend here" is disabled off-turn, and its style option is hidden

- **Workflow:** Ask for an extension of the current line.
- **Current behavior:** **Suggest** is disabled unless it is the user's turn (`usersTurn`,
  `RepertoirePanel.tsx:73`, `1074-1085`). The explanation is only visible when the section is open
  (`:1120-1122`). The low-mem/sharp style select is in the section body (`:1106-1119`), so changing
  it requires opening the section first.
- **Friction:** A disabled button with no visible reason while collapsed. The user must navigate one
  ply back or forward and then open the section to change the style: about 2–3 extra interactions.
- **Recommendation:** When it is the opponent's turn, suggest from the position after the
  repertoire's main reply, and say so ("from after 3…Nf6"). Otherwise make the button open the
  section and show why. Remember the chosen style.
- **Expected improvement:** 2–3 fewer interactions, and no dead click.
- **Priority: Low**

### F20 — "Save status" opens a dialog to repeat the status line

- **Workflow:** Check whether work is saved.
- **Current behavior:** File → Save status opens a modal (`DocumentMenu.tsx:47-52`,
  `DocumentStatus.tsx:87-98`) whose text is the same `detail()` already in the status indicator's
  title. Closing it takes a separate button.
- **Friction:** 3 interactions (File, Save status, Close) to read one sentence.
- **Recommendation:** Make the top-bar status indicator itself show the detail on tap (a popover)
  and drop the menu item. Include a **Save now** action in it when there are unsaved changes.
- **Expected improvement:** 1 tap instead of 3.
- **Live evidence (run 5):** Confirmed. File → Save status opened a dialog reading "Stored in this
  browser · autosaved 02:51 PM. No changes to export to rich-repertoire.pgn.", then one sentence of
  explanation and a Close button (`batch-4157da9a`).
- **Priority: Low**

### F22 — Recovery snapshots don't say why they were taken

- **Workflow:** Get back the repertoire you had before opening another file, or before a bad
  session of edits.
- **Current behavior:** Every snapshot is stored with a `reason` of `before-replace`, `idle` or
  `manual` (`store/persist.ts:59`, `68`, `76`). The Recover dialog (File → Recover, the replace
  dialog, or Settings) lists each one by file name, time, size, move count and line count, and never
  shows the reason (`components/RecoverDialog.tsx:89-96`). Restoring one first takes a `manual`
  snapshot of the current document (`persist.ts:259-265`), which adds another row that looks the
  same.
- **Friction:** The row the user usually wants, "just before I replaced it", looks the same as the
  idle autosaves around it. It can only be found by clicking through rows and reading the PGN
  preview, one click per row checked. Each restore adds another similar row, so the next search
  takes longer.
- **Recommendation:** Label each row with its reason ("Before opening *other.pgn*", "Autosave",
  "Before restore"). Group the rows by reason, or put the latest `before-replace` snapshot at the
  top and select it. The replace dialog's link to Recover can open with that row already selected.
- **Expected improvement:** The common recovery takes 1 click instead of previewing rows one by
  one. File → Recover → Restore becomes 3 clicks with no guessing.
- **Live evidence (run 5):** Confirmed. After a replace, the Recover row read "rich-repertoire.pgn ·
  9/29/2026, 2:52:28 PM · 1 KB · 124 moves · 12 lines", with no reason shown. The preview underneath
  is the raw PGN text, headers included, rather than a board (`batch-3646cfe2`,
  `20-recover-list.png`).
- **Priority: Low**

### F23 — Replacement Lab asks you to confirm a pivot it already chose

- **Workflow:** Generate replacement candidates for a finding (Review → finding → **Open
  Replacement Lab**).
- **Current behavior:** When the pivot resolver returns a single `selected` pivot, the lab opens
  with that pivot already selected and status `pivot-ready` (`store/strategic-fit-replacement.ts:388-402`).
  The legend reads "Confirm pivot" over a single radio button. **Generate and stage previews**
  stays disabled until **Confirm semantic pivot** is pressed (`ReplacementLab.tsx:344-352`,
  `433-439`; `confirmPivot` at `strategic-fit-replacement.ts:431-439`). Generation only stages
  previews and does not change the repertoire. Nothing becomes durable before the later explicit
  acceptance.
- **Friction:** An extra confirmation click on every lab run for a choice that has only one option
  and that the app has already made. The user has to notice that the Generate button is disabled,
  scroll back up to find the reason, and then return.
- **Recommendation:** When there is a single pivot, drop the separate confirmation and label the
  primary button with the pivot ("Generate from 7.Bg3"). Keep the explicit confirmation only for
  `alternatives-required`, where the user really chooses. Acceptance of a staged replacement stays
  the durable gate, as the staging invariant requires.
- **Expected improvement:** 1 click instead of 2 to start a generation in the common single-pivot
  case, and no dead Generate button.
- **Priority: Low**

---

## Still unverified

- **Code-trace findings not exercised live:** F6 (training/drills), F11's resolution form (no
  resolvable finding on the fixture), F13, F14, F15, F19, F23. F18 and the send half of F16 need an
  OpenRouter key; the default fixtures do not configure one. F4's Reopen path needs a stored file
  handle, which the picker stub does not create.
- **Replacement Lab after generation, and cohort editing.** Candidate review, the Pareto view,
  acceptance, and `CohortEditor`'s preview → confirm step were not traced from source or live.
- **Recover dialog with many snapshots.** The live run produced one row (F22). How the list reads
  with many rows is still open.
- **Desktop and tablet widths.** Run 5 used only the default phone device. Click counts that
  depend on the File menu (F4) or on scroll distance (F10, F25) differ at wider tiers.

Resolved by run 5: the phone Analysis-tab depth. Gaps is 412 px below the staged-line card
(`batch-912cc2a9`), and Open Strategic Fit is off-screen after a board jump (`batch-c11ed687`).

## Replaying the audit

The batches are in the git-ignored `.web-harness/batches/`. Batches 01–07 were written in runs 1–4
and adapted to the phone layout in run 5; 08–21 were added in run 5. Each drives visible controls
and returns click counts plus before/after document state. They are local to the audit worktree
and deliberately not committed (they are exploration, not tests); the Live evidence bullets record
what each one asserted. Promote a batch with `web-harness promote` before relying on it as coverage.

```sh
free -h && pnpm exec web-harness doctor
pnpm exec web-harness start --fixture blank
pnpm exec web-harness run .web-harness/batches/01-open-pgn.js        # F4 (rich fixture via picker stub)
pnpm exec web-harness run .web-harness/batches/02-explore-move.js    # F2 F3 F7 F8
pnpm exec web-harness run .web-harness/batches/03-gaps-scan.js       # F5 scope
pnpm exec web-harness run .web-harness/batches/08-gaps-view.js       # F5 screenshot
pnpm exec web-harness reset
pnpm exec web-harness run .web-harness/batches/01-open-pgn.js
pnpm exec web-harness run .web-harness/batches/07-stale-results.js   # F17 F21
pnpm exec web-harness run .web-harness/batches/09-structure-miss.js  # F17 error panel
pnpm exec web-harness run .web-harness/batches/10-open-gappy.js      # thin White repertoire
pnpm exec web-harness run .web-harness/batches/03-gaps-scan.js       # F24: 0 gaps
pnpm exec web-harness run .web-harness/batches/11-gaps-text.js
pnpm exec web-harness run .web-harness/batches/12-open-thin-black.js # thin Black repertoire
pnpm exec web-harness run .web-harness/batches/03-gaps-scan.js       # 6 gaps
pnpm exec web-harness run .web-harness/batches/04-gaps-fill.js       # F5 filled row stays
pnpm exec web-harness run .web-harness/batches/13-measure-gaps-distance.js  # F25
pnpm exec web-harness reset
pnpm exec web-harness run .web-harness/batches/01-open-pgn.js
pnpm exec web-harness run .web-harness/batches/05-sf-first-run.js    # F9
pnpm exec web-harness run .web-harness/batches/06-sf-triage.js       # F10 F11 F26
pnpm exec web-harness run .web-harness/batches/15-sf-triage-page2.js
pnpm exec web-harness run .web-harness/batches/16-sf-form-census.js  # F26 census
pnpm exec web-harness run .web-harness/batches/17-eval-on.js
pnpm exec web-harness reload
pnpm exec web-harness run .web-harness/batches/18-after-reload.js    # F7
pnpm exec web-harness run .web-harness/batches/19-save-recover.js    # F12 F20
pnpm exec web-harness run .web-harness/batches/12-open-thin-black.js
pnpm exec web-harness run .web-harness/batches/20-recover-list.js    # F22
pnpm exec web-harness run .web-harness/batches/21-chat-and-review-entry.js  # F1 F16
pnpm exec web-harness stop
```

Batch 19's board tap landed on a deep line and was ignored, so both of its Saves ran on a clean
document; that is still a valid F12 observation (a clean Save downloads a new file), but a replay
meant to test dirty saves should navigate to the root first.

## Attempt log

| # | Run | Command | Result |
| --- | --- | --- | --- |
| 1 | 1 | `pnpm exec web-harness describe --json` | OK. Dev target, fixtures `rich-repertoire` (default) and `blank`, state sections `document`/`commands`/`strategicFit`, default device `webkit` / `iPhone 13 Mini`, port 4183. (`pnpm` installed `node_modules` as part of this call.) |
| 2 | 1 | `free -h` | 12 GiB total, 3.7 GiB available, no swap. |
| 3 | 1 | `pnpm exec web-harness doctor` | **Refused:** "needs 4.0 GiB + 2.5 GiB margin; 3.6 GiB usable … No swap: memory pressure freezes this host". |
| 4 | 1 | `pnpm exec web-harness status` | `No session chess.` Nothing of this project was holding the memory. |
| 5–8 | 1 | `pnpm exec web-harness doctor` (repeated) | Refused each time: 3.5, 3.3, 3.4, then 3.5 GiB usable. |
| 9–11 | 2 | `pnpm exec web-harness doctor` (repeated) | Refused; usable memory peaked at 5.3 GiB, still under 6.5. |
| 12 | 3 | `free -h` | 6.1 GiB available at the start of the run. |
| 13 | 3 | `pnpm exec web-harness doctor` | Refused: 4.5 GiB usable. |
| 14–21 | 3 | `pnpm exec web-harness doctor` (repeated through the run) | Refused each time: 3.2, 3.4, 3.3, 3.5, 3.5, 3.6, 3.5, 3.5 GiB usable, with no harness container running. |
| 22 | 4 | `free -h` | 6.1 GiB available at the start of the run. |
| 23 | 4 | `pnpm exec web-harness doctor` | Refused: 5.0 GiB usable, the highest in runs 1–4. |
| 24 | 4 | Background poll of `MemAvailable` for 7.0 GiB, every 10 s for 10 minutes | Fell to 3.4 GiB and stayed between 3.8 and 4.1 GiB. |
| 25–26 | 4 | `pnpm exec web-harness doctor` (mid-run, end of run) | Refused both times: 3.7, then 3.6 GiB usable. |
| 27 | 5 | `git fetch origin main` + `git rebase origin/main` | Rebased onto `3bc467f` ("chore: update web-harness to v0.2.2"). The report was untracked; no conflicts. |
| 28 | 5 | `pnpm install` | OK in 1 s: `@azeajr/web-harness` 0.2.0 → 0.2.2. No other change. |
| 29 | 5 | `free -h`; `pnpm exec web-harness doctor` | 3.7 GiB available, 15 GiB swap. **Passed:** need 1.8 GiB + 1.5 GiB margin, 3.6 GiB usable, 16.0 GiB swap. |
| 30 | 5 | `web-harness start --fixture blank` | Run `2026-09-29T14-34-22-875Z-53f2c2bf`, 0 faults; `00-seeded.png` inspected. |
| 31–38 | 5 | 8 batches | 01 failed `batch-abf64fbf` (desktop selector) → passed `batch-a084a5d5`; 02 failed `batch-fc0778c5` (hidden `.current-line`) → passed `batch-0a4dd047`; 03 failed `batch-81b99b2b` (wrong tab) → passed `batch-568baf2f`; 08 passed `batch-1a6b6389`; 07 failed `batch-21cb6177` (dirty dialog has no Continue). |
| 39 | 5 | `web-harness reset` | Run `2026-09-29T14-40-52-791Z-fedeb347`, 0 faults. |
| 40–50 | 5 | 11 batches | 01 `batch-9e21e5ac`, 07 `batch-0c63dd6c`, 09 `batch-1930b8b4`, 10 `batch-3f73c3db`, 03 `batch-d3b8d6ed`, 04 failed `batch-22bde6d8` (no gap row on the thin White repertoire), 11 `batch-384cf8e4`, 12 `batch-9ca89860`, 03 `batch-beca9c51`, 04 `batch-d7b722ba`, 13 `batch-912cc2a9`. |
| 51 | 5 | `web-harness reset` | Run `2026-09-29T14-46-33-930Z-4820b7f1`, 0 faults. |
| 52–65 | 5 | 14 batches and one `reload` | 01 `batch-8f021895`, 05 `batch-eb333ece`, 06 failed `batch-a12988dc` (finding without a form) → rewritten, passed `batch-c11ed687`, 15 `batch-2359603f`, 16 failed `batch-b987cfe6` and `batch-e30304b8` (hidden buttons counted) → passed `batch-706cad8b`, 17 `batch-d1c12045`, `reload` (0 faults), 18 `batch-c02872a3`, 19 `batch-4157da9a`, 12 `batch-4e264067`, 20 `batch-3646cfe2`, 21 `batch-129228eb`. |
| 66 | 5 | `web-harness stop`; `web-harness status` | Stopped; `state: stopped`, container `none`. |

Runs 1–4 ran on a host with no swap, where the harness added a 2.5 GiB margin; in those runs a
smaller container bound was blocked by the session's permission policy, and `--force-resources`
was never used. Run 5 needed neither.

## Method note

- **Sessions run:** one live session in run 5, on WebKit / `iPhone 13 Mini`, dev target, 33 batch
  attempts across three run directories (two `reset`s), 0 faults throughout. Runs 1–4 ran none.
- **Live-validated:** F1, F2, F3, F4, F5, F7, F9, F10, F12, F20, F21, F22 (12). **Partly:** F8, F16,
  F17 (3). **New from the live run:** F24, F25, F26 (3). **Code trace only:** F6, F11, F13, F14,
  F15, F18, F19, F23 (8).
- **Revised by live evidence:** F17's claim that a near-miss looks like an empty answer was wrong;
  the app shows an "unknown structure" error listing the valid names. F4's phone count rose from 4
  to 5 (File menu). F10's control is now labelled Show on repertoire board. F11 could not be
  exercised because the fixture yields no resolvable finding. No other count changed.
- **How counts were taken:** each batch logs every visible control it clicks; the counts in the
  Live evidence bullets are those logs. Fixture changes went through the File menu with a stubbed
  file chooser, the only non-UI step.
- **Code-trace findings** rest on the interaction graph in `apps/ui/src` at `3bc467f`, cited with
  `file:line`. F14 is also corroborated by a checked-in e2e spec, which was read, not run.
- **Out of scope:** accessibility, by the brief. Linux WebKit emulation is not a real iPhone; no
  claim here depends on iOS-specific behaviour beyond the missing `showSaveFilePicker` (F12).
