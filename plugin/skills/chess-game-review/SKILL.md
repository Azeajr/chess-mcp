---
name: chess-game-review
description: >-
  Review a chess game with grounded Stockfish analysis. Use when the user shares a PGN, or asks to
  analyze/review a chess game, find blunders/mistakes/inaccuracies, explain where a game went wrong,
  or suggest better moves. Drives the `chess-analysis` MCP tools so every move, eval, and line is
  engine-verified — never guessed.
---

# Chess game review

Procedural wrapper over the `chess-analysis` MCP server. The MCP does the compute (Stockfish, legal
moves, FEN/PGN); this skill is the *method* — what to call, in what order, and the rules that keep
every claim grounded.

## Before you start

These tools must be connected (MCP server `chess-analysis`, default `http://localhost:8000/sse`):

- `mcp__chess-analysis__get_game_summary`
- `mcp__chess-analysis__analyze_game`
- `mcp__chess-analysis__get_position`
- `mcp__chess-analysis__evaluate_position`
- `mcp__chess-analysis__validate_line`
- `mcp__chess-analysis__get_legal_moves`

If they're absent, tell the user to start the server (`docker compose up -d` in the chess-mcp repo)
— do **not** fall back to analyzing the game from memory. The whole point is to not guess.

## The loop

1. **Overview first.** `get_game_summary(pgn)` → opening, per-side counts, accuracy %, and the
   top-3 `worst_moves`. Lead your reply with this verdict. One call, small output.
2. **Mistake list.** `analyze_game(pgn, min_cp_loss=50)` → every inaccuracy-or-worse (lean fields).
   Use `min_cp_loss=0` only if the user wants every move. Add `verbose=true` only when you actually
   need `eval_after` / `best_pv` for the moves you'll discuss.
3. **Drill the ones that matter.** For each move you'll explain (start with `worst_moves`, plus
   anything the user asked about): `get_position(pgn, move_number, color)` → `fen`, `eval_cp`,
   `move_played`, `best_move`, `best_pv`, `alternatives`. Don't drill every move — only what you'll
   speak to.
4. **Ground anything you add.** The `fen` from step 3 is the bridge — pass it straight to:
   - `evaluate_position(fen)` — eval a what-if position.
   - `validate_line(fen, [...])` — **before stating any line or "they should have played…"**,
     validate it. If it comes back `valid:false`, do not state it.
   - `get_legal_moves(fen)` — when you need to name a move and aren't quoting `best_move` /
     `alternatives`, pick from here. Never invent a move.

## Grounding rules (non-negotiable)

- Never state a move, line, or "better was X" that didn't come from a tool result or pass
  `validate_line`. No move from memory.
- Never hand-build a FEN. Use the `fen` `get_position` returns.
- Evals are **white-POV centipawns**; mate = **±10000**. `cp_loss` = centipawns worse than best,
  white-POV. Report consistently and say which side it favors in plain terms.
- Same `(pgn, depth)` is cached server-side — repeat calls in one review are cheap, so prefer a
  correct extra call over a guess.

## Presenting the review

- **Verdict** up top: accuracy per side, the 1–3 turning points, the result it shaped.
- **Per key mistake**: move played → the eval swing (e.g. `+0.3 → −2.1`, white-POV) → `best_move`
  and the **validated** line → one human sentence on *why* (hung a piece, missed a fork, wrong
  plan). Keep it tight.
- Don't dump raw JSON. Translate cp to words (±50 ≈ equal, ±200 = clearly better, ±500+ ≈ winning,
  ±10000 = forced mate).
- Match depth to stakes: default 18 is fine; bump depth for a sharp critical position the user
  cares about.

## Scope

This skill reviews a *game* (PGN). For a single isolated position (a puzzle, "is this winning?"),
you can call `evaluate_position` / `get_legal_moves` / `validate_line` on the FEN directly without
the full loop. If the user doesn't have a PGN yet, they need to obtain one first (e.g. export from
Lichess/Chess.com) before this skill applies.
