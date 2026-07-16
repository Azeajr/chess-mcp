---
name: chess-game-review
description: >-
  Review a chess game with grounded Stockfish analysis. Use for a shared PGN, blunder review,
  turning-point explanations, accuracy, or engine-verified better moves.
---

# Chess game review

Use the `chess-analysis` MCP for one game's mainline. A branching preparation tree belongs to the
repertoire workflow.

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

Review one game's mainline, identify turning points, and explain only engine-grounded alternatives.

1. Validate: Validate pasted PGN before review; use the already parsed current game directly on the browser host. Tools: `validate_pgn`.
2. Summarize: Get the compact game verdict first: accuracy, per-side classifications, and worst moves. Tools: `get_game_summary`.
3. Inspect: Retrieve the mainline move analysis and focus on the few largest losses rather than narrating every good move. Tools: `analyze_game`.
4. Explain: For each discussed alternative, ground the position, validate the line, and evaluate a child only when the summary is insufficient. Tools: `get_position`, `validate_line`, `evaluate_position`.

## Shared report contract

- Lead with accuracy and one to three turning points.
- For each mistake: played move, labeled swing, grounded best move, validated line, and one plain-language reason.
<!-- END GENERATED WORKFLOW GUIDANCE -->

## MCP adaptation

- Pass the explicit PGN to `validate_pgn`, `get_game_summary`, and `analyze_game`.
- The default `analyze_game` projection is lean. Use `verbose=true` only for the few moves whose
  `best_move`, `best_eval`, and post-move `eval_cp` you will explain.
- Derive a position through validated SAN from a tool-returned FEN; do not reconstruct FEN manually.
- If the MCP tools are absent, report that the `chess-analysis` server is not connected and stop.
