# PWA product

## Conversation

Chat works from a natural first message. Presets supply guidance but do not change available
commands. Each tool-capable round receives the complete canonical browser schema plus compact current
document context. Commands retrieve larger evidence only when needed.

The assistant can analyze positions, games, and repertoires; navigate to cited positions; generate
artifacts; and propose edits. Tool calls render as application data with progress, cancellation,
retry, and structured errors. A stale report or document identity fails instead of returning older
evidence.

OpenRouter model and token settings stay in the browser. Local Stockfish analysis and direct tools
work without chat. Explorer-backed commands require a Lichess token in Settings.

## Actions and artifacts

Assistant-proposed mutations are revision-bound previews. The user accepts or rejects them in the
UI. Direct previews use the same staging path. PGN, CSV, and JSON results become browser artifacts
with explicit save actions.

Inferred profile preferences show an exact diff and become durable only after acceptance. Retained
exception plan cards must cite deterministic concepts, checkpoints, or drills and mention only moves
on validated paths. Constrained portfolio requests show parsed bounds for confirmation, reject
contradictions, and select only already-generated candidates whose measured evidence satisfies every
bound.

## Direct analysis

The position panel offers local or cloud evaluation, candidate comparison, opening identification,
popularity, and tablebases. The game panel offers summary, move review, and annotated export.

The repertoire panel offers prescribed-move and gap audits, critical moves, drills, structures,
theory depth, history comparison, opponent preparation, annotations, shortening, transposition
inspection, complementary lines, and gap or replacement suggestions. Direct controls call the same
browser-command registry used by chat.

Live board evaluation and workflows that coordinate several commands remain UI-owned. Engine-backed
operations default to depth 20; Deep analysis uses depth 30 and shows progress for bulk work.

## Strategic Fit

Strategic Fit reports combine explicit profile preferences, source filters, personal-history
signals, and training evidence. Findings expose bounded pages, cited evidence, and navigable SAN
paths. Large visualizations and lists keep complete data available through bounded mounted windows.

Resolution options include retention with training, replacement, archive, and undo. Replacement Lab
shows retained candidate, score, safety, risk, provenance, and change-set evidence. Selecting a
candidate opens a staged before/after review. Acceptance applies one atomic document revision; a
fresh analysis then proves resolved, still open, or superseded status without relying on predicted
metrics.

Creating training registers untrained targets. `DrillRunner` shows one position, accepts one move,
records that first result, and carries the session across reanalysis. Later drill sessions add
evidence rather than overwrite earlier attempts.

## Persistence

The working document autosaves in IndexedDB. Browser file handles open and save PGN locally.
Settings, profile metadata, training performance, accepted archives, and undo records remain local.
The production build includes its Stockfish assets and service worker for installation and offline
use.
