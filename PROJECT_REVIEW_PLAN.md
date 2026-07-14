# Chess MCP Product and Architecture Review Plan

This document is the implementation handoff for consolidating the chess-mcp tool surface, making
the PWA chat behave like a capable coding-agent/MCP conversation, preserving direct access to useful
analysis, and pruning documentation that no longer describes the code.

It is intentionally self-contained. A new session should be able to start any phase after reading:

1. `AGENTS.md`
2. this document
3. the source files named by that phase

Do not treat the existing README, roadmap, design documents, comments, or tool counts as truth.
Confirm behavior in code and tests first.

## Product direction

The PWA has two complementary jobs:

1. **Conversation first.** Chat should behave like the Claude Code + MCP experience: the user asks
   naturally, the assistant selects and sequences tools, progress is visible, results are grounded,
   and proposed changes or generated artifacts have real UI actions. The user should not need to
   choose a workflow mode before speaking.
2. **Direct analysis second.** The user should also be able to invoke any valuable analysis without
   an LLM. Direct controls should be organized by user outcome (position, game, repertoire,
   advanced), not by the historical MCP tool list.

The MCP server remains a first-class product for Claude Code and other MCP clients. PWA
consolidation must not make the MCP surface less useful merely to make the UI simpler.

## Review baseline (2026-07-14)

The repository currently has three overlapping orchestration surfaces:

- `apps/mcp-server/src/index.ts`: 38 registered MCP tools, with Zod schemas and Node host adapters.
- `apps/ui/src/llm/tools.ts`: 30 separately declared OpenAI-style tools plus a browser executor.
- `apps/ui/src/components/RepertoirePanel.tsx` and `apps/ui/src/store/{gaps,repertoire}.ts`: direct
  workflows, some using the browser tool executor and some calling `chess-tools` directly.

They share chess algorithms in `packages/chess-tools`, but they do **not** share a canonical tool
contract or application-command layer. Claims that the browser and MCP toolsets are identical are
incorrect.

Important MCP capabilities absent from PWA chat include:

- `audit_repertoire_moves`
- `find_only_moves`
- `find_structures`
- `compare_shortcut_lines`
- `check_shortcut_coverage`
- `export_annotated_repertoire`
- `prep_vs_opponent`

Some differences are intentionally host-specific. MCP handle/file tools should not be copied into
the browser merely for numeric parity:

- `load_repertoire`
- `load_repertoire_from_file`
- `export_repertoire`
- `export_repertoire_to_file`

### Verified baseline

The following passed during the review:

```sh
pnpm -r typecheck
pnpm --filter @chess-mcp/chess-tools build
node scripts/smoke-gametree.mjs       # 211 passed
node scripts/structure-accuracy.mjs   # 27/27
```

The network-gated MCP smoke did **not** pass in the review environment (Node 26.2.0):

```sh
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
```

It failed immediately after server startup with `MCP error -32000: Connection closed`. The test
also asserts 40 tools even though the implementation currently registers 38. Diagnose both rather
than blindly changing the expected count. CI targets Node 22, so determine whether the connection
failure is a Node 26 compatibility issue, a server lifecycle issue, or a test/SDK issue.

## Core architectural decisions

Unless code evidence discovered during a phase invalidates one, use these as the working decisions.

### A. One canonical contract, multiple hosts

MCP and browser chat should share:

- tool identifiers and concise descriptions;
- input and result types;
- defaults, limits, and validation semantics;
- common error codes;
- host-neutral execution for shared operations;
- capability metadata (`position`, `game`, `repertoire`, `engine`, `network`, `artifact`, `action`).

They may differ through explicit host adapters:

- Node repertoire handles vs the browser's current document;
- Node filesystem confinement vs browser File System Access;
- Node engine pool vs browser Worker pool;
- MCP artifact-return conventions vs PWA UI affordances;
- PWA-only staged UI actions.

Do not build a large abstraction that hides these real differences. The goal is shared contracts and
shared behavior, not identical transport code.

### B. Separate domain operations from transport schemas

`packages/chess-tools` remains the domain layer. It should not import MCP, SolidJS, Zod, or
OpenRouter types.

A thin shared application/tool layer should adapt domain functions into stable operations. MCP Zod
schemas and browser JSON schemas should be derived from, or mechanically verified against, that
canonical definition. Avoid maintaining independent handwritten descriptions and defaults.

### C. Organize the product by outcomes

Primary user-facing outcomes:

- Position: evaluate, compare candidates, popularity, opening, tablebase.
- Game: review, inspect mistakes, annotate, batch review.
- Repertoire: audit prescribed moves, find missing replies, coverage, critical/only moves, theory
  depth, practical history, structures, annotated export, opponent prep.
- Advanced repertoire: congruence, transpositions, shortening, shortcut inspection, replacement and
  complementary suggestions.

An MCP client may still need smaller composable primitives even when the PWA groups them.

### D. Chat results are application data, not raw JSON transcripts

Tool results should have typed renderers where they create interaction:

- navigate to a position or path;
- stage/apply/reject a repertoire edit;
- inspect a line;
- save an artifact;
- cancel or retry work;
- open a structured analysis report.

Raw JSON may remain available in a disclosure for debugging, but it is not the primary UX.

## Tool disposition hypothesis

This is a starting hypothesis, not permission to delete tools without usage and contract analysis.

### Foundational primitives — retain

- `validate_fen`, `validate_pgn`, `validate_line`
- `get_position`, `get_legal_moves`
- `evaluate_position`, `compare_moves`
- `identify_opening`, `position_popularity`, `tablebase_lookup`

Investigate whether `cloud_eval` should remain a standalone agent tool or become an evaluation source
within a unified position-analysis presentation. Do not combine sources if doing so obscures offline
behavior, provenance, or MCP composability.

### Primary repertoire outcomes — retain and expose directly

- `audit_repertoire_moves`
- `find_repertoire_gaps`
- `find_only_moves`
- `get_repertoire_coverage`
- `find_theory_depth`
- `repertoire_vs_history`
- `prep_vs_opponent`
- `find_structures`
- `export_annotated_repertoire`

### Advanced/drill-down capabilities — retain, but reconsider top-level prominence

- `get_transpositions`
- `find_pruning_transpositions`
- `compare_shortcut_lines`
- `check_shortcut_coverage`
- `get_structural_profile`
- `analyze_repertoire_congruence`
- `classify_illustrative_lines`
- `suggest_complementary_lines`
- `suggest_replacement_line`

Specific consolidation candidates:

- Present shortcut quality and shortcut coverage as one inspection outcome in the PWA; decide
  separately whether MCP agents still benefit from two composable tools.
- Make illustrative-line handling automatic where possible. A model should not have to remember a
  classifier call merely to prevent false gap results.
- Use suggestion operations as actions attached to audit/congruence/gap findings, while retaining
  standalone MCP operations if they remain independently useful.
- Treat `get_transpositions` as exploration/explanation; gap and coverage algorithms must already
  account for transpositions internally.

### Game review — consolidate presentation before changing tools

`analyze_game`, `get_game_summary`, and `export_annotated_pgn` share the same underlying analysis but
serve different output sizes. First make the PWA present summary, mistakes, detail, and artifact as
views of one cached review. Only then decide whether MCP contracts should become a single
`review_game(detail=...)` operation. Do not collapse them if it worsens MCP context size or
summary-to-detail chaining.

## Phase 0 — Restore and pin the baseline

### Objective

Make the current runtime and contract inventory trustworthy before refactoring.

### Read first

- `apps/mcp-server/src/index.ts`
- `apps/mcp-server/test/smoke-client.mjs`
- `.github/workflows/ci.yml`
- `apps/ui/src/llm/tools.ts`
- root and workspace `package.json` files

### Tasks

1. Diagnose the MCP smoke connection failure on the supported CI Node version and the current local
   version. Record the supported version behavior.
2. Replace the stale hard-coded 40-tool expectation with the correct intentional contract. Prefer a
   named expected-tool set over a count-only assertion so additions/removals are reviewed.
3. Add an inventory check that reports:
   - MCP tools;
   - browser-chat tools;
   - intentional host-only tools;
   - unexpected missing or extra tools.
4. Pin representative result semantics where drift is already known: validation errors, game-review
   detail fields, depth/default behavior, and current-tree vs handle adaptation.
5. Do not redesign tools in this phase.

### Acceptance criteria

- CI-equivalent smoke passes on the documented Node version.
- The expected MCP tool names are explicit and correct.
- A parity/inventory test fails when an unclassified surface difference is introduced.
- Existing engine-free smoke and typecheck remain green.

### Verify

```sh
pnpm --filter @chess-mcp/chess-tools build
pnpm -r typecheck
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
```

## Phase 1 — Introduce the canonical tool/application contract

### Objective

Remove independent MCP/browser declarations as the source of truth while preserving host-specific
behavior.

### Read first

- `apps/mcp-server/src/index.ts`
- `apps/ui/src/llm/tools.ts`
- `packages/chess-tools/src/index.ts`
- `packages/chess-tools/src/enginetools.ts`
- `packages/chess-tools/src/pgn.ts`
- `apps/mcp-server/src/handles.ts`
- `apps/mcp-server/src/paths.ts`
- `apps/ui/src/store/game.ts`

### Tasks

1. Design the smallest shared contract module/package. Before implementation, document:
   - what is canonical;
   - how schemas are emitted or checked;
   - how Node handles and browser current-document state are injected;
   - how engine/network/filesystem dependencies enter;
   - how artifact and action results are represented.
2. Migrate a vertical slice first:
   - position validation/grounding;
   - position evaluation/comparison;
   - one repertoire read operation;
   - one engine repertoire operation.
3. Prove that both hosts use the shared definition for descriptions, defaults, validation, and
   result shaping.
4. Migrate the remaining shared operations in bounded groups.
5. Keep explicit host-only registries for filesystem/handle tools and PWA staged actions.
6. Split `apps/mcp-server/src/index.ts` by capability during migration if this improves reviewability;
   it is currently a 1,000+ line registration file. Avoid changing contracts merely for file layout.
7. Split the 500+ line browser switch executor into capability modules or host adapters.

### Acceptance criteria

- No shared operation has two independently handwritten descriptions/default sets.
- Shared operations return the same semantic result on both hosts for the same fixture and engine
  response, except for documented host fields.
- Every surface difference is classified as intentional.
- MCP listing and browser schema tests derive from the canonical registry.
- No SolidJS or MCP SDK dependency enters `packages/chess-tools`.

### Non-goals

- Removing tools.
- Redesigning chat UX.
- Copying MCP handle/file operations into the browser.

## Phase 2 — Rebuild chat orchestration around natural conversation

### Objective

Make chat feel like an agent using tools, not a mode-specific form wrapped around an LLM.

### Read first

- `apps/ui/src/store/chat.ts`
- `apps/ui/src/llm/openrouter.ts`
- `apps/ui/src/llm/workflows.ts`
- `apps/ui/src/components/ChatPanel.tsx`
- `apps/ui/src/store/settings.ts`
- `docs/design/CHAT_TOOLSET_REVIEW.md`

### Tasks

1. Remove the mandatory chat-mode gate. Preserve modes, if useful, as optional prompt/action presets.
2. Implement automatic capability routing. Start simple and deterministic:
   - compact universal grounding/actions;
   - selected outcome bundle based on user request and document state;
   - a controlled way to expand capabilities on a later round.
3. Stop embedding the full working PGN in every system message. Include only:
   - current normalized FEN;
   - repertoire/user color;
   - selected SAN path or position reference;
   - document type/revision;
   - compact tree/game statistics.
4. Add scoped retrieval operations for current line, selected subtree, document summary, and PGN
   artifact when genuinely needed.
5. Add an `AbortController` covering OpenRouter streaming and tool execution where supported.
6. Add a visible Stop action and explicit states for tool queued/running/completed/cancelled/failed.
7. Surface progress for long scans. Use callbacks/events from shared operations; do not create a
   polling loop around synchronous state.
8. On the maximum-round boundary, return an explicit incomplete-state message rather than ending
   silently.
9. Compact old tool results before subsequent rounds and turns. Preserve enough structured summary
   for follow-up questions; do not blindly truncate identifiers/FENs/paths needed by later calls.
10. Validate tool arguments at runtime. Replace unsafe `as` casts at the browser boundary with the
    shared contract validator.
11. Add conversation tests with a fake model stream and fake tools covering multi-tool turns,
    malformed arguments, cancellation, abnormal finish, round-limit exhaustion, and retry.

### Acceptance criteria

- A user can send a first message without choosing a mode.
- A position question can naturally become a repertoire or game question in the same conversation.
- Full PGN size is not multiplied across every chat round.
- The user can stop generation and long analysis.
- Tool progress and errors are visible and recoverable.
- The assistant never silently exits because the round limit was reached.

## Phase 3 — Add typed result UI, staged edits, and artifacts

### Objective

Turn tool calls into an interactive product instead of collapsed JSON.

### Read first

- `apps/ui/src/components/ChatPanel.tsx`
- `apps/ui/src/components/RepertoirePanel.tsx`
- `apps/ui/src/store/suggestions.ts`
- `apps/ui/src/store/files.ts`
- `apps/ui/src/store/game.ts`
- `apps/ui/src/llm/tools.ts` or its Phase 1 replacement

### Tasks

1. Introduce a typed result-renderer registry keyed by operation/result kind.
2. Implement reusable navigation rows for FEN, SAN path, game ply, and repertoire finding.
3. Replace the `propose_line` special case with a general staged-action model.
4. Support staged add, prune, and reorder edits with:
   - before/after summary;
   - affected path and line;
   - board/tree preview where meaningful;
   - Accept and Reject;
   - stale-revision detection so an edit cannot apply to a changed tree.
5. Make accepted edits use the same application command as direct UI editing.
6. Add artifact results for annotated PGN, annotated repertoire, CSV drill deck, and future exports.
   Save/download actions must be UI-driven and must not require the model to repeat the artifact.
7. Keep a raw JSON disclosure for debugging.

### Acceptance criteria

- Chat can propose and the user can apply/reject add, prune, and reorder operations.
- A tool cannot mutate the repertoire without explicit user acceptance.
- Stale previews cannot overwrite newer work.
- Generated PGN/CSV artifacts can be saved directly.
- The model receives only artifact metadata/reference unless inline content is explicitly necessary.

## Phase 4 — Unify direct analysis and chat commands

### Objective

Make direct controls and chat two clients of the same application operations and result models.

### Read first

- `apps/ui/src/components/RepertoirePanel.tsx`
- `apps/ui/src/components/AnalysisPanel.tsx`
- `apps/ui/src/store/gaps.ts`
- `apps/ui/src/store/repertoire.ts`
- the shared contract/application layer from Phase 1

### Tasks

1. Inventory every direct panel workflow, its defaults, engine budget, cancellation, and result
   transformation.
2. Move reusable orchestration into application operations. Preserve specialized panel workflows
   such as gap filling when they are genuinely higher-level than an MCP primitive, but define them
   as named application commands rather than hidden store logic.
3. Ensure chat and direct UI consume the same result models and renderer components.
4. Reorganize direct controls by outcome:
   - Position
   - Game
   - Repertoire
   - Advanced
5. Expose the primary repertoire outcomes directly, especially the currently missing:
   - prescribed-move audit;
   - only-move/drill analysis;
   - structure search;
   - annotated repertoire export;
   - opponent preparation.
6. Keep expensive operations on demand. Show expected scope/budget and permit cancellation.
7. Remove duplicated store-level implementations only after equivalent behavior and UX are covered.

### Acceptance criteria

- The same command produces the same result whether invoked by chat or a button.
- Defaults and error handling are defined once.
- Direct analysis covers every primary user outcome without requiring an API key.
- Panel-specific workflows have explicit names, contracts, tests, and ownership.
- No useful cancellation/progress behavior is lost during consolidation.

## Phase 5 — Evaluate and consolidate the public tool surface

### Objective

Reduce overlap and obsolete tools based on the unified product model, without sacrificing agent
composability or breaking clients casually.

### Method

For every MCP and PWA operation, record:

- user question/outcome served;
- unique inputs and outputs;
- whether another tool fully subsumes it;
- model context cost;
- engine/network cost;
- direct-UI use;
- workflow/skill use;
- whether it is a primitive, report, artifact, or action;
- proposed disposition: keep, group in UI, merge, deprecate, or remove.

### Required investigations

1. `get_position` vs `get_legal_moves` after compact grounding exists.
2. `cloud_eval` vs unified evaluation-source presentation.
3. `analyze_game` vs `get_game_summary` vs cached review projections.
4. `compare_shortcut_lines` plus `check_shortcut_coverage` as one PWA inspection operation.
5. Whether `classify_illustrative_lines` should remain callable or become automatic metadata.
6. Whether standalone suggestion tools remain valuable after suggestions become finding actions.
7. Whether `get_transpositions` is still necessary as an agent tool beyond explanation/navigation.
8. Whether any export-to-file operation duplicates MCP-client artifact handling without adding safe
   host functionality.

### Removal rules

- Do not remove a tool because its UI is grouped with another tool.
- Do not merge tools if the combined result becomes a context-heavy god tool.
- Add deprecation descriptions and migration guidance before removal when external clients may use
  the tool.
- Update skills and parity tests in the same change as a contract change.
- Bump plugin manifests when the MCP tool surface changes, per `AGENTS.md`.

### Acceptance criteria

- A checked-in disposition table covers every operation.
- Every merge/removal has a concrete replacement workflow.
- Output sizes remain bounded and summary-to-detail workflows remain possible.
- No workflow references a removed or hidden capability.

## Phase 6 — Documentation reset

**Implemented 2026-07-14.** The canonical registry now generates `docs/TOOL_CATALOG.md`; the
verified host inventories are captured by that generated file. The earlier review baseline was
superseded by shortcut and conversation operations already present in source. Current architecture/product docs replace the
superseded design set, durable rationale is under `docs/archive/`, and `pnpm docs:check` guards the
generated catalog and known stale claims.

### Objective

Make markdown describe current code, remove duplicated sources of truth, and preserve only useful
historical rationale.

### Drift resolved by this phase

- Hand-maintained tool counts in README, ROADMAP, and `AGENTS.md` were removed. The smoke expectation
  and generated catalog now follow the verified canonical MCP inventory.
- Browser/MCP differences are documented as host adaptations rather than described as numeric or
  behavioral parity.
- `docs/archive/UI_DESIGN_HISTORY.md` records that the old UI proposal used a superseded stack;
  current code calls OpenRouter's OpenAI-compatible API.
- The superseded UI stack proposal was archived; current docs describe custom Solid components and
  `styles.css`.
- The former repertoire design mixed current behavior with extensive Python-era material; its
  durable decisions are summarized in `docs/archive/REPERTOIRE_DESIGN_HISTORY.md`.
- The former engineering-pass prompt collection has been retired; reusable process is in
  `AGENTS.md`, with its disposition recorded under `docs/archive/`.
- The chat-toolset review findings are summarized in `docs/archive/CHAT_TOOLSET_REVIEW_HISTORY.md`;
  remaining integration verification is in `ROADMAP.md`.
- README's chronological completed-feature log duplicates ROADMAP and has already accumulated stale
  counts.

### Target documentation set

- `README.md`: install, run, current architecture, compact capability groups, verification.
- `docs/ARCHITECTURE.md`: actual runtime boundaries, shared contract, hosts, state, engines, caches.
- `docs/TOOL_CATALOG.md`: generated from or mechanically checked against the canonical registry.
- `docs/PWA_PRODUCT.md`: conversation flow, direct-analysis organization, staged actions/artifacts.
- `ROADMAP.md`: unshipped work only.
- `AGENTS.md`: concise operational facts and commands for coding agents.
- `docs/archive/`: historical design documents that still provide worthwhile rationale.

### Tasks

1. Audit every markdown claim against current source and tests.
2. Generate tool names/counts/catalog fields where practical; do not hand-maintain repeated tables.
3. Move still-valid architectural decisions out of historical design docs into current docs.
4. Archive historical Python-era and superseded design material; delete content with no continuing
   explanatory value.
5. Remove completed feature chronology from README. Git history and releases own chronology.
6. Convert CHAT_TOOLSET_REVIEW findings into completed work, current issues, or this plan; archive it
   when no unique active information remains.
7. Decide whether ENGINEERING_PASSES contains any reusable contributor process. Move that process to
   a focused contributor document, then archive/delete the prompt collection.
8. Add a lightweight documentation consistency check for generated tool catalog/count references.

### Acceptance criteria

- No current document contains a manually repeated stale tool count.
- README can be read as the current product, not a changelog.
- Design docs describe the implemented TypeScript system.
- Historical documents are clearly labeled and separated from current guidance.
- Skills, tool catalog, and source contracts agree.

## Phase 7 — Final integration and product verification

**Automated integration implemented 2026-07-14.** The canonical contract checks, browser unit
tests, and an offline Playwright/Chromium suite now cover document-aware natural routing, direct
analysis availability, finding navigation, explicit edit acceptance/rejection, stale revisions,
artifact downloads, and direct/chat command equivalence. The manual journeys below remain the
release verification checklist because native file pickers, persistence across a real browser
restart, representative long scans, and the external Claude Code plugin workflow are not faithfully
proved by a deterministic headless test.

### Objective

Validate the redesigned system as a whole, including the user journeys that unit tests cannot prove.

### Automated verification

```sh
pnpm --filter @chess-mcp/chess-tools build
pnpm -r typecheck
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs
SMOKE_NETWORK=0 EVAL_CACHE_DIR=0 node apps/mcp-server/test/smoke-client.mjs
pnpm --filter @chess-mcp/ui build
```

Add focused automated tests for:

- canonical registry parity and intentional host differences;
- browser runtime validation/defaults;
- natural chat routing and capability expansion;
- cancellation and progress;
- history compaction preserving references;
- staged edit acceptance/rejection/stale revisions;
- artifact save affordances;
- direct UI and chat command equivalence.

Use headless Chromium against the dev server for critical UI paths, following `AGENTS.md`.

### Manual journeys

1. Open a repertoire and ask, without choosing a mode, “What are the biggest problems here?”
2. Navigate from a chat finding to the exact board position.
3. Ask for a replacement, preview it, reject it, request another, and accept it.
4. Run the same audit directly without an API key and compare results.
5. Start and cancel a long gap/shortening/game scan.
6. Review a game, inspect a mistake, and save the annotated PGN.
7. Generate and save an annotated repertoire or only-move deck.
8. Switch from a position question to repertoire analysis in one conversation.
9. Reload and confirm autosave/file-reopen behavior still works.
10. Exercise the Claude Code plugin workflow after any MCP surface change.

### Acceptance criteria

- Conversation is natural and does not require preclassification.
- All primary analyses are available directly without chat.
- Chat and direct results agree.
- Every proposed mutation requires explicit user acceptance.
- Long work can be stopped.
- Artifacts are saved without model-mediated copying.
- MCP, PWA, plugin skills, tests, and current documentation agree.

## Cross-phase engineering constraints

- Preserve user changes in a dirty worktree and avoid unrelated rewrites.
- Use `apps/mcp-server/src` tool definitions as the current truth until Phase 1 replaces that source
  of truth deliberately.
- Keep `packages/chess-tools` framework-agnostic.
- Preserve structured errors; close and document the real set rather than allowing arbitrary thrown
  strings at host boundaries.
- Avoid returning full PGNs or large finding sets when a reference plus summary/detail workflow is
  sufficient.
- Do not claim MCP/PWA parity based only on matching names; compare validation, defaults, execution,
  result shapes, and errors.
- Engine results are white-POV unless an operation explicitly converts and labels them.
- Keep mainline-only game-review limitations visible.
- Preserve explicit user confirmation for mutations and external file writes.
- When a tool surface changes, update tests, skills, generated catalog, README summary, and plugin
  versions together.

## Starting a fresh phase

At the beginning of a new context/session:

1. Read `AGENTS.md` and this plan completely.
2. Inspect `git status`; preserve unrelated user work.
3. State the phase being executed and its non-goals.
4. Re-run the quickest relevant baseline before editing.
5. Inspect the named source files; do not rely on line numbers or old markdown claims.
6. If an earlier phase changed an assumption in this plan, update this document before proceeding.
7. Implement in reviewable slices and add behavioral tests with each slice.
8. Run the phase verification and summarize remaining risks.

Suggested fresh-session request:

> Execute Phase N from `PROJECT_REVIEW_PLAN.md`. Read `AGENTS.md` and the full plan first, verify the
> current implementation rather than trusting old docs, implement the phase with tests, and update
> the plan if code evidence changes any assumption.

## Definition of done

This program is complete when:

- MCP and browser shared operations have one canonical contract;
- PWA chat accepts natural requests without mandatory modes;
- context cost no longer scales by repeatedly injecting complete PGNs and raw history;
- chat supports cancellation, progress, typed results, staged edits, and artifacts;
- every valuable primary analysis is available directly without an LLM;
- chat and direct controls use the same application commands;
- the public tool surface has an evidence-backed disposition;
- MCP smoke, browser tests, builds, and core smoke suites pass;
- current markdown is concise, code-verified, and free of duplicated stale tool inventories.
