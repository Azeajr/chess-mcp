# Workflow-efficiency audit implementation

This change addresses the findings in [the workflow audit](workflow-efficiency-audit.md).
The audit remains a historical record; this document records the chosen behavior, not new
live-audit evidence. Regression results are reported on the PR and in CI.

| Findings     | Implementation                                                                                                                                                                                                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1           | Direct game summary/review/export, candidate comparison, tablebase, popularity, public-game import/batch review and repertoire/history comparison. All call the canonical browser command registry, without chat credentials. External services retain their existing authentication/network requirements.                 |
| F2           | Explicit Explore in the Moves toolbar. Scratch moves affect the board and local evaluation, not PGN, revision or autosave. Keep line is one history entry; Discard/navigation abandons scratch moves. Save exports only the committed repertoire.                                                                          |
| F3           | Visible Undo/Redo and current-move Delete from here/Make mainline. Tree and navigation updates are batched so pruning cannot publish an invalid intermediate path.                                                                                                                                                         |
| F4           | Clean-document replacement skips the confirmation but still captures a recovery snapshot. A detected PGN side loads immediately; unknown sides still require a choice. Dirty documents retain the close guard.                                                                                                             |
| F5, F24, F25 | Twelve-position gap pages, Add best fill, inline preview acceptance, SAN-based path resolution and removal of answered replies. Low-severity candidates are retained; empty text describes sampled engine candidates, never all legal replies.                                                                             |
| F6           | Practice from the Moves toolbar runs saved semantic training targets, most missed first, or retained only-move findings. Training creation starts its drill. Correct recall advances after 800 ms; misses keep an explicit Next/Finish. Only-move practice is explicitly session-only, not Strategic Fit mastery evidence. |
| F7           | Evaluation enabled/disabled is persisted; the default remains off to avoid surprise computation on mobile.                                                                                                                                                                                                                 |
| F8           | Engine rows offer Preview, Add and Play; Extend rows offer Add. Actionable engine rows clear when their source position changes.                                                                                                                                                                                           |
| F9           | Profile completion/skip starts analysis; reopening an idle/stale report starts a new non-mutating review. Completed reports are reused.                                                                                                                                                                                    |
| F10          | Showing a finding on the repertoire board offers a document-bound Back to Strategic Fit control, retaining stage and selection.                                                                                                                                                                                            |
| F11          | Direct resolution buttons, optional reason/note, next-decision selection and Undo decision. Existing metadata writer, report identity checks and reconciliation remain authoritative.                                                                                                                                      |
| F12          | Browsers without file handles label Save as Export PGN. Download explanation appears once per session and expires. Browser autosave remains the working-copy persistence.                                                                                                                                                  |
| F13          | Create drill deck serializes the retained only-move findings; it does not request another engine scan. Stale results cannot export a deck.                                                                                                                                                                                 |
| F14          | Strategic Fit metadata and intent-PGN exports generate/download in one step, show artifact status, and retain Download again.                                                                                                                                                                                              |
| F15          | Settings owns engine toggle/depth/cloud and chat workflow alongside credentials. The analysis shortcut focuses Engine, and missing explorer authentication links to the token field.                                                                                                                                       |
| F16          | Starters use the repertoire side, include game review for a single mainline, and send immediately only when the assistant is configured.                                                                                                                                                                                   |
| F17          | Remembered structure/opponent inputs, a structure-name datalist and recent-opponent datalist. Both hosts fold accents/apostrophes and accept unambiguous structure prefixes; ambiguous names still fail rather than guessing.                                                                                              |
| F18          | Accept all applies pending suggestions atomically as one undoable history entry. Stale batches/previews cannot edit a replacement document.                                                                                                                                                                                |
| F19          | Off-turn Suggest opens the section and explains why extension is unavailable rather than silently disabling the control. Extension style is remembered.                                                                                                                                                                    |
| F20          | Save status is a tap-to-open/light-dismiss popover with a save/export action for dirty documents, not a File-menu modal.                                                                                                                                                                                                   |
| F21          | Direct command results carry document, revision, side and last arguments. Document switches hide them; edits mark them stale with Re-run. Removed SAN paths disable navigation.                                                                                                                                            |
| F22          | Recovery rows label Autosave, Before replacing repertoire or Before restore, and prefer the latest readable pre-replacement snapshot.                                                                                                                                                                                      |
| F23          | An unambiguous semantic pivot is ready for generation immediately. Multiple alternatives still require explicit selection/confirmation; generation still only stages and acceptance remains explicit.                                                                                                                      |
| F26          | Default Review counts decidable findings. Insufficient evidence and transpositions are grouped information with direct board actions; explicit evidence/classification navigation can still inspect them.                                                                                                                  |

## Gap continuation contract

`find_repertoire_gaps` adds optional, zero-based `position_start` on both hosts. The existing
`positions_scanned` is the page count; `positions_available` is the full decision-node count.
Callers advance by the scanned count and keep the same tree, side and scan settings. Existing
severity thresholds and defaults do not change.

The browser retains an immutable scan tree while accepting fills. Scan next 12 continues that
original tree, and the UI labels results as from the original snapshot after edits. It resolves
rows against the current tree and removes answered replies; a fresh Scan is required for newly
added positions. No missing measurement is promoted into an all-clear claim.

## Regression locations

- `apps/ui/test/e2e/workflow-efficiency.spec.ts`: direct registry workflows, imports, exploration,
  visible edit controls, persisted engine settings, stale scans, gap continuation/inline acceptance,
  practice and retained deck export.
- `apps/ui/test/workflow-efficiency.test.ts`: scratch/history invariants, atomic suggestion batches,
  stale document guards, per-command reruns and optional-storage behavior.
- `packages/chess-tools/test/core/workflow-efficiency.test.ts`: gap offsets, retained low-severity
  White replies and structure normalization.
- Existing document, settings, Strategic Fit, artifact, drill and replacement suites retain their
  safety assertions with expectations updated for shorter interaction paths.

## Regression integration

- The review queue excludes informational findings by default, but its evidence checklist remains
  reachable even when every route is incomplete. Canonical overview metrics retain their full report
  counts; the Review badge counts only decisions.
- Decision feedback and Undo remain above the stage panes, including after the last decision returns
  the user to the assessment. Analysis details stay collapsed without introducing hidden Tab stops.
- Board pointer input refreshes Chessground's cached bounds before mouse/touch interaction. Document
  header changes can translate the board without triggering its size observer.
- Browser regression expectations reflect automatic first analysis, immediate drill start, and the
  browser-dependent Save/Export PGN label. Phone geometry comes from the container run, not estimates.
- Persistence-reload coverage waits for auto-started analysis to settle before navigation, avoiding
  aborted worker-module requests being mistaken for application faults. Lifecycle cancellation
  coverage remains separate. Assessment and completion actions retain explicit 44px target floors.
- The print-map screenshot hides only the unrelated main-app background during capture; map content
  assertions and pixel thresholds are unchanged. Its baseline is generated by the container gate.
