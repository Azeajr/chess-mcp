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
browser Stockfish Workers and calls shared domain/application operations directly.

## Canonical contract and host adaptation

`packages/chess-tools/src/tool-contract.ts` is dependency-free. Each contract records identity,
description, host availability, capabilities, defaults, input metadata, result kind, and explicit
host adaptations. Browser JSON Schema is emitted from it and browser calls are runtime-validated.
MCP retains Zod schemas, mechanically checked against the canonical definition by the stdio smoke.

The registry does not hide real host differences. MCP repertoire operations accept a handle;
browser operations use the current `GameTree`. MCP file operations return or write confined
artifacts; the browser creates an artifact reference and presents a save action. MCP edits return a
new clone-on-write handle; browser edits first return a revision-bound staged action.

The generated [tool catalog](TOOL_CATALOG.md) is the exact inventory. The
[surface disposition](TOOL_SURFACE_DISPOSITION.md) explains why operations are kept or grouped.

## State and data flow

`GameTree` stores a legal variation tree. Multi-game PGN imports merge their lines into one tree.
Browser navigation uses index paths internally and SAN paths as stable tool-facing references.
Browser document revisions protect staged actions from overwriting later edits.

The MCP repertoire store is a bounded LRU with an idle TTL. Handles are process-local capability
tokens. Edits structurally clone the tree, apply an operation, and store a new handle; the source
remains valid and unchanged.

Chat sends compact document metadata and current FEN instead of the complete PGN. Deterministic
routing selects capability bundles, and scoped retrieval operations supply the selected line,
subtree, summary, or full PGN only when needed. Older tool results are compacted while retaining
references required by follow-up calls.

## Engines and caches

The Node host runs a pool of Stockfish WebAssembly child processes speaking UCI over stdio. Pool
size defaults to the smaller of CPU count and four; `ENGINE_POOL_SIZE=0` selects an in-process
fallback. Identical in-flight requests deduplicate. A watchdog requests `stop`, accepts a partial
result after grace, and does not cache stopped searches.

The browser mirrors this shape: several scan Workers are bounded by hardware concurrency, with one
slot reserved, and a dedicated live-analysis Worker so navigation does not queue behind scans.

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
`max_positions`, or budgets and support progress/cancellation where the host can propagate them.

Errors cross host boundaries as structured codes. File paths are realpath-confined. Browser chat
cannot directly mutate the document: add, prune, and reorder results are staged, previewable,
accept/reject actions with stale-revision detection. Artifact content is retained by the application
and chat receives compact metadata/reference unless inline content is part of the explicit contract.
