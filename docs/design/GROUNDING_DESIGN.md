# Grounding Hardening Design

Goal: make it structurally impossible for the model to assert a chess fact it did not get
from the engine/MCP. Two user requirements drive this pass:

- **R1** — the skills/MCP/tools must ensure the model **never guesses a next move or a line**.
  Every move, line, and eval it states comes from a tool result.
- **R2** — when the user **inputs a PGN or FEN, it is validated by the MCP before** any
  question is answered.

This is a defense-in-depth pass: tools already reject bad input at the boundary; this work
makes validation *explicit and first*, removes the remaining model-authored-artifact surfaces,
and consolidates the grounding rules so they cannot drift between skills.

---

## Current posture (what already holds)

- Every FEN-taking tool rejects a bad FEN (`invalid_fen`); every PGN-taking tool rejects a bad
  PGN (`invalid_pgn` / `pgn_too_large`); move-taking tools (`validate_line`, `compare_moves`)
  check legality. **Malformed input dies at the tool boundary.**
- The grounding toolset is complete: `validate_line` (a move list → legal? + normalized
  `final_fen`), `compare_moves` (rank the model's own candidates), `get_legal_moves`
  (enumerate), `evaluate_position` (engine picks + candidates).
- All four skills already carry "never from memory" prose.

## Gaps this pass closes

| # | Gap | Req |
|---|-----|-----|
| G1 | No skill makes "validate the user's FEN/PGN" an explicit **first** step — it happens only as a side effect of the first analysis call. | R2 |
| G2 | No intent-named, cheap validator. FEN-validation means misusing `get_legal_moves`; PGN has no engine-free pre-flight (`get_game_summary` runs the engine). | R2 |
| G3 | The model can still guess in **prose**. No tool stops words — only skill prose does, and that prose is worded differently in each skill (drift risk). | R1 |
| G4 | `annotate-pgn` instructs the model to **hand-assemble the annotated PGN** — that is a model-authored PGN. The grounded `export_annotated_pgn` tool exists but the skill ignores it. | R1 |
| G5 | ~~`plugin/skills/` and `.claude/skills/` are git-tracked duplicates~~ — resolved. | process |

---

## Decisions

### D1 — Add two engine-free validator tools (R2, G1/G2)

`validate_fen(fen)` and `validate_pgn(pgn)`. Both are cheap (no engine), idempotent, and reuse
the **existing closed error-code set** — no new error codes.

**`validate_fen(fen)`** — stronger than a bare `chess.Board()` parse: it also runs
`board.status()`, so an illegal-but-parseable position (two white kings, side-not-to-move in
check, …) is reported invalid instead of silently flowing into the engine. This is the
"lenient parser" guard from `MCP_DESIGN.md` applied to FEN.

```
valid:true  → {valid, fen (NORMALIZED — use this downstream), side_to_move, is_game_over}
valid:false → {valid:false, error:"invalid_fen", reason}
```

The normalized `fen` is the point: after validation the model uses the MCP's FEN, never the
raw paste — so even a user-supplied position becomes an MCP-owned artifact (the
`feedback-mcp-owns-fen-pgn` rule).

**`validate_pgn(pgn)`** — parse + cheap shape report so the model can both confirm validity and
route correctly (a branching tree → `load_repertoire`; a single game → game tools).

```
valid:true  → {valid, mainline_plies, has_variations, headers:{event,white,black,result,date,opening}}
valid:false → {valid:false, error:"invalid_pgn"|"pgn_too_large", reason}
```

Both outputs are tiny (~25 / ~60 tok), well under the 2k budget.

*Rejected:* reusing `validate_line(fen,[])` for FEN and `identify_opening` for PGN (works, but
obscures intent and leaves PGN with no engine-free pre-flight). Chosen: explicit named tools.

### D2 — One shared "Grounding contract" block in every skill (R1, G3)

Identical wording at the top of all four skills (skills can't `include`, so the text is
duplicated; the sync target in D5 keeps the two copies aligned). The block states the hard,
always-on rules:

1. **Validate user input first** — paste FEN → `validate_fen`; paste PGN → `validate_pgn`;
   `valid:false` → stop and report, never "fix" it. Use the normalized value downstream.
2. **Never author a move/line/FEN/PGN from memory** — every move comes from
   `evaluate_position` / `get_legal_moves` / `alternatives` / `candidates`; every line passes
   `validate_line`; continue from the `final_fen` it returns.
3. **FENs come only from the MCP** — the one FEN the model may type is the standard start
   position; everything else is a tool's returned `fen`.
4. **Tools down → stop** — never fall back to analyzing from memory.

### D3 — `annotate-pgn` uses `export_annotated_pgn` (R1, G4)

Primary path becomes a single call to the grounded server tool. Hand-assembly is kept only as
a last-resort fallback, explicitly bound to "every glyph/comment/line from a tool result,
every line `validate_line`-confirmed." Removes the model-authored-PGN surface.

### D4 — Tighten tool docstrings (R1)

`evaluate_position` / `get_legal_moves` reinforce "pass a FEN from an MCP result, not a
hand-built one." `validate_fen`/`validate_pgn` docstrings state "call on any user-supplied
FEN/PGN before analysis." Descriptions are routing logic (`MCP_DESIGN.md`), so the contract
lives there too, not only in skills.

### D5 — skills location (G5)

Skills live in `.claude/skills/` — auto-load when running `claude` in the repo. Canonical source; edit directly. Plugin distribution was removed (2026-06); the `plugin/skills/` duplicate and `make sync-skills` no longer exist.

---

## Out of scope / follow-ups

- **Prose-level guessing is mitigated, not eliminated.** No tool can stop the model from typing
  a move without calling anything; D2/D3/D4 make that a contract violation, not a possibility
  the tooling invites.
- **`evals` snapshot regen** (`evals/capture.py`) needs Stockfish → runs in Docker
  (`project_stockfish_docker_only`). Tool count moves 16 → 18; regenerate the snapshot and the
  token table in `MCP_DESIGN.md` in the same release.
- **Version bump** (0.1.5 → 0.1.6) + README tool list — at commit/release time.

## Test plan

- `validate_fen`: valid FEN → normalized echo + side_to_move; bad FEN → `invalid_fen`;
  illegal-but-parseable (status≠valid) → `invalid_fen`; terminal position → `is_game_over:true`.
- `validate_pgn`: valid game → `mainline_plies` + `has_variations:false`; branching PGN →
  `has_variations:true`; empty → `invalid_pgn`; oversized → `pgn_too_large`.
- All engine-free → land in the existing `server/test_tools.py` suite (`make test`).
