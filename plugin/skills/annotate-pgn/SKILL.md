---
name: annotate-pgn
description: >-
  Produce an annotated PGN from an engine review — move glyphs (?!, ?, ??), the engine's best move,
  and evals as inline comments — so the user can import it into a board GUI or share it. Use after
  or alongside a game analysis when the user wants a marked-up PGN file, not just prose.
---

# Annotate PGN

Turns the ephemeral review into a durable, importable artifact. No new tool — assemble the
annotated PGN from the `chess-analysis` results.

## Inputs

- the original PGN
- `analyze_game(pgn, min_cp_loss=0)` → per-move `classification` + `cp_loss`
- `get_position(pgn, move_number, color)` → `best_move` / `best_pv` / `eval_cp` for the moves you
  annotate

## Glyph mapping (NAG)

| classification | glyph | NAG  |
|----------------|-------|------|
| inaccuracy     | `?!`  | `$6` |
| mistake        | `?`   | `$2` |
| blunder        | `??`  | `$4` |

Good moves get no glyph.

## Output rules

- Keep the original headers and move order exactly. Put the glyph immediately after the move it
  grades, then an inline `{ ... }` comment with the engine note, e.g.:
  `24. Qb2?? { -3.1, blunder. Best: Qxb7 (+0.4). } 24... Rd8`
- Comment content comes only from tool results — `best_move`, eval (white-POV cp rendered as pawns,
  e.g. `+0.4`), one short reason. Never annotate a move or line the engine didn't produce.
- Validate any suggested line with `validate_line` before writing it into a comment.
- Emit as a fenced ```pgn block and offer to save it to `<name>-annotated.pgn`.
