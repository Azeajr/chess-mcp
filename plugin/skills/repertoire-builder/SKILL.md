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

## Shared method

Pressure-test a branching repertoire for soundness, coverage, memorization cost, structures, and practical opponent preparation.

1. Profile: Use the aggregate structural profile for identity; use structure search to locate lines matching explicit structure, center, theme, or color-complex criteria. Tools: `get_structural_profile`, `find_structures`.
2. Check consistency: Find thematic outliers within opening systems, then inspect a flagged SAN path with the position-level structural profile. Tools: `analyze_repertoire_congruence`, `get_structural_profile`.
3. Audit user moves: Audit prescribed user moves tree-wide and rank centipawn-loss findings. This checks move quality, not missing opponent replies. Tools: `audit_repertoire_moves`.
4. Find gaps: Scan opponent decision nodes for strong uncovered replies. For a real gap, generate best-evaluation and best-fit fills and let the user choose before staging or applying an edit. Tools: `find_repertoire_gaps`, `suggest_gap_fills`, `modify_repertoire_line`.
5. Find only moves: Find sharp user-turn positions where the best move clearly separates from the second. Fix non-best prescriptions through the audit path before producing a drill deck. Tools: `find_only_moves`.
6. Shorten safely: Find sound transposition shortcuts, compare memorization savings with evaluation, inspect quality and post-prune coverage, then stage/apply only the chosen prune. Tools: `find_pruning_transpositions`, `compare_shortcut_lines`, `check_shortcut_coverage`, `modify_repertoire_line`.
7. Extend and connect: Use coverage for dangling lines and stub reconnection; use complementary or replacement suggestions for intentional additions grounded in engine output. Tools: `get_repertoire_coverage`, `suggest_complementary_lines`, `suggest_replacement_line`.
8. Use practical evidence: Use explorer popularity and theory depth only with authentication. Keep engine soundness distinct from human frequency. Tools: `position_popularity`, `find_theory_depth`.
9. Prepare an opponent: Use opponent preparation for an opponent's games and targets; use repertoire-versus-history for the user's own departures. Do not substitute one report for the other. Tools: `prep_vs_opponent`, `repertoire_vs_history`.
10. Export the right artifact: Use annotated repertoire export for the branching tree and only-move deck export for training. Game annotation is not a repertoire artifact. Tools: `export_annotated_repertoire`, `find_only_moves`.

## Shared report contract

- Separate structural identity, weak user moves, uncovered opponent replies, only-move drills, and practical frequency.
- Give navigable SAN paths and preserve action/artifact references.
- Present alternatives and tradeoffs; never choose or apply a mutation silently.
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
