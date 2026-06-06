# Black Repertoire Analysis — Caro-Kann / Nimzo / Anti-English / 1.b4

**Source:** `ct-black-repertoire.pgn` (Chesstempo export, 2026-06-06)

This repertoire ships as a **4-game PGN** — Chesstempo exports one `[Event]` block per
opening. The four games are: Anti-English (`1.c4`), Caro-Kann (`1.e4 c6`), Nimzo-Indian
(`1.d4 Nf6 2.c4 e6 3.Nc3 Bb4`), and "Other" (`1.b4`, the Polish/Sokolsky).

| Run | Date | MCP version |
|-----|------|-------------|
| v1 (current) | 2026-06-05 | chess-mcp 0.2.2 |

---

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
