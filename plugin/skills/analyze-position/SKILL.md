---
name: analyze-position
description: >-
  Deep-dive a single chess position by FEN: best move, evaluation, candidates, and validated
  continuations. Use for puzzles, what-if positions, or questions such as "is this winning?".
---

# Analyze a position

Use the `chess-analysis` MCP for one position, not a whole game.

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

Evaluate one position and compare legal candidate moves without drifting into whole-game review.

1. Ground: Validate a pasted FEN, then ground the normalized or current position and its legal moves. Tools: `validate_fen`, `get_position`.
2. Evaluate: Run one multi-line local evaluation and compare the ranked candidates directly. Tools: `evaluate_position`.
3. Compare: Use the full legal-move primitive only when needed; use candidate comparison for moves the user names. Tools: `get_legal_moves`, `compare_moves`.
4. Drill: Validate a proposed SAN line, take its returned final FEN, and evaluate that child position for the what-if. Tools: `validate_line`, `evaluate_position`.

## Shared report contract

- Lead with the position verdict and favored side.
- Compare the top candidates with labeled scores.
- State only validated continuations.
<!-- END GENERATED WORKFLOW GUIDANCE -->

## MCP adaptation

- MCP calls require an explicit FEN. Start from the normalized `fen` returned by `validate_fen`.
- `evaluate_position` returns White-POV `cp`/`mate`; `compare_moves` returns mover-POV rankings and
  preserves per-item illegal results.
- If the MCP tools are absent, tell the user the `chess-analysis` server is not connected and stop.
