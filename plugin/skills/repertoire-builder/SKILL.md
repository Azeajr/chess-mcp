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

Editing returns a NEW handle: `modify_repertoire_line` deep-copies the tree, applies the edit, and
returns a fresh `repertoire_id` — the source id still resolves to the unmodified tree. So you improve
a repertoire in ONE session (load → edit → re-analyze the new id → … → export), branching and
comparing handles, with no re-download. See "Edit loop" below.

## Workflow

0. `validate_pgn(pgn)` — confirm the repertoire PGN parses (expect `has_variations:true` for a real
   tree). On `valid:false`, stop and report; never load unvalidated input.
1. `load_repertoire(pgn, color)` → `repertoire_id`. Note `leaves` (how many distinct lines) and
   `max_depth`.
2. `get_structural_profile(repertoire_id)` (no path) → the repertoire's **aggregate fingerprint**:
   which `structures` it reaches (IQP / Carlsbad / Maroczy / unknown, with counts), center tendencies,
   common open / half-open files. This is the repertoire's strategic identity — state it plainly.
3. `analyze_repertoire_congruence(repertoire_id)` → thematic **incongruencies**, judged WITHIN each
   opening system (lines are clustered by move-order-robust system, so a system reached via several
   first moves is judged as one and distinct systems under one first move don't dilute each other): a
   line that veers off its system's dominant structure (extra plans to learn), accepts a pawn weakness
   against the grain, or splits the system between locking and opening the center. Each carries `paths`
   (SAN `variation_path`s) + its `cluster` label; the result's `clusters` shows the system partition.
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

## Edit loop (single session — fix the repertoire without leaving)

Once analysis surfaces a change to make, apply it through the MCP and re-analyze the result in the
same session — no hand-editing, no re-download, no fresh session:

1. **Decide the edit from a tool result.** A prune target is a flagged `path`; an `add` continuation
   comes from `suggest_complementary_lines` / `evaluate_position` candidates (confirm with
   `validate_line`); a `reorder` promotes an existing child move. You only ever pass back paths + SAN
   the MCP already surfaced.
2. **Apply it:** `modify_repertoire_line(repertoire_id, path, action, …)` →
   - `action="prune"` — drop the subtree at `path` (a refuted/illustrative/incongruent line).
   - `action="add"`, `add_moves=[…SAN…]` — graft a continuation under the node at `path`.
   - `action="reorder"`, `promote_move="…"` — make a different child the recommended mainline at `path`.
   It returns a NEW `repertoire_id` (+ a one-line `summary` and updated stats). The old id is unchanged.
3. **Re-analyze on the new id.** Run `analyze_repertoire_congruence` / `find_repertoire_gaps` /
   `get_structural_profile` / `get_repertoire_coverage` on the returned id to confirm the edit did what
   you intended (and didn't introduce a new gap). Iterate id → id → id; keep earlier ids to compare.
4. **Export + save once done:** `export_repertoire(final_id)` returns the full multi-variation `pgn`
   string — Write it to disk for the user to re-upload. **Write the `pgn` field straight to a file; do
   NOT print it into the conversation** (it's a large artifact, not something to read aloud).

The agent orchestrates the loop purely with paths / actions / SAN the MCP surfaced. The ONLY chess
content it ever writes to disk is the `pgn` string `export_repertoire` returned — it never authors,
edits, or hand-writes a line, FEN, or variation itself.

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
