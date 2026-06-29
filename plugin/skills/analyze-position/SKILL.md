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
   tool result; every line passes `validate_line`. Name a move only from `evaluate_position` (its
   ranked `lines`) or `get_legal_moves`. To explore a line, pass the moves to `validate_line` and
   continue from the `finalFen` it returns.
3. **FENs come only from the MCP.** Use the `fen` a tool returned; the one FEN you may type is the
   standard start position.
4. **Tools down → stop.** If the `chess-analysis` tools are unavailable, say so and stop — never
   fall back to analyzing from memory.

## Tools

- `validate_fen(fen)` → `{valid, fen (normalized), reason?}`. Run first on any user-supplied FEN;
  use the normalized `fen` it returns for every later call. (For side-to-move + legal moves, call
  `get_position(fen)` → `{fen, turn, legal_moves}`.)
- `evaluate_position(fen, lines=N, depth?)` → `{fen, lines: [{uci, san, cp, mate, depth}]}` — the
  top-N moves ranked best-first, each white-POV (`cp`, or `mate` = signed mate distance; treat mate
  as ±10000). `lines[0]` is the engine's best. One call gives the verdict and the realistic options.
- `get_legal_moves(fen)` → `{fen, moves}` (SAN array). Use when you need the full legal set, not just
  the engine's top picks — never name a move from memory.
- `compare_moves(moves, fen, depth?)` → ranks YOUR candidate SANs (mover-POV `mover_cp`); illegal
  ones are flagged. Use to score specific moves the engine might not pick.
- `validate_line(fen, [moves])` → `{ok, canonical, firstUci?, finalFen?, badIndex?}`. Confirm a line
  is legal before stating it; chain `evaluate_position` on the returned `finalFen`.

## Method

1. `validate_fen(fen)` — confirm the position before any engine call; on `valid:false`, stop and
   report. Use the normalized `fen` it returns from here on.
2. `evaluate_position(fen, lines=3)` (or more) — one call gives the best move plus the ranked top
   lines with evals. Compare them directly; no hand-evaluating children.
3. Going deeper down a chosen move: `validate_line(fen, [moves])` → take `finalFen` →
   `evaluate_position(finalFen, lines=3)` to see the options at the next position.
4. Translate cp to words (±50 ≈ equal, ±200 clearly better, ±500+ winning, ±10000 forced mate) and
   always say which color it favors. Evals are white-POV — for Black, more negative is better.
