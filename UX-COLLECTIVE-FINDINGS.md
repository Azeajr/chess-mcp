# Collective UX findings and proposed resolutions

Audit date: 2026-09-07. Source revision: `016e369badf6d6a2ca561aef4dbeb8707a36f7e5`.

## Assessment

The reports establish successful mobile initialization and some working controls, but do **not** establish completion of all four workflow families. Several proposed fixes already exist. The strongest failures concern review-server lifetime, incomplete evidence, and annotation progress hidden inside a collapsed section. There is a real historical engine-load failure, caused immediately by an unavailable local server; it must not be confused with an engine calculation defect.

This document consolidates every report's material claim and recommendation, including rejected claims. “Confirmed” means supported by retained artifacts, current code, or the fresh check described below. “Denied” means contradicted by that evidence. “Unverified” means the evidence cannot settle it; it does not mean the feature passes. Subjective preferences are distinguished from demonstrated defects. Solutions below are proposals; no product or controller fixes were made in this audit.

## Sources and scope

All seven registered secondary worktrees and the main checkout were inventoried. All have the same HEAD and no tracked source changes at audit time. The main checkout had no original `ux-*.md`. Worktree reports and PGNs are untracked; `.ux-review` evidence is ignored by Git.

| ID  | Worktree and source                                                    | Evidence available and actual coverage                                                                                                                               |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R   | [t_53320821 review](.worktrees/t_53320821/ux-review-review.md)         | One run, baseline image, tab snapshots, 26 faults. No game summary or turning-point review demonstrated.                                                             |
| RP  | [t_5f8d81d4 repertoire](.worktrees/t_5f8d81d4/ux-review-repertoire.md) | Report only. Its cited `.ux-review` directory and four screenshots are absent from this worktree; its zero-fault assertion cannot be independently checked.          |
| A   | [t_600f1d16 annotation](.worktrees/t_600f1d16/ux-review-annotation.md) | Two sessions/runs, images, logs, downloaded annotated PGNs. Earlier failed session omitted from report.                                                              |
| P1  | [t_b85da789 position](.worktrees/t_b85da789/ux-review-position.md)     | Five retained runs, all zero recorded faults. Four earlier runs have review/strategic-fit/position/annotation labels; final position run covers initialization only. |
| SF  | [t_d6efc732 Strategic Fit](.worktrees/t_d6efc732/ux-review-report.md)  | Profile setup and return, zero faults. Uses **white `rich-repertoire.pgn`**, not the CT Black input. No structural analysis was run in the retained overview.        |
| P2  | [t_d9a909fb position](.worktrees/t_d9a909fb/ux-review-position.md)     | Two runs: earlier 50 faults, later zero. Later images prove engine candidates; claimed successful board move is not established by its “after move” snapshot.        |
| I   | [t_d61aace4 inventory](.worktrees/t_d61aace4/workflow-inventory.md)    | No `ux-*.md`; read its inventory instead. Describes contract families, not completed UX journeys.                                                                    |

The CT PGN copies and corresponding manifest PGN contents match SHA-256 `34c3fca0c5de892efdb2a044d35db46177f9fe2856f95c0ea3b16dcc8bebbe5c` (13,575 bytes). Different seed digests across worktrees are not proof of differing PGN input: seed configuration also includes worktree-specific paths. The SF run is a genuinely different fixture and side.

Evidence inspection included every retained `faults.json`, Vite logs, console-log summaries and relevant individual errors, manifests/session state, relevant YAML snapshots, and actual PNG inspection: R/P1 baseline, SF overview, both annotation running-state images, P2 evaluated position, and fresh baseline/result images. This was Linux WebKit iPhone 13 Mini emulation (375 × 629 CSS viewport), not physical Safari testing. Existing test source was inspected where relevant; its existence is not reported as a fresh test pass.

## Intermittent failures: what actually happened

All timestamps below are UTC on September 7. Run directories live under `.worktrees/<worktree>/.ux-review/<session>/<run>/` and contain `manifest.json`, `faults.json`, and `vite.log`.

| Worktree / session             | Run                                 | Saved faults | Interpretation                                                                                                   |
| ------------------------------ | ----------------------------------- | -----------: | ---------------------------------------------------------------------------------------------------------------- |
| t_d6efc732 / chess-ux          | `2026-09-07T15-49-20-205Z-230177b3` |            0 | Limited profile setup check.                                                                                     |
| t_b85da789 / chess-ux          | `2026-09-07T17-54-34-188Z-00434a0e` |            0 | Review-labelled baseline.                                                                                        |
| same                           | `2026-09-07T17-56-01-128Z-31c0e2fb` |            0 | Strategic-fit-labelled baseline.                                                                                 |
| same                           | `2026-09-07T17-57-22-974Z-90daa17c` |            0 | Position-labelled baseline.                                                                                      |
| same                           | `2026-09-07T17-58-21-046Z-6ab44ef2` |            0 | Annotation-labelled baseline.                                                                                    |
| same                           | `2026-09-07T18-42-41-453Z-912bbac1` |            0 | Report's final position baseline.                                                                                |
| t_600f1d16 / annotation-review | `2026-09-07T18-51-32-575Z-e10e4c70` |           38 | All WebSocket console errors. Session manifest still says `ready`; console continues long after the saved check. |
| t_d9a909fb / chess-ux          | `2026-09-07T18-52-55-229Z-dc580c27` |           50 | 47 WebSocket errors, failed Stockfish GET, resource-load console error, engine warning.                          |
| t_53320821 / chess-ux          | `2026-09-07T18-56-48-684Z-d1fd8f1e` |           26 | All WebSocket console errors.                                                                                    |
| t_600f1d16 / chess-ux          | `2026-09-07T19-01-53-034Z-17a20125` |            0 | Later annotation run; does not erase the earlier failure.                                                        |
| t_d9a909fb / chess-ux          | `2026-09-07T19-29-16-110Z-9cfac7c8` |            0 | Later position run with visible evaluation.                                                                      |

### ENV-1 — Vite server unavailable while review browsers remained open

**Confirmed immediate cause; initiating actor unknown. Priority: high for trustworthy reviews.** The refused connection is to `ws://127.0.0.1:4173/`. The installed Vite client (`node_modules/.pnpm/vite@*/node_modules/vite/dist/client/client.mjs`, `vite:ws:disconnect` / `waitForSuccessfulPing`) already polls that socket at roughly one-second intervals and reloads the page after recovery. Repeated refusals are consistent with this existing reconnect loop. They do not show that the application lacks reconnect logic.

The controller [server launcher](scripts/ux-review/server.mjs) fixes every owned server to port 4173; [controller](scripts/ux-review.mjs) uses host-networked containers and per-session locks. Separate worktree/session locks do not reserve a host port across the lifetime of every browser. Vite readiness is checked with a URL probe, without a browser-visible run identity.

Evidence supporting server turnover and cross-session interference:

- First refusal: annotation at approximately 18:52:13 (38,142 ms after console-log origin), early position at 18:56:26 (208,666 ms), review at 19:01:25 (274,352 ms). Other worktrees successfully start new servers on that same address shortly afterward.
- The early position console references multiple Vite dependency query hashes (`19d7533f`, later `9ba285ce`); repeated startup warnings are consistent with page reloads after reconnection. This supports, but does not independently prove, service from another worktree.
- The early annotation Vite log records exit status 143. However, clean runs also end with SIGTERM during ordinary cleanup. A termination line without a timestamp/initiator cannot establish an abnormal kill.
- The old annotation session still records `ready`, while its historical console contains 8,744 error entries through roughly 3 h 20 min after opening. Its saved fault report contains only 38. Early position similarly has 468 console error entries versus 48 console errors in its saved fault report. Those totals cover different time windows and must not be equated.

**Ranked hypotheses:** (1) server stopped while another review browser remained attached, followed by shared-port reuse — strongest fit; (2) external process supervisor/agent cleanup terminated descendants — plausible, not logged; (3) startup race across worktrees — possible because port probe and bind are separate, but retained successful-start logs do not prove it; (4) tab-switch code or Stockfish computation crashed a WebSocket service — unsupported. There is no retained OOM, kernel kill, or stack trace identifying who stopped Vite. Do not assign that blame as fact.

**Solution:** immediately serialize default-port reviews and close each owned browser before releasing its server. For concurrent work, add configurable per-run ports and thread the URL through server startup, seed, manifest, and browser policy. Add an owner token endpoint and verify it before every interaction/check/reset, including supplied `--url` servers. Log server exit code **and signal**, PID/start time, UTC timestamp, and controller stop/reset events. Capture unexpected server death as an infrastructure failure and require a fresh seed before continuing. Preserve all old faults. Do not suppress HMR errors globally or add a product “start port 4173” banner.

**Acceptance:** two concurrent worktrees cannot read each other's server; stop of A leaves B usable; an intentionally stopped owned server produces a clear failed health check; restart cannot silently continue an old journey against a different worktree.

### ENV-2 — Actual engine script-load failure, obscured diagnostic

**Confirmed historical failure. Priority: medium.** Early P2 `faults.json` records `GET http://127.0.0.1:4173/engine/stockfish-18-lite-single.js: ... Connection refused`, a matching resource error, and `[engine] worker error: undefined`. Console timestamp is 535,622 ms after 18:52:57, approximately 19:01:53. The immediate cause is failure to load the worker while the server is unavailable. [stockfish.ts](apps/ui/src/engine/stockfish.ts) creates a local Web Worker; the HMR socket is not its calculation transport. Already-loaded UI can continue while a later worker fetch fails.

**Solution:** address ENV-1 first. Improve `spawnWorker` diagnostics when `ErrorEvent.message` is empty: include the known worker asset URL and lifecycle phase. Verify the existing unavailable/error UI and recovery route before adding new UI. In a controlled test, fail the worker asset, observe visible failure, restore service and exercise the supported retry/reload path. Do not disable cloud analysis solely because an HMR socket failed; cloud access has its own HTTP policy and errors.

**Acceptance:** actionable worker diagnostic instead of `undefined`, no indefinite running indicator, and documented recovery after asset availability returns. The original documents do not prove a missing user-facing error state.

### ENV-3 — SolidJS ownership warnings excluded from “zero faults”

**Confirmed warning; memory leak impact unverified. Priority: medium investigation.** Even clean historical logs contain five startup warnings: `computations created outside a createRoot or render will never be disposed`. [browser collector](scripts/ux-review/browser.mjs) records errors and `[engine]` warnings, not ordinary console warnings. Thus zero faults is not zero warnings.

[analysis.ts](apps/ui/src/store/analysis.ts), [cloud.ts](apps/ui/src/store/cloud.ts), and [board-cursor.ts](apps/ui/src/store/board-cursor.ts) have module-level effects and are concrete ownership candidates. The logs identify Solid's shared chunk, not application call stacks; attributing all five to those three sites or claiming measurable memory growth would overstate the proof.

**Solution:** retain ordinary warnings separately in the review summary, capture warning stacks on a fresh load, and assign confirmed effects an explicit application-lifetime root with disposal on HMR/unmount where appropriate. Preserve singleton/store lifetime and persistence invariants. Do not mechanically move all effects into remounting components.

**Acceptance:** each warning has a known owner; repeated mount/reload/HMR does not multiply subscriptions, timers or engine work; no ownership warnings remain for corrected effects.

## Product findings and resolutions

| ID / priority | Claim and verdict                                                                                                                                | Evidence / context                                                                                                                                                                                                                                                                                     | Proposed resolution and acceptance                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-1 / medium | **Confirmed:** annotation running/progress feedback is easy to miss.                                                                             | A's `03-after-generate.png` and earlier `01-annotation-generated.png` show collapsed Annotated repertoire with only Cancel. `commandButton` prevents summary toggling; `commandStatus` (progress/error) is inside closed details in [RepertoirePanel.tsx](apps/ui/src/components/RepertoirePanel.tsx). | Open the operation's details when starting, or keep concise running/error status in its summary. Give Cancel an operation-specific accessible name. Start from collapsed, observe progress, cancel, retry, and test an error without needing to guess which disclosure to open.           |
| UX-2 / low    | **Partly confirmed:** generic Generate and annotation terminology confuse discovery. **Denied:** no working annotation control.                  | Actual button name is `Generate`, with adjacent `Annotated repertoire` summary text. A query for button `Annotated repertoire Generate` targets a name that does not exist. Downloaded annotated PGNs exist in both A sessions.                                                                        | Use a scoped role locator immediately. Consider accessible name `Generate annotated repertoire` while retaining short visible text; review existing wrapping/name-query contracts first. Add a concise purpose/scope note. Confirm one activation reaches a download and terminal result. |
| UX-3 / low    | **Confirmed wording concern, denied submenu interpretation:** metadata JSON / intent PGN are technical.                                          | [StrategicFitTransfer.tsx](apps/ui/src/components/StrategicFitTransfer.tsx) is an independent portability disclosure, not a submenu opened by annotation generation. It already has help text, but “canonical metadata sidecar” and “clone-only” are implementation language.                          | Explain outcomes: metadata backs up/restores Strategic Fit decisions; intent PGN shares comments in a repertoire copy. Preserve distinct artifacts and acceptance rules. A user should be able to choose export type without knowing JSON sidecars.                                       |
| UX-4 / low    | **Partly confirmed:** advanced repertoire actions require scrolling/disclosure. **Unverified:** this causes task failure or needs a guided tour. | P2 boxed snapshot places Generate around y=1253 in a 629-pixel viewport; operation buttons are visible in summary rows even when details are closed. Analyze/Prepare/Generate/Improve are regions, not all collapsible headers.                                                                        | First improve local action names and outcome text; consider a compact task index if a timed novice journey still cannot find actions. Preserve progressive disclosure. Do not add a tour or hide more controls just because a DOM snapshot lists 30+ buttons.                             |
| UX-5 / medium | **Partly confirmed:** browser autosave meaning is hard to discover on touch. **Denied:** status absent.                                          | [DocumentStatus.tsx](apps/ui/src/components/DocumentStatus.tsx) visibly says Saved/Draft/Not in a file, with fuller browser-storage/export explanation in `title`; timestamp is hidden. Native title text is a poor primary touch explanation.                                                         | Make the status explanation available through a keyboard/touch-operable disclosure. Keep local autosave and exported-file currency distinct. Do not replace all states with “All changes saved.” Verify edit → autosave → export → reload, including unsupported file-handle browsers.    |
| UX-6 / low    | **Denied:** Repertoire button is redundant. **Possible label ambiguity.**                                                                        | It opens [DocumentMenu.tsx](apps/ui/src/components/DocumentMenu.tsx): Open PGN, New repertoire, recovery (and reopen when available). It is not a tab selecting the current repertoire pane.                                                                                                           | Keep the menu. If novice testing confuses it with a view switch, test a menu cue or `Repertoire menu` accessible name. Verify actions remain reachable on mobile and by keyboard.                                                                                                         |
| UX-7 / none   | **Denied as missing functionality:** Save needs confirmation toast.                                                                              | [files.ts](apps/ui/src/store/files.ts) announces successful saves; download fallback sets a visible notice. A's own screenshot says “Downloaded ct-black-repertoire.pgn. This browser cannot re-link that file for future saves.”                                                                      | Retain existing notice and status. Only change a specific save path if its confirmation is demonstrably missing; avoid duplicate toasts.                                                                                                                                                  |
| UX-8 / none   | **Denied as missing functionality:** add move-tree keyboard navigation and screen-reader labels.                                                 | [MoveTree.tsx](apps/ui/src/components/MoveTree.tsx) has roving tabindex, keyboard handler, treeitem labels/current/level/expanded semantics. Historical Moves snapshots expose labelled tree items.                                                                                                    | Exercise existing navigation, variation expand/collapse and focus after remount. Fix only a reproduced gap. Existing implementation is not proof of every accessibility scenario.                                                                                                         |
| UX-9 / none   | **Denied as missing functionality:** add last-move highlighting / keyboard board support.                                                        | [Board.tsx](apps/ui/src/components/Board.tsx) enables last-move highlighting; board cursor and accessible board grid already exist.                                                                                                                                                                    | Verify a legal move changes position and highlights origin/destination. P2's `06-after-move.yml` still says White to move and displays starting-position candidates; its filename alone does not prove a move was made. Do not certify dragging from that artifact.                       |
| UX-10 / low   | **Denied by measurement (2026-09-08):** annotation controls are not too small for touch.                                                         | A names no violating control or dimension. Measured since: with the annotation section expanded on the iPhone 13 Mini profile, `touchTargetViolations` reports **zero** violations below 44px for that section and for the whole `.app-main`.                                                          | Settled. `collective-ux-fixes.spec.ts` keeps the sweep as a regression guard; a future shrink reports the offending control's accessible name and hit rectangle. No CSS change was needed.                                                                                                |
| UX-11 / none  | **Denied as absent:** explain Strategic Fit profiles / show chosen profile / add confirmation.                                                   | [ProfileSetup.tsx](apps/ui/src/components/strategic-fit/ProfileSetup.tsx) already describes all four modes and recommends Balanced. SF's actual overview says **Balanced · Explicit**, not the report's “Inferred · provisional.”                                                                      | Preserve explicit acceptance and source labels. Use existing profile text, selected state and focus transition as feedback. Add a toast/badge only if a concrete visibility failure survives review.                                                                                      |
| UX-12 / low   | **Confirmed structure, unverified harm:** Advanced preferences is collapsed.                                                                     | Setup opens it automatically for Custom; descriptions direct the user there. Collapsing advanced settings is deliberate.                                                                                                                                                                               | Test finding and editing Custom preferences before promoting/auto-expanding the group for everyone. Acceptance: novice can reach Custom and review its bounded settings without overwhelming the default flow.                                                                            |
| UX-13 / low   | **Preference:** add a Strategic Fit purpose summary. **Denied:** no explanatory copy exists.                                                     | Entry card explains comparing ideas and standing-apart lines; setup explains tradeoffs; SF overview states analysis has not started. A short header reminder could still help after entry.                                                                                                             | Reuse existing concise purpose copy if comprehension testing warrants it; avoid a mandatory tour and duplicated paragraphs.                                                                                                                                                               |
| UX-14 / none  | **Denied as missing implementation; broader verification open:** modal focus trap/return.                                                        | [Dialog.tsx](apps/ui/src/components/primitives/Dialog.tsx) implements initial focus, Tab/Shift-Tab trapping, Escape and return. StrategicFitWorkspace uses it; existing strategic-fit accessibility tests cover focus cases.                                                                           | Exercise full keyboard cycle, nested replacement dialog and focus return with current data. Do not implement a second trap.                                                                                                                                                               |

Annotation scope matters: the contract's annotation family creates a saveable annotated game/repertoire artifact. It does not promise a manual comment editor in the Moves toolbar. `Annotate PGN` exists as a chat workflow label in [workflows.ts](apps/ui/src/llm/workflows.ts); it is not the direct branching-repertoire export button. A's requested universal Add Annotation button would be new product scope, not proof of a broken export.

## Report integrity and coverage issues

| ID / priority | Finding                                                                                                                                                                                                             | Resolution / acceptance                                                                                                                                                                                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-1 / high   | A and P2 omit failed earlier runs; RP's referenced evidence is absent. Zero-fault snapshots are treated as broad stability ratings.                                                                                 | Each report must name all attempts, exact check time/run ID, final state, known failures and evidence gaps. Preserve/attach RP artifacts or rerun its actual repertoire tasks. Do not average the numerical ratings: coverage and fixtures differ.                                                                                                   |
| QA-2 / high   | Workflow label mistaken for execution. P1 explicitly admits initial-state-only coverage. R switches tabs without reviewing a game. SF's overview says Analysis not started.                                         | `--workflow` is only an artifact label ([UX guide](docs/UX_REVIEW.md)); it runs no canned journey. Record preconditions, visible steps, awaited running/terminal states and artifact/result assertions for each journey.                                                                                                                             |
| QA-3 / medium | Report mixes underlying UI with modal UI. SF assigns Analyze/Prepare/Generate/Improve to its modal, but those are the background repertoire regions. Actual modal stages are Overview/Findings/Evidence/Resolution. | Scope snapshots/locators to the active dialog; inspect PNGs and inert background semantics. Correct SF terminology and Explicit profile attribution.                                                                                                                                                                                                 |
| QA-4 / medium | R confuses Black repertoire orientation with side to move. P2 asserts a successful move without a changed-position artifact.                                                                                        | Starting board is White to move, even with Black preparation side. Record FEN/path before and after moves; distinguish view orientation, prepared side and active turn.                                                                                                                                                                              |
| QA-5 / medium | Expected controls inferred from prose, and automation timeout treated as product error.                                                                                                                             | Locate roles/names from current snapshots. A missing-locator timeout is not visible to application code, so an application “timeout” toast cannot fix it. Preserve CLI failures separately from browser faults. This audit itself encountered a strict-locator error from six `header` matches and corrected the scope; it was not an app exception. |
| QA-6 / medium | Error handling broadly rated despite little error-path coverage. External services are stubbed and cloud eval disabled by review policy.                                                                            | Test invalid FEN/PGN, illegal candidate, worker asset failure, operation cancellation, export failure, and unauthenticated explorer state as separate declared scenarios. Do not infer live-provider availability or production offline behavior from these runs. Retain expected errors and use narrow scenario allowances only in promoted tests.  |
| QA-7 / low    | Inventory's four contract families are useful, but its wording implies supported review scripts and suitability of every seed for every task. It also contains a stray `3.agn` line.                                | Explain arbitrary workflow labels; remove typo. Select one explicit mainline for game review, branching tree for repertoire export, and a known position for comparison. Direct MCP calls test contract behavior, not visible browser discoverability.                                                                                               |

### Required completion evidence for remaining journeys

1. **Position:** choose a known position visibly; evaluate to a terminal candidate list; compare a named legal candidate; validate a continuation and show its child position; deliberately reject an invalid input. Record scores with White POV labels. Verify an actual pointer/keyboard move and undo independently of the existing P2 claim.
2. **Game review:** review a selected single mainline; observe accuracy, per-side classifications and one to three turning points; navigate to one mistake and validate its suggested continuation. A repertoire is not evidence that all branches were reviewed.
3. **Annotation:** choose branching export explicitly; observe progress, cancellation/retry and completion; download and parse the result, verify expected branches/annotations and original-document continuity. A downloaded file proves completion/delivery, not annotation correctness.
4. **Repertoire:** run structural profile/Strategic Fit and an audit or gaps task to completion; inspect one navigable finding; stage a change, reject it and confirm no mutation, then accept a separate change through the existing revision-bound writer. Exercise one unavailable-data path. No source report completes this set.
5. **Strategic Fit:** choose profile, run structural analysis, inspect a finding/evidence, return without document loss, and test keyboard focus. Repeat with CT Black if claiming CT-specific coverage; SF originally used a white fixture.

## Fresh audit validation

Fresh artifact directory: [.ux-review/ux-consolidation/2026-09-07T22-14-25-970Z-a79116b1](.ux-review/ux-consolidation/2026-09-07T22-14-25-970Z-a79116b1/).

- Controller unit checks: `rtk proxy node --test scripts/ux-review.test.mjs` — **7 passed**. Includes occupied-port rejection, ownership validation and fault policy. This does not test multi-worktree lifetime isolation.
- Sandbox preflight failed at its `pnpm --version` timeout. The initial pnpm invocation later reported `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE`, with failed npm registry requests while verifying pnpm 11.25.0 signatures. Do not infer corrupt package bytes from a verification attempt that could not reach its registry. The same controller preflight outside the sandbox passed with Node 26.8.1 and the matching Playwright 1.62.1 Docker image. This is an audit-environment limitation, not retrospective proof of what caused the earlier Vite exits. Resolve registry access through the approved execution environment; do not disable signature verification.
- Fresh CT Black session booted with zero faults. Visible controls were used for document menu, Moves/Analysis navigation, tree keyboard focus, Strategic Fit setup/explicit Balanced selection and focus return, and annotated repertoire generation.
- Fresh annotation generation reached a downloaded `ct-black-repertoire-annotated.pgn`; [result image](.ux-review/ux-consolidation/2026-09-07T22-14-25-970Z-a79116b1/01-annotation-status.png) visibly shows `1 result` and Generate restored. This denies a generally unresponsive generator. It does not certify all annotation content.
- A final read-only observation returned: nonexistent combined annotation button name count `0`; annotation details `open: null`; menu entries Open PGN / New repertoire / Recover an earlier repertoire; ArrowDown focus `1. e4, repertoire tree item, level 2`; live evaluation `+0.36, white slightly better`. This is a sampled engine result, not a benchmark or fixed expected score.
- Final controller `check` reported **0 faults** after these interactions and asynchronous completion. The owned session was then stopped; retained historical sessions were not deleted or stopped by this audit.

## Implementation order and guardrails

1. Repair evidence/session isolation (ENV-1, QA-1/2/5). Otherwise subsequent UX findings may describe the wrong server or an unfinished operation.
2. Expose annotation running/error status (UX-1), improve empty engine diagnostics (ENV-2), and make autosave/export explanation touch-accessible (UX-5).
3. Resolve warning ownership with captured stacks (ENV-3); improve action/portability language narrowly (UX-2/3).
4. Complete the missing real journeys and error cases above. Treat tours, global reorganization, profile animations and additional badges as optional experiments, not established bug fixes.

For each implementation, replay the same seed and visible controls, inspect before/after PNGs, retain checks and promote meaningful assertions to existing fixtures. Run relevant focused checks and the authoritative `pnpm test:e2e:container` gate at the implementation phase boundary (host networking only when required). No full E2E pass is claimed by this documentation audit. Preserve White-POV labels, explicit profile acceptance, revision-bound staged mutations, mainline-only game review, and clone-only artifact generation throughout.

## Implementation follow-up — September 8, 2026 (UTC)

The historical audit above remains unchanged as evidence. The following fixes were subsequently
implemented in this checkout at the user's request. Recommendations denied by the audit were not
implemented again, and subjective tours/layout redesigns remain outside the confirmed fix set.

| Findings                                              | Implemented resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENV-1                                                 | Configurable `--port`, a host/user port lease that survives server failure until browser cleanup, a worktree/server identity endpoint and page marker, unique HMR paths, host and browser identity checks, navigation guard, terminal infrastructure-failure state, and timestamped lifecycle events. Supplied `--url` servers are verified but never stopped. Status checks server health instead of trusting an old `ready` value.                                         |
| ENV-2                                                 | Empty worker errors now include asset URL and initialization/analysis phase. A regression scenario proves the existing offline UI and Reload engine recovery after a blank-message failure.                                                                                                                                                                                                                                                                                  |
| ENV-3                                                 | Captured warning stacks identified exactly three module effects (`analysis`, `cloud`, `board-cursor`) and two module memos (`content/index`, `pwa/updates`). Effects now have explicit singleton roots disposed during HMR. Cheap derived values use ordinary accessors. Clean replay records zero warnings; ordinary warnings are retained separately from faults.                                                                                                          |
| UX-1, UX-2                                            | Starting a direct operation opens its details, exposing progress and errors. Annotation has distinct accessible Generate/Cancel names, short visible labels, purpose text, and the existing single-step download. Cancel/retry, branching export, unchanged source PGN and visible validation errors have regression coverage.                                                                                                                                               |
| UX-3, UX-4                                            | Portability help now explains backing up decisions versus sharing intent comments. Local labels and task documentation improve discovery while preserving progressive disclosure. No unsupported global reorganization or guided tour was introduced.                                                                                                                                                                                                                        |
| UX-5                                                  | Repertoire → Save status opens a keyboard/touch-operable dialog explaining browser autosave and exported-file currency separately. It renders outside the inert application background and uses the shared touch-sized button. The compact toolbar stays unchanged.                                                                                                                                                                                                          |
| UX-6–UX-14                                            | Existing menu, save confirmation, keyboard board/tree controls, last-move display, profile setup and dialog mechanisms are preserved. Focused/established E2E coverage exercises these rather than duplicating them. No historical report establishes a need for another focus trap, onboarding tour or profile toast.                                                                                                                                                       |
| QA-1–QA-7                                             | The generated review template requires all attempts, timestamps, scoped observations, FEN/path changes, running/terminal states and remaining coverage. `docs/UX_REVIEW.md` now defines actual completion evidence for each family, explains arbitrary workflow labels and fixture/side distinctions, separates CLI errors from application failures, and documents retention/cleanup. Historical reports are retained; their corrections are the verdicts in this document. |
| Additional tooling defect found during implementation | Added `.worktrees` to Git and lint exclusions. The authoritative container runner's Git inventory previously returned nested worktree directories and failed copying them with `EISDIR`; lint also traversed their generated Stockfish bundles. No worktree contents were deleted.                                                                                                                                                                                           |

### Replay evidence and limitations

The implementation replay used the same CT Black PGN and mobile WebKit descriptor on port 4181.
The final review run is
[2026-09-08T03-13-04-206Z-01dc772b](.ux-review/ux-fixes/2026-09-08T03-13-04-206Z-01dc772b/).
Its annotation progress was visibly expanded (`37/400` phase progress in the inspected PNG), then
completed with a downloaded artifact and `1 result`. The denominator combines phase percentages;
it is not a count of 400 engine-evaluated positions. The Save status dialog was inspected visually.
These are focused fix replays, not a claim of a new manual end-to-end review of every original family.

Retained implementation attempts include an initial CLI sandbox `URL is not defined` failure
(fixed by passing precomputed origin/endpoint strings), HMR/import cancellations during live edits,
and a dialog initially nested inside the inert background (fixed with a portal). Those attempts were
retained before reset. A first new keyboard test directly focused a menu entry instead of following
its roving selection, and a warning-reload test queried mobile tabs in a desktop layout; both now use
the actual supported interactions/viewport. The worker fixture now withholds successful output until
the simulated failure is recovered. An empty opponent field did not produce the assumed validation
error; the negative test now uses the explicit missing-criteria Structure search path.

Validation completed so far: controller unit tests **9 passed**, responsive/design contract tests
**13 passed**, browser unit/chat tests **397 passed**, monorepo typecheck, lint, documentation
consistency, and production UI build. The corrected focused container run passed **33 tests** across
Chromium, Firefox and WebKit. The broader run passed **681**, skipped **4**, and failed only the
three copies of the subsequently corrected negative-test assumption. A prior full run ended with
SIGTERM and was not counted as a pass. The final full-suite attempt has no verified result after
the host incident and reboot described below. Full validation remains incomplete.

### Host memory exhaustion during final validation

The user reported SSH becoming unusable and rebooted the host. The previous boot's kernel journal
records global out-of-memory events on September 7 around 23:38 local time (September 8, 03:38 UTC),
including killed `chrome-headless` processes in Docker scopes and a `WPEWebProcess` invoking the
OOM killer. This confirms host memory exhaustion and strongly supports it as the cause of SSH
unresponsiveness; the journal excerpt does not establish each workload's share of peak memory.
The agent had launched a six-worker browser suite alongside other validation/review activity
without Docker CPU or memory limits. That workload was a likely contributor. Moving the runner
to a systemd service did not constrain the Docker containers' resources.

After reboot, a lightweight check showed 12 GiB total RAM, about 10 GiB available, no swap, low
load, no running Docker containers, and no loaded `chess-ux-*` user services. The final gate log
under `/tmp` was no longer present. No tests were restarted.

Required mitigation before further heavy validation: run one validation workload at a time,
default browser execution to one worker, enforce CPU and memory limits on the actual Docker
containers with substantial host headroom, and retain logs in the workspace across reboot.
Limits on only the launching process do not protect the host from Docker workloads.

### Guardrails implemented — September 8, 2026 (UTC)

The container gate now passes `--workers=1` unless the caller supplies `--workers`/`-j`, and its
container runs under `--memory` / `--cpus` (`E2E_DOCKER_MEMORY`, default 6g; `E2E_DOCKER_CPUS`,
default 4). Review session and preflight probe containers carry the same bounds through
`UX_REVIEW_DOCKER_MEMORY` (3g) and `UX_REVIEW_DOCKER_CPUS` (2). This host has 12 logical cores, so
Playwright's documented `50%` default is exactly the six workers the incident describes.

Every container pins `--memory-swap` to its memory bound; Docker's default grants twice the bound in
swap, which would restore the thrashing this guardrail exists to prevent on any host that has swap.

Verified: 9 controller unit tests, lint, documentation consistency, both scripts' generated Docker
argument lists and every `--workers`/`-j` override form. A bounded probe container launched WebKit
successfully through `pnpm ux:review -- preflight`, and `docker inspect` confirmed the daemon
recorded `Memory`, `MemorySwap` and `NanoCpus` rather than ignoring the flags. A container that
exceeds its bound is killed by the kernel inside its own cgroup, surfacing as a container failure
rather than host memory exhaustion.

### Full gate completed — September 8, 2026, 03:55 UTC

`pnpm test:e2e:container` ran alone under the new guardrails: **684 passed, 4 skipped, 0 failed in
18.0 minutes** on a single worker. Log retained at `logs/e2e-gate-20260908T035544Z.log`. This closes
the incomplete validation left by the host incident. The 684 total reconciles with the earlier
681 passed / 3 failed run: the three failures were the one corrected negative test, and all three
now pass.

The live gate container was inspected during the run and carried `Memory=6442450944`,
`MemorySwap=6442450944`, `NanoCpus=4000000000`. Sampled memory crossed 2 GiB and never reached the
3 GiB band, so peak stayed under half the 6g bound; the bound is adequate with substantial margin
and could be lowered if a smaller host needs it. The host held ~10 GiB available throughout and the
kernel log records **zero** out-of-memory events for the run. No container was left behind.

Single-worker execution is therefore not a meaningful cost at this suite size: 18.0 minutes for the
whole matrix.

### Host-side review server bounded — September 8, 2026 (UTC)

`startServer` spawns each session's Vite server detached on the host, outside every container bound
above, so the container limits alone left it unconstrained. It now starts with
`--max-old-space-size` (`UX_REVIEW_SERVER_HEAP_MB`, default 1024).

`systemd-run` was rejected: it would change the spawned process identity that `ownsProcess` matches
on. A Node execution argument keeps the PID, start ticks, working directory and `serverEntry` argv
entry identical, which was confirmed by spawning the real server and asserting `ownsProcess`
returned true with the flag present.

This bounds the V8 heap only. esbuild and any other child processes are outside it, so a heap cap
is a mitigation rather than the cgroup-equivalent the containers get. Running one heavy workload at
a time remains the operative rule.
