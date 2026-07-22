# PWA product

The PWA supports two complementary entry points: natural conversation and direct analysis. Both use
canonical application commands and result models for user-triggered reports and exports.

## Conversation

Users can ask about the current position, game, or repertoire without choosing a mode. Every
tool-capable round exposes the complete stable browser command schema, allowing a conversation to
change subject without a routing gate. Position, game, repertoire, and annotation presets are
optional guidance only and never hide commands.

The prompt includes normalized FEN, color, selected SAN path, document kind and revision, and
compact statistics. Scoped tools retrieve a bounded selected subtree or full PGN artifact on
demand. Tool-round exhaustion produces an explicit incomplete summary.

Streaming and supported tool work share cancellation. The UI shows queued/running/completed,
cancelled, and failed states, including progress counts for long scans, plus Stop and Retry.

## Results, actions, and artifacts

Typed tool results render navigation targets for FENs, SAN paths, and game plies. Raw JSON remains a
debug disclosure, not the primary presentation.

Repertoire add, prune, and reorder operations produce staged actions. Each preview records the
source revision, path, before/after summary, and line where applicable. Accept uses the same command
as direct editing; Reject discards it; a stale revision cannot apply.

Direct repertoire suggestions, including gap fills, open a visible staged-line card with Accept line
and Cancel controls. Accept grafts the line into the working tree; the normal Save action persists it.

Annotated game PGN, annotated repertoire PGN, and only-move CSV decks are artifacts. Results give
the model compact metadata and an artifact reference while the UI owns the save affordance.

## Direct analysis

The Position area presents local engine lines and cloud provenance. Game workflows cover summary,
detail, batch review, and annotated export. Repertoire controls expose prescribed-move audit,
only-move drills, structure search, opponent preparation, gaps, coverage, congruence, shortening,
suggestions, and annotated export. Advanced controls group operations without changing the public
MCP surface; for example, the browser's shortcut inspector combines quality and coverage while MCP
keeps the independently composable operations.

Continuous live board analysis is deliberately UI-owned: it uses a dedicated Worker and discards
late results after navigation. Gap filling and shortening are named multi-step panel workflows that
compose canonical commands. These are documented exceptions to one-command equivalence, not
duplicate domain implementations.

Direct local analysis does not need an OpenRouter key. Network operations still need connectivity
and, for Lichess opening explorer, a personal token entered in Settings. An explicitly requested
Strategic Fit popularity enrichment remains a usable base report without that token and labels the
population source unavailable rather than reporting zero popularity.

## Persistence

The current document autosaves in IndexedDB. Browser file APIs open and save PGN without routing
content through the model. Settings keep model and token configuration locally. The production
build is an installable PWA and packages browser Stockfish assets during build.
