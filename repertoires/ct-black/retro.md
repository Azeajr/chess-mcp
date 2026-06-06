# MCP Retro — Black Repertoire Analysis (Caro-Kann / Nimzo / Anti-English / 1.b4)

**Source analysis:** `analysis.md`
**Retro date:** 2026-06-05
**Companion retro:** `../ct-white/retro.md` (English White repertoire — single-game tree)

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

---

## v2 Update — chess-mcp 0.2.3 (2026-06-06)

First run after the Issue #13 fix shipped (0.2.3) and the container was rebuilt. The whole
4-game repertoire now loads as one forest, so every tool sees all four openings.

### What Resolved

**Issue #13 FIXED — multi-game PGN loads as one forest (verified live)**
- v1: `load_repertoire` on the 4-game file returned 64 nodes / 5 leaves — game 1 only.
- v2: returns the full forest (518/54 canonical; 516/54 via the inline paste this run). `validate_pgn` reports `games: 4` and `has_variations: true`. Confirmed through the live MCP container, not just unit tests.
- Cross-game transpositions now surface: 21 vs 1 in v1, including `c4 Nf6 d4` ↔ `d4 Nf6 c4` (the Anti-English and Nimzo games converging on a move-order swap) — proof the merge is transposition-aware across game boundaries.
- The v1 false root gaps are gone: `find_repertoire_gaps` no longer flags `1.e4` / `1.d4` as uncovered, because the Caro-Kann and Nimzo games now answer them. The only remaining `path: []` gap is `1.e3` (genuinely rare).

### What Shone

- **`get_transpositions` scales cleanly to the forest** — 21 convergence points across four openings, grouped correctly, including the cross-game `c4`/`d4`/`Nf3` move-order merges. No spurious groups.
- **Classifier names 15/54 leaves on the full repertoire** — French ×4 (0.85) correctly tags the Advance Caro main lines; IQP ×3 (0.90), Carlsbad ×3, Caro-Kann (0.88), Slav (0.80) all plausible. The full-forest view is where the classifier earns its keep.
- **`evaluate_position` soundness stable** — Anti-English main still −5 (identical to v1); Caro/French main +40, Nimzo/Grünfeld main +27 — all normal Black ranges.

### New Shortcoming

**`analyze_repertoire_congruence` has no per-opening grouping (exposed by Issue #13)**
- Observed: with four merged openings, congruence judges every leaf against the whole 54-leaf forest. `structure_outlier` produced **zero** flags because no structure or theme reaches the 50% dominance threshold across four independent systems (fianchetto_white is the highest at 10/54). `weakness_inconsistency` fired 6 times, each describing a per-opening structural concession (the Caro exchange-sac `…Rxh1+`, the Caro IQP after `exd5`, the Nimzo `…exf5` doubled f-pawns) as "inconsistent with the repertoire's grain" — but a Black repertoire is one opening per White first move; there is no single grain to be inconsistent with.
- Expected: congruence should partition leaves by opening (e.g. by root first move, transposition-aware) and judge each leaf's structure/weakness against its own opening's siblings, not the entire forest.
- Concrete fix: group leaves by their first move before computing dominant structure/theme and the weakness baseline; report incongruencies within each opening. Design-worthy (what defines an "opening" boundary — root move vs ECO vs transposition cluster), so opened, not implemented this run.
- Filed: Issue #14.
- Note: this only became visible once #13 let the full multi-opening forest load — single-game v1 could not surface it.

### Carried Over

- **Classifier misses hypermodern `1.c4` structures** — the Anti-English (reversed-Sicilian / King's-English) leaves are still `unknown`. Same class as the English White repertoire (Issue #5 territory). Theme tags carry the signal there. Not re-filed.

### Skipped Tools (this run)

- **`suggest_complementary_lines`** / **`suggest_replacement_line`** — deferred. Now unblocked (#13 fixed), but the real next step is extending the repertoire's content gaps (e.g. `1.e4 c6 2.c3`, Catalan `3.g3`) — a user PGN task — before line suggestion is useful.
- **`get_transpositions`** — run (pre-flight), now genuinely informative across the forest.
- **`export_annotated_pgn`** — still not run; viable now that the full repertoire loads.

---

## v3 Update — chess-mcp 0.2.5 (2026-06-06)

Exercised the tools skipped in v1/v2 (unblocked by #13/#14): `get_repertoire_coverage`,
`suggest_replacement_line`, `suggest_complementary_lines`, `export_annotated_pgn`.

### What Resolved

**Issue #15 FIXED — `get_repertoire_coverage` is now transposition-aware**
- v3 first run: `dangling_count: 20` on `repertoire.pgn`, but most were transposition stubs (`c4 Nf6 d4` covered by the `d4 Nf6 c4` Nimzo mainline, the Caro `c3`/`Nbd2` pair, the Nimzo `e3`/`Nf3 … Bd3` pair, etc.).
- Fix: `coverage_report` excludes a player-to-move leaf from `dangling` when its position key also occurs as an internal node that continues — covered by transposition (mirrors the gap tool's #3 dedup). After: `dangling_count: 3` (genuine holes only). Engine-free, shipped 0.2.5.

### What Shone

- **`export_annotated_pgn`** — annotated the Anti-English game across mainline + variations in one pass; flagged only the intentional `9.exd4 $4 { -5.88 best Nxd4 }` blunder, left sound moves clean (`moves_annotated: 1`). Accurate, importable, correct.
- **`suggest_complementary_lines` / `suggest_replacement_line` return sound lines** — engine-validated continuations with PVs and evals. The engine soundness floor works; only the structural ranking is degraded (below).

### New Shortcomings

**`suggest_replacement_line` mis-anchors `weakness_inconsistency` flags**
- Observed: on the Nimzo doubled-f-pawn line (`… Qxf5 exf5 … Be6`), the tool returned `outlier_move: "Be6"`, `anchored_to: "e3"` — the terminal move, not `…exf5` where the doubled pawns were incurred. Replacing the last move cannot remediate the weakness.
- Expected: for weakness flags, walk back to the move that incurred the weakness and pivot from there (the #7 divergence walk is `structure_outlier`-only).
- Filed: Issue #16 (engine-backed → opened, not implemented).

**`profile_match` inert for unknown-structure repertoires (carried-over, now confirmed broadly)**
- Observed: both `suggest_complementary_lines` (`low_memorization`) and `suggest_replacement_line` (`structural_fit`) return `profile_match: 0.0` / `resulting_structure: unknown` for every suggestion on the Nimzo/QGD positions. The structural ranking modes provide no discrimination; ranking falls back to eval.
- Root cause: these positions classify `unknown` (the classifier gap), and the #11/#12 theme fallback doesn't reach the quiet, early pivots within its 8-ply window.
- This is the #8/#11/#12 lineage, not a new defect — recorded so the limitation is visible for Black/QGD repertoires too. Not re-filed.

### Skipped Tools (this run)

- **All previously-skipped repertoire tools have now been exercised.** `get_repertoire_coverage`, `suggest_complementary_lines`, `suggest_replacement_line`, and `export_annotated_pgn` all ran this loop.
- Remaining structural-ranking weakness (`profile_match` on unknown structures) is bounded by the classifier's coverage of Black/QGD systems — the standing classifier-extension work (Issue #5 class), not a per-tool fix.

---

## v4 Update — chess-mcp 0.2.7 (2026-06-06)

Verification run on 0.2.6 — all prior fixes (#13–#16) confirmed stable — plus the last
unrun tools (`identify_opening`, `compare_moves`). One new shortcoming found and fixed.

### What Resolved

**Issue #17 FIXED — `get_structural_profile.opening` now reads the named ancestor**
- v2–v4: every leaf returned `"opening": null`. Root cause: the field used `openings.identify(node.board())`, a single-position EPD lookup on the leaf — but leaves sit beyond ECO-table depth, so it always missed.
- Fix: added `openings.deepest_to_node(node)` (root→node, last ECO match wins — the node analogue of `deepest_in_line`); `get_structural_profile` now reports `{eco, name, ply}` from the deepest named ancestor. Engine-free, shipped 0.2.7. Also backstops `structure_class: "unknown"` (the ECO table names what the pawn-structure classifier cannot).

**Issues #13–#16 verified stable on 0.2.6** — multi-game load 516/54 + `games: 4`; congruence per-opening (no spurious outlier); coverage dangling 3; `suggest_replacement_line` #16 anchoring confirmed and shown to generalize (Caro IQP → `outlier_move: exd4`, 4 real alternatives).

### What Shone

- **`identify_opening`** — named all four games by ECO engine-free (B12 Caro Advance, E59 Nimzo Bernstein, A28 King's English Four Knights, A00 Polish). A28 names the Anti-English game the structural classifier returns `unknown` for — the ECO table is the practical name source for hypermodern systems.
- **`compare_moves`** — ranked Black's candidate replies correctly at a Nimzo extension leaf (c5/b6 best, Re8 worst +17), PVs, no illegal inputs.

### Carried Over

- **`profile_match` inert on unknown-structure lines** (#8/#11/#12 lineage) — still applies to the Nimzo/QGD suggestions; bounded by classifier coverage (Issue #5 class), not a per-tool fix.
- **Classifier `unknown` for hypermodern `1.c4`** — now backstopped at the tool level by the fixed `opening` field (#17), which surfaces the ECO name even when `structure_class` is `unknown`.

### Skipped Tools

- None outstanding for the repertoire workflow. All repertoire and supporting tools (`identify_opening`, `compare_moves`, `validate_line` surface) have now been exercised across v1–v4.

---

## v5 Update — chess-mcp 0.2.7 (2026-06-06)

Edge/robustness probe of the last unexercised behaviors: `suggest_complementary_lines`
mode `sharp` (only `low_memorization` had run) and `validate_line`.

### What Shone

- **`sharp` mode** — returns a differentiated `sharpness` ranking and correctly surfaces the most committal move (`dxc4`, 1.21) above quiet moves (0.28–0.35) on a position where every `resulting_structure` is `unknown`. It degrades more gracefully than `low_memorization`, whose `profile_match` goes inert (0.0) on the same unknown-structure positions — `sharp` still ranks usefully.
- **`validate_line`** — validated a 10-move Caro line from the start position, correct `final_fen`.

### No New Shortcomings

Nothing new surfaced. All prior fixes (#13–#17) remain in effect; `sharp` and `validate_line` work correctly. After five loops the Black repertoire and the full tool surface are thoroughly exercised with every found shortcoming closed — the standard flow has reached diminishing returns on this input. To find fresh tool behavior, the next loop should use a structurally different repertoire (e.g. a single-system or heavily-transposing tree) or deliberate edge inputs (oversized PGN, single-line, FEN-setup games). No code change this run.
