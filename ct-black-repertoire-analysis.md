# Black Repertoire Analysis — Caro-Kann / Nimzo / Anti-English / 1.b4

**Source:** `ct-black-repertoire.pgn` (Chesstempo export, 2026-06-06)

This repertoire ships as a **4-game PGN** — Chesstempo exports one `[Event]` block per
opening. The four games are: Anti-English (`1.c4`), Caro-Kann (`1.e4 c6`), Nimzo-Indian
(`1.d4 Nf6 2.c4 e6 3.Nc3 Bb4`), and "Other" (`1.b4`, the Polish/Sokolsky).

| Run | Date | MCP version |
|-----|------|-------------|
| v3 (current) | 2026-06-06 | chess-mcp 0.2.5 |
| v2 | 2026-06-06 | chess-mcp 0.2.3 |
| v1 | 2026-06-05 | chess-mcp 0.2.2 |

---

## v3 — 2026-06-06 — chess-mcp 0.2.5

**Tools:** `load_repertoire` → `get_repertoire_coverage` → `suggest_replacement_line` → `get_structural_profile` → `suggest_complementary_lines` → `export_annotated_pgn`.

**Focus:** Exercise the tools skipped in v1/v2 — now unblocked because #13 lets the full forest load and #14 fixed congruence. Core flow (transpositions/structure/congruence/gaps/soundness) was validated in v2 and is unchanged on 0.2.4; v3 hunts shortcomings in the previously-unrun tools.

### `get_repertoire_coverage` (first run)

`leaves: 54`, `dangling_count: 20`, `frontier_count: 34`, `shallowest_leaf_ply: 3`. **The dangling count was inflated by transposition stubs** — e.g. `c4 Nf6 d4` (ply 3) reaches the same position as the `d4 Nf6 c4` Nimzo mainline that continues; `Nf3 Nf6 c4 e6 d4`, the Caro `c3`/`Nbd2` pair, and the Nimzo `e3`/`Nf3 … Bd3` pair are all move-order duplicates already covered. The gap tool got transposition dedup (#3); coverage had not. **Fixed this run (Issue #15):** after the fix `dangling_count` drops to **3** genuine holes (17 stubs excluded). The 3 real dangling lines are extension points the user owes a move at.

### `suggest_replacement_line` (first run on Black)

Run on the Nimzo doubled-f-pawn line (`… Qxf5 exf5 … Be6`), `mode="structural_fit"`. Returned 4 full engine-validated continuations (evals +21…+28). Two problems:
- **Anchored to the terminal move** `Be6` (`anchored_to: "e3"`), not to `…exf5` where the doubled f-pawns were incurred. The #7 divergence walk is `structure_outlier`-only; for `weakness_inconsistency` flags the tool replaces the last move, which cannot fix the weakness. Filed **Issue #16**.
- **`profile_match: 0.0`** for all suggestions (`resulting_structure: unknown`). Known #8/#11/#12 lineage — the Nimzo/QGD positions classify `unknown`, and the quiet deep pivots don't hit a theme within the 8-ply window, so ranking degenerates to eval order.

### `suggest_complementary_lines` (first run on Black)

Run from a genuine Nimzo extension leaf (`… e3 O-O Bd3`, Black to move), `mode="low_memorization"`. Returned 5 sound suggestions with PVs (c5 +19, b6 +21, dxc4 +21, Nbd7 +28, Re8 +34). **All `profile_match: 0.0`, `resulting_structure: unknown`** — `low_memorization` ranking ("structures you already play") is inert here for the same reason: the resulting positions are `unknown`, so the mode provides no structural discrimination and falls back to eval order. The suggestions themselves are valid; the ranking signal is the limitation.

### `export_annotated_pgn` (first run on Black) — shone

Run on the Anti-English game. Correctly annotated across the mainline AND variations in one pass: the only flagged move is the intentional `9.exd4 $4 { -5.88 best Nxd4 }` blunder (the line Black baits White into), sound moves left clean, `moves_annotated: 1`. Importable artifact, accurate eval and best-move. Works as intended.

### MCP Retro Notes

- **`get_repertoire_coverage` transposition-blindness (NEW, fixed)** — 20 → 3 dangling after Issue #15 fix. Detail in retro § v3.
- **`suggest_replacement_line` mis-anchors weakness flags (NEW)** — terminal move, not weakness origin. Issue #16 (engine-backed, opened not implemented).
- **`profile_match` inert for unknown-structure lines (carried-over)** — confirmed for both suggest tools on the Nimzo/QGD positions. #8/#11/#12 lineage; theme fallback doesn't reach quiet early pivots. Not re-filed.
- **`export_annotated_pgn` works correctly** across variations.

#### Content observations (not MCP issues)

- 3 genuine dangling lines (post-#15) are real extension points the user owes a reply at; extending them is a PGN task.

## v2 — 2026-06-06 — chess-mcp 0.2.3

**Tools:** `validate_pgn` → `load_repertoire` → `get_transpositions` → `get_structural_profile` → `analyze_repertoire_congruence` → `find_repertoire_gaps` → `evaluate_position` (×3).

**Focus:** First run after the Issue #13 fix (multi-game merge, shipped in 0.2.3, container rebuilt). The whole 4-game repertoire now loads as one forest, so this is the first run that actually analyzes all four openings instead of just the Anti-English game.

### Tree Stats

| Metric | v1 (game 1 only) | v2 (full forest) |
|--------|------------------|------------------|
| Nodes | 64 | **518** (canonical; 516 via the inline paste this run — 2 optional sub-lines dropped in transcription) |
| Leaves | 5 | **54** |
| Max depth (plies) | 20 | **28** |
| Color | black | black |
| `validate_pgn` games | (only game 1 seen) | **4** |

The fix is verified end-to-end through the live MCP: `validate_pgn` reports `games: 4`; `load_repertoire` returns the full forest.

### Structural Identity (full repertoire, 54 leaves)

15/54 leaves now name a structure (vs all-`unknown` for the game-1-only v1 view):

| structure_class | count | avg_conf |
|-----------------|-------|----------|
| unknown | 39 | 0.0 |
| French | 4 | 0.85 |
| Carlsbad | 3 | 0.75 |
| IQP | 3 | 0.90 |
| Grünfeld Centre | 2 | 0.70 |
| Caro-Kann | 1 | 0.88 |
| King's Indian | 1 | 0.53 |
| Slav | 1 | 0.80 |

The **French ×4** hits are the Advance Caro-Kann main lines (Black's b7–c6–d5–e6–f7 chain vs White e5/d4) — correctly classified now that the Caro game loads. Center distribution: tense 25, semi-open 18, locked 8, open 3. Dominant themes: `minority_attack_white` 18, `minority_attack_black` 16, `fianchetto_white` 10, `wing_majority_white:queenside` 10. No single theme reaches 50% — the repertoire is four structurally independent systems, as expected for a Black repertoire (one answer per White first move).

### Transpositions (pre-flight)

**21 transpositions** (v1 saw 1). The merge surfaced cross-game convergence the single-game load could never see:

- `c4 Nf6 d4` ↔ `d4 Nf6 c4` — the **Anti-English game and the Nimzo game converge** after a `c4`/`d4` move-order swap.
- `c4 Nf6 Nf3` ↔ `Nf3 Nf6 c4` — same two games via `Nf3`.
- `d4 Nf6 c4 e6 Nf3` ↔ `Nf3 Nf6 d4 e6 c4` ↔ `Nf3 Nf6 c4 e6 d4` — Nimzo main + its `1.Nf3` sideline.
- Many within-Caro move-order merges (`e4 c6 d4 d5 Nc3` ↔ `e4 c6 Nc3 d5 d4`, etc.).

This is direct evidence the forest merge is transposition-aware across game boundaries.

### Congruence Results

`total_flagged: 6`, all `weakness_inconsistency` (medium), `acknowledged_count: 0`. **Zero `structure_outlier`** this run.

The 6 weakness flags span all four games:
- Anti-English `3.e3 … 9.exd4?? dxc3` (doubled) — the v1 blunder-punish leaf.
- Caro `2.Nf3 … 3.d4 dxe4 4.Ng5 … Rxh1+` (doubled) — the exchange-sac line, Black up material.
- Caro `3.d3 … d4 exd4 exd5 cxd5 Nb3/Nxd4` (isolated ×2) — IQP after the central trade.
- Caro `2.Bc4 … Bxc6+ bxc6` (isolated) — the doubled/hanging c-pawns line.
- Nimzo `4.Qc2 d5 cxd5 Qxd5 … Qxf5 exf5` (doubled f-pawns).

Each is a real, mostly forced/intentional structural concession **specific to that opening**. See MCP Retro Notes / Issue #14: across four independent systems, "inconsistent with the repertoire's grain" is the wrong frame — these should be judged against their own opening's siblings, not all 54 leaves.

### Soundness Checks (`evaluate_position`, depth 20)

| Line | FEN | Eval (White-POV) | Best | Verdict |
|------|-----|------------------|------|---------|
| Caro Advance main (`…a5`, French) | `r2qkb1r/1p1n1ppb/2p1p2p/p2pPn2/P2P4/1NP2N2/1P2BPPP/R1BQ1RK1 w kq - 0 11` | **+40** | Bd3 | Slight White pull — normal Advance Caro |
| Nimzo main (`…Qc7`, Grünfeld Centre) | `r1b2rk1/ppq2ppp/2n1pn2/2p5/2BP4/P1P1PN2/5PPP/R1BQ1RK1 w - - 1 11` | **+27** | h3 | Normal small edge — sound for Black |
| Anti-English main (`…Qd7`) | `r4rk1/1ppqbppp/2n1b3/p2np3/8/P1NP1NP1/1P1BPPBP/R2Q1RK1 w - - 2 11` | **−5** | Rc1 | Equal — unchanged from v1 |

All three mainline endpoints sit in the normal Black range (≤ +40). The repertoire is sound.

### Gaps (`find_repertoire_gaps`, depth 20, min_severity medium)

`positions_scanned: 20`, `total_gaps: 57`, `transposition_endpoints: []`. **The v1 false root gaps are gone:** `1.e4` and `1.d4` are no longer flagged as uncovered — the Caro-Kann and Nimzo games now answer them. Only `path: []` gap remaining is `e3` (1.e3, +20, a genuinely rare first move).

Top gaps are now legitimate move-order points inside the covered openings:

| path | uncovered_move | eval | severity |
|------|----------------|------|----------|
| `e4 c6 Nc3 d5` | Nf3 | 31 | high |
| `d4 Nf6 c4 e6` | g3 (Catalan) | 27 | high |
| `e4 c6` | c3 | 26 | high |
| `e4 c6` | Be2 | 24 | high |
| `c4 Nf6` | g3 | 22 | high |

Several are likely transposition-resolvable (e.g. `d4 Nf6 c4 e6 → g3` is the Catalan, reachable via other move orders), but most are real opening-theory branches the repertoire does not yet answer. These are **content gaps** for the user to extend, not tool defects — tracked here, not in the retro.

### MCP Retro Notes

- **Issue #13 fixed and verified live** — the dominant outcome. Full forest loads (518/54), `validate_pgn` reports `games: 4`, cross-game transpositions surface (21 vs 1), and the false `1.e4`/`1.d4` root gaps are eliminated. Detail in `ct-black-repertoire-retro.md` § v2.
- **Congruence has no per-opening grouping (new, exposed by #13)** — with four merged openings, `analyze_repertoire_congruence` judges every leaf against the whole 54-leaf forest. `structure_outlier` goes inert (no theme reaches 50% across four systems) and `weakness_inconsistency` frames per-opening concessions as repertoire-wide inconsistency. Filed as Issue #14.
- **Classifier markedly better on the full repertoire** — 15/54 named, French ×4 correctly tags the Advance Caro. The hypermodern-`1.c4` blind spot persists (Anti-English leaves still `unknown`), but that is the known Issue #5 class.

#### Content observations (not MCP issues)

- 57 gaps include real opening-theory branches the repertoire omits (e.g. `1.e4 c6 2.c3`, `1.d4 Nf6 2.c4 e6 3.g3` Catalan, `1.c4 Nf6 2.g3`). Extending these is a user PGN task.
- The 6 weakness lines are mostly forced/intentional; candidates to pass via `acknowledged_weaknesses` once the user confirms they are deliberate.

## v1 — 2026-06-05 — chess-mcp 0.2.2

**Tools:** `validate_pgn` → `load_repertoire` → `get_transpositions` → `get_structural_profile` → `analyze_repertoire_congruence` → `find_repertoire_gaps` → `evaluate_position` (×2). Each game also re-loaded individually to quantify the multi-game drop (see below).

**Focus:** First run against the Black repertoire. The Black export is multi-game, which the White repertoire never was — this immediately surfaced a new MCP limitation.

### Tree Stats

`load_repertoire` on the full 4-game file returned **only the first game** (Anti-English):

| Metric | Reported by load_repertoire (full file) | Value |
|--------|------------------------------------------|-------|
| Nodes | 64 | game 1 only |
| Leaves | 5 | game 1 only |
| Max depth (plies) | 20 | game 1 mainline |
| Color | black | correct |

Re-loading each `[Event]` block individually reveals the true scope:

| Game | Opening | Nodes | Leaves | Max depth |
|------|---------|-------|--------|-----------|
| 1 | Anti-English (`1.c4`) | 64 | 5 | 20 |
| 2 | Caro-Kann (`1.e4 c6`) | 85 | 16 | 22 |
| 3 | Nimzo-Indian (`1.d4 Nf6 2.c4 e6 3.Nc3 Bb4`) | 151 | 19 | 26 |
| 4 | Other (`1.b4`) | 69 | 4 | 20 |
| **Total** | — | **369** | **44** | 26 |

**The full-file load covered 64/369 nodes (17%) and 5/44 leaves (11%). 83% of the repertoire was silently dropped** with no warning, error, or count. See MCP Retro Notes and Issue #13.

### Structural Identity

Per-game aggregate profile (each game loaded individually):

**Game 1 — Anti-English** (5 leaves): all 5 `unknown` (conf 0.0). Themes: `fianchetto_white` ×3, `minority_attack_white` ×2, `minority_attack_black` ×1, `wing_majority_black:queenside` ×2. Center: semi-open ×3, tense ×2. Half-open `d`. Reversed-Sicilian / King's-English structures — the same hypermodern blind spot the classifier has for the White English repertoire.

**Game 2 — Caro-Kann** (16 leaves): `unknown` ×13, **IQP ×2 (conf 0.90)**, **King's Indian ×1 (conf 0.53)**. Themes: `minority_attack` (both) ×3, `fianchetto_white` ×3, `wing_majority_black:kingside` ×3. Center: tense ×8, semi-open ×5, open ×2, locked ×1. The Advance Caro (`3.e5 Bf5`) dominates; the IQP hits come from exchange/`exd5` lines.

**Game 3 — Nimzo-Indian** (19 leaves): `unknown` ×17, **Carlsbad ×1 (conf 0.85)**, **Grünfeld Centre ×1 (conf 0.70)**. Themes: `minority_attack` (both) ×3, `wing_majority_black:queenside` ×3, `fianchetto_black` ×2. Center: tense ×9, semi-open ×8, open ×1, locked ×1. Classic Nimzo doubled-c / `bxc3` structures — mostly `unknown` despite being canonical pawn skeletons.

**Game 4 — Other (1.b4)** (4 leaves): `unknown` ×3, **Grünfeld Centre ×1 (conf 0.70)**. Themes: `fianchetto_white` ×4, `double_fianchetto` ×2, `fianchetto_black` ×2. Center: tense ×4. Half-open `e`. Black grabs the b4-pawn (`1...e5 2.Bb2 Bxb4`) then fianchetto/center play.

**Classifier coverage across the full repertoire: 6/44 leaves named (IQP ×2, Grünfeld Centre ×2, King's Indian ×1, Carlsbad ×1), 38/44 `unknown`.** Better than the all-`unknown` English White repertoire, but Nimzo and Advance-Caro skeletons — textbook structures — still fall through. Theme tags remain the practical signal where `structure_class` is silent.

### Congruence Results

Run on the loaded handle (Anti-English only — the other 3 games were never in the tree): `total_flagged: 3` at `min_severity: low` — 2 `structure_outlier` + 1 `weakness_inconsistency`, all three pointing at the **same leaf**: the `3.e3 ... 9.exd4?? exd4+ ... dxc3` line.

- `structure_outlier` (×2, source: theme) — line lacks the dominant `fianchetto_white` theme.
- `weakness_inconsistency` (×1) — line accepts doubled c-pawns against the otherwise-clean grain.

Cross-checked against the soundness eval below: this leaf is the line where White plays the PGN-annotated blunder `9.exd4??`. **Black is winning (−633 cp).** The congruence flags are static-structure artifacts (doubled pawns, no fianchetto are literally true) but they mislabel a tactical refutation leaf as a strategic "island." Not a false positive in the strict sense — the checker is static by design — but low practical value here.

Congruence could not be run across the whole repertoire because of the multi-game drop. Cross-game congruence (e.g., does the Nimzo's `bxc3` structural bet rhyme with anything?) was unreachable.

### Soundness Checks (`evaluate_position`, depth 20)

| Position | FEN | Eval (White-POV) | Best | Verdict |
|----------|-----|------------------|------|---------|
| Anti-English mainline leaf (`...Qd7`) | `r4rk1/1ppqbppp/2n1b3/p2np3/8/P1NP1NP1/1P1BPPBP/R2Q1RK1 w - - 2 11` | **−5 cp** | Rc1 | Equal — sound for Black |
| `3.e3 9.exd4??` punish leaf (`...dxc3`) | `r1b1k2r/ppp1qppp/5n2/3p4/2P5/P1p2N2/1P2BPPP/R1B1K2R w KQkq - 0 11` | **−633 cp** | bxc3 | Black winning — refutation line, working as intended |

Both engine-grounded. The mainline endpoint at dead-equal is exactly what a Black repertoire wants. Only the Anti-English game's leaves were reachable for soundness checks (multi-game drop).

### Gaps (`find_repertoire_gaps`, depth 20, min_severity medium)

`positions_scanned: 20`, `total_gaps: 67`, `transposition_endpoints: []`. **The top gaps are corrupted by the multi-game drop:**

| path | uncovered_move | eval | severity |
|------|----------------|------|----------|
| `[]` (root) | **e4** | 38 | high |
| `[]` (root) | **d4** | 35 | high |
| `[]` (root) | Nf3 | 35 | high |
| `[c4, Nf6]` | d4 | 32 | high |

`find_repertoire_gaps` flags `1.e4` and `1.d4` as **uncovered at the root** — but the user has a full Caro-Kann (vs `1.e4`) and a full Nimzo (vs `1.d4`). Those games were dropped by `load_repertoire`, so the gap scan, fed only the `1.c4` game, concludes Black has no answer to the two most common first moves. **These are false gaps produced entirely by the multi-game limitation.** The remaining gaps are genuine Anti-English move-order points but cannot be trusted as a repertoire-wide list until the whole tree loads.

### MCP Retro Notes

- **Multi-game PGN silently truncated to game 1** — the dominant finding this run. `load_repertoire` and `validate_pgn` both read a single game; games 2–N are dropped with no signal. 83% of this repertoire was invisible. Cascades into false gaps (`1.e4`/`1.d4` "uncovered") and prevents cross-game congruence/structure analysis. Filed as Issue #13. Full detail in `ct-black-repertoire-retro.md`.
- **Classifier still misses canonical Black structures** — Nimzo `bxc3` and Advance-Caro skeletons return `unknown`. Same class of gap as the English White repertoire (Issue #5 territory); theme tags carry the load.
- **Congruence is static-only** — correctly flags the `9.exd4??` leaf's doubled pawns / missing fianchetto, but that leaf is a winning tactical refutation, not a strategic island. Expected behavior, low practical value here.

#### Content observations (not MCP issues)

- The repertoire is **four structurally independent systems** — there is no shared middlegame DNA to be congruent about. This is normal for a Black repertoire (one answer per White first move), unlike the single-root White English tree.
- Game 1 (Anti-English) `3.e3` line deliberately walks into the `9.exd4??` punish line; it relies on White blundering. Worth confirming the line also holds against `9.Nxd4` (the PGN's non-blunder sideline) — a content task, tracked here, not in the retro.
