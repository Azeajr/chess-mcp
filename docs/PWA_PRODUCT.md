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

Strategic Fit V2 replacement previews stage complete atomic change sets against the exact document,
revision, tree, metadata, result, archive, version, identity, and provenance chain. Preview and reject
are non-mutating. Accept persists the working PGN, canonical metadata references, exact archive PGNs
outside metadata, and bounded undo state atomically before publishing tree plus metadata as exactly
one revision. Undo restores repertoire, metadata, resolutions, archive state, and navigation in one
new revision. Pending replacement changes are discarded on reload and are never auto-accepted.

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
Optional Strategic Fit personal-history enrichment fetches full PGNs from the selected Lichess or
Chess.com account, uses only games played from the repertoire color, and shrinks sparse personal
branch counts toward the population or equal baseline. Missing PGNs and unavailable history remain
explicitly insufficient or unavailable rather than becoming zero frequency. Population, personal,
and manual estimates can be combined: the current profile's usable coefficients are normalized,
unavailable sources contribute zero, and equal mode ignores enrichments.
After first-run setup, the workspace keeps Familiar plans, Balanced, and Versatile as one-click
presets and exposes Custom through progressive disclosure. Custom settings cover bounded
feature-family weights, engine-loss tolerance, minimum coverage, memorization tolerance, explicit
preferred/avoided concepts, population filters, and a Lichess or Chess.com personal-history source.
Every advanced value explains its current impact; evaluation and coverage constraints are labeled
as later-alternative constraints rather than pretending to change the engine-free base scan. A
visible source-status grid distinguishes ready, off, unavailable, and unobserved evidence. Before
saving, an affected-metrics preview explains which frequency, distance, priority, or training metrics
will be recalculated. Saving invalidates/reanalyzes immutable reports and never edits the tree.
Strategic Fit training attempts are stored per document in a separate versioned IndexedDB record and
can be imported or exported as strict JSON. Registered drills remain explicitly untrained until an
attempt records recall; missing response time or confidence stays missing, while stale semantic
targets retain history but do not contribute current mastery evidence. Observed mastery is injected
into browser reports so familiarity-adjusted coverage, training-adjusted workload, and repertoire
regret show their source coverage instead of treating absent observations as failure.
The Strategic Fit workspace also detects a deliberately small set of explicit PGN comment phrases:
`must keep`, `tournament weapon`, and `avoid queenless middlegame`/`endgame`. The corresponding
explicit tags are `[%strategic-fit keep]`, `[%strategic-fit tournament-weapon]`, and
`[%strategic-fit avoid-queenless-middlegame]`/`avoid-queenless-endgame`. Every candidate quotes the
unchanged source comment and SAN path for confirmation. Detection alone never changes the PGN or
profile; dismissals are remembered only for the exact unchanged comment/path, while confirmations
become versioned structured document metadata that round-trips through the canonical JSON sidecar.

## Persistence

The current document autosaves in IndexedDB. Browser file APIs open and save PGN without routing
content through the model. Settings keep model, token, and Strategic Fit source-filter configuration
locally; the canonical document sidecar keeps the profile itself. The production
build is an installable PWA and packages browser Stockfish assets during build.

MCP and browser expose the same Strategic Fit V2 replacement meaning but different host guarantees.
Browser results are staged and support document archive storage plus bounded undo. MCP results are
immutable previews only, explicitly expose unavailable archive/restore/undo support, and return a
new clone-on-write repertoire handle only after a separate explicit edit. Matching command names do
not imply shared Worker, engine-pool, credential, path, artifact, persistence, or handle behavior.
Legacy one-move replacement results remain supported. The browser Replacement Lab now opens only
from a current unresolved actionable finding, retains the exact document/report/finding/cohort
identity, requires explicit semantic pivot confirmation, and exposes canonical candidate sources,
engine depth, bounded budgets, progress, cancellation, retry, partial/unavailable source evidence,
and structured per-item errors. It orchestrates the Phase 8 candidate, engine, expansion, scoring,
safety, and browser staging boundaries without applying a repertoire edit. Closing or reloading
discards the transient lab and its pending previews. The completed Task 9.2 presentation consumes
that retained Phase 8 evidence directly: an accessible comparison table and Pareto chart keep every
tradeoff, tie, dominated candidate, incomplete subtree, missing axis, structured error, exact
identity/version, provenance source, transposition, concept, and risk inspectable. Evaluation copy
uses repertoire POV while White-POV engine transport remains separately labeled. Chart and table
selection share only the stable candidate identity and never create a recommendation. Shape/status
text, keyboard controls, a tabular equivalent, reduced-motion behavior, long-line wrapping, and a
phone list fallback avoid relying on color, pointer input, animation, or desktop width. Selected
candidates now open a revision-bound staged before/after review that consumes canonical Phase 8
safety and change-set evidence without recalculating coverage, metrics, safety, or Pareto status in
the view. It exposes every ordered addition, transposition link, compatible annotation, archive,
optional prune, affected descendant, tree statistic, coverage/gap result, metric delta, theory and
training value, unresolved risk, safety check, structured error, identity, version, POV label, and
provenance source. Add-and-validate remains the default. Optional pruning reruns the canonical Phase
8 safety/change-set/staging chain, archives first, and remains blocked with exact failed checks when
coverage or gap safety fails. Preview and reject are non-mutating. Final acceptance requires an
explicit confirmation bound to the exact current document revision and immutable safety/change-set/
preview/archive/provenance identities, then delegates to the existing one-revision atomic browser
mutation registry path. Acceptance does not rescan or claim resolution. Task 9.4 proof, post-apply
report reconciliation, and undo UI remain absent.

The public V2 command branch remains a retained-evidence preview bridge: it accepts a complete
immutable Task 8.7 result and produces Task 8.8 change-set previews. It does not regenerate evidence
from shallow finding IDs. The browser-only Task 9.1 lifecycle builds that complete retained context
through the canonical Phase 8 producers and injected browser engine/explorer adapters before calling
the command for stage-only previews; this does not expand the public schema or claim MCP host parity.
