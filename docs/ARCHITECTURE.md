# Architecture

## Boundaries

`packages/chess-tools` is the framework-free domain and application layer. It owns chessops-based
position and PGN handling, `GameTree`, analysis, provider clients, result models, and the canonical
tool and workflow contracts.

`apps/mcp-server` adapts that layer to MCP over stdio. It supplies Zod transport schemas,
process-local repertoire handles, the Node Stockfish pool, credentials, and file access confined to
`REPERTOIRE_DIR`.

`apps/ui` is a static SolidJS PWA. It supplies the current document, IndexedDB, browser file APIs,
OpenRouter streaming, Stockfish Workers, staged actions, and artifacts. Its typed browser-command
registry is the common entry point for chat and direct report or export controls.

## Contracts and adapters

`packages/chess-tools/src/tool-contract.ts` owns operation names, descriptions, host availability,
capabilities, defaults, validation metadata, result kinds, and explicit host adaptations. Browser
JSON Schema is emitted from it; MCP Zod schemas are checked against it. The generated
[tool catalog](TOOL_CATALOG.md) is the exact inventory.

Host differences remain explicit. MCP operations use repertoire handles, confined paths, and
clone-on-write results. Browser operations use the current `GameTree`, create downloadable
artifacts, and stage mutations against a document revision. A shared name does not imply equal
storage, credential, engine, or persistence behavior.

## State

`GameTree` stores a legal variation tree. Multi-game PGN imports merge lines into one tree. Browser
navigation uses index paths internally and SAN paths at application boundaries. Document revisions
prevent stale staged actions from overwriting later edits.

The MCP repertoire store is bounded by count and idle TTL. Handles are process-local capability
tokens. Analysis jobs and cached reports bind to immutable handle and settings identities.

Browser chat sends compact document context and retrieves larger PGN, subtree, or Strategic Fit
evidence only through bounded commands. Every tool-capable round receives the same complete browser
schema. Long operations use shared progress, cancellation, settlement, and retry state.

## Engines and providers

Node Stockfish uses a bounded child-process pool and an in-process fallback. Browser Stockfish uses
a scan-worker pool and a dedicated live worker. Evaluation caches reuse sufficient depth and
MultiPV results, recognize transpositions below the 50-move boundary, and remain bounded. Node can
persist its cache; browser persistence uses IndexedDB.

Engine transport uses White POV. User-facing repertoire comparisons convert to repertoire POV and
label the conversion. Depth is clamped to 1–30. Game review follows the mainline; repertoire scans
walk decision nodes and preserve per-item failures.

Explorer-backed work uses injected Lichess or Chess.com clients and credentials. Missing credentials,
partial provider data, aborts, and unavailable engine results remain structured outcomes.

## Strategic Fit

Strategic Fit computes deterministic, transposition-aware findings from a document, effective
profile, source filters, and analysis settings. Reports, pages, evidence retrieval, and staged
actions carry identities that prevent mixing revisions or settings.

The browser persists profile metadata, resolution records, training evidence, accepted archives,
and undo records through dedicated stores. Inferred preferences, retained-exception plan cards, and
portfolio choices are proposals until accepted. Training creation registers untrained targets;
only a move played in `DrillRunner` records an attempt, and first-attempt recall is preserved.

Replacement Lab retains candidate generation, engine evidence, scores, safety results, and change
sets. Views read those records rather than recomputing them. Selection stages a revision-bound
before/after preview. Acceptance uses the canonical atomic mutation path, then a fresh report proves
whether the finding resolved. Undo uses the persisted archive and is verified by another report.

Constrained portfolio redesign first validates and confirms explicit bounds. It filters only
already-retained candidates with measured values and existing safety and change-set evidence. It
does not relax contradictions, count missing evidence as satisfying a bound, or create a second
staging path.

## Persistence and safety

The browser autosaves the current document and settings in IndexedDB. Canonical Strategic Fit JSON
sidecars carry portable, secret-free profile and metadata state. Browser file APIs keep PGN content
out of model context unless a command explicitly retrieves it.

MCP paths are confined beneath a real-path-resolved base and reads are size-capped. Repertoire edits
are clone-on-write. Browser edits require explicit acceptance and a matching document revision.
Errors use stable codes; operations that process many items preserve item-level failures.
