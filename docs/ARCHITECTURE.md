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
in-memory cache because source data changes. Keys include database, rating buckets, speeds,
database-supported recency, move limit, and the transposition-safe position key. Rate limiting is
shared, and a 429 starts the requested cooldown. Explorer operations require a Lichess personal
token.

Strategic Fit remains network-free inside the analyzer. When its optional popularity input is
requested, each host first walks canonical opponent decision positions under a hard query budget,
deduplicates transpositions, and injects external decision weights into the existing report cache
and analyzer boundary. Missing authentication or connectivity yields unavailable provenance and
equal fallback weights; budget exhaustion or a later lookup failure yields partial provenance.
When optional personal history is requested, the host reuses the existing Lichess or Chess.com
full-PGN fetch boundary, excludes games played from the wrong repertoire color, and maps played
positions, semantic decisions, transpositions, and player departures without mutating the
repertoire. Per-position personal opponent-choice counts use a 20-game empirical prior drawn from
the requested population evidence, or an equal prior when population data was not requested.
Missing PGN metadata, invalid samples, no matching color, and fetch failure remain explicit
insufficient, partial, or unavailable provenance while the base report remains usable. The
deterministic weighting layer keeps market, empirically shrunk personal, and manual estimates
independent, normalizes the usable profile coefficients, and assigns unavailable sources zero
effective coefficient. Equal mode reports but ignores every enrichment.

Training performance is a separate versioned, document-keyed browser record rather than analyzer
state or a field added to the canonical metadata sidecar. Deterministic drill targets bind semantic
positions, decisions, and concepts; attempts retain recall, measured response time, explicit lapses,
optional confidence, and UTC spacing timestamps. Mastery uses only supplied observations, preserves
untrained as distinct from failure, and excludes stale semantic targets from current metric evidence
without deleting their historical provenance. The browser injects observed concept mastery through
the clone-safe Worker/cache boundary. Familiarity-adjusted coverage, training-adjusted workload, and
repertoire regret report the exact expected-route coverage of their market, mastery, and viable-
replacement components; missing observations never become zero mastery or failed training.

The browser Strategic Fit workspace owns a persisted, host-local source-settings record. It turns
the selected popularity population and personal-history account into canonical command arguments;
the pure analyzer still receives only injected evidence. Source-settings identity joins profile,
document, resolution, and training identity in stale-result rejection and cache invalidation. The
document profile now carries bounded per-family distance weights, which the analyzer applies unless
an explicit one-off distance override is supplied. Profile metadata `1.5.0` migrates older profiles
to equal family weights while preserving every prior explicit preference. Settings drafts preview
affected metrics and never mutate the repertoire tree.

PGN intent detection is a pure, deterministic read of game- and move-level comments plus the
canonical repertoire graph. Supported tags and phrases produce exact-source, SAN-path, and semantic
reference suggestions; the browser alone presents confirmation. The metadata `1.5.0` collection
stores confirmed or rejected decisions by exact suggestion identity and the JSON sidecar merges
them by that identity. Detection and decisions never mutate PGN comments, and changed text produces
a new pending identity instead of inheriting an old rejection.

Replacement Lab domain transport starts with a framework-free `1.0.0` schema in `chess-tools`.
Requests bind report, finding, cohort, profile, semantic pivot selection, repertoire color and
revision, candidate sources, evaluation/coverage constraints, and bounded expansion budgets.
Candidates always carry a bounded subtree with routes and opponent replies, causal-pivot evidence,
per-source availability/provenance, separate objective and strategic scores, coverage effects,
Pareto status, unresolved risks, and explicit archive/prune choices. Engine transport fields name
White POV explicitly; candidate verdicts and user-facing evaluation fields name repertoire POV.
Atomic change-set contracts describe ordered clone operations and use a success/failure union that
cannot return a partially changed tree on failure. These additive domain types do not yet replace
the live `suggest_replacement_line` contract or enable Replacement Lab UI; Phase 8 safety work must
complete first.

Pivot selection is a pure framework-free refinement over one current finding, its current cohort,
and the semantic repertoire graph. Automatic selection accepts only one repertoire-owned causal
decision supported across every affected route; shared, interacting, and multi-path evidence returns
explicit alternatives without choosing a navigation path. User-selected semantic decisions are
revalidated against the finding, cohort, revision, color, and graph. Each user SAN line is then
validated from the selected pivot position with deterministic chess logic and receives an independent
valid, illegal, or stale result. Opponent-controlled and unsupported findings remain versioned
non-actionable results. Selection is read-only, and SAN paths remain navigation references rather
than pivot identity.

Replacement candidate generation is another pure framework-free layer. It consumes only a validated
actionable pivot, searches every legal move from that semantic position for prepared graph outcomes,
and distinguishes existing decisions from graph-supported move-order shortcuts. Hosts may inject
completed opening-database evidence, including exact population filters and snapshot provenance; the
domain performs no network access and revalidates each SAN/UCI pair from the pivot position. Missing,
offline, unavailable, partial, stale, rejected, and illegal evidence remains explicit per source or
item while usable local candidates survive. Candidates deduplicate by canonical outcome position,
merge all source kinds and provenance, and deterministically apply the request candidate limit.
Existing preparation carries only a low-memory rank hint, not later Strategic Fit scoring. Outputs
are versioned candidate seeds with an explicit `full-subtree-required` expansion state; they cannot
satisfy the mandatory `ReplacementCandidateSubtree` contract until Phase 8 expansion work covers
important and forcing opponent replies. Source repertoire, graph, pivot result, and injected evidence
remain immutable. Public tools, hosts, generated guidance, and Replacement Lab UI are still unchanged.

Replacement engine generation is a separate framework-free enrichment layer over the validated
pivot and current bounded candidate-seed result. A host-injected provider receives the exact
semantic pivot position, depth (including 30), bounded MultiPV width, and cancellation signal. Every
returned root UCI and full PV is replayed legally from that position. White-POV centipawn and mate
transport stays distinct from repertoire-POV evaluation, mate direction, loss from best, and
tolerance verdicts. Inspectable engine observations provide tactical volatility, evaluation
sensitivity, forcing density, king-safety risk, viable-move width, and uncertainty; absent
observations remain unavailable.
Engine alternatives merge with local and database seeds by canonical outcome before the global
candidate limit, while rejected, illegal, malformed, stale, partial, cancelled, unavailable, and
unverified evidence remains structured per item and source. Read-only cache evidence uses semantic
position below the 50-move boundary, exact FEN at or above it, and full engine identity/configuration.
Only complete evidence with every requested legal rank at sufficient depth permits
deeper-to-shallower and wider-to-narrower reuse. Outputs remain `full-subtree-required` seeds: no PV
is presented as a coverage-aware candidate before Task 8.5. Source graph, pivot, Task 8.3
candidates, engine evidence, and cache inputs remain immutable. No Node/browser adapter, public
tool, generated guidance, plugin, UI, or `suggest_replacement_line` behavior changes at this
boundary.

Replacement expansion consumes only the current validated Task 8.4 engine-enriched seeds. It is a
framework-free, sequentially scheduled domain layer with cancellable explorer and engine evidence
providers. Every supplied SAN/UCI and full PV is replayed from its semantic position; forcing
replies are classified from legal checks, captures, and promotions rather than provider labels.
Important replies above the configured population threshold and every requested forcing reply are
expanded to one absolute strategic horizon, or terminate earlier only at a terminal position or a
canonical join into existing preparation. Candidate, per-candidate node, global engine-position,
global explorer-query, popularity, horizon, and reply-policy budgets are deterministic. Common or
forcing omissions, provider failures, malformed/stale items, cancellation, and budget stops remain
explicit in coverage counts, per-item evidence, omissions, route terminations, truncation reasons,
and unresolved risks. Progress is request-bound and monotonic, and cancellation stops new provider
scheduling while retaining completed evidence.

Only runtime-validated complete, truncated, or blocked `ReplacementCandidateSubtree` values are
published. Task 8.5 returns expanded seeds rather than synthesizing the strategic scores, coverage
effects, Pareto assessment, or change set required by a later `ReplacementCandidate`. Task 8.3 and
8.4 seeds therefore remain compile-time distinct from expansions, and partial expansion cannot
masquerade as a finished candidate. White-POV engine transport and repertoire-POV labels, engine
identity/configuration/depth/MultiPV/cache evidence, semantic identities, source states, nested
provenance, and navigation-only SAN paths remain inspectable. Source graph, pivot, Task 8.3 result,
Task 8.4 result, providers, cache inputs, and injected evidence remain immutable. Public/generated
contracts, hosts, UI, Replacement Lab lifecycle, and `suggest_replacement_line` remain unchanged.

Replacement scoring consumes only current runtime-validated Task 8.5 expansion results. Complete
candidate subtrees are projected onto their full canonical repertoire prefix and every prepared
continuation after a transposition join, then passed through the existing trajectory, concept,
distance, cohort-mode, route-weighting, profile, popularity, metrics, and training semantics.
Expected opponent frequency weights the whole continuation. Semantic position identity prevents
transpositions and navigation-only SAN paths from manufacturing extra observations. Partial,
truncated, blocked, stale, illegal, cancelled, and unavailable expansions remain preserved but
unscored.

Each scored candidate retains objective quality as a separate axis and emits inspectable strategic
fit, strategic familiarity, memorization burden, expected coverage, new concepts, theory size,
popularity, homogenization cost, and training cost contributions. Every contribution carries raw
and normalized values, unit, direction, state, reason, and provenance; missing evidence remains
null or partial rather than becoming zero. Deterministic Pareto assessment reports all optimal and
dominated tradeoffs plus exact dominating candidate IDs, while shared partial evidence stays
explicit and never implies one best candidate. Task 8.6 returns an intermediate scored expansion,
not Task 8.7 coverage simulation, a Task 8.8 change set, or a finished `ReplacementCandidate`.
Request/report/finding/cohort/pivot/revision/color and semantic position/decision/trajectory
identities, schema versions, Black repertoire POV, separately labeled White-POV engine transport,
Task 8.3 seeds, Task 8.4 evidence, Task 8.5 subtrees, source context, and nested provenance remain
immutable and serializable. The layer stays framework-free; public/generated contracts, hosts, UI,
Replacement Lab lifecycle, and `suggest_replacement_line` remain unchanged.

Replacement safety simulation consumes only a current Task 8.6 result that can be deterministically
recomputed from its retained request, graph, cohort, trajectory, concept, metric, popularity,
training, Task 8.3 seed, Task 8.4 engine, and Task 8.5 expansion evidence. Every candidate route is
added to a structural `GameTree` clone; pruning occurs only for an explicitly confirmed replacement,
while the default non-pruning action is labeled exactly `Add alternative`. The clone is projected
back through the canonical Strategic Fit graph to compare semantic required replies,
popularity-weighted coverage, duplicate routes, new transpositions, and affected scalar metrics.
Familiarity coverage is recalculated from the simulated graph with canonical trajectory, concept,
training, conditional-decision weighting, and current profile source-coefficient semantics. Missing
personal/manual weighting or conditional reply evidence keeps the preview partial; training workload
retains its current value but leaves after/delta explicitly unavailable because Task 8.6 does not
retain the full finding inputs needed to recompute it.
Forcing replies and expected frequencies remain requirements, transposition joins prevent false
gaps, and navigation SAN paths or editorial duplicates never multiply semantic evidence.

Incomplete, stale, invalid, unscored, truncated, blocked, cancelled, illegal, or unavailable
Task 8.5/8.6 values remain inspectable but cannot become safe simulations. Missing or partial
coverage, popularity, objective, or metric evidence retains nulls, reasons, states, and provenance;
it never becomes zero or a passed check. Dominated candidates remain present with their exact Pareto
assessment. Task 8.7 returns only an intermediate safety report and never exposes the cloned tree or
fabricates Task 8.8 operations, change sets, archive payloads, atomic application results, staging,
undo, or host behavior. Public MCP/browser contracts, generated catalog/guidance, plugin versions,
hosts, UI, Replacement Lab lifecycle, and `suggest_replacement_line` remain unchanged.

Atomic Replacement Lab change sets consume one current Task 8.7 candidate only after its retained
Task 8.3–8.6 scoring evidence and source graph reproduce the supplied safety boundary. Candidates
with no blocking safety check may become deterministic domain proposals; blocked, unavailable,
stale, identity-mismatched, or version-mismatched evidence cannot. Proposals canonicalize ordered
add-subtree, transposition-link validation, semantically equivalent annotation preservation,
archive, explicitly confirmed prune, and variation-reorder operations. Training and intent-metadata
operations remain outside the Task 8.8 tree transaction.

Application uses one structural `GameTree` clone. Every SAN navigation target is revalidated against
its canonical semantic position and optional decision identity before use. Candidate subtrees must
reproduce their retained position and decision identities, duplicate SAN routes merge editorially,
transposition links validate canonical prepared positions without creating a second tree model, and
variation ordering covers every semantic child deterministically. Archive PGNs are exact subtree
projections made before pruning; compatible comments and NAGs move only between equal semantic
positions, while incompatible pruned comments remain in archive evidence. Any operation failure
discards the clone and returns `result: null`; success returns the clone separately from a JSON-safe
preview containing exact canonical graph statistics, every affected path, per-operation diffs, and
archive payloads. Missing old-line objective/strategic evidence remains explicitly unavailable and
finding changes remain `not-reanalyzed` rather than being inferred.

This boundary allocates no document revision and does not stage, persist, accept, store archives,
mutate metadata, rescan findings, or implement undo. Task 8.9 owns those host/document concerns.
Public MCP/browser contracts, generated catalog/guidance, plugin versions, hosts, UI, Replacement
Lab lifecycle, and `suggest_replacement_line` remain unchanged.

Task 8.9 adds those browser document concerns without weakening the pure Task 8.8 boundary. A
document/revision/PGN/metadata identity snapshot binds each complete validated change set and its
preview. Staging and rejection do not publish a tree, metadata, navigation, revision, archive, or
disk change. Acceptance reruns Task 8.8 validation through a recoverable prepare/publish/finalize
protocol. The prepare transaction keeps the prior PGN, metadata, archives, and undo state canonical
and stores the proposed after-state only in an inert recovery journal. The validated clone and
metadata then publish in one Solid batch as exactly one monotonic document revision. A final
IndexedDB transaction atomically promotes the working PGN, normalized metadata, exact archive
payloads, and bounded undo snapshot without separately flushing the new live state. If finalization
fails, the prior live snapshot is restored exactly; reload normalization discards the inert prepared
journal while retaining the prior durable canonical state. Metadata retains canonical archive
references only; byte-exact PGN payloads stay in a separate document-keyed record. Matching
resolutions retain the staged-edit identity without losing their semantic finding identity or
provenance.

Undo is bounded and deterministic. It requires the exact accepted PGN, metadata, revision, archive
set, and document identity, persists the complete pre-acceptance snapshot atomically, and then
restores tree, metadata, resolutions, archive state, and navigation as one new monotonic revision.
Apply, archive, persistence, publish, and undo failures expose no partial document result. Pending
change sets are deliberately session-only and discarded on reload, so reload can never auto-accept
a proposal. SAN paths remain navigation aids and are re-resolved after the semantic Task 8.8
validation; pruning remains explicit and archive-before-prune.

Task 8.10 keeps `suggest_replacement_line` stable while adding the discriminated
`strategic-fit-replacement-v2` envelope. Its canonical inputs mirror the exact finding, semantic
pivot, profile, sources, budget, engine, coverage, retention, candidate, safety, identity, version,
and provenance chain. The shared framework-free composer revalidates the retained Task 8.3–8.7
evidence and produces structured per-candidate Task 8.8 change sets and immutable previews. Legacy
`outlier_variation_path`/mode/depth behavior remains available until Phase 9; V2 and legacy inputs
cannot be mixed.

Phase 8 exposes that V2 branch only as a retained-evidence preview bridge. It does not claim to start
candidate discovery or host engine/explorer work from public finding IDs; the Phase 9 lifecycle will
own that orchestration. This keeps the complete contract serializable without advertising unavailable
host generation or fabricating engine/network evidence.

Host parity is semantic, not operational. Browser V2 execution uses the exhaustive command registry
and stages each valid preview against the current browser document; it never accepts it. Browser
acceptance owns IndexedDB archive storage and bounded document undo. MCP V2 execution looks up one
immutable repertoire handle and returns previews only, explicitly reporting that archive storage,
restore, and undo are unavailable. It returns no new repertoire handle until a separate explicit
edit call uses the existing clone-on-write handle boundary. Browser engine/Worker, cancellation,
credentials, persistence, artifacts, and navigation remain browser-owned; Node engine-pool,
network credential, confined-path, and handle lifetimes remain MCP-owned. Both retain structured
unavailable/partial/cancelled/illegal evidence, Black repertoire ownership, and separately labeled
White-POV transport. Phase 9 visual Replacement Lab lifecycle and candidate UI remain unstarted.

## Safety and result conventions

Engine scores are white-POV unless an operation explicitly converts and labels mover POV. Game
review analyzes only the mainline. Expensive scans expose bounds such as depth, limits,
`max_positions`, or budgets. Shared operations use bounded scheduling and cooperative checks; the
browser propagates one abort signal through chat/direct lifecycle state, engine queues, network
requests, and artifact-producing operations.

Errors cross host boundaries as structured codes. File paths are realpath-confined. Browser chat
cannot directly mutate the document: add, prune, and reorder results are staged, previewable,
accept/reject actions with stale-revision detection. Assistant-proposed Strategic Fit profile
preferences are staged the same way. Validation, exact profile diffing, and concept-identity checks
are framework-free domain code; the staged proposal is session-only state bound to the document,
revision, effective profile, and analysis-settings identity, and acceptance writes only through the
single profile-state module rather than touching document metadata itself. An assistant-written plan
card for a retained exception is staged the same way and is additionally bound to evidence: every
section must cite a concept, checkpoint, or drill from that finding's deterministic training record,
every move its prose mentions must appear on a validated path, and an unsupported identity, move, or
outside game is rejected rather than trimmed. Acceptance writes through the existing training path,
which re-validates the card against the record it just rebuilt, so no second writer reaches training
metadata. Artifact content is retained by the application
and chat receives compact metadata/reference unless inline content is part of the explicit contract.

Most direct report/export controls and chat calls share the browser command registry. Continuous
live evaluation remains navigation-owned because it has a dedicated Worker and latest-position
discard semantics. Higher-level gap filling and shortening panels may sequence several canonical
commands, but do not maintain a second implementation of their underlying analyses.
