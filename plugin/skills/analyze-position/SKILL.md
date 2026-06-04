---
name: analyze-position
description: >-
  Deep-dive a single chess position by FEN — best move, evaluation, candidate moves, and whether a
  given line holds. Use for puzzles, "what's the best move here?", "is this winning?", or checking a
  hypothetical position — the single-position case, not a whole game. Drives the chess-analysis MCP.
---

# Analyze a position

For one position (a FEN), not a game. Same grounding contract as game review: state nothing the
engine didn't return or `validate_line` didn't confirm.

## Tools

- `evaluate_position(fen, multipv=N)` → `score_cp` (white-POV; ±10000 = mate), `score_type`,
  `mate_in`, `best_move`, `pv`, `depth`. With `multipv>1` (max 10) also returns `candidates`: the
  top-N ranked moves, each `{move, eval (white-POV cp), pv}`. The verdict + the realistic options.
- `get_legal_moves(fen)` → every legal move (SAN string; `uci=true` for UCI). Use when you need the
  full legal set, not just the engine's top picks — never name a move from memory.
- `validate_line(fen, [moves])` → confirm a candidate line is legal before stating it; returns
  `final_fen` so you can chain `evaluate_position` on the resulting position.

## Method

1. `evaluate_position(fen, multipv=3)` (or more) — one call gives the verdict plus the ranked
   candidate moves with evals. Compare them directly; no hand-evaluating children.
2. Going deeper down a chosen move: `validate_line(fen, [moves])` → take `final_fen` →
   `evaluate_position(final_fen, multipv=3)` to see the options at the next position.
3. Translate cp to words (±50 ≈ equal, ±200 clearly better, ±500+ winning, ±10000 forced mate) and
   always say which color it favors. `candidates` evals are white-POV — for Black, more negative is
   better.
