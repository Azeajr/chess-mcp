# UI/UX Audit — `apps/ui` chess repertoire PWA

**Date:** 2026-08-01
**Scope:** `apps/ui` (SolidJS 1.9 / Vite PWA), with `packages/chess-tools` and `apps/mcp-server` inspected only where their contracts, terminology, states, or errors reach the interface.
**Method:** full source reconstruction of `apps/ui/src` (108 files), plus runtime inspection of the running dev server driven headlessly through Chromium at twelve viewports, four zoom levels, and scripted keyboard/pointer interaction. Every finding is tagged **Verified** (observed at runtime or unambiguous in source) or **Hypothesis** (requires assistive-technology or real-device confirmation).

**No production code was modified.**

---

## 0. Corrections to the brief

The task description differs from the repository in ways that matter to the findings. Recorded here so the rest of the report is read against the code, not the brief.

| Brief says                                                                                         | Repository actually has                                                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Global stylesheet ~1,500 lines                                                                     | `src/styles.css` is **5,513 lines**, 1,226 top-level class rules                                                    |
| Mobile breakpoint at 720px                                                                         | Three breakpoints: **720px** (phone), **820px** (Strategic Fit compact), **1100px** (grid⇄flex). No shared policy   |
| "Side-panel switching between analysis and move-tree content"                                      | No switching. `AnalysisPanel`, `RepertoirePanel`, and `MoveTree` are **stacked vertically in one scrolling column** |
| Top bar has an unsaved indicator, filename, Open, Reopen, Save, New, colour, eval, depth, settings | Confirmed, all nine present in one unwrapped flex row (`TopBar.tsx:19–76`)                                          |
| `ToolResult` ~785 lines                                                                            | 785 lines. Size is not the problem; see UX-015                                                                      |
| `StrategicFitWorkspace` ~708 lines                                                                 | 708 lines. Reasonably decomposed into 30 child components                                                           |
| Strategic Fit "makes the rest of the interface inert and aria-hidden"                              | True (`App.tsx:70–74`). This is the **only** overlay in the app that does so — see UX-007                           |
| "Little or no component-scoped CSS"                                                                | Confirmed: zero `.module.css`, zero CSS-in-JS. One global sheet                                                     |

---

## 1. Executive summary

### Overall assessment

This is a genuinely powerful analytical tool with an unusually honest evidence model. The Strategic Fit workspace refuses to fabricate — it names what it withheld, what it could not measure, and what a staged action will and will not do. Its profile wizard, preflight panel, finding queue filters, and staged-mutation copy are better than most commercial chess software. That quality is real and should be preserved verbatim.

It is also, measurably, **two products in one binary**. 993 of the stylesheet's 1,226 class rules (81%) and 21 of 22 Playwright e2e specs belong to Strategic Fit and the Replacement Lab. The surfaces a user touches every single session — top bar, board, move list, analysis panel, chat — carry roughly 233 CSS rules and two e2e specs between them. The audit's most damaging findings are almost all in that under-invested core, and the pattern is consistent enough to be the single largest root cause in the report.

The core interface fails in ways that are not stylistic. **The chessboard is invisible to keyboard and assistive technology.** The move list is not keyboard reachable. At 200% browser zoom the entire application below the board becomes unreachable. Between roughly 721px and 823px — iPad portrait — the page scrolls horizontally and every repertoire action button leaves the screen. `Ctrl+Z` deletes a repertoire node with no redo. `New` destroys the only copy of a saved-once document without asking.

### The five highest-value changes

1. **Make the core interface keyboard-operable** (UX-003, UX-004, UX-013). The board, the move list, and every result row are currently pointer-only. This is the difference between "an app with accessibility gaps" and "an app a keyboard user cannot use at all."
2. **Fix the responsive floor** (UX-001, UX-002). One unwrapped flex row and one missing `min-height` cause total content loss at 200% zoom and horizontal scroll at tablet portrait. Both are small fixes with very large blast radius.
3. **Make document state and destructive actions safe and legible** (UX-005, UX-006, UX-031). Introduce a real undo stack, confirm `New` unconditionally, and state plainly where the work currently lives (browser vs file).
4. **Rebuild the top bar as three labelled groups with progressive disclosure** (UX-008). It is 258px tall on a phone — 35% of the viewport — before any chess appears, and it is the direct cause of the 721–823px overflow.
5. **Reorder the side column and give the analysis panel an honest empty state** (UX-009, UX-010). The move list — the app's most-used navigation surface — is below the fold at 1440×900, and the engine is off by default while the panel says "No lines yet."

### Most serious usability risks

- **Silent data loss.** Single autosave slot, no version history, `New` unguarded on a clean document, `Ctrl+Z` deletes without redo.
- **Complete keyboard/AT exclusion from the primary task** (playing and browsing moves).
- **Total content loss at 200% zoom and on short viewports.**
- **Horizontal scroll at iPad portrait**, hiding every repertoire scan button.
- **Strategic Fit terminating in a dead end** for realistically-sized repertoires while the header says "Analysis complete."

### Strongest existing design decisions — preserve these

- **Staged-mutation copy.** "Nothing is saved until you accept. Accepting changes profile preferences only; the repertoire is not edited." (`ToolResult.tsx:349`). This is exemplary.
- **The Strategic Fit profile wizard.** A real question as a heading, four plain-language options, a `RECOMMENDED` badge, an explicit consequence statement, and a `Skip for now`.
- **Bounded-evidence honesty.** "Withheld evidence exists; it is not absent, and it cannot be cited in a plan." (`ToolResult.tsx:407`).
- **Preflight results panel.** Named counts (routes found / comparable / incomplete) and severity-tagged issues.
- **Finding queue filters.** Sort by replacement priority / training priority / expected frequency, filter by priority band and opening — genuine prioritisation, not a flat list.
- **The colour-picker modal on PGN open** — asks the one question the file cannot answer, pre-fills a detection, and labels it "Detected from file headers."
- **Arrow-key guard inside text fields** (`App.tsx:55`) — verified working.
- **Panels stay mounted across mobile tab switches** — chessground never re-initialises, chat keeps its log.
- **Side-panel minimum width of 240px** — panels cannot be dragged into an unrecoverable collapse.

### Systemic causes (detail in §11)

1. **Investment asymmetry** between the Strategic Fit workspace and the core interface.
2. **Domain objects mapped straight onto the interface** — `nodes`/`leaves`, `cohort:b6b48b1c47f62275`, `gaps 1`, `engine_unavailable`.
3. **No responsive-state policy** — three uncoordinated breakpoints, no minimum-content contract.
4. **No interaction primitives** — every clickable row is a hand-rolled `<div onClick>`.
5. **No content-design layer** — copy is inline string literals with no register or terminology rules.
6. **Feature organisation follows implementation tiers**, not user goals ("Advanced", "Tier A/B" in source comments).

---

## 2. Product and user model

### Likely user groups

| Group                            | Primary job                                                      | Expertise assumed                       | Where the interface serves / fails them                                                                                                     |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repertoire builder** (primary) | Grow, prune, and pressure-test a branching opening tree          | High chess, moderate engine             | Well served by Gaps/Connect/Shorten; badly served by the below-the-fold move list and the absence of undo                                   |
| **Tournament preparer**          | Prepare a line against a named opponent before a game            | High chess                              | `prep_vs_opponent` exists but is buried in a collapsed section behind a Lichess token in a drawer                                           |
| **Coach**                        | Produce annotated material for a student                         | High chess, low tooling                 | `export_annotated_repertoire` and the CSV drill deck exist; both are two-click affordances inside collapsed sections with 14px-tall buttons |
| **Engine-literate analyst**      | Interrogate one position deeply                                  | High chess, high engine                 | Served by the analysis panel and chat — but eval is off by default and there is no legend for the arrow system                              |
| **Strategic-fit reviewer**       | Decide whether the repertoire's strategic load is worth carrying | High chess, **zero** product vocabulary | This is the group the terminology audit (§6) is written for                                                                                 |
| **Mobile focused-task user**     | Check one line, drill one position, on a phone                   | Varies                                  | Actively hostile: 258px top bar, 66px analysis panel, no cross-tab status                                                                   |
| **Keyboard-only / AT user**      | Any of the above                                                 | Varies                                  | **Cannot perform the core task at all** (UX-003, UX-004)                                                                                    |

### Expertise assumptions the interface may make

Standard chess terminology (SAN, FEN, PGN, structure names, "only move", "transposition") is appropriate and should not be diluted. Engine terminology (depth, centipawns, multi-PV, mate-in-N) is appropriate for the analysis panel and eval bar, and appropriate _with a one-line explanation_ everywhere it drives a decision.

Product terminology (**Strategic Fit, congruence, cohort, finding, candidate, change set, revision, resolution proof, training exception, Pareto**) is assumed with no introduction anywhere in the interface. A grandmaster and a beginner are equally lost.

### Where novice and expert needs conflict, and how disclosure reconciles them

| Conflict                                                                           | Resolution                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expert wants depth 30 on every scan; novice does not know depth exists             | Move depth out of the global top bar into an "Engine" disclosure inside the analysis panel, with the current value shown as a read-only chip in the panel header |
| Expert reads `+0.34`; novice reads "slightly better for White"                     | Keep the number; add a one-word qualifier on hover/description, not a replacement                                                                                |
| Expert wants the raw report; novice wants a conclusion                             | Keep `Raw JSON` but move it behind a single per-conversation "developer details" toggle in Settings rather than on every card                                    |
| Expert knows a cohort is a comparison group; novice sees `cohort:b6b48b1c47f62275` | Name cohorts by their defining opening, keep the hash in a `title`/detail row                                                                                    |

---

## 3. Interface inventory

### Surfaces

| Surface                 | File                                                         | Notes                                                  |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| App shell               | `App.tsx`                                                    | `100dvh` grid, `auto 1fr`                              |
| Top bar                 | `components/TopBar.tsx`                                      | 9 controls, unwrapped flex above 720px                 |
| Board panel             | `components/Board.tsx`, `EvalBar.tsx`                        | Chessground 9, no a11y attributes                      |
| Side column             | `AnalysisPanel.tsx` → `RepertoirePanel.tsx` → `MoveTree.tsx` | Stacked, single scroll container ≥1101px               |
| Chat column             | `ChatPanel.tsx` + `ToolResult.tsx`                           | Fixed width, always present                            |
| Settings drawer         | `SettingsDrawer.tsx`                                         | Overlay, no focus trap                                 |
| Promotion modal         | `PromotionModal.tsx`                                         | Overlay, no dialog semantics                           |
| Colour-picker modal     | `ColorPickerModal.tsx`                                       | Overlay, no dialog semantics                           |
| Strategic Fit workspace | `StrategicFitWorkspace.tsx` + 30 children                    | Full-screen; makes `.app-main` `inert` + `aria-hidden` |
| Replacement Lab         | `strategic-fit/ReplacementLab.tsx`                           | Nested overlay inside the workspace                    |

### Panels, sections, tabs

- **Analysis panel:** engine lines (fit badge, SAN, weight swatch, eval), cloud row, "Suggested (from chat)" list.
- **Repertoire panel:** 10 `<details>` sections — Strategic Fit entry card, Prescribed-move audit, Only moves & drills, Structure search, Opponent preparation, Annotated repertoire, Strategic Fit portability, then an `Advanced` label followed by Gaps (open by default), Connect, Shorten, Extend here.
- **Move tree:** current-line strip (horizontally scrolling) + recursive tree body with per-branch collapse toggles.
- **Chat:** mode `<select>` (Auto / General / Repertoire / Game review / Position / Annotate PGN), Clear, log, tool-run list, error strip, input.
- **Mobile tabs (≤720px):** Analysis / Moves / Chat.
- **Strategic Fit stages:** Overview / Findings / Evidence / Resolution — a real tablist **only** ≤820px; hidden above (§8).

### States

| Kind    | Where             | Copy                                                                                       |
| ------- | ----------------- | ------------------------------------------------------------------------------------------ |
| Empty   | Analysis          | "No lines yet." / "Engine offline — arrows unavailable."                                   |
| Empty   | Move tree         | "No moves yet — play on the board."                                                        |
| Empty   | Gaps              | "No scan yet — or no gaps." (**two states in one string**)                                 |
| Empty   | Connect / Shorten | "No stubs that rejoin prep." / "No shortenable lines."                                     |
| Empty   | SF panes          | Four tailored messages in `EMPTY_COPY` (`StrategicFitWorkspace.tsx:64`)                    |
| Loading | Analysis          | `analysing…` + indeterminate bar                                                           |
| Loading | Scans             | `.scan-progress` bar + `done/total`                                                        |
| Loading | Chat              | `…` bubble, then `.tool-run` rows with `queued`/`running`/`completed`/`cancelled`/`failed` |
| Error   | Chat              | `.chat-error` strip + Retry                                                                |
| Error   | Tool result       | `ErrorResult` card with mapped label **plus the raw code**                                 |
| Error   | Scans             | Reuses `.empty` styling — errors look like empty states                                    |
| Warning | App               | `strategic-fit-metadata-warning` fixed banner, `role="alert"`                              |
| Warning | Top bar           | Depth-30 notice, `role="status"`, dismissible but re-fires                                 |

### Destructive actions

| Action                           | Guard                                             | Reversible                                          |
| -------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| `New`                            | `window.confirm` **only if `dirty()`**            | No                                                  |
| `Open PGN`                       | `window.confirm` **only if `dirty()`**            | No                                                  |
| `Ctrl+Z` on a leaf               | **None**                                          | **No**                                              |
| Colour-picker backdrop click     | None — cancels the pending load                   | Re-open the file                                    |
| Promotion backdrop click         | None — cancels the move                           | Replay the move                                     |
| Accept staged edit / preview     | None                                              | Only via `Ctrl+Z` leaf delete                       |
| `Clear` chat                     | None                                              | No                                                  |
| Replacement Lab change-set apply | Multi-step confirmation + resolution proof + undo | **Yes** — the only well-guarded mutation in the app |

### Keyboard commands (global, `App.tsx:45–65`)

| Key            | Action                               | Scope                                              | Notes                                                                                |
| -------------- | ------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Cmd/Ctrl+S`   | Save file                            | Everywhere including text fields                   | Verified working from the chat textarea                                              |
| `Cmd/Ctrl+Z`   | Delete leaf / step back              | Everywhere except text fields and the SF workspace | **Destructive, no redo**                                                             |
| `←` / `→`      | Back / forward                       | Same                                               | **Active behind the Settings drawer and both modals** (verified)                     |
| `Escape`       | Close SF workspace / Replacement Lab | SF only                                            | **Does not close the Settings drawer, promotion modal, or colour picker** (verified) |
| `←/→/Home/End` | Move between SF stages               | SF workspace ≤820px only                           | Correct roving-tabindex tablist                                                      |

There is no shortcut help, no shortcut list, no customisation, and no discoverability affordance anywhere in the UI.

### Persistence

| Store                                           | Mechanism                                       | Key                            | Recovery                               |
| ----------------------------------------------- | ----------------------------------------------- | ------------------------------ | -------------------------------------- |
| Working repertoire                              | IndexedDB, 400ms debounce                       | `workingRepertoire`            | **One slot, overwritten, no history**  |
| File handle                                     | IndexedDB                                       | `fileHandle`                   | "Reopen \<name\>" button               |
| Panel widths                                    | localStorage                                    | `chess.layout.side/chat/board` | No reset control                       |
| API key / model / Lichess token / cloud-eval    | localStorage, **plaintext**                     | —                              | Disclosed to the user                  |
| SF metadata, training records, profile, sources | IndexedDB                                       | various                        | Warning banner on failure              |
| Service worker                                  | `vite-plugin-pwa`, `registerType: "autoUpdate"` | —                              | **No update notification to the user** |

---

## 4. Journey audit

Format per journey: **Entry → Goal → Pain → Preserve → Target flow.**

### 1. First launch and orientation

**Entry:** cold URL. **Goal:** understand what this is and what to do first.
**Current:** empty board in start position, a green arrow already drawn (repertoire arrows for child moves of the empty root — actually none, so the green arrow seen in testing came from a loaded file), "No lines yet.", "No scan yet — or no gaps.", "No moves yet — play on the board.", a 360px empty chat column saying "No API key.", and ten collapsed section headers.
**Pain:** Nothing states what the product does or what a first action would be. The most prominent right-hand third of the screen is a disabled feature. The engine is off and nothing says so.
**Missing:** a first-run state that says "Open a PGN repertoire, or start playing moves on the board to build one."
**Target flow:** replace the three simultaneous empty states with one primary empty state in the board region: a short title, two buttons (`Open a PGN` / `Start a new repertoire`), and one line explaining that everything is stored in this browser until you save a file. Collapse the chat column to a rail until a key is set.

### 2. Opening a PGN

**Entry:** `Open PGN`. **Goal:** load a repertoire.
**Current:** confirm-if-dirty → native picker → colour-picker modal with detection → load. Parse failures are caught and shown inside the modal.
**Preserve:** the colour picker, the detection hint, and the in-modal parse error are all good.
**Pain:** the modal has no `role="dialog"`, no focus move, no `Escape`, and a backdrop click silently cancels. Arrow keys navigate the board behind it (verified). On browsers without File System Access (Firefox, Safari) the fallback `<input type=file>` path never stores a handle, so `Save` becomes a download and `Reopen` never appears — with no explanation of why the button is missing.
**Target flow:** wrap both modals in one `Dialog` primitive: `role="dialog" aria-modal="true"`, focus to the first control, `Escape` = Cancel, background `inert`, focus restored on close. Add a one-line capability note when the fallback path is used: "This browser can't write back to the file directly — Save will download a new copy."

### 3. Reopening the last document

**Current:** `restoreLastFile()` shows a `Reopen <name>` button; clicking requests permission and loads.
**Pain:** if permission is denied, `reopenLast()` returns silently (`files.ts:159`) — the button appears to do nothing. There is no explanation of why re-opening the file is different from the autosave that already restored the work.
**Target flow:** on denial, show "Couldn't re-open <name> — the browser needs permission again. Your work is safe in this browser." Relabel the button `Re-link file: <name>` and add a one-line status: "Your current work was restored from this browser, not from the file."

### 4. Starting a new document

**Current:** `New` → `confirm` only when `dirty()` → tree replaced, handle cleared, autosave overwrites within 400ms.
**Pain (Critical, verified):** after any `Save`, `dirty()` is false. `New` then wipes the working document _and its only autosave slot_ with **no confirmation and no recovery**. With the download fallback, the "saved" file is in the Downloads folder and the handle was never stored, so `Reopen` cannot bring it back either.
**Target flow:** confirm unconditionally, naming what will happen: _"Start a new repertoire? The current repertoire (my-rep.pgn, 6 lines) will be closed. It's saved to your file, so you can re-open it."_ / _"…It has never been saved to a file — this will be lost."_ Keep the last three autosave snapshots and expose them under `Settings → Recover`.

### 5. Autosave vs explicit save

**Current:** autosave to IndexedDB every 400ms; `Save` writes a PGN file; `dirty` drives a `● unsaved` chip.
**Pain:** "Save" and "saved" mean two different things and nothing in the UI distinguishes them. `● unsaved` means "differs from the file", not "unsaved" — the work _is_ saved, in the browser. A user reading `● unsaved` reasonably believes their work is at risk when it is not; a user seeing no chip believes it is durable when it may exist only in one browser profile.
**Target flow:** two independent indicators. A persistent quiet line: `Stored in this browser · autosaved 12:04`. A separate file state: `File: my-rep.pgn — 3 changes not exported` with an `Export to file` action. Rename the button `Save to file`.

### 6. Navigating a game tree

**Current:** click any move span; `←`/`→` step; the current-line strip mirrors the path; branch collapse toggles.
**Preserve:** the current-line strip, the Lichess-style indentation, the per-branch collapse with a `+N` count, and the "keep the branch open if the current node is inside it" rule.
**Pain (Critical, verified):** 11 move spans, 0 focusable. Move targets measure 16px tall — below the WCAG 2.2 24px minimum and far below 44px on touch. On desktop at 1440×900 the move tree begins at y≈800 in a 900px viewport: the primary navigation surface is below the fold behind ten collapsed repertoire sections.
**Target flow:** move tree to the **top** of the side column. Make each move a `<button>` in a `role="tree"`/`role="group"` structure with `aria-current="true"` on the active node, `↑/↓` between siblings, `←/→` in/out of variations, and `Enter` to go. Raise the row box to ≥24px (≥44px on coarse pointers) using padding, not font size.

### 7. Adding, deleting, or changing a variation

**Current:** play a move on the board to add; `Ctrl+Z` at a leaf to delete; chat/Strategic Fit propose staged edits with Accept/Reject.
**Pain (Critical):** `Ctrl+Z` is bound to a function that, at a leaf, does `parent.children.splice(...)` (`game.ts:186`) with no history and no redo. Verified: `Ctrl+Shift+Z` and `Ctrl+Y` do nothing. The same key does two different things depending on invisible state (leaf vs internal node) — verified: at an internal node it only stepped the path back. A user who presses `Ctrl+Z` twice expecting to walk back two moves deletes a line on the second press if the first landed on a leaf.
**Target flow:** introduce a real command history (`applyEdit`, `play`, `undo` all push an inverse). `Ctrl+Z` = undo last change; `Ctrl+Shift+Z` = redo. `←` remains navigation. Give deletion its own explicit control (`Delete this line` in a move's context menu) with an undo toast: _"Deleted 3… Bf4 and 2 continuations. Undo."_

### 8. Running live engine analysis

**Current:** `evalEnabled` defaults to **false** (`analysis.ts:39`). With it off the panel renders "No lines yet." and the eval bar sits at a neutral 50% with no label.
**Pain (High, verified):** the empty state gives the wrong diagnosis. "No lines yet" says _wait_; the truth is _turn it on_. The toggle `Eval On`/`Eval Off` is ambiguous — is that the state or the action? Three distinct conditions (off, starting, offline) are visually near-identical.
**Target flow:** empty state becomes _"Engine evaluation is off. [Turn on evaluation]"_ with the button inline. Replace the toggle with a labelled switch: `Engine evaluation ⬤ Off`. Give the eval bar an accessible name and a distinct "off" appearance (greyed, `—`).

### 9–10. Deeper analysis; progress and completion

**Current:** a single global `Depth` slider + number in the top bar drives live analysis _and_ every engine-backed repertoire command. Reaching 30 raises a dismissible notice.
**Pain:** the depth control is global but its effect is local to two panels; it is a precision control living in a top bar that is 258px tall on a phone. The notice re-fires every time depth reaches 30 (verified) — dismissal is not remembered, and it fires while dragging the slider. Long scans report `done/total` inside the collapsed section that started them; nothing surfaces at app level. There is **no completion announcement** anywhere — no live region, no toast, no tab badge.
**Target flow:** move depth into the analysis panel under an `Engine` disclosure; show the effective depth as a read-only chip in each section that consumes it (`Audit · depth 20`). Convert the depth-30 notice into inline helper text under the control that appears whenever depth ≥ 25 and never needs dismissing. Add one app-level activity indicator listing running operations with cancel, and one `aria-live="polite"` region announcing starts and completions.

### 11–13. Chat: simple question, structured workflow, stop/retry

**Current:** free-text input; a `Auto/General/Repertoire/Game review/Position/Annotate PGN` select; streamed text; `⚙ tool_name` chips; typed result cards; a separate `.tool-run` list showing `queued/running/completed/cancelled/failed` with `done/total`; `Stop` replaces `Send` while busy; `Retry` next to the error.
**Preserve:** the staged-mutation cards, the explicit `Accept`/`Reject`, the stale-status text, the round-limit summary message ("Tool-round limit reached; the response is explicitly incomplete and can be continued").
**Pain:**

- The mode select is titled _"Optional workflow guidance; all tools remain available"_ — only on hover. A user cannot tell what "Annotate PGN" mode does, or that it changes nothing but the system prompt.
- Nothing tells the user what the assistant can currently see. `systemMessage()` injects FEN, colour, selected path, document type, revision, and tree stats — the user is never shown this.
- Tool chips show raw contract identifiers: `⚙ analyze_repertoire_congruence`, `⚙ find_pruning_transpositions`.
- `NavigationRows` derives labels from JSON keys, producing `gaps 1`, `result 3 position`, `uncovered opponent moves 2` (verified in a live render).
- Every result card carries a permanent `Raw JSON` `<details>` (verified: 3 results → 3 disclosures).
- `Stop` aborts the whole turn including in-flight tools; the label does not say so. `Retry` re-sends the _last user text_, not the failed step; the label does not say so either.
- Mutation cards and informational cards share the same `.result-card` shell; only a `staged-card` class differentiates them.
  **Target flow:** a context chip above the input — `Looking at: 1.d4 Nf6 2.Nf3 · your White repertoire · 6 lines` — that expands to the full injected context. Replace the mode select with a labelled row of presets and one line of description under the selected one. Map tool identifiers to task labels through the existing `tool-contract` (`⚙ Checking repertoire coverage`). Move `Raw JSON` behind a global `Settings → Show technical details`. Rename `Stop` → `Stop this request` and `Retry` → `Send again`. Give mutation cards a distinct treatment (accent left border, a `Changes your repertoire` badge, and a reversibility line).

### 14. Navigating from a chat result to a board position

**Current:** `result-nav` buttons call `actions.goto(indexPath)` or `navigateFen` (full tree walk).
**Pain:** the conversation does not scroll or mark where you were; after navigating, nothing indicates which result produced the current position. `navigateFen` silently does nothing when the FEN is not in the tree.
**Target flow:** on navigate, mark the source card `● showing on board` and keep it pinned to the top of the log until superseded. When a FEN is not in the tree, say so: _"That position isn't in this repertoire."_

### 15–16. Reviewing and applying a repertoire suggestion; stale suggestions

**Current:** `StagedEditResult` shows action, path, line, and `nodes 45 → 46 · leaves 6 → 7`; buttons `Preview on board` / `Accept` / `Reject`. When the revision moved on, the status becomes `Tree changed — preview is stale`.
**Preserve:** revision binding, the pending/accepted/rejected/stale state machine, and `Preview on board`.
**Pain:** `nodes`/`leaves` is tree vocabulary, not chess vocabulary — a user cannot tell whether `leaves 6 → 7` is good. `Accept` never says what it changes or whether it can be undone (it can only be undone by the leaf-deleting `Ctrl+Z`). The stale message says what happened but not what to do.
**Target copy:**

> **Add to your repertoire** — after 1.d4 Nf6 2.Nf3 e6, play 3.Bf4 d5
> Adds 1 new move and 1 new line. Your repertoire goes from 6 lines to 7.
> _Accept adds this to the working repertoire in this browser. Export to a file to make it permanent._
> `[Show on board] [Add to repertoire] [Dismiss]`

Stale: _"Your repertoire changed since this was suggested, so it may no longer fit. Ask again to get a fresh suggestion for the current position."_ with an `Ask again` button.

### 17. Finding gaps

**Current:** `Gaps` section (open by default) → `Scan` → progress bar → severity-tagged rows → `Fill this` → two fill options → click stages a gold-arrow preview → `Accept line`.
**Preserve:** the covered-by-transposition "false gap" rows, the `best eval` / `best fit` pair, and the fact that the whole prospective line is shown inline rather than on hover.
**Pain:** the section title is `Gaps` — a gap in _what_? The empty state "No scan yet — or no gaps." conflates two opposite states. Rows are click-only divs. The `Fill this` button is 14px tall.
**Target flow:** rename to `Unanswered opponent moves`. Split the empty state: `[Scan for unanswered moves]` before, `No unanswered moves found — every opponent reply is covered.` after. Rows become buttons.

### 18. Creating or reviewing drills

**Current:** `Only moves & drills` → `Find` → rows → `Generate CSV deck` → `Save CSV deck`.
**Pain:** two sequential buttons that look identical and appear in the same place; the user cannot predict that `Generate` must precede `Save`, and no state explains the wait between them. `margin 47cp` is unexplained.
**Target flow:** one `Create drill deck` button with an inline progress→download state. Replace `margin 47cp` with `only move by 0.47` and a description: _"Any other move loses at least 0.47 pawns of evaluation."_

### 19. Exporting annotated material

**Current:** `Annotated repertoire` → `Generate` → `Save annotated PGN`.
**Pain:** same two-step problem; the summary `Audit 3 · only moves 5 · gaps 2 · congruence 1` uses four internal category names with no explanation of what got written into the PGN.
**Target flow:** _"Creates a PGN with engine comments on 11 positions: 3 move-quality notes, 5 critical-move warnings, 2 coverage gaps, 1 strategic note."_

### 20. Entering the Strategic Fit workspace

**Current:** a card inside the repertoire panel: title, _"Explore the review workspace. Opening it does not analyze or change this repertoire."_, `Open workspace`.
**Preserve:** the no-side-effects promise — it is exactly the reassurance that belongs there.
**Pain:** the card never says what Strategic Fit _is_. "Explore the review workspace" is a description of the UI, not of the value. The entry point sits inside a scrolling side column, below the analysis panel, above ten collapsed sections.
**Target copy:** **Strategic Fit — is your repertoire asking you to learn too many different plans?** _Compares the strategic ideas across your lines and flags the ones that stand apart. Opening this does not analyse or change anything._

### 21. Configuring a strategic profile

**Current:** first-run wizard, four options, advanced disclosure with weighted sliders, a note that the base scan is engine-free, `Skip for now` / `Use Balanced profile`.
**Preserve — this is the best screen in the product.** Verified at 1440 and 390; no overflow, correct grid collapse, plain language throughout.
**Pain:** the advanced preference copy — _"0 ignores this family; 1 is standard; 3 gives it the strongest influence on strategic distance"_ — repeats verbatim for four sliders and assumes "strategic distance" is understood.
**Target:** define `strategic distance` once above the sliders and shorten each to a family name plus a two-word effect.

### 22. Reviewing findings

**Current (verified on a six-line repertoire):** `Analysis complete` in the header, `Preflight degraded`, `Routes found 6 / Comparable routes 0 / Incomplete routes 6`, and six findings all reading `Uncertain · Incomplete strategic evidence · Low confidence · 0/100 · Replacement: Insufficient evidence · Training: Insufficient evidence`.
**Pain (High):** the header claims success while the body reports that nothing could be measured. Every finding is a negation. The Evidence pane then adds _"No typical-versus-branch dimensions are available"_, _"Contribution breakdown is unavailable"_, _"Board unavailable at this milestone"_ ×5. The workflow's promised arc (setup → interpretation → comparison → decision → preview → application → verification) **cannot start** for a repertoire of this size, and the interface never says "your repertoire is too small / too shallow for this analysis; come back with N+ routes past ply 12."
The honesty is right. The framing is wrong.
**Target flow:** when `comparable_route_count === 0`, replace the entire findings/evidence/resolution area with one directive state:

> **Not enough comparable lines yet.** Strategic Fit compares branches that reach at least ply 12 and share measurable structure. This repertoire has 6 routes, 0 of which are comparable. Extend your main lines past move 6, or add a second system, then analyse again.
> Downgrade the header from `Analysis complete` to `Analysis finished — limited evidence` whenever preflight is degraded.

### 23–24. Comparing candidates; Pareto and heatmap

**Current:** `CandidateTable`, `ReplacementPareto` (with a keyboard-navigable plot and a tabular fallback), `ConceptHeatmap`, `StrategicMap`, `DecisionFlow`.
**Preserve:** every chart has a text alternative, an explicit "N branches grouped" statement, a print/export mode that expands all lists, forced-colors handling, and reduced-motion handling. This is model work.
**Pain:** `Pareto status` and `dominated by <candidate ids>` appear at the primary level. The strategic map's axis explanation is _"Horizontal position is the explainable strategic distance from the heaviest weighted repertoire route (no cohort produced a strategic mode)"_ — accurate and unreadable. Cohorts are labelled with raw hashes (verified: `cohort:314849cdced212ef (1)` in the filter dropdown, `cohort:b6b48b1c47f62275` on finding cards). Excluded branches are identified as `fda16c53`, `96c967e8`.
**Target:** `Pareto status` → **`No better option on every measure`** / **`Beaten by <name>`**, with "Pareto-optimal" kept as a secondary line for readers who want it. Name cohorts by their defining opening (the finding cards already carry `Traditional Variation`, `London System`, `Wade-Tartakower Defense` — use those) and keep the hash in a detail row. Give the map a plain first sentence: _"Branches far apart need different plans. Branches close together reuse the same ideas."_

### 25–28. Preview, conflicts, apply, proof

**Current:** `ChangeSetPreview` with per-operation diffs and bounded path lists; `ResolutionActions`; `TrainException`; `CohortEditor`; `ResolutionProof` with a full status machine (`awaiting-rescan`, `rescanning`, `proven`, `superseded`, `rescan-failed`, `undoing`, `undo-blocked`, `undone`).
**Preserve:** this is the only mutation path in the product with a preview, a confirmation, a verification, and an undo. It is the model the rest of the app should follow.
**Pain:** the vocabulary is entirely internal. `Resolution proof`, `awaiting affected-cohort rescan`, `evidence superseded by another edit` describe the mechanism, not the user's question, which is _"did that actually help?"_
**Target copy:** section title **`Did this help?`**; statuses `Checking the affected lines…` / `Re-checked — here's what changed` / `Out of date — you edited again since` / `Couldn't re-check` / `Change undone and re-checked`.

### 29. Exiting the workspace

**Current:** `Return to repertoire`, `Escape`, focus restored to the invoking element (`StrategicFitWorkspace.tsx:406`). Correct.
**Pain:** unsaved staged decisions are not mentioned on exit. **Hypothesis** — needs a run with a pending staged change.

### 30. Main workflows on mobile

**Verified at 360×740:** top bar 258px (5 wrapped rows), board 318px, **analysis panel 66px tall**. At 390×844: top bar 240px, board 348px, panel 158px. At 720×900: top bar 124px, board 630px, panel **48px**.
**Pain (Critical/High):**

- The board's `min(70vh, 100% - 26px)` sizing plus `.side-panel { flex: 1 1 0; min-height: 0 }` inside `.workspace { overflow: hidden }` means the panel absorbs _all_ the leftover space, including none. At 640×400 (≡ 200% zoom) it measures **0px** and the tab bar is clipped — the entire application below the board is unreachable, with no scroll container that can reach it.
- Tabs carry no state. **Verified:** with a Gaps scan running, switching to `Chat` hides every progress indicator and the tab labels are unchanged (`Analysis`, `Moves`, `Chat`).
- `role="tab"` without `aria-controls`, without `id`, without `role="tabpanel"` on the targets, without roving tabindex, without arrow keys. **Verified** at runtime: `aria-controls: null`, `id: ""` on all three.
  **Target flow:** give `.side-panel`/`.chat-wrap` a `min-height` (e.g. `12rem`) and let `.workspace` scroll on short viewports; cap the board at `min(70vh, 45dvh, 100% - 26px)` when height is constrained. Add state to tab labels: `Analysis ●`, `Moves`, `Chat 2`. Complete the tablist ARIA contract or drop the roles and use plain buttons with `aria-pressed`.

### 31. Keyboard-only operation

**Verified:** the board has `tabindex: null`, `role: null`, `aria-label: null`, and 0 focusable descendants. 11 move spans, 0 focusable. All `.rep-row` result rows are click-only. The tab order runs top bar → `Open workspace` → repertoire section summaries and scan buttons → chat. **A keyboard user can start scans but cannot play a move, cannot select a move, and cannot open any scan result.**
Additionally: Settings drawer has no focus trap (**verified:** 10 consecutive Tabs all landed outside the drawer, in the page behind the backdrop, drawer still open), no `Escape` (**verified**), and `→` navigated the board behind it (**verified:** path `[0]` → `[0,0]`).
**Target flow:** a `Dialog` primitive for all three overlays; a `role="tree"` move list; `<button>` result rows; a focusable board with arrow-key square navigation and `Enter` to select/move (chessground does not provide this — a small overlay grid is the usual approach); a documented shortcut sheet reachable from `Settings` and from `?`.

### 32. Recovery after refresh, SW update, crash, interrupted analysis

**Current:** `restoreWorking()` restores PGN, colour, path (probed for validity), filename, and dirty flag before autosave is armed. This is careful, correct work.
**Pain:** the restore is completely silent — the user cannot distinguish "this is my work, restored" from "this is a stale document I forgot about". `registerType: "autoUpdate"` means the service worker swaps under the user mid-session with no notification. An interrupted scan leaves `commandStates` at `running` with an orphaned `AbortController` after reload (**Hypothesis** — the store is module-level and re-initialises, so state is `idle`; the _engine_ worker restarts clean. Worth confirming).
**Target flow:** a dismissible line under the top bar on restore: _"Restored your work from this browser — last change 14:32."_ A `New version available — Reload` toast on SW update.

---

## 5. Issue register

Severity: **Critical** = data loss / inaccessible core workflow / seriously wrong action. **High** = major workflow failure, recurring confusion, severe a11y problem. **Medium** = meaningful friction. **Low** = polish.
Effort: **XS** isolated copy/style · **S** localized component · **M** multi-component · **L** workflow/architecture · **XL** product restructuring.

| ID     | Surface                           | Finding                                                                                                                                                                                                       | Evidence                                                                                                                                                                                           | User impact                                                                                                                                                | Principle                                                   | Sev          | Freq                              | Affected                                        | Root cause                                                                             | Recommendation                                                                                                                                                                                                        | Effort | Conf     |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------ | --------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------- |
| UX-001 | Shell                             | On short viewports ≤720px wide the side panel collapses to **0px** and `.workspace{overflow:hidden}` makes all content below the board unreachable                                                            | Verified at 640×400 (≡200% zoom on 1280×800): `side-panel` height 0, tab bar clipped; `styles.css:288` `overflow:hidden`, `:305–310` `flex:1 1 0; min-height:0`                                    | Total content loss. At 200% zoom the app is a top bar and a board                                                                                          | Reflow (WCAG 1.4.10), Feedback                              | **Critical** | Every zoomed/short session        | Low-vision users, phone landscape, split-screen | No minimum-content contract in the responsive layout                                   | Give `.side-panel`/`.chat-wrap` `min-height:12rem`; let `.workspace` scroll below a height threshold; cap board by `dvh` as well as `vh`                                                                              | S      | Verified |
| UX-002 | Top bar / shell                   | Page scrolls horizontally from **~721px to ~823px** (band width depends on filename length); every repertoire scan button leaves the screen                                                                   | Verified: scrollWidth 856 vs client 721/768; screenshot `768x1024-tablet.png` shows `Open workspace`, `Audit`, `Find`, `Scan` clipped. `.topbar{flex-wrap}` applies only ≤720px (`styles.css:331`) | iPad-portrait users cannot see or reach the primary action of any panel section                                                                            | Reflow, Fitts                                               | **Critical** | Every tablet-portrait session     | Tablet, split-screen, 150% zoom                 | Unwrapped flex row with content-driven minimum width                                   | `flex-wrap: wrap` on `.topbar` at all widths; truncate the filename with `min-width:0; text-overflow:ellipsis`; move depth out of the bar                                                                             | S      | Verified |
| UX-003 | Board                             | Chessground root has no `tabindex`, `role`, or `aria-label`, and zero focusable descendants                                                                                                                   | Verified: `{tabindex:null, role:null, aria:null, focusableInside:0}`; `Board.tsx:92–95`                                                                                                            | A keyboard or screen-reader user cannot play or inspect a move — the core task                                                                             | Keyboard (WCAG 2.1.1), Semantics                            | **Critical** | Every session                     | Keyboard-only, screen-reader                    | Third-party board wrapped without an a11y layer                                        | Add a focusable square grid overlay: `role="grid"`, arrow keys move a cursor, `Enter` selects/moves, each square named `e4, white pawn`; announce moves in a live region                                              | L      | Verified |
| UX-004 | Move tree, repertoire panel       | Moves and every result row are `<div>`/`<span>` with `onClick` — not focusable, no role, no key handling                                                                                                      | Verified: 11 `.move`, 0 focusable; `MoveTree.tsx:67–76`, `RepertoirePanel.tsx:176, 189, 207, 253, 300, 330, 396`                                                                                   | Keyboard users can start a scan but cannot open any of its results, and cannot select a move                                                               | Keyboard, Affordance                                        | **Critical** | Every session                     | Keyboard-only, screen-reader                    | No shared interactive-row primitive                                                    | Introduce one `ResultRow`/`MoveButton` primitive rendering a real `<button>`; migrate all call sites                                                                                                                  | M      | Verified |
| UX-005 | Global shortcut                   | `Ctrl+Z` deletes a repertoire node at a leaf with no redo, and merely steps back at an internal node — same key, two behaviours, no feedback                                                                  | `game.ts:177–190` (`children.splice`, no history). Verified: internal-node case only moved the path; `Ctrl+Shift+Z`/`Ctrl+Y` are no-ops                                                            | Silent, unrecoverable loss of a line the user believed they were navigating away from                                                                      | Error prevention, User control, Mapping                     | **Critical** | Occasional but unrecoverable      | All                                             | `undo()` conflates navigation with deletion; no command history                        | Add a bounded inverse-command stack; `Ctrl+Z`=undo, `Ctrl+Shift+Z`=redo; give deletion an explicit control + undo toast                                                                                               | M      | Verified |
| UX-006 | Top bar                           | `New` destroys the document and its only autosave slot with **no confirmation** whenever `dirty()` is false                                                                                                   | Verified: after `markSaved()`, `New` emptied the tree with no dialog. `TopBar.tsx:38`, `persist.ts` (single key `workingRepertoire`)                                                               | A repertoire saved once via the download fallback is unrecoverable from the app                                                                            | Error prevention, Recovery                                  | **Critical** | Low frequency, total loss         | All, worst on Firefox/Safari                    | Confirmation is gated on the wrong signal; single-slot persistence                     | Confirm unconditionally with a scoped message; keep the last 3 autosave snapshots under `Settings → Recover`                                                                                                          | S      | Verified |
| UX-007 | Settings drawer, both modals      | No focus trap, no `inert` background, no `Escape`, no focus restore; global arrow shortcuts stay live behind the overlay                                                                                      | Verified: 10 Tabs all landed outside the open drawer; `Escape` left it open; `→` moved the board from path `[0]`→`[0,0]`. `SettingsDrawer.tsx`, `PromotionModal.tsx`, `ColorPickerModal.tsx`       | Keyboard users are stranded behind a visual overlay and can mutate the document they cannot see                                                            | Modal semantics, User control                               | **Critical** | Every settings/promotion/open     | Keyboard-only, screen-reader                    | Three hand-rolled overlays; the correct pattern exists only in `StrategicFitWorkspace` | Extract that workspace's trap/restore/`Escape`/`inert` logic into a `Dialog` primitive; use it for all three; short-circuit global shortcuts on any open overlay                                                      | M      | Verified |
| UX-008 | Top bar                           | Nine controls spanning document, board, engine, and app settings in one row; **258px tall at 360px wide** (35% of viewport)                                                                                   | Verified heights: 258/240/124/110/63/50px at 360/390/720/768/1024/1280. `TopBar.tsx:19–76`                                                                                                         | Before any chess is visible, a third of a phone screen is chrome; unrelated concepts compete for the same visual weight                                    | Information hierarchy, Gestalt proximity                    | **High**     | Every session                     | All, worst on phone                             | Top bar used as the default home for anything global-ish                               | Three labelled groups (Document · Board · App); depth and eval move to the analysis panel; overflow menu on narrow widths                                                                                             | M      | Verified |
| UX-009 | Analysis panel                    | Engine eval is **off by default**; the empty state says "No lines yet." and the eval bar sits blank at 50%                                                                                                    | `analysis.ts:39` `createSignal(false)`; verified screenshot at 1440                                                                                                                                | The user believes the engine is loading or broken; the actual fix (a toggle in the top bar labelled `Eval Off`) is unrelated-looking and ambiguous         | Feedback, Information scent                                 | **High**     | Every first session               | All                                             | Empty state written for one condition, reused for three                                | `"Engine evaluation is off. [Turn on evaluation]"`; distinct off/starting/offline treatments; relabel the toggle as a switch                                                                                          | S      | Verified |
| UX-010 | Side column                       | The move list — the most-used navigation surface — starts at y≈800 in a 900px viewport, below ten collapsed repertoire sections                                                                               | Verified screenshot `1440x900-desktop.png`; `App.tsx:106–110` render order                                                                                                                         | Every navigation action costs a scroll; the panel that changes on every click is the one you cannot see                                                    | Information hierarchy                                       | **High**     | Every session                     | Desktop/laptop                                  | Column order follows feature-addition order, not frequency                             | Reorder: Move tree → Analysis → Repertoire; give the move tree a fixed share of the column                                                                                                                            | S      | Verified |
| UX-011 | Mobile tabs                       | `role="tab"` without `aria-controls`/`id`/`tabpanel`/roving tabindex/arrow keys; labels carry no state; a running scan is invisible from another tab                                                          | Verified: `aria-controls:null`, `id:""`; scan running → `anyVisibleProgress:false` on the Chat tab. `MobileTabs.tsx`                                                                               | Screen-reader users get a broken tab pattern; all mobile users lose track of running work                                                                  | Semantics, Visibility of status                             | **High**     | Every mobile session              | Mobile, screen-reader                           | Roles applied without the rest of the pattern; no cross-panel status channel           | Complete the ARIA contract; add per-tab status dots/counts; hoist running operations into a persistent activity strip                                                                                                 | M      | Verified |
| UX-012 | Whole core app                    | No `aria-live` region for any core event — save, autosave, restore, scan start/finish, engine ready, chat tool status                                                                                         | Verified grep: only 5 `role=status/alert` in the whole non-SF UI, all for warnings; none announce completion                                                                                       | Screen-reader users receive no confirmation that anything happened                                                                                         | Feedback, Announcements                                     | **High**     | Every session                     | Screen-reader                                   | No status architecture; each component owns its own visual feedback only               | One app-level polite live region fed by a small `announce()` helper; assertive only for errors                                                                                                                        | S      | Verified |
| UX-013 | Dividers                          | 5px-wide (14px-tall on phone) drag-only handles; `role="separator"` with no `tabindex`, no `aria-valuenow`, no keyboard; double-click does not reset                                                          | Verified: dblclick left widths at 240/360; `Divider.tsx`, `styles.css:192–229`                                                                                                                     | Panel sizing is unavailable to keyboard users and hard to hit for anyone with a tremor or a touch screen                                                   | Dragging Movements (WCAG 2.5.7), Target Size (2.5.8), Fitts | **High**     | Occasional                        | Keyboard, touch, motor                          | Divider written as a pure pointer gesture                                              | Focusable separator with `←/→` (±16px), `Home/End`, `aria-valuenow/min/max`; double-click resets to default; widen the hit area to 12px with a 4px visual                                                             | S      | Verified |
| UX-014 | Repertoire panel, move tree       | Interactive targets far below the 24×24 minimum: `.fix-btn` **14px**, `.rep-mode` 19px, `.scan-btn` 20px, `.move` 16px, `.collapse-toggle` 18px, `.divider-h` 14px                                            | Verified measurements at 1280 and 360. `@media (pointer:coarse)` covers only 6 selectors (`styles.css:342–351`)                                                                                    | Mis-taps and repeated attempts on the most frequent actions; formal WCAG 2.2 AA failure                                                                    | Target Size (2.5.8), Fitts                                  | **High**     | Every session                     | Touch, motor, all                               | Coarse-pointer rule written as a spot fix, not a token                                 | Set a `--target-min` token; apply `min-height:24px` universally and `44px` under `pointer:coarse` to every interactive class                                                                                          | S      | Verified |
| UX-015 | Chat                              | Result cards expose contract identifiers (`⚙ analyze_repertoire_congruence`), JSON-key-derived nav labels (`gaps 1`), and a permanent `Raw JSON` disclosure on every result                                   | Verified live render: `"Repertoire findings / gaps 1 / d4 Nf6 Nf3"`, 3 results → 3 raw disclosures. `ToolResult.tsx:78, 83, 783`                                                                   | Users cannot tell what a result is about or why it matters; the conversation reads like a debug log                                                        | Information scent, Plain language                           | **High**     | Every chat session                | All                                             | Domain payloads rendered generically instead of mapped to user labels                  | Map operations to task labels via `tool-contract`; give `NavigationRows` a label dictionary; move `Raw JSON` behind one global technical-details setting                                                              | M      | Verified |
| UX-016 | Strategic Fit                     | Raw hashes used as user-facing identity: `cohort:b6b48b1c47f62275`, excluded branches `fda16c53`                                                                                                              | Verified live: cohort filter options and finding cards. `StrategicFitWorkspace.tsx:519` `strategicFitCohortDisplayName(cohortId, cohortId)` — the fallback is the id                               | Users cannot distinguish, remember, or discuss comparison groups                                                                                           | Recognition over recall, Plain language                     | **High**     | Every SF session                  | All                                             | Identifier used as a display name when no name exists                                  | Derive a display name from the cohort's dominant opening (the data is already on the finding cards); keep the id in a detail row                                                                                      | M      | Verified |
| UX-017 | Strategic Fit                     | Header reads `Analysis complete` while the body reports `Preflight degraded`, `0/6 comparable routes`, and six `Insufficient evidence` findings                                                               | Verified end-to-end run on a 6-line repertoire                                                                                                                                                     | The user is told it worked, then shown that nothing was measured, with no statement of what would make it work                                             | Feedback, Error recovery                                    | **High**     | Every small/shallow repertoire    | All SF users                                    | Lifecycle status and evidence status are independent and not reconciled in the UI      | Header becomes `Analysis finished — limited evidence` when preflight is degraded; when `comparable_route_count === 0`, replace findings/evidence/resolution with one directive state naming the threshold and the fix | M      | Verified |
| UX-018 | Strategic Fit                     | Six "analysis phase" cards plus the preflight block fill the entire first screen; the first finding is below the fold at 1440×900                                                                             | Verified screenshot `sf-analysed-overview.png`                                                                                                                                                     | Process telemetry outranks results; the user scrolls past the machine's self-report to reach their answer                                                  | Information hierarchy, Progressive disclosure               | **High**     | Every SF session                  | All                                             | Progress UI kept at full size after completion                                         | Collapse the phase list to one line on completion (`All six phases completed ▸`); keep preflight but compress to a one-line summary with a disclosure                                                                 | S      | Verified |
| UX-019 | Promotion / colour-picker modals  | No `role="dialog"`, no `aria-modal`, no accessible names on promotion glyph buttons, backdrop click silently cancels a move or a file load                                                                    | `PromotionModal.tsx:22–37`, `ColorPickerModal.tsx:11–47`                                                                                                                                           | A screen-reader user cannot tell a modal opened or what the four glyphs are; a stray click discards work                                                   | Semantics, Error prevention                                 | **High**     | Every promotion / every file open | Screen-reader, all                              | Hand-rolled overlays (see UX-007)                                                      | Use the `Dialog` primitive; label buttons `Promote to queen` etc.; make the backdrop dismiss non-destructive or add an explicit `Cancel`                                                                              | S      | Verified |
| UX-020 | Chat staged edits                 | Card reports `nodes 45 → 46 · leaves 6 → 7`; `Accept` states neither scope nor reversibility                                                                                                                  | Verified render; `ToolResult.tsx:600–607`                                                                                                                                                          | The user cannot judge the size of a change, and does not know it can only be undone by a shortcut that deletes                                             | Plain language, User control                                | **High**     | Every accepted suggestion         | All                                             | Tree statistics surfaced verbatim                                                      | Rewrite as moves/lines (see §4.15); add "You can undo this" once undo exists                                                                                                                                          | XS     | Verified |
| UX-021 | Repertoire panel                  | Ten sections organised by implementation tier (an unexplained `Advanced` label splits them), all identical `<details>` with identical `Scan`/`Find`/`Search` buttons                                          | `RepertoirePanel.tsx:148–403`; source comments name "Tier A"/"Tier B"                                                                                                                              | The user cannot form a model of what the panel offers or which action answers their question                                                               | Hick–Hyman, Information scent, Gestalt similarity           | **High**     | Every session                     | All                                             | Feature organisation mirrors the code's build order                                    | Regroup by goal: _Check my repertoire_ (audit, gaps, only moves) · _Extend it_ (extend, connect) · _Simplify it_ (shorten) · _Prepare & export_ (opponent prep, structure search, annotated PGN, drill deck)          | M      | Verified |
| UX-022 | Top bar                           | The depth-30 notice re-appears every time depth reaches 30; dismissal is not remembered; it fires during slider drags                                                                                         | Verified: dismissed, re-set to 30, notice returned. `TopBar.tsx:13–17`                                                                                                                             | Repeated nagging trains dismissal-without-reading                                                                                                          | Feedback proportionality                                    | Medium       | Frequent for deep-analysis users  | All                                             | Notice state is local and unpersisted                                                  | Replace with persistent inline helper text under the control shown at depth ≥ 25                                                                                                                                      | XS     | Verified |
| UX-023 | Board                             | Green/yellow/red arrows and thick/medium/thin widths encode fit and eval with **no legend anywhere**; green means both "your book continues here" and "engine top move that is in-book"                       | `analysis.ts:32–33, 43–49`; `AnalysisPanel.tsx:12` `{in-book:"book", adjacent:"adj", out:"out"}`                                                                                                   | The board's richest information channel is unreadable until the user reverse-engineers it                                                                  | Recognition over recall, Consistency                        | Medium       | Every session                     | All                                             | Encoding designed once, never surfaced                                                 | Add a compact legend row under the analysis panel; distinguish repertoire arrows from engine arrows (e.g. dashed vs solid); expand `book/adj/out` to `in book / one move off / not in book`                           | S      | Verified |
| UX-024 | Shell                             | Three breakpoints (720 / 820 / 1100) with no shared policy; crossing 1100→1101 shrinks the board from **560px to 325px** (−42%)                                                                               | Verified measurements                                                                                                                                                                              | Resizing a window produces an unexplained, jarring re-layout                                                                                               | Consistency, Mapping                                        | Medium       | On resize / external display      | Desktop, tablet                                 | No responsive-state policy; each feature chose its own breakpoint                      | Define three named tiers with shared custom-property breakpoints; smooth the 1100 transition by seeding flex widths from the grid widths                                                                              | M      | Verified |
| UX-025 | Global CSS                        | `user-select:none` on `body` with exceptions only for `input`, `textarea`, `[contenteditable]` — FEN strings, SAN lines, eval numbers, error messages, chat text, and report ids cannot be selected or copied | `styles.css:20–40`                                                                                                                                                                                 | In a tool whose main export is a FEN or a line, copying is impossible without devtools                                                                     | User control, Consistency                                   | **High**     | Frequent                          | All, especially desktop analysts                | Broad gesture-suppression rule applied app-wide                                        | Invert: `user-select:none` only on `.cg-wrap`, `.topbar`, `.mobile-tabs`, `.divider`; `user-select:text` everywhere content lives; add a copy button to FEN and SAN-path displays                                     | S      | Verified |
| UX-026 | Global CSS                        | `prefers-reduced-motion` and `forced-colors` are handled **only** inside `.strategic-fit-*`/`.replacement-*`; the board's 120ms piece animation, eval-bar transition, and divider transitions are unguarded   | `styles.css:4872, 4890, 5424` (all SF-scoped); `Board.tsx:39` `animation:{enabled:true}`                                                                                                           | Motion-sensitive users get animated pieces; forced-colors users lose the core status colours                                                               | Motion, Forced colors                                       | Medium       | Per-user, persistent              | Vestibular, high-contrast                       | Accessibility work scoped to the newest feature only                                   | Promote both media blocks to global; bind chessground `animation.enabled` to `matchMedia('(prefers-reduced-motion: reduce)')`                                                                                         | S      | Verified |
| UX-027 | Global CSS                        | All 34 `:focus-visible` rules are inside Strategic Fit / Replacement selectors; the core app relies on the UA default                                                                                         | Verified grep + tab walk (`outline: auto 1px`)                                                                                                                                                     | Focus is visible but visually inconsistent between the two halves of the product                                                                           | Visible focus, Consistency                                  | Medium       | Keyboard sessions                 | Keyboard                                        | Same scoping cause as UX-026                                                           | One global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`                                                                                                                                 | XS     | Verified |
| UX-028 | Chat column                       | 360px of permanent width (25% of a 1440 screen) reserved for a feature that is unusable without an API key, showing only "No API key."                                                                        | Verified screenshot `1440x900-desktop.png`                                                                                                                                                         | A quarter of the workspace is dead space until the user completes an unprompted setup step                                                                 | Information hierarchy                                       | Medium       | Until a key is set                | All new users                                   | Layout allocates by structure, not by state                                            | Collapse the chat to a 44px rail with a `Set up assistant` call to action until `hasApiKey()`; restore the column on activation                                                                                       | S      | Verified |
| UX-029 | Files                             | On browsers without File System Access, `Save` downloads and calls `markSaved()`, but no handle is stored — so `Reopen` never appears and the user has no in-app path back                                    | `files.ts:134–141`                                                                                                                                                                                 | The user believes the app is linked to a file that it cannot read back                                                                                     | Feedback, Mapping                                           | Medium       | Every Firefox/Safari session      | ~35% of desktop users                           | Two save paths with one success state                                                  | On the fallback path show: _"Downloaded my-rep.pgn. This browser can't re-link the file — use Open PGN to load it again."_                                                                                            | XS     | Verified |
| UX-030 | Design system                     | 100+ rules set text below 12px (32× 0.72rem, 32× 0.68rem, 18× 0.62rem, 12× 0.57rem ≈ 9.1px)                                                                                                                   | Verified counts over `styles.css`                                                                                                                                                                  | Dense analytical panels become genuinely hard to read, especially zoomed or on a phone                                                                     | Legibility, Density                                         | Medium       | Every session                     | All, worst for low-vision                       | No typography scale — sizes chosen per rule                                            | Define a 6-step scale (`--fs-xs:0.75rem` floor … `--fs-xl`); replace ad-hoc values; reserve ≤0.75rem for uppercase labels only                                                                                        | M      | Verified |
| UX-031 | Top bar / persistence             | "Save" and "saved" mean both IndexedDB autosave and PGN file export; `● unsaved` actually means "differs from the file"; nothing shows that autosave exists or when it last ran                               | `TopBar.tsx:21–33`, `persist.ts`                                                                                                                                                                   | Users cannot answer "where is my work right now?" or "what happens if I close this tab?"                                                                   | Visibility of status, Plain language                        | **High**     | Every session                     | All                                             | One vocabulary for two persistence layers                                              | Two indicators: `Stored in this browser · autosaved 12:04` and `File: my-rep.pgn — 3 changes not exported`; rename the button `Save to file`                                                                          | S      | Verified |
| UX-032 | Top bar                           | `reopenLast()` returns silently when permission is denied                                                                                                                                                     | `files.ts:159`                                                                                                                                                                                     | The button appears broken                                                                                                                                  | Feedback                                                    | Medium       | Occasional                        | All                                             | Early return without a user-facing branch                                              | Show a message and offer `Open PGN` instead                                                                                                                                                                           | XS     | Verified |
| UX-033 | Strategic Fit                     | The four-stage nav is `display:none` above 820px and the Resolution pane is hidden there; resolution actions are duplicated inside the Evidence pane                                                          | `styles.css:1711–1713`, `:4787–4792`; `StrategicFitWorkspace.tsx:630, 672`                                                                                                                         | The documented `setup → … → resolution` progression exists only on small screens; desktop users get three columns with no stage model and duplicated logic | Consistency, Mapping                                        | Medium       | Every desktop SF session          | Desktop                                         | Two layouts expressing two different mental models                                     | Keep the stage model at all widths — either as a persistent progress header over the three columns, or as a fourth column                                                                                             | M      | Verified |
| UX-034 | Chat errors                       | `ErrorResult` prints the mapped label **and** the raw code (`engine_unavailable`)                                                                                                                             | `ToolResult.tsx:692`; verified render                                                                                                                                                              | Internal identifiers in the primary error surface; no recovery action                                                                                      | Plain language, Error recovery                              | Medium       | On every failure                  | All                                             | Debug affordance left in the production card                                           | Hide the code behind the technical-details setting; add a recovery action per code (`engine_unavailable` → `Retry`, `explorer_auth_required` → `Add Lichess token`)                                                   | S      | Verified |
| UX-035 | Repertoire panel                  | The Strategic Fit entry card is inside the scrolling repertoire panel, below the analysis panel, and never says what Strategic Fit does                                                                       | `RepertoirePanel.tsx:148–160`                                                                                                                                                                      | The most sophisticated capability in the product is the least discoverable and the least explained                                                         | Information scent, Discoverability                          | Medium       | Every session                     | All                                             | Entry point placed where the code lived                                                | Promote to a top-level entry with a value sentence (§4.20)                                                                                                                                                            | S      | Verified |
| UX-036 | Gaps section                      | `"No scan yet — or no gaps."` collapses two opposite states into one string                                                                                                                                   | `RepertoirePanel.tsx:246`                                                                                                                                                                          | The user cannot tell whether the repertoire is clean or the work was never done                                                                            | Feedback                                                    | Medium       | Every session                     | All                                             | One empty state reused for two conditions                                              | Split into a pre-scan call to action and a post-scan success message                                                                                                                                                  | XS     | Verified |
| UX-037 | Repertoire panel                  | Scan errors render with the `.empty` class, so failures look identical to empty results                                                                                                                       | `RepertoirePanel.tsx:96, 244, 293, 323`                                                                                                                                                            | Users read a failure as "nothing found"                                                                                                                    | Consistency, Error presentation                             | Medium       | On failure                        | All                                             | No error pattern distinct from the empty pattern                                       | Add an `.error-state` treatment (icon + accent border + retry)                                                                                                                                                        | XS     | Verified |
| UX-038 | Analysis panel                    | `Suggested (from chat)` appears in the analysis panel while its source card lives in the chat column, with no link between them                                                                               | `AnalysisPanel.tsx:62–84`                                                                                                                                                                          | The user must remember which chat message produced which suggestion                                                                                        | Recognition over recall, Proximity                          | Low          | When chat suggests lines          | All                                             | Cross-panel coupling without a back-reference                                          | Add "from chat" with a link that scrolls the conversation to the source card                                                                                                                                          | S      | Verified |
| UX-039 | Shorten section                   | Inspect results use `evalΔ`, `fit 0.33→0.5`, `structureStay→structureTranspose`, `↓`/`★` badges, `"fit weak — branches resemble the repertoire about equally"`                                                | `RepertoirePanel.tsx:350–372`                                                                                                                                                                      | Dense, undefined, symbol-heavy — the reasoning is present but unreadable                                                                                   | Plain language, Recognition                                 | Medium       | When shortening                   | All                                             | Internal comparison model rendered directly                                            | Lead with the verdict sentence, then the numbers under a `Why?` disclosure; give `↓`/`★` text labels                                                                                                                  | S      | Verified |
| UX-040 | Chat                              | The `.tool-run` list renders after the log rather than inline with the message that triggered it, and resets on every `send()`                                                                                | `ChatPanel.tsx:106–122`; `chat.ts:172` `setToolRuns([])`                                                                                                                                           | Users lose the record of what ran for a previous turn                                                                                                      | Visibility of status                                        | Medium       | Every multi-tool turn             | All                                             | Run state is per-request, the log is per-conversation                                  | Attach runs to their assistant message and keep them in history                                                                                                                                                       | M      | Verified |
| UX-041 | Shell                             | The service worker uses `registerType:"autoUpdate"` with no user-facing notification                                                                                                                          | `vite.config.ts:25`                                                                                                                                                                                | The app can change under a long analysis session with no explanation                                                                                       | Feedback, User control                                      | Medium       | On each deploy                    | All                                             | Update strategy chosen without a UI surface                                            | Add a `New version available — Reload` toast; defer while an operation is running                                                                                                                                     | S      | Verified |
| UX-042 | Only moves / annotated repertoire | Two sequential same-looking buttons (`Generate` then `Save`) in the same slot, with no state explaining the order                                                                                             | `RepertoirePanel.tsx:194–199, 222`                                                                                                                                                                 | Users click `Generate` twice or miss `Save` entirely                                                                                                       | Mapping, Feedback                                           | Medium       | Per export                        | All                                             | Artifact lifecycle exposed as two raw steps                                            | One action with an internal progress→download state                                                                                                                                                                   | S      | Verified |
| UX-043 | Strategic Fit                     | Advanced-preference help text repeats verbatim for four sliders and depends on the undefined term "strategic distance"                                                                                        | `sf-open-1440.png`, `ProfileSetup.tsx`                                                                                                                                                             | Four identical paragraphs teach nothing and inflate the wizard                                                                                             | Plain language, Density                                     | Low          | First run                         | All SF users                                    | Per-field copy with no shared definition                                               | Define the term once above the group; reduce each field to a name + two-word effect                                                                                                                                   | XS     | Verified |
| UX-044 | Whole app                         | No shortcut discoverability: no help sheet, no tooltips listing keys, no customisation                                                                                                                        | `App.tsx:45–65` is the only definition                                                                                                                                                             | Power features are invisible; `Ctrl+Z`'s danger is undocumented                                                                                            | Recognition over recall                                     | Medium       | Every session                     | All                                             | Shortcuts implemented, never surfaced                                                  | A `?` shortcut opening a keyboard reference, linked from Settings                                                                                                                                                     | S      | Verified |
| UX-045 | Strategic Fit                     | `aria-hidden="true"` is set on the workspace when the Replacement Lab opens, but the workspace is **not** `inert`                                                                                             | `StrategicFitWorkspace.tsx:417`                                                                                                                                                                    | Focus can still reach elements hidden from the accessibility tree — the classic "hidden but focusable" conflict                                            | Modals and inert content                                    | Medium       | When the Lab is open              | Screen-reader, keyboard                         | `aria-hidden` used without `inert`                                                     | Use `inert` alongside `aria-hidden`, matching `App.tsx:72–73`                                                                                                                                                         | XS     | Verified |
| UX-046 | Chat                              | Nothing tells the user what context the assistant can see, though FEN, colour, path, revision, filename, and tree stats are injected on every turn                                                            | `chat.ts:52–59`                                                                                                                                                                                    | Users over- or under-explain, and cannot tell whether the assistant is looking at the current position                                                     | Visibility of status, Mental model                          | Medium       | Every chat session                | All                                             | Injected context has no UI representation                                              | A context chip above the input that expands to the full injected block                                                                                                                                                | S      | Verified |
| UX-047 | Chat                              | `Stop` aborts the whole turn including in-flight tools; `Retry` re-sends the last _user message_, not the failed step. Neither label says so                                                                  | `chat.ts:27–28`, `ChatPanel.tsx:126, 150`                                                                                                                                                          | Users expect step-level control and get turn-level                                                                                                         | Information scent, Mapping                                  | Medium       | On interruption                   | All                                             | Labels shorter than their scope                                                        | `Stop this request` / `Send again`; add per-run `Cancel` on long tools                                                                                                                                                | S      | Verified |
| UX-048 | Design system                     | Two visual languages: the SF workspace uses larger type, 8–9px radii, distinct surfaces and a bespoke focus ring; the core app uses 10–12px type and UA focus                                                 | Verified screenshots; 993/1226 class rules are SF-scoped                                                                                                                                           | The product reads as two applications, and quality expectations set by one are broken by the other                                                         | Consistency                                                 | **High**     | Every session                     | All                                             | Investment asymmetry (see §11)                                                         | Extract the SF workspace's tokens (spacing, radius, focus, surface, type) into the root and adopt them in the core surfaces                                                                                           | L      | Verified |

---

## 6. Terminology and content audit

Classification: **1** standard chess · **2** standard engine-analysis · **3** standard software · **4** product-specific · **5** internal implementation · **6** ambiguous.

| Current term                            | Class | Where used                                                    | Likely interpretation                                  | Problem                                                                    | Recommended user-facing term / explanation                                                                                    | Preserve expert term?               |
| --------------------------------------- | ----- | ------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Strategic Fit**                       | 4     | Entry card, workspace title, chat cards                       | "Does this suit me?" — roughly right, but unanchored   | Names the machinery, not the question                                      | Keep as the feature name; always pair with the question: _"Is your repertoire asking you to learn too many different plans?"_ | Yes                                 |
| **Congruence**                          | 4/5   | `analyze_repertoire_congruence`, annotated-PGN summary        | Unknown to nearly all users                            | Legacy internal name for Strategic Fit                                     | Retire from the UI; use "strategic fit" everywhere                                                                            | No                                  |
| **Cohort**                              | 5     | SF filters, finding cards, evidence panel — **as a raw hash** | Meaningless                                            | Identifier used as a display name (UX-016)                                 | _Comparison group_ + the group's dominant opening: `Comparison group: London System (3 lines)`                                | Hash in a detail row only           |
| **Finding**                             | 4     | Findings pane, chat cards                                     | "Something it found" — acceptable                      | Fine as a noun, weak as a section title                                    | Keep. Title the pane `What stands out` with `Findings` as the sub-label                                                       | Yes                                 |
| **Candidate**                           | 4     | Candidate table, replacement lab                              | Ambiguous — candidate move, or candidate repertoire?   | Overloaded against the chess meaning of "candidate move"                   | _Alternative line_ (when it replaces a line) / _Option_ (in the portfolio)                                                    | Yes, in the expert table header     |
| **Prescribed move**                     | 4     | Audit section                                                 | "The move my book says to play" — correct              | Slightly formal but precise                                                | _Your book move_ (title: `Are your book moves the best moves?`)                                                               | Yes                                 |
| **Only move**                           | 1     | Only-moves section, drills                                    | Correct among strong players                           | Fine; the _margin_ metric is not                                           | Keep. Replace `margin 47cp` with `only move by 0.47` + _"Any other move loses at least 0.47 pawns."_                          | Yes                                 |
| **Structure**                           | 1     | Structure search, heatmap                                     | Pawn structure — correct                               | Fine                                                                       | Keep; label the input `Pawn structure (e.g. Carlsbad)`                                                                        | Yes                                 |
| **Gap**                                 | 4/6   | Gaps section                                                  | "Something missing" — but missing what?                | Under-specified                                                            | _Unanswered opponent moves_                                                                                                   | Keep `gap` in expert copy           |
| **Covered**                             | 4     | Gaps sub-rows                                                 | Reasonable                                             | Fine, but `covered → Bf4` is cryptic                                       | _Already answered — transposes into 3.Bf4_                                                                                    | Yes                                 |
| **Connect / Bridge / Stub**             | 4/5   | Connect section, `ExtendedBridge`                             | Networking metaphor, not chess                         | Mixed metaphor                                                             | Section: _Finish unfinished lines_; row: _3.Bf4 … rejoins your 2.Nf3 line_                                                    | No                                  |
| **Shorten / Prune / Reroute**           | 4     | Shorten section                                               | Understandable in context                              | `✂`, `↓`, `★` badges are unlabelled                                        | Section: _Shorten what you memorise_; badges get text                                                                         | Partly                              |
| **Fit (0.33 → 0.5)**                    | 5     | Shorten inspect, gap fills                                    | A number with no scale                                 | Unitless internal score                                                    | _Resembles the rest of your repertoire: low → medium_; keep the number under `Why?`                                           | Under disclosure                    |
| **Resolution proof**                    | 5     | SF resolution panel                                           | Mathematical proof?                                    | Describes the mechanism, not the value                                     | _Did this help?_ — with statuses in §4.25                                                                                     | No                                  |
| **Training exception**                  | 4     | `TrainException` card                                         | "An exception to training"?                            | Backwards — it means _keep this line and train it instead of replacing it_ | _Keep and train this line_                                                                                                    | No                                  |
| **Change set**                          | 3/5   | Change-set preview                                            | Version-control vocabulary                             | Correct but developer-register                                             | _Proposed changes_ / _These edits_                                                                                            | In the expert detail row            |
| **Revision**                            | 5     | Chat cards, staged actions, SF snapshots                      | Document version — mostly opaque                       | Internal monotonic counter surfaced verbatim                               | Never show the number. Express as recency: _"Your repertoire has changed since this was prepared."_                           | No                                  |
| **Stale revision / stale report**       | 5     | Staged cards, SF lifecycle, error labels                      | "Old" — direction unclear                              | States the condition, not the recovery                                     | _No longer matches your repertoire — [Refresh]_                                                                               | No                                  |
| **Pareto / dominated by**               | 5     | Replacement Pareto, portfolio options                         | Unknown outside operations research                    | Technical term at the primary level                                        | _No option beats it on every measure_ / _Beaten by X on every measure_; keep "Pareto-optimal" as a secondary line             | Secondary only                      |
| **Capability / capability token**       | 5     | (MCP host only)                                               | —                                                      | **Correctly absent from the UI.** Keep it that way                         | —                                                                                                                             | n/a                                 |
| **Workflow / mode**                     | 3/6   | Chat mode select                                              | "Some kind of setting"                                 | Effect never stated                                                        | Label the row `Focus`; describe the selection: _"Answers are framed around building a repertoire. All tools stay available."_ | No                                  |
| **Tool result**                         | 5     | `.tool-result-label`, `⚙ tool_name` chips                     | "The AI ran something"                                 | Exposes the mechanism                                                      | Replace identifiers with task labels: `Checked repertoire coverage`                                                           | No                                  |
| **Live analysis / Eval**                | 2     | Top bar toggle, analysis panel                                | Correct                                                | `Eval On/Off` is state-or-action ambiguous                                 | `Engine evaluation` with a switch                                                                                             | Yes                                 |
| **Scan**                                | 3/6   | Six buttons                                                   | "It will look at things" — but how long, at what cost? | One verb for six different operations of very different cost               | Verb the goal: `Find unanswered moves`, `Check book moves`, `Find critical positions`                                         | No                                  |
| **Depth**                               | 2     | Top bar                                                       | Correct for engine users                               | Global control, local effect, no cost cue                                  | Keep; add _"Higher depth is more accurate and much slower."_                                                                  | Yes                                 |
| **Repertoire mutation / staged edit**   | 5     | Internal + card titles                                        | —                                                      | `Proposed add edit` is generated from an enum                              | _Add to your repertoire_ / _Remove from your repertoire_ / _Reorder these lines_                                              | No                                  |
| **nodes / leaves / max_depth**          | 5     | Staged cards, chat context                                    | Graph theory                                           | Tree internals as user-facing metrics                                      | _moves_ / _lines_ / _deepest line_                                                                                            | No                                  |
| **Preflight**                           | 5     | SF results panel                                              | Aviation metaphor                                      | Accurate but foreign                                                       | _Evidence check_ (`Input and evidence check` sub-label already exists — promote it)                                           | No                                  |
| **Provisional / degraded / blocked**    | 5     | SF states, chat report card                                   | Ops vocabulary                                         | Severity unclear                                                           | _Early results_ / _Limited evidence_ / _Couldn't run_                                                                         | Yes in the detail row               |
| **Trajectory / milestone / checkpoint** | 4     | Evidence comparison                                           | Plausible but undefined                                | Three near-synonyms for one idea                                           | Pick one — _key moment_ — and define it once                                                                                  | Yes for `checkpoint` in expert copy |
| **Strategic distance**                  | 4     | Map axes, profile sliders                                     | "How different" — roughly right                        | Never defined before first use                                             | Define once: _"How different two lines' plans are. Far apart = different ideas to learn."_                                    | Yes                                 |
| **artifact**                            | 5     | `saveArtifact`, `Generated artifact`                          | Software term                                          | Leaks in the fallback card title                                           | _File_ / name it: `Annotated repertoire (PGN)`                                                                                | No                                  |

### Replacement copy

**Buttons.** `Save` → `Save to file` · `New` → `New repertoire` · `Scan` → goal verbs (above) · `Generate` + `Save CSV deck` → `Create drill deck` · `Open workspace` → `Open Strategic Fit` · `Stop` → `Stop this request` · `Retry` → `Send again` · `Accept` → `Add to repertoire` · `Reject` → `Dismiss` · `Fill this` → `Suggest an answer` · `Suggest` → `Suggest next moves` · `?` (inspect) → `Why?`

**Labels.** `Eval Off` → `Engine evaluation ⬤ Off` · `Depth` → `Engine depth` · `● unsaved` → `3 changes not exported` · `book / adj / out` → `in book / one move off / not in book` · `cloud` → `Lichess cloud eval` · `Advanced` (repertoire divider) → delete; use the goal groups of UX-021.

**Notices.**

- Deep analysis: _"Depth 30 is the most accurate setting and the slowest. A full repertoire scan can take several minutes."_ (inline, persistent at depth ≥ 25).
- Restore: _"Restored your work from this browser — last change 14:32."_
- PWA update: _"A new version is ready. Reload to use it."_ `[Reload] [Later]`
- Download fallback: _"Downloaded my-rep.pgn. This browser can't re-link the file — use Open PGN to load it again."_

**Empty states.**

- App first run: **Start a repertoire.** _Open a PGN file, or play moves on the board to build one from scratch. Your work is stored in this browser until you save it to a file._ `[Open PGN] [Start from scratch]`
- Analysis, eval off: **Engine evaluation is off.** _Turn it on to see the engine's top moves for this position._ `[Turn on evaluation]`
- Analysis, engine offline: **The engine didn't start.** _Board arrows and evaluations are unavailable. Reload the page to try again._ `[Reload]`
- Gaps, pre-scan: **Find unanswered opponent moves.** _Checks every position where your opponent can deviate and flags replies your repertoire doesn't answer._ `[Find unanswered moves]`
- Gaps, post-scan clean: **No unanswered moves.** _Every opponent reply in your repertoire has a prepared answer._
- Chat, no key: **Set up the assistant.** _The assistant runs on your own OpenRouter key. It can read the current position and your repertoire, and propose changes you approve._ `[Add API key]`

**Error states.**

- Engine: **The engine isn't available.** _This can happen if too many analyses are running. Wait a moment and try again._ `[Retry]`
- Lichess: **Lichess access needed.** _Add a Lichess token in Settings to use opening-explorer data._ `[Open Settings]`
- Path: **That line isn't in your repertoire any more.** _It may have been removed or renamed since this result was produced._
- Load failure: **Couldn't read that PGN.** _<parser message>. Check the file opens in another chess program, then try again._

**Stale-revision messages.**

- Staged edit: _"Your repertoire changed since this was suggested, so it may no longer fit. Ask again for a fresh suggestion."_ `[Ask again]`
- SF report: _"This report was made before your latest edits. Re-run the analysis to see current results."_ `[Analyze again]`
- SF resolution blocked: _"You can't record a decision on an out-of-date report — the lines it describes may have changed. Analyze again first."_ `[Analyze again]`

**Destructive confirmations.**

- New, unsaved: **Start a new repertoire?** _"my-rep.pgn" has 4 changes that were never saved to a file. They'll be lost._ `[Keep working] [Save to file first] [Discard and start new]`
- New, saved: **Start a new repertoire?** _"my-rep.pgn" will be closed. It's saved to your file, so you can open it again._ `[Cancel] [Start new]`
- Open with unsaved changes: **Open a different repertoire?** _"my-rep.pgn" has 4 changes that were never saved to a file._ `[Cancel] [Save to file first] [Discard and open]`
- Delete a line: **Delete 3…Bf4 and 2 continuations?** `[Cancel] [Delete]` → toast _"Deleted 3 moves. [Undo]"_

**Strategic Fit explanations.**

- Entry: **Is your repertoire asking you to learn too many different plans?** _Strategic Fit compares the ideas behind your lines and flags the ones that stand apart from the rest. Opening it doesn't analyse or change anything._
- Post-analysis, no comparable routes: **Not enough comparable lines yet.** _Strategic Fit compares branches that reach at least move 12 and share measurable structure. This repertoire has 6 lines, none of which are comparable yet. Extend your main lines further, or add a second system, then analyse again._ `[Analyze again]`
- Finding card lead-in: **This line asks for different plans than the rest of your <London System> lines.** _You'll need to learn <2 extra structures> to play it well._

---

## 7. Density and hierarchy audit

### Top bar

|                             |                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**                    | Know which document is open and whether it is safe; act on it                                                                                                                                  |
| **Primary content**         | Filename + persistence state                                                                                                                                                                   |
| **Primary action**          | Save to file                                                                                                                                                                                   |
| **Secondary**               | Open, New, Reopen                                                                                                                                                                              |
| **Persistent state**        | Autosave status, dirty state                                                                                                                                                                   |
| **Advanced**                | Depth, eval toggle, colour, settings                                                                                                                                                           |
| **Problems**                | Nine peers of equal weight; state text competing with buttons; filename unbounded (461px at 1280, 5 lines at 768); engine controls with global reach but local effect; **258px tall at 360px** |
| **Recommended hierarchy**   | `[Repertoire ▾ …file menu] my-rep.pgn · Stored in this browser · 3 changes not exported   ——   [♔ White ▾] [Settings]`                                                                         |
| **Stays visible**           | Filename, persistence state, save action, colour                                                                                                                                               |
| **Behind disclosure**       | Open / Reopen / New inside a `Repertoire ▾` menu; Settings unchanged                                                                                                                           |
| **Moves closer to content** | Eval toggle **and** depth → analysis panel header                                                                                                                                              |
| **Removed**                 | The word "Chess Repertoire" on narrow widths; the depth number input (slider + value chip suffices)                                                                                            |

### Board region

Goal: see and manipulate the position. Content: the board. Actions: play, navigate. State: side to move, eval, last move, arrows.
Problems: the eval bar has a 9.6px `mix-blend-mode` label and no accessible name; no arrow legend (UX-023); no board-local navigation controls (◀ ▶ ⏮ exist only as keys); the board consumes 70vh regardless of remaining space (UX-001).
Recommended: a slim strip under the board — `⏮ ◀ ▶ ⏭ · 1.d4 Nf6 2.Nf3 · ⟲ flip · legend ⓘ`. Board sized by `min(70vh, 45dvh + 20vh, 100% - 26px)` so it yields on short viewports.

### Analysis panel

Goal: what does the engine think, and does it match my book? Content: three lines with fit + eval. Action: turn evaluation on. State: analysing / offline / off.
Problems: `POSITION` / `ENGINE LINES · DEPTH 20` are two competing headers in 10px and 12.5px uppercase; the cloud row shows `—` permanently when disabled; `Suggested (from chat)` is an orphan (UX-038); the empty state misdiagnoses (UX-009).
Recommended: one header `Engine · depth 20 [⚙]` with the gear opening depth + eval + cloud. The `[⚙]` disclosure is where UX-008's controls land. Legend row under the lines. Chat suggestions get a back-link.

### Repertoire panel

Goal: find and fix problems in the repertoire. Content: findings. Actions: run a check, act on a row.
Problems: ten identical `<details>`, one unexplained `Advanced` divider, `scope-note` metadata repeated on five sections (`Engine-backed operations use depth 20.` at panel level _and_ `Up to 20 positions · depth 20 · local engine` per section), all action buttons 20px or 14px tall, rows are click-only divs.
Recommended: four goal groups (UX-021), each collapsed to a single row showing its last result summary (`Unanswered moves — 2 found · 4 min ago`). Depth stated once, in the panel header. Rows become buttons with a 32px minimum.
**Keep the density of the result rows themselves** — `severity · line · eval` on one line is productive density and should not be spread out.

### Move tree

Goal: know where I am and go somewhere else. Content: the tree. State: current node, previewed nodes.
Problems: below the fold (UX-010); 16px targets; branch collapse toggles are 18px `–`/`+N`; the current-line strip scrolls horizontally with no scrollbar affordance.
Recommended: top of the column, fixed share `min(45vh, 24rem)`. Keep the strip but add fade-out edge indicators. Toggles become 24px with `aria-expanded`.

### Chat

Goal: ask a question and act on the answer. Content: conversation + result cards. Action: send / accept a proposal.
Problems: 360px permanently reserved even with no key (UX-028); `Raw JSON` on every card; identical card shells for informational and mutating results; the tool-run list detached from the log.
Recommended: rail until configured. Three card tiers — **informational** (flat), **navigational** (subtle border + go action), **mutating** (accent left border, `Changes your repertoire` badge, reversibility line). One collapsed `Details` per card replacing `Raw JSON`.

### Strategic Fit workspace

Goal: decide whether to change the repertoire. Content: findings + evidence. Action: resolve a finding.
Problems: process telemetry owns the first screen (UX-018); stage model exists only ≤820px (UX-033); raw hashes (UX-016); axis explanations written as specifications.
Recommended: header row `Strategic Fit · Balanced profile · 6 findings, 6 unresolved · Limited evidence ⓘ · [Analyze again] [Close]`. Phases and preflight collapse to one line each on completion. A persistent stage strip above the columns at all widths.
**Keep** the chart/table dual rendering, the bounded-list disclosures, the print/export mode, and every "what was withheld" statement.

---

## 8. Responsive and mobile audit

All figures verified at runtime with a 78-character filename loaded.

| Viewport                    | Top bar                 | Board     | Side panel | Chat   | Verdict                                                          |
| --------------------------- | ----------------------- | --------- | ---------- | ------ | ---------------------------------------------------------------- |
| **360×740** small phone     | **258px** (5 rows)      | 318px     | **66px**   | hidden | Unusable — the analysis panel shows one and a half lines of text |
| **390×844** large phone     | 240px                   | 348px     | 158px      | hidden | Poor — one visible result row                                    |
| **720×900** breakpoint edge | 124px                   | 630px     | **48px**   | hidden | Board dominates; the panel is a sliver                           |
| **721×900** just above      | 110px                   | 466px     | 320px      | 824px  | **Horizontal overflow +135px**                                   |
| **768×1024** iPad portrait  | 110px (5-line filename) | 466px     | 320px      | 824px  | **Horizontal overflow +88px — every scan button off-screen**     |
| **1024×768** iPad landscape | 63px                    | 538px     | 320px      | 992px  | Acceptable; chat below in a 360px band                           |
| **1100×800** grid edge      | 63px                    | 560px     | 320px      | 1068px | Acceptable                                                       |
| **1101×800** flex edge      | 63px                    | **325px** | 300px      | 360px  | **Board drops 42% across one pixel**                             |
| **1280×800** laptop         | 50px                    | 504px     | 300px      | 360px  | Good, but the move tree is below the fold                        |
| **1280×600** short laptop   | 50px                    | 420px     | 300px      | 518px  | Cramped; move tree unreachable without scrolling                 |
| **1440×900** desktop        | 50px                    | 630px     | 300px      | 360px  | Good                                                             |
| **1920×1080**               | 50px                    | 756px     | 300px      | 360px  | Board over-large; panels do not scale with the window            |

### Zoom (emulated as reduced CSS viewport at 1280×800)

| Zoom | CSS viewport | Result                                                                       |
| ---- | ------------ | ---------------------------------------------------------------------------- |
| 100% | 1280×800     | Fine                                                                         |
| 125% | 1024×640     | Fine (grid layout)                                                           |
| 150% | 853×533      | **Horizontal overflow (+3px, filename-dependent)**                           |
| 200% | 640×400      | **Side panel 0px, tab bar clipped, all content below the board unreachable** |

### Findings by device class

**Small phone.** Minimum viable dimension is currently unmet: the app needs ~500px of vertical space below the top bar to show a board _and_ any panel, and the top bar alone takes 258px. Board sizing must yield.
**Large phone.** Same shape, one extra visible row. The `divider-h` grip (344×14) is the only way to rebalance and is 14px tall.
**Tablet.** The 721–823px band is the single worst defect in the responsive layer. Between 824 and 1100 the two-column grid with a 360px chat band below is reasonable.
**Laptop.** Works; hierarchy is wrong (UX-010).
**Short-height.** `.side-panel` gets whatever is left after a `70vh` board. On a 600px-tall window at 1280 the side panel is 518px — fine — but the same rule at ≤720px width produces the zero-height failure.
**Zoomed.** WCAG 1.4.10 requires content to reflow to a 320 CSS-px equivalent without two-dimensional scrolling. Verified failure at 150% (horizontal scroll) and 200% (content loss).

### Cross-cutting mobile issues

- **Tab state communication:** none. Verified — a running scan is completely invisible from another tab, and labels never change.
- **Context loss:** panels stay mounted (good), but there is no indication of what changed in the tab you left.
- **Touch targets:** `pointer: coarse` raises exactly six selectors. `.fix-btn` (14px), `.rep-mode` (19px), `.collapse-toggle` (18px), `.move` (16px), `.inspect-btn`, and `.divider-h` (14px) are untouched.
- **Board gestures vs page scroll:** `.divider`/`.divider-h` set `touch-action:none` and `overscroll-behavior:none` sits on `body`. Chessground handles its own touch. No conflict observed, but pull-to-refresh is globally disabled — including on the chat log where a user might expect it. **Hypothesis** (needs a real device).
- **Virtual keyboard:** `100dvh` on `.app`/`.app-main` tracks the URL bar. `.chat-input textarea` gets a 16px font floor to stop iOS zoom (`styles.css:334–338`) — good. Whether the input stays visible above the keyboard inside a `dvh` grid with `overflow:hidden` is **unverified** and should be tested on iOS.
- **Safe areas:** handled on `.topbar`, `.workspace`, `.analysis-notice`, and the SF panes. `.mobile-tabs` and `.chat-input` have no bottom inset of their own; they sit inside `.workspace`'s padding, which does. Adequate.
- **Installed PWA:** `registerType:"autoUpdate"` with no notification (UX-041). In standalone mode there is no browser reload affordance, making a silent update harder to recover from.

---

## 9. Accessibility audit

### Confirmed failures (verified at runtime)

| Area           | Failure                                                                                                       | Criterion                    |
| -------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Keyboard       | Board not focusable, no keyboard move entry                                                                   | 2.1.1 Keyboard               |
| Keyboard       | Move list not focusable (11 moves, 0 focusable)                                                               | 2.1.1                        |
| Keyboard       | All `.rep-row` result rows click-only                                                                         | 2.1.1                        |
| Keyboard       | Dividers drag-only, no keyboard alternative                                                                   | 2.5.7 Dragging Movements     |
| Focus          | Settings drawer has no trap — 10 Tabs all landed outside, drawer still open                                   | 2.4.3 Focus Order            |
| Focus          | `Escape` does not close the Settings drawer, promotion modal, or colour picker                                | 2.1.2 (no trap) / convention |
| Focus          | No focus restoration after closing the drawer or either modal                                                 | 2.4.3                        |
| Semantics      | Board has no role or accessible name                                                                          | 4.1.2 Name, Role, Value      |
| Semantics      | `role="tab"` without `aria-controls`, `id`, or `role="tabpanel"`                                              | 4.1.2                        |
| Semantics      | `aria-hidden` on the SF workspace without `inert` when the Lab opens                                          | 4.1.2                        |
| Announcements  | No live region for save, restore, scan completion, engine state, or chat tool status                          | 4.1.3 Status Messages        |
| Target size    | `.fix-btn` 14px, `.rep-mode` 19px, `.scan-btn` 20px, `.move` 16px, `.collapse-toggle` 18px, `.divider-h` 14px | 2.5.8 Target Size (Minimum)  |
| Reflow         | Horizontal scroll at 150% zoom / 721–823px                                                                    | 1.4.10 Reflow                |
| Reflow         | Content unreachable at 200% zoom                                                                              | 1.4.4 Resize Text, 1.4.10    |
| Text selection | `user-select:none` app-wide blocks copying FEN, SAN, evals, and error text                                    | 1.3.1 / usability            |
| Motion         | `prefers-reduced-motion` not honoured outside Strategic Fit; board animates                                   | 2.3.3 (AAA) + expectation    |
| Forced colors  | `forced-colors` handled only inside Strategic Fit                                                             | 1.4.3 / 1.4.11 in HCM        |

### Probable failures (source-supported, need AT confirmation)

- Promotion buttons render bare glyphs (`♕♖♗♘`). Screen-reader output depends on the font and the AT's Unicode name table; likely "white chess queen" at best, silence at worst. **Add explicit labels.**
- `.eval-bar` conveys the evaluation through height plus a 9.6px `mix-blend-mode` number, with only a `title`. Almost certainly not announced usefully.
- `.analysis-progress` has `role="progressbar"` with no `aria-valuenow`/`valuemin`/`valuemax` and no `aria-busy` on the region — an indeterminate bar without the indeterminate contract.
- The chat log has no `role="log"`/`aria-live`, so streamed assistant text is not announced.
- Colour-only status: `.sev-*` severity badges and `.fit-*` classes carry text (`high`, `book`, `adj`) so redundancy exists — **this is fine**. The `weight` swatch (`w-thick/medium/thin`) is a bare `<span>` with only a `title` and no text equivalent — that one is colour/size-only.
- `.pick-badge` `↓` and `★` in the Shorten section carry meaning only in `title` attributes.

### Items requiring assistive-technology testing

Reading order of the three-column Strategic Fit layout; whether the `inert` + `aria-hidden` combination on `.app-main` is respected by VoiceOver/NVDA; whether streamed chat text creates announcement storms; iOS virtual-keyboard behaviour inside the `dvh` grid; whether the SF Pareto plot's keyboard navigation is announced usefully.

### Contrast (measured)

Muted text `#9a9aa3` on `#26262b` = **5.43:1** — passes AA for normal text. `.cloud-label` `#c8dcf0` on `#2f4a6b` = **6.6:1** — passes. **Contrast is not a defect in this app.** The legibility problem is size (UX-030), not contrast, and the report should not conflate them.

### Positives worth preserving

`StrategicFitWorkspace` implements a correct focus trap, `Escape` handling, focus restoration, `inert` + `aria-hidden` on the background, a roving-tabindex tablist with `Home`/`End`, `beforeprint`/`afterprint` complete-list mode, `prefers-reduced-motion`, `forced-colors`, and a tabular fallback for every chart. It is the reference implementation the rest of the app should copy — the failure is that it was never generalised.

---

## 10. Design-system findings

| Area                 | Current                                                                                                                                                                                                           | Finding                                                                                             | Recommendation                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colour tokens        | 6 root variables (`--bg --panel --border --text --muted --accent`); ~40 hard-coded hexes in Strategic Fit alone (`#24272d`, `#20242a`, `#31343c`, `#4d5561`, `#596473`…)                                          | Token set too small for the surface hierarchy the app actually has, so the SF work invented its own | Extend to `--surface-0..3`, `--border-subtle/strong`, `--text-primary/secondary/tertiary`, plus semantic `--status-ok/warn/danger/info`; replace the hexes |
| Typography           | No scale; 100+ rules below 12px, 32 different `font-size` values                                                                                                                                                  | Ad-hoc sizing is the direct cause of the density complaints                                         | 6-step scale with a 0.75rem floor for body text; ≤0.7rem reserved for uppercase micro-labels                                                               |
| Spacing              | Inline `rem` values throughout (`0.22rem`, `0.35rem`, `0.48rem`, `0.55rem`, `0.65rem`, `0.7rem`, `0.85rem`)                                                                                                       | No rhythm; adjacent components use different gaps for the same relationship                         | 4px base scale `--sp-1..8`                                                                                                                                 |
| Surface hierarchy    | `--panel` for everything in the core app; four bespoke greys in SF                                                                                                                                                | Core panels are flat and indistinguishable; SF panels read as a different product                   | Adopt the SF surface ladder globally                                                                                                                       |
| Borders              | `1px solid var(--border)` on nearly every container plus per-row separators                                                                                                                                       | Excessive boxing is a real cause of visual density in the repertoire panel                          | Use background elevation for grouping; reserve borders for genuine boundaries                                                                              |
| Buttons              | No variants. `.topbar button`, `.scan-btn`, `.fix-btn`, `.chat-retry`, `.result-accept`, `.stop-btn`, `.accept`, `.reject`, `.color-btn`, `.model-chip`, `.strategic-fit-open-button` — eleven bespoke treatments | Users cannot read importance from appearance; `Accept` (mutating) and `Scan` (read-only) look alike | Three variants — `primary` / `secondary` / `quiet` — plus a `danger` modifier, and one size scale with the 24/44px floors                                  |
| Form controls        | Styled per context (`.topbar select` vs `.rep-mode` vs `.chat-mode` vs `.field input`)                                                                                                                            | Same control, four appearances                                                                      | One `Field` + `Select` primitive                                                                                                                           |
| Status treatments    | `.sev-*`, `.fit-*`, `.tool-run.*`, `.result-status.*`, `.strategic-fit-*-state` — five parallel systems                                                                                                           | Same concept (severity/state) rendered five ways                                                    | One `Status` primitive: dot + label + optional count, driven by a semantic token                                                                           |
| Feedback             | Progress rendered three ways: `<progress>` (chat), `.scan-bar` + `.scan-bar-fill` (gaps), `.scan-meter` (commands)                                                                                                | Three visual languages for one concept                                                              | One `Progress` primitive supporting determinate and indeterminate                                                                                          |
| Empty states         | Two patterns: `.empty` (one italic line) and SF's `RegionState` (title + body + optional spinner)                                                                                                                 | The core app's version cannot express a next action                                                 | Adopt `RegionState`'s shape globally, with an optional action slot                                                                                         |
| Errors               | `.empty` reused for scan errors; `.chat-error` strip; `ErrorResult` card; SF `role="alert"` blocks                                                                                                                | Failures are indistinguishable from empty results in the panel that runs most operations            | One `ErrorState` primitive: icon, plain title, cause, recovery action                                                                                      |
| Dialogs              | Three hand-rolled overlays with none of the required behaviour, plus one correct implementation in SF                                                                                                             | Direct cause of UX-007 and UX-019                                                                   | Extract `Dialog` from `StrategicFitWorkspace`                                                                                                              |
| Panel headers        | `.outcome-label` (10px caps) + `.panel-head` (12.5px caps) + `.strategic-fit-pane-heading` (kicker + `<h2>`)                                                                                                      | Three header patterns; the core app's two stack on top of each other in the analysis panel          | One `PanelHeader`: title, optional status, optional action slot                                                                                            |
| Data tables          | SF uses real `<table>` with `<th scope>`; the core app uses flex rows with `<span>`                                                                                                                               | Core "tables" are unreadable to AT and unsortable                                                   | Use `<table>` for tabular findings, or ARIA grid roles on the flex rows                                                                                    |
| Dense analysis views | Genuinely good: `severity · line · eval` on one row                                                                                                                                                               | **Preserve** — this is productive density                                                           | Do not spread these out; fix the target size with padding, not layout                                                                                      |
| Responsive rules     | Breakpoints hard-coded in 18 media queries at three different widths                                                                                                                                              | Adding a component means guessing which breakpoint applies                                          | Three named tiers with documented content contracts                                                                                                        |
| Focus styling        | 34 rules, all SF-scoped                                                                                                                                                                                           | Inconsistent between halves of the app                                                              | One global `:focus-visible`                                                                                                                                |
| Motion               | `transition` on dividers, eval bar, chessground; reduced-motion only in SF                                                                                                                                        | Motion policy not global                                                                            | Global reduced-motion block + a `--motion-fast/slow` token pair                                                                                            |
| Z-index              | `120` (metadata warning), `100` (analysis notice), plus unlayered overlays                                                                                                                                        | Two magic numbers; overlay stacking is implicit                                                     | A 5-level `--z-*` scale (base / sticky / overlay / dialog / toast)                                                                                         |

**Do not** replace the stylesheet with a utility framework. The problems above are missing abstractions, not a missing tool — and the Strategic Fit half already demonstrates that this stylesheet can express a coherent system. The work is to lift that system into the root and adopt it in the ~233 rules that make up the core app.

---

## 11. Component and CSS architecture implications

| Structure                                                                                                                                                                                                                                                                                                        | UX consequence                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Investment asymmetry.** 993/1226 CSS rules and 21/22 e2e specs cover Strategic Fit and the Replacement Lab. The core app has ~233 rules and 2 specs.                                                                                                                                                           | Every Critical finding in this report is in the core app. The half with a dedicated accessibility spec (`strategic-fit-accessibility.spec.ts`) is the accessible half.                                                       |
| **`RepertoirePanel.tsx` owns 10 features, 3 stores, 7 command lifecycles, and 4 result-row shapes in 406 lines.**                                                                                                                                                                                                | No two sections behave identically (Gaps has a labelled progress bar with ARIA values; Connect shows `…`; Shorten shows an inline bar with an `✕`; commands use `.scan-meter`). Inconsistency is structural, not accidental. |
| **No interactive-row primitive.** Nine independent `<div class="rep-row" onClick>` sites plus `<span class="move" onClick>`.                                                                                                                                                                                     | UX-004 exists nine times over. A single fix is impossible without a primitive.                                                                                                                                               |
| **Three hand-rolled overlays** vs one correct implementation.                                                                                                                                                                                                                                                    | UX-007 and UX-019. The correct pattern is 60 lines away in the same repository.                                                                                                                                              |
| **Domain payloads rendered generically.** `NavigationRows` walks arbitrary JSON deriving labels from keys; `strategicFitCohortDisplayName(id, id)`; `nodes`/`leaves` printed verbatim.                                                                                                                           | UX-015, UX-016, UX-020. The interface's vocabulary is whatever the contract happened to name a field.                                                                                                                        |
| **Copy is inline string literals** with no content module.                                                                                                                                                                                                                                                       | Terminology drifts between panels (`Prescribed-move audit` / `audit` / `Audit`), tone shifts between the core app (terse) and SF (explanatory), and there is nowhere to apply §6 systematically.                             |
| **Global CSS with app-wide gestures.** `user-select:none`, `overscroll-behavior:none`, `-webkit-touch-callout:none` on `body` with three narrow exceptions.                                                                                                                                                      | UX-025 — a chess tool where you cannot copy a FEN.                                                                                                                                                                           |
| **Accessibility depends on manual repetition.** `role`/`aria-*` are hand-written per element; nothing enforces the full pattern.                                                                                                                                                                                 | `MobileTabs` has `role="tab"` and none of the rest; the SF workspace has all of it.                                                                                                                                          |
| **Responsive ownership is unclear.** Panels declare structure in TSX and behaviour in three media-query blocks 4,000 lines apart.                                                                                                                                                                                | UX-001 and UX-002 both come from a rule whose effect is invisible at the component that suffers it.                                                                                                                          |
| **Status logic duplicated.** `ExecutionStatus` exists in `application/execution-status.ts` and is consumed by `chat.ts` and `commands.ts`, but each renders it independently, and `gaps.ts`/`repertoire.ts` maintain their own `scanning`/`compScanning`/`bridgeScanning`/`pruneScanning`/`inspecting` booleans. | No single place can answer "is anything running?" — which is exactly what the mobile tabs and an app-level activity strip need.                                                                                              |
| **`styles.css` is loaded whole for every route.**                                                                                                                                                                                                                                                                | Not a UX defect today (there is one route), but it makes the two-visual-languages problem invisible to anyone reading a component.                                                                                           |

---

## 12. Recommended target information architecture

```text
Application
├── Repertoire (document)
│   ├── Open PGN…
│   ├── Re-link last file: <name>
│   ├── Save to file            [Cmd/Ctrl+S]
│   ├── New repertoire…         (always confirms)
│   ├── Recover…                (last 3 autosave snapshots)   ← new
│   └── Status (always visible, not in the menu)
│       ├── Stored in this browser · autosaved 12:04
│       └── File: my-rep.pgn — 3 changes not exported
│
├── Board
│   ├── Play / navigate         [← →] [⏮ ⏭] [keyboard square cursor]  ← new
│   ├── Orientation / repertoire colour   (White ▾)
│   ├── Evaluation bar
│   └── Arrow legend ⓘ                                                ← new
│
├── Moves          ← moves to the TOP of the side column
│   ├── Current line strip
│   ├── Variation tree (role="tree", arrow-key navigable)
│   ├── Collapse / expand branch
│   └── Delete this line…       (explicit, with undo)                 ← new
│
├── Analysis
│   ├── Engine lines (fit · SAN · eval)
│   ├── Cloud second opinion
│   ├── Suggestions from the assistant  → back-link to source card
│   └── Engine settings ⚙                                            ← moved from top bar
│       ├── Evaluation on/off
│       ├── Depth (with speed/accuracy note)
│       └── Lichess cloud eval on/off
│
├── Repertoire tools            ← regrouped by goal
│   ├── Check my repertoire
│   │   ├── Are my book moves best?          (prescribed-move audit)
│   │   ├── Unanswered opponent moves        (gaps)
│   │   └── Critical positions               (only moves)
│   ├── Extend it
│   │   ├── Suggest next moves here          (extend)
│   │   └── Finish unfinished lines          (connect)
│   ├── Simplify it
│   │   └── Shorten what you memorise        (prune / transpositions)
│   └── Prepare & export
│       ├── Prepare against an opponent
│       ├── Find a pawn structure
│       ├── Annotated repertoire (PGN)
│       └── Drill deck (CSV)
│
├── Assistant
│   ├── Context chip: what it can currently see                       ← new
│   ├── Ask a question
│   ├── Focus preset (Auto / Repertoire / Game review / Position / Annotate)
│   ├── Results
│   │   ├── Informational
│   │   ├── Navigational   → Go to line
│   │   └── Proposed changes   (distinct treatment + reversibility)
│   └── Stop this request / Send again
│
├── Strategic Fit
│   ├── Entry: "Is your repertoire asking you to learn too many plans?"
│   ├── Profile               (first-run wizard — preserve as built)
│   ├── Analysis              (run / cancel / re-run)
│   ├── Evidence check        (was: preflight — one line + disclosure)
│   ├── What stands out       (findings queue, filters, priorities)
│   ├── Compare               (evidence, map, heatmap, alternatives)
│   ├── Decide                (keep / replace / keep-and-train)
│   ├── Review changes        (change-set preview)
│   ├── Apply
│   └── Did this help?        (was: resolution proof)
│
├── Settings
│   ├── Assistant (OpenRouter key, model)
│   ├── Data sources (Lichess token, cloud eval)
│   ├── Display (reduced motion follows the system; technical details on/off)   ← new
│   ├── Keyboard shortcuts (reference)                                          ← new
│   └── Recover autosaves                                                       ← new
│
├── Status & notifications                                                      ← new, app level
│   ├── Activity strip: running operations + cancel
│   ├── Polite live region (starts, completions, saves, restores)
│   └── Toasts (undo, PWA update, restore)
│
└── Mobile navigation
    ├── Board (pinned, yields on short viewports)
    └── Tabs: Moves · Analysis · Assistant   (with state indicators)
```

Note two deliberate changes: **Moves comes first** on mobile as well as desktop (it is the highest-frequency panel), and **engine controls live with the analysis they affect** rather than in the global bar.

---

## 13. Prioritized remediation plan

### Phase A — Immediate safety and accessibility (blocks nothing; ship first)

| #   | Change                                                                                                                                                     | Problem                | Benefit                                               | Deps             | Risk                                                                                                         | Effort | Success measure                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------ |
| A1  | `min-height` on side/chat panels; `dvh`-aware board cap; allow `.workspace` to scroll on short viewports                                                   | UX-001                 | Content reachable at 200% zoom and in landscape       | none             | Low — verify the phone layout is unchanged at 360×740                                                        | S      | Automated check: at 640×400 all three panels have height > 0 and the tab bar is visible                |
| A2  | `flex-wrap: wrap` on `.topbar` at all widths; `min-width:0` + ellipsis on the filename                                                                     | UX-002                 | No horizontal scroll at any width                     | none             | Low                                                                                                          | S      | Automated check: `scrollWidth === clientWidth` from 320px to 2560px with a 120-char filename           |
| A3  | Confirm `New` unconditionally with scoped copy; keep 3 autosave snapshots                                                                                  | UX-006                 | Removes the only silent total-loss path               | none             | Low                                                                                                          | S      | Zero accidental-wipe reports; `Recover` used at least once in testing                                  |
| A4  | Command history with real undo/redo; explicit delete control + undo toast                                                                                  | UX-005                 | Removes the second total-loss path                    | A3               | Medium — touches `game.ts` mutation paths and every caller of `applyEdit`                                    | M      | `Ctrl+Z` after any mutation restores the prior PGN exactly; `Ctrl+Shift+Z` re-applies                  |
| A5  | Extract `Dialog` from `StrategicFitWorkspace`; apply to settings drawer, promotion, colour picker; short-circuit global shortcuts when any overlay is open | UX-007, UX-019, UX-045 | Overlays become usable and safe for keyboard/AT       | none             | Low — the reference implementation is already tested                                                         | M      | Automated: Tab cycles within each overlay; `Escape` closes; focus returns; `→` does not move the board |
| A6  | Make moves and result rows real buttons via one primitive                                                                                                  | UX-004                 | Keyboard users can use scan results and the move list | none             | Medium — nine call sites, visual regression risk on row density                                              | M      | Automated: every `.rep-row` and `.move` is reachable by Tab and activates with Enter                   |
| A7  | Board keyboard layer: `role="grid"`, square cursor, `Enter` to move, live-region move announcements                                                        | UX-003                 | The core task becomes keyboard-operable               | A5 (live region) | High — new interaction surface over a third-party widget; needs care with chessground's own pointer handling | L      | A keyboard-only user completes "open a PGN, navigate to move 6, add a variation, save"                 |
| A8  | Global target-size floors (24px, 44px on coarse); widen divider hit areas                                                                                  | UX-014, UX-013         | Fewer mis-taps; WCAG 2.5.8                            | none             | Low — verify the repertoire panel does not grow unacceptably                                                 | S      | Automated: zero interactive elements below 24×24 at 1280; below 44×44 under `pointer:coarse`           |
| A9  | Keyboard-operable dividers with `aria-valuenow` + double-click reset                                                                                       | UX-013                 | Panel sizing available without dragging               | none             | Low                                                                                                          | S      | `←/→/Home/End` resize; dblclick restores defaults                                                      |
| A10 | One app-level polite live region + `announce()` helper; wire save, restore, scan start/finish, engine state, chat tool status                              | UX-012                 | Screen-reader users get confirmations                 | none             | Low — risk of over-announcing; keep messages terse                                                           | S      | Every operation in §3 produces exactly one announcement                                                |
| A11 | Invert `user-select`; add copy buttons to FEN / SAN-path displays                                                                                          | UX-025                 | Analysis output becomes usable                        | none             | Low — re-verify board drag on touch                                                                          | S      | FEN, SAN, evals, and error text are all selectable                                                     |
| A12 | Promote `prefers-reduced-motion` and `forced-colors` to global; bind chessground animation to the media query                                              | UX-026                 | Respects OS preferences everywhere                    | none             | Low                                                                                                          | S      | Board pieces do not animate with reduced motion on                                                     |
| A13 | One global `:focus-visible` ring                                                                                                                           | UX-027                 | Consistent, visible focus                             | none             | Low                                                                                                          | XS     | Focus is identically styled in both halves of the app                                                  |

### Phase B — High-value structural improvements

| #   | Change                                                                                                                                                     | Resolves                                                | Effort | Notes                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| B1  | Rebuild the top bar as three labelled groups; move eval + depth into the analysis panel; file actions into a `Repertoire ▾` menu                           | UX-008, UX-002, UX-022 (partly)                         | M      | Depends on A2 landing first so wrapping is not the fix                   |
| B2  | Reorder the side column (Moves → Analysis → Repertoire) and give the move tree a fixed share                                                               | UX-010                                                  | S      | Highest benefit-per-line change in the report                            |
| B3  | Two-indicator document state (`Stored in this browser` + `File: … n changes not exported`); rename `Save` → `Save to file`                                 | UX-031, UX-029, UX-032                                  | S      | Depends on B1 for placement                                              |
| B4  | App-level activity strip driven by a unified running-operations selector; feed the mobile tab badges                                                       | UX-011, UX-040, and the "no completion feedback" family | M      | Requires consolidating the five `*scanning` booleans                     |
| B5  | Complete or replace the mobile tablist ARIA contract; add per-tab status                                                                                   | UX-011                                                  | S      |                                                                          |
| B6  | Regroup the repertoire panel by goal; one summary line per collapsed group                                                                                 | UX-021, UX-035, UX-042                                  | M      | Pure re-organisation; no new capability                                  |
| B7  | Chat card tiers (informational / navigational / mutating) + `Details` replacing `Raw JSON` + context chip                                                  | UX-015, UX-020, UX-046, UX-034                          | M      | Depends on the terminology work (C1) for card titles                     |
| B8  | Lift the Strategic Fit design tokens into the root and adopt them in the core surfaces                                                                     | UX-048, UX-030                                          | L      | Do after A1–A13 so the visual diff is not entangled with behaviour fixes |
| B9  | Collapse SF process telemetry on completion; reconcile the lifecycle header with the evidence state; add the "not enough comparable lines" directive state | UX-017, UX-018                                          | M      |                                                                          |
| B10 | Named responsive tiers with documented content contracts; smooth the 1100px board cliff                                                                    | UX-024                                                  | M      |                                                                          |

### Phase C — Terminology and content (independent of A and B; can run in parallel)

| #   | Change                                                                                                        | Effort |
| --- | ------------------------------------------------------------------------------------------------------------- | ------ |
| C1  | Introduce a content module; move every user-visible string out of components                                  | M      |
| C2  | Apply the §6 replacement table: buttons, labels, notices, empty states, errors, stale messages, confirmations | M      |
| C3  | Cohort and branch display names derived from opening data; hashes to detail rows                              | M      |
| C4  | Map tool identifiers to task labels through `tool-contract`; label dictionary for `NavigationRows`            | S      |
| C5  | Split every conflated empty state; add an `ErrorState` treatment distinct from `.empty`                       | S      |
| C6  | Arrow-system legend; expand `book/adj/out`                                                                    | S      |
| C7  | Keyboard shortcut reference (`?` and Settings)                                                                | S      |

### Phase D — Density and visual hierarchy

| #   | Change                                                                                        | Effort |
| --- | --------------------------------------------------------------------------------------------- | ------ |
| D1  | Typography scale with a 0.75rem body floor; replace 100+ ad-hoc sizes                         | M      |
| D2  | Spacing scale; reduce border usage in favour of surface elevation                             | M      |
| D3  | Three button variants + one `Status` primitive + one `Progress` primitive + one `PanelHeader` | M      |
| D4  | Collapse repeated metadata (`depth 20` stated once per panel)                                 | S      |
| D5  | Chat rail until an API key is set                                                             | S      |

### Phase E — Advanced workflow redesigns

| #   | Change                                                                                                                                                      | Effort | Notes                                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------ |
| E1  | Persistent Strategic Fit stage model at all widths; resolve the desktop/compact duplication                                                                 | L      | UX-033                                                                                                                   |
| E2  | Split Strategic Fit into two focused modes — **Review** (map, findings, evidence, decide) and **Redesign** (replacement lab, portfolio, change sets, proof) | XL     | The workspace currently spans two genuinely different jobs; only do this if E1 shows the stage strip is still overloaded |
| E3  | Board-local navigation strip and a real move-tree keyboard model (`role="tree"`)                                                                            | L      | Builds on A6/A7                                                                                                          |
| E4  | Chat conversation model: runs attached to messages, per-run cancel, result pinning                                                                          | L      | UX-040, UX-047                                                                                                           |
| E5  | Autosave version history surfaced as a recovery UI                                                                                                          | M      | Builds on A3                                                                                                             |

### Suggested order

`A1 → A2 → A3 → A8 → A13 → A11 → A12 → A5 → A6 → A10 → A9 → A4 → A7` , then `B2 → B1 → B3 → B5 → B4 → B6 → B7 → B9 → B10 → B8`, with `C` running in parallel from the start and `D`/`E` after `B`.

Rationale for the ordering: A1/A2/A3 are the highest-severity, lowest-effort, lowest-risk items in the report and unblock honest testing of everything else. A8/A11/A12/A13 are near-zero-risk global fixes. A5 must precede A6/A7 because the `Dialog` primitive and the live region are shared dependencies. A4 (undo) precedes A7 (board keyboard entry) because keyboard move entry will increase the rate of accidental edits. B2 is placed first in Phase B because it is an `S` change that fixes the single most frequent friction point.

---

## 14. Quick wins

Genuinely low effort **and** low design/regression risk. Each is independently shippable.

| Change                                                                                    | Issue          | Why it is safe                                                                        |
| ----------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `flex-wrap: wrap` on `.topbar` + `min-width:0` on the filename                            | UX-002         | One-line CSS; removes a Critical failure; the ≤720px rule already does exactly this   |
| Global `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`         | UX-027         | Additive; no layout change                                                            |
| Promote the `prefers-reduced-motion` and `forced-colors` blocks out of the SF scope       | UX-026         | Rules already written and tested                                                      |
| Analysis empty state → `"Engine evaluation is off. [Turn on evaluation]"`                 | UX-009         | Copy + one button; removes the most common first-run confusion                        |
| Split `"No scan yet — or no gaps."` into two states                                       | UX-036         | Copy only                                                                             |
| `.error-state` class for scan errors instead of `.empty`                                  | UX-037         | One class, four call sites                                                            |
| Reorder the side column to Moves → Analysis → Repertoire                                  | UX-010         | Three lines in `App.tsx`; verify the ≤720px tab rules still target the right children |
| Depth-30 notice → persistent inline helper text at depth ≥ 25                             | UX-022         | Removes a local signal and a re-nag                                                   |
| `Save` → `Save to file`, `New` → `New repertoire`, `Eval Off` → `Engine evaluation ⬤ Off` | UX-031, UX-009 | Label-only                                                                            |
| Confirm `New` unconditionally                                                             | UX-006         | One condition removed; removes a Critical failure                                     |
| Accessible names on the four promotion buttons                                            | UX-019 (part)  | Four `aria-label`s                                                                    |
| `inert` alongside `aria-hidden` on the SF workspace when the Lab opens                    | UX-045         | One attribute, matching an existing pattern in `App.tsx`                              |
| Message on `reopenLast()` permission denial                                               | UX-032         | One branch                                                                            |
| Download-fallback save message                                                            | UX-029         | One branch                                                                            |
| `user-select` inversion                                                                   | UX-025         | CSS-only, but **re-test board drag on a touch device before shipping**                |

Explicitly **not** quick wins despite small diffs: the target-size floors (A8) change the height of every panel and need a density review; the undo stack (A4) is small in `game.ts` and large in consequence; renaming cohorts (C3) requires deciding what a cohort's name _is_.

---

## 15. UX validation plan

Ten task-based tests. Run with 6–8 participants split between "experienced repertoire builder, new to this app" and "existing user". Instrument each with the metrics listed; the pre-change run establishes the baseline.

**Global metrics for every task:** task completion (binary), time on task, error rate, backtracking events (returning to a previously-visited panel), panel switches, help requests, and "lost context" events (participant asks "where did that go?" or re-reads a panel they already read).

| #   | Task                       | Goal                                                    | Start condition                                                                                                  | Success condition                                                                                     | Observable failure signals                                                                                         | Key metrics                                                                                |
| --- | -------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| 1   | **First launch**           | Understand what the app is for and take a first action  | Cold browser, no data                                                                                            | Participant opens a PGN or plays a move within 60s and can state in their own words what the app does | Scrolling the repertoire panel looking for a start point; asking "is it broken?"; reading "No API key" as an error | Time to first meaningful action; misinterpreted-label count                                |
| 2   | **Open and save**          | Load a PGN, add a variation, save it back               | A `.pgn` on disk                                                                                                 | File on disk contains the new variation; participant can say where the work lives                     | Believing `● unsaved` means data loss; looking for autosave; using `Save` expecting a browser save                 | Time on task; "where is my work?" questions                                                |
| 3   | **New document safely**    | Start a fresh repertoire without losing the current one | Repertoire loaded and saved to file                                                                              | Participant reaches an empty board and can re-open the previous file                                  | Any wipe without an explicit decision; inability to get the old work back                                          | **Accidental destructive actions** (target: 0)                                             |
| 4   | **Engine analysis**        | Find the engine's top move for a position               | Repertoire loaded, eval at default (off)                                                                         | Engine lines visible within 30s; participant can say which lines are in their book                    | Waiting for lines that never come; hunting the top bar; asking what `adj` means                                    | Time to first engine line; label misinterpretation                                         |
| 5   | **Chat workflow**          | Ask "is 3.Bf4 sound here?" and act on the answer        | API key configured, position selected                                                                            | Participant reads a grounded answer and knows whether the assistant looked at the right position      | Re-typing the position into chat; asking what a tool chip means; reading raw JSON                                  | Panel switches; context-chip usage                                                         |
| 6   | **Apply a suggestion**     | Accept an assistant-proposed line                       | A pending staged-edit card                                                                                       | Line is in the tree, participant can state what changed and how to undo it                            | Interpreting `nodes/leaves`; not knowing whether it was applied; unable to reverse it                              | Time to decide; undo attempts                                                              |
| 7   | **Stale recovery**         | Recover after the repertoire changed under a suggestion | Staged card, then an unrelated edit                                                                              | Participant requests a fresh suggestion without confusion                                             | Repeated clicking of a disabled `Accept`; reading "stale" as an app error                                          | Recovery time; help requests                                                               |
| 8   | **Strategic Fit decision** | Decide whether to keep or replace one flagged line      | A repertoire large enough to produce comparable routes (**≥ 12 routes past ply 12** — the current sample is not) | Participant records a decision and can explain the evidence for it                                    | Getting stuck on the phase cards; asking what a cohort is; unable to find the Resolution step on desktop           | Time to first finding; time to decision; **number of terms the participant cannot define** |
| 9   | **Mobile navigation**      | On a phone, find and fix one unanswered opponent move   | 390×844, repertoire loaded                                                                                       | Gap found, fill staged and accepted                                                                   | Losing track of a running scan; mis-taps on 14–20px buttons; not finding the panel below the top bar               | Mis-tap rate; cross-tab context loss; scroll distance to first content                     |
| 10  | **Keyboard-only**          | Open a PGN, navigate to move 6, add a variation, save   | Mouse physically removed                                                                                         | All four steps completed                                                                              | Focus lost behind an overlay; cannot reach the board or the move list; cannot open a scan result                   | **Task completion (currently 0%)**; focus-trap escapes; time on task                       |

### Automated regression checks to add alongside

These encode the verified failures so they cannot return:

1. **No horizontal overflow** — `scrollWidth === clientWidth` at every 5px step from 320 to 2560, with a 120-character filename loaded.
2. **No zero-height panels** — at 640×400, 360×640, and 720×500, every one of `.side-panel`, `.chat-wrap`, `.mobile-tabs` has a rendered height > 0.
3. **Target size** — no interactive element below 24×24 at 1280×800, none below 44×44 under `hasTouch: true`.
4. **Keyboard reachability** — every `.move`, `.rep-row`, and board square is reachable by Tab or an arrow-key cursor.
5. **Overlay contract** — for each of the three overlays: Tab cycles inside, `Escape` closes, focus returns to the opener, and `→` does not change `currentPath()`.
6. **Undo/redo round-trip** — for each mutation kind, `apply → Ctrl+Z → Ctrl+Shift+Z` returns the PGN to the post-apply state exactly.
7. **Announcements** — every operation listed in §3 produces exactly one live-region message.
8. **No raw identifiers in user-facing text** — assert that no rendered text node matches `/^cohort:[0-9a-f]{16}$/`, `/^[0-9a-f]{8}$/`, or a bare `tool_contract` identifier outside a `details` element.

### How we will know it worked

- Test 10 (keyboard-only) goes from 0% to 100% completion.
- Tests 1–4 show a reduction in time-to-first-meaningful-action and in "where is my work?" questions.
- Test 3 records zero accidental destructive actions across all participants.
- Test 8 records fewer than three undefinable terms per participant (baseline is expected to be well above ten).
- Test 9 records zero cross-tab context-loss events.
- The eight automated checks stay green in CI.

---

## Appendix — Final quality check

**Most damaging user problems:** total content loss at 200% zoom; horizontal scroll hiding every action button at tablet portrait; a chessboard and move list that keyboard and assistive-technology users cannot operate at all; two unguarded paths to irreversible data loss (`New` on a clean document, `Ctrl+Z` on a leaf).

**Symptoms of the same root cause:** UX-003, UX-004, UX-007, UX-011, UX-012, UX-013, UX-019, UX-026, UX-027, UX-045 are all the same cause — accessibility was built once, thoroughly, inside Strategic Fit, and never generalised. UX-002, UX-008, UX-024, UX-030 all stem from the top bar and the absence of a responsive-state policy. UX-015, UX-016, UX-020, UX-034 are all domain objects rendered directly. UX-021, UX-035, UX-042 are all feature organisation following code structure.

**Complexity that is genuinely necessary:** the branching tree, engine depth, multi-PV lines, fit classification, the staged-mutation model, revision binding, preflight evidence states, and the bounded-evidence disclosures. None of these should be simplified away.

**Complexity imposed by the interface:** ten identical collapsed sections; nine top-bar controls in one row; two-step generate/save exports; `Raw JSON` on every card; process telemetry ahead of results; three parallel progress patterns; five parallel status patterns; 100+ sub-12px type rules.

**Terminology appropriate for chess experts:** SAN, FEN, PGN, transposition, structure names, only move, prescribed move, centipawns, depth, mate-in-N, ply.
**Terminology that exists only because of the implementation:** cohort hashes, revision numbers, `nodes`/`leaves`, `preflight`, `resolution proof`, `change set`, `stale revision`, `artifact`, `tool result`, `capability`, raw error codes, `congruence`.

**Controls in the wrong location:** engine depth and the eval toggle (top bar → analysis panel); the Strategic Fit entry (buried in a scrolling panel → top-level); the move tree (bottom of the column → top).

**State that is invisible or ambiguous:** whether the engine is on; whether autosave has run and when; whether work exists only in this browser; whether an operation is running when you are on another mobile tab; what context the assistant can see; whether a Strategic Fit report is current; which chat result produced the position on the board.

**Workflows lacking a clear beginning, progression, or completion:** every repertoire scan (no completion signal); export (two undifferentiated steps); Strategic Fit on a small repertoire (no terminating state, no directive); chat multi-tool turns (runs vanish on the next request).

**Interactions that fail on mobile, touch, keyboard, zoom, or AT:** enumerated in §8 and §9, with the specific measurement or observation for each.

**Behaviours to preserve:** listed in §1 and repeated per journey in §4. In summary — the staged-mutation model and its copy, the profile wizard, the bounded-evidence honesty, the preflight panel, the finding-queue filters, the colour-picker modal, the arrow-key text-field guard, mounted-panel mobile tabs, the 240px panel floor, the chart/table dual rendering, the print/export mode, and the Strategic Fit workspace's complete dialog implementation — which should become the app's `Dialog` primitive rather than remaining a one-off.

**What to fix first, and the evidence for that order:** A1 and A2, because they are the only Critical findings whose fix is a single CSS declaration each, and both were verified by direct measurement (0px panel height at 640×400; 856px scrollWidth at 721px). A3 next, because it removes a total-loss path with one changed condition. Then the shared primitives (A5's `Dialog`, A10's live region), because six further findings depend on them existing.
