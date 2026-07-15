# Architecture

## Runtime boundaries

`packages/chess-tools` is the framework-independent domain and application layer. It owns legal
position/PGN handling through chessops, `GameTree`, structure and ECO classification, repertoire and
game analysis, network clients, the canonical tool contract, and host-neutral operation helpers.

`apps/mcp-server` is a local stdio host. MCP SDK and Zod define the transport boundary; adapters
resolve short-lived repertoire handles, run the Node engine, supply explorer credentials, and
confine file paths under `REPERTOIRE_DIR`.

`apps/ui` is a static-capable SolidJS/Vite PWA. It owns the current document, IndexedDB autosave,
browser file handles, OpenRouter streaming, result rendering, staged edits, and artifacts. It uses
browser Stockfish Workers. The typed registry under `apps/ui/src/application/browser-commands/`
injects document, engine, network, action, and artifact dependencies into capability-specific
handlers; chat and direct controls are thin clients of that registry.

## Canonical contract and host adaptation

`packages/chess-tools/src/tool-contract.ts` is dependency-free. Each contract records identity,
description, host availability, capabilities, defaults, input metadata, result kind, and explicit
host adaptations. Browser JSON Schema is emitted from it and browser calls are runtime-validated.
MCP retains Zod schemas, mechanically checked against the canonical definition by the stdio smoke.

The registry does not hide real host differences. MCP repertoire operations accept a handle;
browser operations use the current `GameTree`. MCP file operations return or write confined
artifacts; the browser creates an artifact reference and presents a save action. MCP edits return a
new clone-on-write handle; browser edits first return a revision-bound staged action.

The generated [tool catalog](TOOL_CATALOG.md) is the exact inventory.

Surface differences are based on semantics, not numeric parity:

- `get_position` is compact grounding with document context; `get_legal_moves` remains a smaller
  primitive for a known FEN.
- Local evaluation and `cloud_eval` remain distinct because offline availability, provenance, and
  result quality differ, although the PWA groups them under Position.
- Game summary, move detail, and annotated PGN remain bounded projections over shared cached
  mainline analysis instead of one context-heavy report.
- The PWA combines shortcut quality and post-prune coverage in `inspect_shortcut`; MCP keeps the
  quality and coverage operations independently composable because coverage is more expensive.
- Illustrative-line classification remains an optional diagnostic, never a hidden prerequisite for
  gap analysis. Suggestion operations remain independently callable finding actions.
- Transposition reporting is for explanation and navigation. Coverage and gap algorithms apply
  their own transposition-aware logic.
- MCP file operations add confined full reads and context-free writes. String-returning exports are
  the fallback for clients without a shared filesystem.

## State and data flow

`GameTree` stores a legal variation tree. Multi-game PGN imports merge their lines into one tree.
Browser navigation uses index paths internally and SAN paths as stable tool-facing references.
Browser document revisions protect staged actions from overwriting later edits.

The MCP repertoire store is a bounded LRU with an idle TTL. Handles are process-local capability
tokens. Edits structurally clone the tree, apply an operation, and store a new handle; the source
remains valid and unchanged.

Chat sends compact document metadata, current FEN, and selected SAN path instead of the complete
PGN. Every tool-capable model round receives the complete stable browser schema; optional presets
only replace workflow guidance. Scoped retrieval supplies the selected subtree or full PGN only
when needed. Older tool results are recursively compacted while retaining errors, FENs, paths,
actions, artifacts, and pagination references required by follow-up calls.

## Engines and caches

The Node host runs a pool of Stockfish WebAssembly child processes speaking UCI over stdio. Pool
size defaults to the smaller of CPU count and four; `ENGINE_POOL_SIZE=0` selects an in-process
fallback. Identical in-flight requests deduplicate. A watchdog requests `stop`, accepts a partial
result after grace, and does not cache stopped searches.

The browser mirrors this shape: several scan Workers are bounded by hardware concurrency, with one
slot reserved, and a dedicated live-analysis Worker so navigation does not queue behind scans.
Queued jobs can be removed on cancellation; an exclusive in-flight search receives UCI `stop` and
is never cached. Identical in-flight searches are subscriber-aware, so cancelling one caller does
not stop work still needed by another caller.

Both engine caches reuse deeper results for shallower calls and wider multipv results for narrower
calls. Keys use the first four FEN fields while the halfmove clock is below 50 and the full FEN at or
above it. The Node cache is FIFO bounded and writes JSONL under `EVAL_CACHE_DIR` unless set to `0`.
Each engine process keeps a warm transposition table, so fixed depth is preferred when reproducible
tie-breaking matters.

Pure placement-dependent structure calculations are bounded and memoized. Explorer results use an
in-memory cache because source data changes; rate limiting is shared, and a 429 starts the requested
cooldown. Explorer operations require a Lichess personal token.

## Safety and result conventions

Engine scores are white-POV unless an operation explicitly converts and labels mover POV. Game
review analyzes only the mainline. Expensive scans expose bounds such as depth, limits,
`max_positions`, or budgets. Shared operations use bounded scheduling and cooperative checks; the
browser propagates one abort signal through chat/direct lifecycle state, engine queues, network
requests, and artifact-producing operations.

Errors cross host boundaries as structured codes. File paths are realpath-confined. Browser chat
cannot directly mutate the document: add, prune, and reorder results are staged, previewable,
accept/reject actions with stale-revision detection. Artifact content is retained by the application
and chat receives compact metadata/reference unless inline content is part of the explicit contract.

Most direct report/export controls and chat calls share the browser command registry. Continuous
live evaluation remains navigation-owned because it has a dedicated Worker and latest-position
discard semantics. Higher-level gap filling and shortening panels may sequence several canonical
commands, but do not maintain a second implementation of their underlying analyses.
