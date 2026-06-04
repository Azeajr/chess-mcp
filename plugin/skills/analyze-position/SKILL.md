---
name: analyze-position
description: >-
  Deep-dive a single chess position by FEN — best move, evaluation, candidate moves, and whether a
  given line holds. Use for puzzles, "what's the best move here?", "is this winning?", or checking a
  hypothetical position — the single-position case, not a whole game. Drives the chess-analysis MCP.
---

# Analyze a position

For one position (a FEN), not a game.

## Grounding contract (applies to every step)

1. **Validate the user's input first.** Pasted a FEN → call `validate_fen`; a PGN → `validate_pgn`.
   On `valid:false`, stop and report — never analyze, guess, or "fix" it. Use the **normalized**
   `fen` the validator returns as the position from here on.
2. **Never author a move, line, FEN, or PGN from memory.** Every move/eval you state comes from a
   tool result; every line passes `validate_line`. Name a move only from `evaluate_position` /
   `get_legal_moves` / `alternatives` / `candidates`. To explore a line, pass the moves to
   `validate_line` and continue from the `final_fen` it returns.
3. **FENs come only from the MCP.** Use the `fen` a tool returned; the one FEN you may type is the
   standard start position.
4. **Tools down → stop.** If the `chess-analysis` tools are unavailable, say so and stop — never
   fall back to analyzing from memory.

## Tools

- `validate_fen(fen)` → `{valid, fen (normalized), side_to_move, is_game_over}`. Run first on any
  user-supplied FEN; use the normalized `fen` it returns for every later call.
- `evaluate_position(fen, multipv=N)` → `score_cp` (white-POV; ±10000 = mate), `score_type`,
  `mate_in`, `best_move`, `pv`, `depth`. With `multipv>1` (max 10) also returns `candidates`: the
  top-N ranked moves, each `{move, eval (white-POV cp), pv}`. The verdict + the realistic options.
- `get_legal_moves(fen)` → every legal move (SAN string; `uci=true` for UCI). Use when you need the
  full legal set, not just the engine's top picks — never name a move from memory.
- `validate_line(fen, [moves])` → confirm a candidate line is legal before stating it; returns
  `final_fen` so you can chain `evaluate_position` on the resulting position.

## Method

1. `validate_fen(fen)` — confirm the position before any engine call; on `valid:false`, stop and
   report. Use the normalized `fen` it returns from here on.
2. `evaluate_position(fen, multipv=3)` (or more) — one call gives the verdict plus the ranked
   candidate moves with evals. Compare them directly; no hand-evaluating children.
3. Going deeper down a chosen move: `validate_line(fen, [moves])` → take `final_fen` →
   `evaluate_position(final_fen, multipv=3)` to see the options at the next position.
4. Translate cp to words (±50 ≈ equal, ±200 clearly better, ±500+ winning, ±10000 forced mate) and
   always say which color it favors. `candidates` evals are white-POV — for Black, more negative is
   better.
