# MCP Retro — Black Repertoire Analysis (Caro-Kann / Nimzo / Anti-English / 1.b4)

**Source analysis:** `ct-black-repertoire-analysis.md`
**Retro date:** 2026-06-05
**Companion retro:** `ct-white-repertoire-retro.md` (English White repertoire — single-game tree)

This retro captures MCP/tool/workflow shortcomings ONLY. Content gaps in the repertoire
itself live in the analysis doc, not here.

---

## v1 Update — chess-mcp 0.2.2 (2026-06-05)

**Tools exercised:** `validate_pgn`, `load_repertoire`, `get_transpositions`, `get_structural_profile`, `analyze_repertoire_congruence`, `find_repertoire_gaps`, `evaluate_position`

First loop against a **multi-game** PGN. The White repertoire was a single `[Event]` with a
big variation tree; the Black repertoire is the more common Chesstempo shape — one `[Event]`
per opening, four games in one file. That difference surfaced a new, high-impact limitation.

### What Shone

- **`load_repertoire` per-game stats are accurate** — re-loading each `[Event]` individually gave correct node/leaf/depth counts (Caro-Kann 85/16/22, Nimzo 151/19/26, Other 69/4/20). The parser itself is sound; the defect is purely that it only reads the *first* game.
- **`evaluate_position` at depth 20 stayed trustworthy** — Anti-English mainline leaf −5 cp (equal), `9.exd4??` punish leaf −633 cp (Black winning). Both engine-grounded, both matched the PGN's own annotations.
- **Classifier named more structures than for the English White repertoire** — IQP ×2 (0.90), Carlsbad (0.85), Grünfeld Centre ×2 (0.70), King's Indian (0.53). The high-confidence IQP/Carlsbad hits are correct.

### New Shortcomings

**`load_repertoire` silently truncates a multi-game PGN to the first game**
- Observed: a 4-game file (Anti-English, Caro-Kann, Nimzo, Other) loaded as 64 nodes / 5 leaves / depth 20 — exactly game 1. Games 2–4 (305 of 369 nodes, 39 of 44 leaves) were dropped with no error, warning, or count. Root cause: `load_repertoire` (`server/chess_mcp.py`) and `validate_pgn` both call `chess.pgn.read_game(io.StringIO(pgn))` once, which returns only the first game.
- Expected: either (a) parse every game and expose the full forest, or (b) at minimum report `games_in_pgn` / reject with a structured error so the caller is not silently handed 17% of their repertoire.
- Concrete fix: merge all games' first-move variations under a single synthetic root so the existing walker/transposition/congruence logic sees the whole forest; handle per-game `FEN`/`SetUp` headers as a documented edge case.
- Filed: Issue #13. (Architectural — synthetic-root data model + FEN-header handling — so opened, not implemented this run.)

**`validate_pgn` reports only the first game of a multi-game file**
- Observed: on the 4-game file, `validate_pgn` returned `valid:true, mainline_plies:20, headers:{black:"Anti-English"}` — describing only game 1. A user pre-flighting their export gets no hint that three more games exist.
- Expected: a `games` count (or `has_multiple_games:true`) so the multi-game shape is visible before `load_repertoire` silently drops most of it.
- Concrete fix: count games via `read_game` loop; add the count to the validate response. (Folded into Issue #13 — same single-game-read root cause.)

**`find_repertoire_gaps` emits false root gaps as a downstream effect of the multi-game drop**
- Observed: with only the `1.c4` game loaded, the gap scan flagged `1.e4` (+38) and `1.d4` (+35) as high-severity uncovered moves at the root — even though the user has a complete Caro-Kann and Nimzo for exactly those moves. The gaps are real *given the truncated tree*, but wrong for the actual repertoire.
- Expected: with the full forest loaded, root-level first moves the user prepares are not flagged.
- Concrete fix: resolved transitively by Issue #13 — once all games load, these gaps disappear. No separate gap-tool change needed; noting the cascade so it is not mistaken for a gap-scanner bug.

### Carried Over (already tracked, re-confirmed for Black)

- **Classifier misses canonical Black structures** — Nimzo `bxc3` skeletons and Advance-Caro structures return `unknown` (38/44 leaves overall). Same class as the English-White classifier gap (Issue #5 was White-scoped). Theme tags (`fianchetto`, `minority_attack`, `wing_majority`) remain the working substitute. Not re-filed; documented as a known limitation now confirmed on the Black side too.

### Skipped Tools (this run)

- **`suggest_complementary_lines`** — skipped; blocked behind Issue #13. Extension suggestions are meaningless while 83% of the tree is invisible.
- **`suggest_replacement_line`** — skipped; the only congruence flag was a winning tactical leaf, not a real outlier to remediate.
- **`get_transpositions`** — run (pre-flight). Found 1 transposition inside the Anti-English game (`Nf3`/`g3` move-order into the same `...Nb6` position). Cross-game transpositions unreachable until Issue #13.
- **`export_annotated_pgn`** — not run; candidate once the full repertoire loads.
