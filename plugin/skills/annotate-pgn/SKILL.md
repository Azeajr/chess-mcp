---
name: annotate-pgn
description: >-
  Produce an annotated PGN from an engine review — move glyphs (?!, ?, ??), the engine's best move,
  and evals as inline comments — so the user can import it into a board GUI or share it. Use after
  or alongside a game analysis when the user wants a marked-up PGN file, not just prose.
---

# Annotate PGN

Turns the ephemeral review into a durable, importable artifact.

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

## Primary path: `export_annotated_pgn`

The server builds the annotated PGN for you — grounded, in one engine pass over the game's mainline.
Prefer it; **do not hand-assemble a PGN string yourself** (that is a model-authored PGN — exactly
what the contract forbids).

1. `validate_pgn(pgn)` — stop on `valid:false`.
2. `export_annotated_pgn(pgn)` → `{annotated_pgn}`. Glyphs (`?!` / `?` / `??`) + inline white-POV
   best-move/eval comments land on the flagged (non-good) moves; good moves stay clean. `depth`
   tunes the pass exactly as in `analyze_game`.
3. Emit the returned `annotated_pgn` in a fenced ```pgn block and offer to save it to
   `<name>-annotated.pgn`.

## Fallback: manual assembly (only if a custom format is needed)

If the user needs something `export_annotated_pgn` can't produce, assemble by hand — but every
token must still come from a tool result, never from memory:

- `analyze_game(pgn, verbose=true)` → per-move `classification`, `cp_loss`, `best_move`, `eval_cp`
  for the moves you annotate.
- Validate any suggested line with `validate_line` before writing it into a comment.

| classification | glyph | NAG  |
|----------------|-------|------|
| inaccuracy     | `?!`  | `$6` |
| mistake        | `?`   | `$2` |
| blunder        | `??`  | `$4` |

Good moves get no glyph. Keep the original headers and move order exactly. Put the glyph immediately
after the move it grades, then an inline `{ ... }` comment with the engine note, e.g.:
`24. Qb2?? { -3.1, blunder. Best: Qxb7 (+0.4). } 24... Rd8`. Comment content comes only from tool
results — `best_move`, eval (white-POV cp rendered as pawns, e.g. `+0.4`), one short reason. Never
annotate a move or line the engine didn't produce. Emit as a fenced ```pgn block and offer to save
it to `<name>-annotated.pgn`.
