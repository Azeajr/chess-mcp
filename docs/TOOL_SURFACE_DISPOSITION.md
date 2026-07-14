# Public tool surface disposition

Phase 5 review, 2026-07-14. The canonical inventory is
`packages/chess-tools/src/tool-contract.ts`; this document records product decisions rather than
redeclaring schemas or defaults. Costs are relative: `E` engine, `N` network, `L` low/local. Types
are primitive, report, artifact, or action.

## Decisions from the required investigations

- `get_position` remains the compact grounding call (normalised FEN, turn, legal moves and browser
  document context). `get_legal_moves` remains a smaller composable primitive for a known FEN.
- `cloud_eval` remains separate from local evaluation. Its network availability, community-cache
  provenance, and result quality differ from Stockfish; the PWA groups both under Position.
- The game-review tools remain bounded projections: summary first, move list for drill-down, and an
  annotated artifact. Their shared `(PGN, depth)` analysis is cached by each host.
- The PWA exposes `inspect_shortcut`, one operation returning quality and post-prune coverage. MCP
  retains `compare_shortcut_lines` and `check_shortcut_coverage` because agents may inspect either
  axis independently and the coverage half is substantially more expensive.
- `classify_illustrative_lines` remains an optional diagnostic/explanation primitive. It is not a
  required precursor to gaps and its output is not accepted as a hidden argument. Future report
  metadata may include its classification without removing this callable operation.
- Suggestion tools remain useful for exploratory “what should replace/extend this?” questions.
  Finding cards may invoke them as actions, but findings do not fully subsume their inputs.
- `get_transpositions` remains for explanation and navigation only. Coverage and gap workflows use
  their own transposition-aware logic and must not instruct agents to cross-reference it manually.
- Node file operations remain because confinement, full server-side reads, and context-free writes
  are safe host functionality rather than duplicate artifact transport. String-returning exports
  remain the fallback for MCP clients without shared filesystem access.

No MCP operation is removed or deprecated in this phase, so external clients and plugin manifests
do not require a compatibility bump.

## Complete disposition

| Operation | Outcome / unique value | Cost | UI / workflow use | Type | Disposition |
|---|---|---:|---|---|---|
| `validate_fen` | Validate and normalise pasted position | L | grounding | primitive | keep |
| `validate_pgn` | Validate PGN and count games | L | grounding | primitive | keep |
| `validate_line` | Legality plus canonical SAN and final FEN | L | line grounding | primitive | keep |
| `get_legal_moves` | Small legal-SAN projection for known FEN | L | position drill-down | primitive | keep |
| `get_position` | Compact position/document grounding | L | conversation entry | report | keep |
| `evaluate_position` | Local, offline, reproducible-source analysis | E | Position | report | group in UI |
| `compare_moves` | Rank caller-selected candidates; report illegals | E | Position | report | keep |
| `cloud_eval` | Community cloud result with distinct provenance | N | Position source | report | group in UI |
| `tablebase_lookup` | Exact seven-piece result | N | Position | report | keep |
| `position_popularity` | Human move frequency and results | N | Position/Repertoire | report | keep |
| `identify_opening` | Deepest ECO reached by a line | L | Position/Game | report | keep |
| `find_repertoire_gaps` | Opponent-reply coverage, transposition-aware | E/N optional | Repertoire | report | keep |
| `find_theory_depth` | Per-line explorer exit depth | N | Repertoire | report | keep |
| `get_transpositions` | Explain/navigate move-order convergence | L | Advanced | report | keep, lower prominence |
| `find_pruning_transpositions` | Generate memory-saving reroutes | E | Advanced | report | keep |
| `get_repertoire_coverage` | Dangling/frontier overview and stub bridges | L/E optional | Repertoire | report | keep |
| `get_structural_profile` | Aggregate or path-specific strategic profile | L | Repertoire | report | keep |
| `analyze_repertoire_congruence` | Thematic outliers by system | L | Advanced | report | keep |
| `classify_illustrative_lines` | Explain NAG-marked wrong-answer branches | L | Advanced diagnostic | report | keep, optional |
| `modify_repertoire_line` | Clone/stage prune, add, or reorder | L | finding action | action | keep |
| `suggest_complementary_lines` | Sound extensions by fit or sharpness | E | finding action/Advanced | report | keep |
| `suggest_replacement_line` | Sound replacements for a selected outlier | E | finding action/Advanced | report | keep |
| `analyze_game` | Bounded per-move review projection | E | Game detail | report | keep |
| `get_game_summary` | Small overview and worst moves | E cached | Game summary | report | keep |
| `export_annotated_pgn` | Portable reviewed-game PGN | E cached | Game artifact | artifact | keep |
| `batch_review` | Multi-game aggregate by ECO/color | E | Game | report | keep |
| `lichess_games` | Fetch source games with optional PGN | N | Game/history | report | keep |
| `chesscom_games` | Fetch monthly source games | N | Game/history | report | keep |
| `repertoire_vs_history` | Player departures across practical games | N | Repertoire | report | keep |
| `audit_repertoire_moves` | Score prescribed player moves tree-wide | E | Repertoire | report | keep |
| `find_only_moves` | Critical-position drills and optional deck | E | Repertoire | artifact report | keep |
| `find_structures` | Query leaves by strategic characteristics | L | Repertoire | report | keep |
| `check_shortcut_coverage` | Independently test post-prune gaps | E | MCP Advanced | report | keep in MCP |
| `compare_shortcut_lines` | Independently compare quality and fit | E | MCP Advanced | report | keep in MCP |
| `inspect_shortcut` | Combined quality and safety for one candidate | E | PWA Advanced | report | group in PWA |
| `export_annotated_repertoire` | Portable multi-analysis repertoire | E | Repertoire artifact | artifact | keep |
| `prep_vs_opponent` | Opponent-specific coverage and targets | N | Repertoire | report | keep |
| `load_repertoire` | Create Node handle from pasted PGN | L | MCP workflow | primitive | keep host-only |
| `load_repertoire_from_file` | Full confined server-side load | L | MCP workflow | primitive | keep host-only |
| `export_repertoire` | Handle-to-PGN fallback artifact | L | MCP workflow | artifact | keep host-only |
| `export_repertoire_to_file` | Confined context-free server-side write | L | MCP workflow | artifact | keep host-only |
| `propose_line` | Stage current-position continuation | L | PWA chat | action | keep host-only |
| `get_current_line` | Selected line and stable references | L | PWA grounding | primitive | keep host-only |
| `get_selected_subtree` | Bounded current subtree | L | PWA grounding | report | keep host-only |
| `get_document_summary` | Compact document metadata/revision | L | PWA grounding | report | keep host-only |
| `get_document_pgn` | On-demand full document artifact | L/context-heavy | PWA escalation | artifact | keep, on demand |
| `expand_capabilities` | Add a routed tool bundle | L | PWA conversation | action | keep host-only |

## Replacement workflows and bounds

There are no removals. The only grouping replacement is:

`find_pruning_transpositions` → choose one candidate → PWA `inspect_shortcut` → stage
`modify_repertoire_line`. MCP clients use the same workflow with
`compare_shortcut_lines` and, only when needed, `check_shortcut_coverage`.

Summary-to-detail remains `get_game_summary` → `analyze_game` → `validate_line`/position tools;
artifacts remain separate so large PGN payloads are not forced into ordinary reports. Existing
`limit`, `max_positions`, `max_games`, depth, and artifact-on-demand controls continue to bound
context and compute.
