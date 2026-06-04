---
name: repertoire-builder
description: >-
  Help develop and pressure-test a chess opening repertoire — check soundness, find gaps, prepare
  the opponent's critical replies, extend lines, and analyze the structural themes and thematic
  consistency across the whole variation tree. Use when the user gives a repertoire PGN (a branching
  tree is fine) and the color they play. Drives the chess-analysis MCP — `load_repertoire` handle +
  structural tools — so every assessment is engine-grounded, never from memory.
---

# Repertoire builder

A repertoire is a *tree of lines* the user plays as one color — not a single game. This skill loads
the whole tree once behind a handle, then judges it on two lenses:

- **Structural / thematic** — what pawn structures and plans does the repertoire commit to, and is
  that commitment *consistent* across lines? (`get_structural_profile`, `analyze_repertoire_congruence`)
- **Tactical / soundness** — is each chosen move sound, and what must the user meet? (engine eval at
  each node)

Everything engine-grounded; nothing asserted from memory.

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

## Inputs

- the user's repertoire PGN — the **full branching tree**, variations and all, in one go
- the user's color: `white` or `black`

## Load once, then reuse the handle

`load_repertoire(pgn, color)` parses the tree once and returns a `repertoire_id` plus tree stats
(`nodes`, `leaves`, `max_depth`). **Every other repertoire tool takes that `repertoire_id`** instead
of the PGN — don't re-send the PGN. The handle lives in the server's cache; if a later call returns
`repertoire_not_found` (idle expiry), just call `load_repertoire` again.

## Workflow

0. `validate_pgn(pgn)` — confirm the repertoire PGN parses (expect `has_variations:true` for a real
   tree). On `valid:false`, stop and report; never load unvalidated input.
1. `load_repertoire(pgn, color)` → `repertoire_id`. Note `leaves` (how many distinct lines) and
   `max_depth`.
2. `get_structural_profile(repertoire_id)` (no path) → the repertoire's **aggregate fingerprint**:
   which `structures` it reaches (IQP / Carlsbad / Maroczy / unknown, with counts), center tendencies,
   common open / half-open files. This is the repertoire's strategic identity — state it plainly.
3. `analyze_repertoire_congruence(repertoire_id)` → thematic **incongruencies**: a line that veers off
   the dominant structure (extra plans to learn), accepts a pawn weakness against the grain, or splits
   the repertoire between locking and opening the center. Each carries `paths` (SAN `variation_path`s).
4. **Drill a flagged line** (or any leaf): `get_structural_profile(repertoire_id, variation_path)` →
   that node's `fen`, `structure_class`, `center`, pawn `primitives`, files.
5. **Soundness + opponent prep** at that node: `evaluate_position(fen, multipv=3)` → ranked
   `candidates`. The top line is the user's best option (compare to what they actually play — a played
   move that isn't near the top and drops eval is **weak**). The candidates at an *opponent* node are
   the critical tries the repertoire must answer; an unanswered strong one is a **gap**. Ground any
   line with `validate_line(fen, [...])` before stating it.
6. **Extend or diversify** from any position: `suggest_complementary_lines(repertoire_id, fen, mode)`.
   - `mode="low_memorization"` → continuations whose resulting structure the user **already plays**
     elsewhere (high `profile_match`) — least new theory.
   - `mode="sharp"` → maximally unbalanced / novel structures (high `sharpness`) — for breaking out of
     the comfort zone on purpose.
   Confirm a chosen suggestion with `validate_line` before recommending it.
7. **Report**: structural identity (step 2) / incongruencies with the offending line (step 3) / weak
   user moves with the engine fix (step 5) / uncovered opponent tries = gaps (step 5) / suggested
   extensions (step 6).

## Grounding rules

- Never call a move "best", "sound", "a gap", "an IQP", or "theory" without a tool result behind it.
  The structural classifier (inside `get_structural_profile`) ships a narrow set and returns
  `structure_class: "unknown"` when unsure — relay `unknown`, don't guess a name.
- Use the `fen` from `get_structural_profile` (or `evaluate_position`) as the bridge; never hand-build
  a FEN. `variation_path` is a SAN move list (e.g. `["d4","d5","c4","e6"]`); the `paths` in a
  congruence result feed straight back into `get_structural_profile`.
- Evals are white-POV cp (±10000 = mate). For a **Black** repertoire, "good for me" = *negative* cp —
  say it in plain terms every time so the user isn't confused by sign. (Note `eval` in
  `suggest_complementary_lines` is white-POV too.)
