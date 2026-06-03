---
name: repertoire-builder
description: >-
  Help develop and pressure-test a chess opening repertoire. Use when the user gives a PGN of their
  repertoire lines and the color they play, and wants to check soundness, find gaps, prepare for the
  opponent's critical replies, or extend lines. Drives the chess-analysis MCP so every assessment is
  engine-grounded, never from memory.
---

# Repertoire builder

A repertoire is a *tree of lines* the user plays as one color — not a single game. This skill uses
the `chess-analysis` MCP to judge each chosen move, surface the opponent's critical tries, find
holes, and propose sound extensions. Everything engine-grounded; nothing asserted from memory.

## Inputs

- the user's repertoire PGN (one line per call is most reliable — see "Variations" below)
- the user's color: `white` or `black`

## Two kinds of node

Walk the line. Who is to move sets the question at each ply:

- **User's move** (their color): is the chosen move sound? `analyze_game(pgn, min_cp_loss=0)`, then
  read `cp_loss` / `classification` on the user's plies. A repertoire move carrying real `cp_loss`
  is a weak choice — surface it and offer the engine's `best_move`.
- **Opponent's move**: what must the user prepare for? `get_position(pgn, move_number, color)` at
  that node returns `alternatives` — the engine's top replies with evals. Those are the critical
  opponent tries. For each, check whether the repertoire already answers it; if not, it's a **gap**.

## Workflow

1. `get_game_summary(pgn)` — confirm the line parses, see overall shape.
2. `analyze_game(pgn, min_cp_loss=0)` — flag any of the user's repertoire moves that drop eval.
3. For each opponent node on the line: `get_position(pgn, move_number, "<opponent color>")` and
   read `alternatives`. Compare to what the repertoire covers; list the strong uncovered replies.
4. **Extend a leaf**: at a line's final position, `get_position(...)` gives its `fen`; run
   `evaluate_position(fen, multipv=3)` to see the best continuations (not just one), pick a sound
   line, and confirm it with `validate_line(fen, [...])` before stating it.
5. Report per line: sound? / weak user moves (with the engine fix) / uncovered opponent tries (the
   gaps) / suggested extensions.

## Grounding rules

- Never call a move "best", "sound", "a gap", or "theory" without an engine result behind it.
- Use the `fen` from `get_position` as the bridge; never hand-build a FEN.
- Evals are white-POV cp (±10000 = mate). For a **Black** repertoire, "good for me" = *negative*
  cp — say it in plain terms every time so the user isn't confused by sign.

## Off-line exploration (opponent deviations)

For nodes **on** the submitted line, `get_position` gives the ranked `alternatives`. To probe a
move *not* in your PGN — an opponent sideline, or "develop my repertoire from here" — reach the
position with `validate_line(fen, [...])`, take its `final_fen`, then
`evaluate_position(final_fen, multipv=N)` (N up to 10). That returns ranked `candidates` for *any*
FEN, so off-line positions get the same top-N treatment as on-line nodes — one call per node.

## Variations (current limit)

The MCP analyzes a PGN's **mainline only**. Feed branching repertoires **one line at a time** (each
variation as its own PGN). Walking a full variation tree in one pass is a planned enhancement.
