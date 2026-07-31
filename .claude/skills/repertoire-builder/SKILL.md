---
name: repertoire-builder
description: >-
  Develop and pressure-test a branching opening repertoire: soundness, gaps, only moves, structures,
  opponent preparation, extensions, shortening, edits, and annotated exports. Use for a repertoire
  PGN and the color the user plays.
---

# Repertoire builder

Use the `chess-analysis` MCP on the whole branching tree.

<!-- BEGIN GENERATED WORKFLOW GUIDANCE -->
## Shared grounding contract

- Validate user-pasted FEN or PGN before analysis. Stop on invalid input; never repair it silently. An already parsed host document needs no redundant validation call.
- Ground every move, line, evaluation, FEN, structure label, popularity claim, and best-move claim in a tool result. Never substitute chess knowledge from memory.
- Validate any concrete continuation before stating it. Reuse normalized FENs and SAN paths returned by tools; never hand-build a FEN.
- Treat engine scores as White-POV centipawns: positive favors White, negative favors Black; about 50 is near equal, 200 clearly better, 500 winning, and the mate sentinel is decisive. Label the favored side.
- Engine-backed tools default to depth 20. Use depth 30 only when the user explicitly requests deep analysis; warn that multi-position work may take minutes.
- If an engine or required network source is unavailable, say which source is unavailable and stop that dependent method. Do not turn missing evidence into a chess claim.
- Summarize semantic results instead of dumping JSON. Preserve structured errors, navigation references, action identifiers, and artifact identifiers for follow-up work.
- Treat Strategic Fit replacement results as revision-bound atomic previews. Compare full candidate subtrees and retained unavailable/partial evidence; never infer pruning, auto-accept a staged browser change, or imply MCP archive/undo support.

## Shared method

Pressure-test a branching repertoire for soundness, coverage, memorization cost, structures, and practical opponent preparation.

1. Profile: Use the aggregate structural profile for identity; use structure search to locate lines matching explicit structure, center, theme, or color-complex criteria. Tools: `get_structural_profile`, `find_structures`.
2. Analyze strategic fit: Run the versioned Strategic Fit report with an explicit profile or the labeled inferred default. Custom profiles may set bounded feature-family weights and browser source filters; explain their impact and source availability. Manual, population, and personal-history estimates are independently normalized under usable profile coefficients; unavailable sources contribute zero rather than diluting the result. Browser-local training mastery adjusts personalized metrics with explicit coverage. Review expected-weight findings and their evidence; never treat missing data, difference, uncertainty, forced diversity, or intentional diversity as a defect. Tools: `analyze_repertoire_congruence`, `get_structural_profile`.
3. Confirm profile intent: When the user describes goals such as low theory, a preferred structure, or an acceptable evaluation loss, translate that into an explicit profile proposal instead of quietly assuming it during analysis. In the browser, propose the exact preferences and let the user compare them against the current effective profile: nothing is saved until they accept, a rejected or superseded proposal never becomes intent, and accepting changes profile preferences only and never the repertoire tree. Propose concept identities the analysis actually reported and values inside their documented ranges; an invalid proposal is rejected, not adjusted. On MCP nothing is remembered between calls, so pass the confirmed profile explicitly with each analysis and never claim it was stored. Tools: `analyze_repertoire_congruence`.
4. Discuss a report: Do not re-run the analysis to talk about a report already produced in this conversation. Retrieve the bounded summary, one page of findings, or one finding with its evidence and navigable paths using the exact report and finding identities. These views are deliberately partial: never present omitted issues, dimensions, references, or truncated text as absent evidence, and treat an unavailable or stale identity as a stale report rather than re-deriving an older answer. Tools: `get_strategic_fit_report`.
5. Plan a retained exception: When the user keeps a branch and trains it instead of replacing it, write the plan card that goes with it: the plan, the pawn break, the favorable exchange, the danger signs, the familiar structure, and the position to drill. In the browser, ask for that finding's deterministic evidence basis first and build every section from the concepts, checkpoints, drill positions, and validated moves it returned; a section that names no evidence, an identity the basis did not return, a move off those paths, and any outside master game are rejected rather than trimmed, and evidence the basis says it withheld is withheld, not absent. Nothing is saved until the user accepts, acceptance records the plan with the existing training item rather than editing repertoire lines, and a rejected or superseded plan never becomes training metadata. On MCP there is no document training state to ground or save a plan card, so explain the branch from the report instead and never imply one was stored. Tools: `get_strategic_fit_report`, `find_only_moves`.
6. Audit user moves: Audit prescribed user moves tree-wide and rank centipawn-loss findings. This checks move quality, not missing opponent replies. Tools: `audit_repertoire_moves`.
7. Find gaps: Scan opponent decision nodes for strong uncovered replies. For a real gap, generate best-evaluation and best-fit fills and let the user choose before staging or applying an edit. Tools: `find_repertoire_gaps`, `suggest_gap_fills`, `modify_repertoire_line`.
8. Find only moves: Find sharp user-turn positions where the best move clearly separates from the second. Fix non-best prescriptions through the audit path before producing a drill deck. Tools: `find_only_moves`.
9. Shorten safely: Find sound transposition shortcuts, compare memorization savings with evaluation, inspect quality and post-prune coverage, then stage/apply only the chosen prune. Tools: `find_pruning_transpositions`, `compare_shortcut_lines`, `check_shortcut_coverage`, `modify_repertoire_line`.
10. Extend and connect: Use coverage for dangling lines and stub reconnection. Keep legacy one-move replacement suggestions compatible; for Strategic Fit V2 compare complete candidate subtrees, coverage, safety, provenance, and atomic change-set previews. Browser previews are staged for explicit acceptance; MCP previews do not provide archive storage or undo and return a new handle only after an explicit edit. Tools: `get_repertoire_coverage`, `suggest_complementary_lines`, `suggest_replacement_line`.
11. Use practical evidence: Use explorer popularity and theory depth only with authentication. Keep engine soundness distinct from human frequency. Tools: `position_popularity`, `find_theory_depth`.
12. Prepare an opponent: Use opponent preparation for an opponent's games and targets; use repertoire-versus-history for the user's own departures. Do not substitute one report for the other. Tools: `prep_vs_opponent`, `repertoire_vs_history`.
13. Export the right artifact: Use annotated repertoire export for the branching tree and only-move deck export for training. In the browser, use the JSON sidecar for canonical Strategic Fit metadata and the intent PGN only for portable comments; never expose tokens or repeat full artifact content. Tools: `export_annotated_repertoire`, `find_only_moves`.

## Shared report contract

- Separate Strategic Fit, structural identity, weak user moves, uncovered opponent replies, only-move drills, and practical frequency.
- Keep confidence, strategic difference, objective quality, replacement priority, and training priority distinct.
- Give navigable SAN paths and preserve report, finding, action, and artifact references.
- Present alternatives and tradeoffs; never choose or apply a mutation silently.

## Explanation and exploration contract

Explain a Strategic Fit report the conversation already produced, at the depth the user asked for, using only what the bounded retrieval views returned.

- Explain a report through `get_strategic_fit_report`, never by re-running the analysis and never from memory of an earlier answer. Name the exact `report_id`, and the `finding_id` when the subject is one finding.
- Quote the projection's own values. Never recompute a score, average contributions, restate one label as another, or turn a strategic distance into an engine evaluation.
- These views are bounded on purpose. A positive `omitted_dimension_count` or `omitted_issue_count`, a `total_san_path_count` larger than the returned paths, and any `truncated: true` mean evidence was withheld from you: say it was not shown, never that it does not exist.
- A `null` value, an `unavailable` or `partial` metric `state`, an `unknown` label, and an absent optional field all stay missing. Never present one as zero and never fill it in from chess knowledge.
- The retrieval views carry no legality, engine evaluation, coverage, or popularity evidence. Such a claim needs its own result from the operation that owns it; without one, say that evidence is unavailable.
- A classification is not a verdict. `forced-diversity`, `intentional-diversity`, `productive-diversity`, and `transpositional-equivalence` are not defects, and `uncertain` and `data-quality-issue` describe the evidence rather than the repertoire.
- Cite branches only by the SAN paths the projection returned. Never hand-build a line, continue a truncated path, or describe a move those paths do not contain.
- Select every operation from its own contract, not from words in the question. The complete schema is offered on each round, so a phrase in the user's message never selects a command by itself.

Answer at the depth the user asked for; use the intermediate level when they did not say.

- Intermediate player (`intermediate`): Say in plain language what this branch asks the player to handle differently and what to do about it. Name the opening scope, one concrete measured difference, and the branch it happens on. Keep engine and statistical vocabulary out unless the projection supplied that number. Cite: `plain_language_category`, `opening_scope`, `affected_line_summary`, `explanation`, `difference.magnitude`, `source_san_paths`.
- Expert strategic breakdown (`expert`): Give the measured breakdown: which comparison dimensions moved, what each contributed, the typical cohort value against the affected value, and what the comparison was made against. State confidence with the caps that limited it and what the causality evidence attributes the difference to. Cite: `difference.distance`, `evidence.dimensions`, `evidence.omitted_dimension_count`, `evidence.comparison_basis`, `evidence.causality.controllability`, `evidence.causality.explanation`, `confidence.score`, `confidence_explanation`, `applied_caps`.
- Concise summary (`concise`): One or two sentences: the category, how large the difference is, how confident the report is, and how often it is expected to occur. No dimension-by-dimension detail and no new evidence. Cite: `plain_language_category`, `difference.magnitude`, `confidence.label`, `expected_frequency`, `replacement_priority.label`, `training_priority.label`.
- Training focus (`training`): Explain it as something to learn rather than something to fix: the memorization it adds, how often it comes up, which decision causes it, and which branch to drill. Drill content itself comes from a training or only-move result; never invent a model game, a plan, or a drill line. To write the plan the user keeps with the exception, ask `propose_strategic_fit_plan` for that finding's evidence basis first and build every section from it. Cite: `training_priority.label`, `learning_burden`, `expected_frequency`, `evidence.causality.label`, `evidence.causality.likely_causal_decision_ids`, `source_san_paths`, `resolution_state`.

Grounded questions and the retrieval that answers each:

- "Show only frequent avoidable exceptions." Use `get_strategic_fit_report` with view `findings` sorted `expected-frequency`. Page the findings sorted by expected frequency and keep only rows classified `genuine-inconsistency`. Forced, intentional, productive, and transpositional rows are not avoidable, and `uncertain` or `data-quality-issue` rows are unproven rather than avoidable. Report the page you actually read and whether more remain. Cite: `findings`, `classification`, `expected_frequency`, `page.has_more`, `next_cursor`. Missing evidence: A `null` `expected_frequency` was not measured: keep that row out of a frequency ranking and say so, rather than treating it as zero or as rare.
- "Which branches force me into opposite-side castling?" Use `get_strategic_fit_report` with view `finding`. Castling is a measured setup-family signal, so read it from a finding's evidence dimensions and the concept identities the analysis reported, not from the moves. Open the findings for the branches in question and quote the dimension that names castling with its typical and affected values. Cite: `evidence.dimensions`, `evidence.omitted_dimension_count`, `affected_line_summary`, `source_san_paths`. Missing evidence: If no returned dimension names castling, say the report did not surface it for that finding, and say dimensions were withheld when `omitted_dimension_count` is above zero. Never read a castling pattern off a move list yourself.
- "Where could I transpose into structures I already know?" Not a report question; use `get_transpositions`, `find_pruning_transpositions`, `find_structures`. The report does not own this question. Use the transposition operations for move orders the repertoire already joins and for sound shortcuts that shorten memorization, and structure search for lines matching an explicit structure. A `transpositional-equivalence` finding only says the report already attributed that difference to move order. Cite: `classification`. Missing evidence: Two similar SAN paths are not a transposition. Without a transposition or shortcut result, say the move order was not verified.
- "What should I train instead of replace?" Use `get_strategic_fit_report` with view `findings` sorted `training-priority`. Both priorities sit on every finding row. Read one page sorted by training priority and compare each row's own `training_priority` against its `replacement_priority`; a page sorted by replacement priority shows the other end. Both are report scores, not an instruction to edit: an edit still goes through the replacement or gap path and needs explicit acceptance. Cite: `training_priority.label`, `replacement_priority.label`, `resolution_state`, `sort`. Missing evidence: A finding already resolved as a kept exception, deferred, or excluded is not a training candidate by default. Read `resolution_state` instead of assuming it is open.
- "Why is this classified as intentional diversity?" Use `get_strategic_fit_report` with view `finding`. Open that finding and quote the report's own explanation, what the causality evidence attributes the difference to, and the confidence with any cap that limited it. When the status came from a decision the user recorded rather than from the analysis, say so: `resolution_state` carries that. Cite: `classification`, `explanation`, `evidence.causality.label`, `evidence.causality.explanation`, `confidence_explanation`, `applied_caps`, `resolution_state`. Missing evidence: Intentional diversity is not proof the branch is good. Objective quality is a separate field and stays `unavailable` when it was not measured.
<!-- END GENERATED WORKFLOW GUIDANCE -->

## MCP handle and file adaptation

- For pasted PGN, call `validate_pgn`, then `load_repertoire(pgn, color)` once and reuse its bounded
  `repertoire_id`. On `repertoire_not_found`, reload it.
- For a file, call `load_repertoire_from_file(path, color)`; never read or truncate the PGN into
  model context. Paths are confined to the configured repertoire directory.
- Every repertoire operation takes the handle. Browser-only `inspect_shortcut` maps on MCP to
  `compare_shortcut_lines` followed by `check_shortcut_coverage`.

## Edit and export adaptation

- `modify_repertoire_line` is clone-on-write. Continue on the returned new handle; the source handle
  remains unchanged. Re-run the affected audit/coverage/profile operation before recommending export.
- For a gap, pass its returned SAN `variation_path` and `uncovered_move` to `suggest_gap_fills`; apply
  only a user-chosen returned line.
- For shortening, omit `budget` for authoritative full-tree ranking. If a long scan is deliberately
  chunked with `leaf_start`/`leaf_count`, label results partial and do not pretend chunk-local sorting
  is a global ranking.
- `find_only_moves(export_path=...)`, `export_annotated_repertoire(export_path=...)`, and
  `export_repertoire_to_file` write explicit artifacts under the confined directory. Do not echo
  large PGN/CSV payloads.
