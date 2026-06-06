# Black Repertoire Analysis — Sicilian Defense (teaching study)

**Source:** `repertoire.pgn` (Lichess gamebook study export, anonymized via python-chess re-export — comments/NAGs/PII headers stripped, full move tree preserved; 21 chapters)

| Run | Date | MCP version |
|-----|------|-------------|
| v2 (current) | 2026-06-06 | chess-mcp 0.2.9 |
| v1 | 2026-06-06 | chess-mcp 0.2.7 |

---

## v1 — 2026-06-06 — chess-mcp 0.2.7

**Tools:** `validate_pgn` → `load_repertoire` → `get_transpositions` → `get_structural_profile` → `analyze_repertoire_congruence` → `find_repertoire_gaps` → `evaluate_position` (×3)

**Focus:** First Black repertoire run on a *gamebook teaching study*, and by far the largest tree exercised to date (3946 nodes). The Najdorf Poisoned-Pawn chapter alone embeds a ~27-move-deep theory encyclopedia with hundreds of nested sub-variations. This run is primarily a **scale stress test**.

### Tree Stats

| Metric | Value |
|--------|-------|
| Nodes | 3946 |
| Leaves (distinct lines) | 693 |
| Max depth (plies) | 54 |
| Color | Black |

~8× the node count of `ct-black` (518). The depth-54 mainline is the Najdorf Poisoned-Pawn forcing line to `27...Qd1+`.

### Structural Identity

`get_structural_profile` (aggregate over 693 leaves) — the classifier's strongest showing yet on a real repertoire:

| Structure | Count | Avg conf |
|-----------|-------|----------|
| unknown | 441 | 0.0 |
| Scheveningen | 126 | 0.75 |
| Closed Sicilian | 43 | 0.68 |
| Najdorf | 37 | 0.77 |
| Lopez | 22 | 0.68 |
| IQP | 8 | 0.90 |
| Hanging pawns | 6 | 0.78 |
| Maroczy | 6 | 0.80 |
| French / Stonewall | 2 / 2 | 0.85 |

Only 64% `unknown` (vs 95% on the English fianchetto study) — the canon's Sicilian-relevant structures (Scheveningen, Najdorf, Maroczy, Closed) earn their keep. **Themes:** `fianchetto_black` 379, `color_complex:dark` 192, `minority_attack_white` 139, `double_fianchetto` 92. **Center:** semi-open 403, tense 126, locked 95, open 69. Half-open `c` file is the repertoire-wide constant — the Sicilian signature.

### Transpositions (pre-flight)

`total: 46` (all returned). Largest group has 3 converging paths; the headline example is the Dragon/Classical/Open-Sicilian convergence at `r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w` (move 9). **The full response exceeded the MCP output cap (32 KB) and had to be read from the spill file** — see MCP Retro Notes (#20).

### Congruence Results

`analyze_repertoire_congruence` (min_severity `low`, limit 50): **509 total flagged** — `structure_outlier` 311 + `weakness_inconsistency` 198, `acknowledged_count: 0`, across 693 leaves. **Response exceeded the cap (39 KB), read via spill file.**

- **311 `structure_outlier`** — the dominant theme is only a *plurality* (`fianchetto_black` 379/693 ≈ 55%), so the checker flags the other ~45% (Najdorf/Scheveningen/Alapin/Sveshnikov non-fianchetto lines) as "lacking the repertoire's DNA." For a deliberately multi-system defense this is expected diversity, not inconsistency — false signal. Distinct from closed #14 (which partitioned *multi-opening* repertoires; this is a *single* opening that nonetheless spans 10 structures). → Issue #21.
- **198 `weakness_inconsistency`** — the Sicilian's structural concessions (doubled c-pawns after `...bxc6`, the Poisoned-Pawn material/structure imbalance, IQP lines) are intentional. The flags are technically correct but, again, are the repertoire's whole point.

### Soundness Checks

`evaluate_position` at depth 20 (white-POV cp):

| Leaf | Eval | Engine best | Verdict |
|------|------|-------------|---------|
| Sveshnikov main (`15...O-O`) | **+26** | `Rxa4` | Sound for Black — the d5 hole is the known price for piece activity |
| Dragon Yugoslav main (`13.h4`, Black to move) | **+112** | `h5` | White's `h4-h5` storm bites; Black objectively worse in this exact line (content note) |
| Najdorf Poisoned Pawn, deepest leaf (`27...Qd1+`, 54 plies) | **0** | `Kf2` → `Bc5+ Nxc5 Qd2+ Kf3` | Forced perpetual — engine confirms the PP main line is a draw; the study walks it correctly |

`get_structural_profile` resolved the full 54-ply Poisoned-Pawn path without error; `evaluate_position` correctly read the perpetual as 0.00. Deep-line handling is solid.

### Gaps

`find_repertoire_gaps` (depth 20, max_positions 40, limit 8): **91 total gaps**, top-8 `high` at white-POV +40…+77 cp. The flagged positions are early anti-Sicilian deviations (`2.c3`/`2.c4`/`Be2` sidelines after `g6`/`a6`) the study doesn't answer exhaustively. Severity is uniform `high` despite the spread (the eval-vs-severity issue, #19, recurs). `transposition_endpoints: []` (the 46 transpositions are mostly White-to-move, out of the gap scanner's dedup scope — consistent with prior runs).

**Content observations (not MCP shortcomings):**
- Black-only study — every node is a Black recommendation against White's tries. Loading `as white` would be meaningless (see the white-only note in the English analysis for the symmetric reasoning).
- The Intro chapter's illustrative `1...e5` and `1...a6` lines (shown to *contrast* with the Sicilian) are walked as real leaves and now seed gap flags (`["e4","a6"]`) — the gamebook-illustration issue (#18) recurs.
- The study is a teaching tree, not an exhaustive repertoire; the 91 gaps reflect untaught anti-Sicilian sidelines, not 91 defects.

### MCP Retro Notes

New shortcoming observed on 0.2.7 (detail in `retro.md` v1):

1. **Lean-output contract breaks at scale** — `get_transpositions` (32 KB) and `analyze_repertoire_congruence` (39 KB) exceeded the MCP token cap on this 693-leaf / depth-54 tree. The `limit` parameter bounds the *number* of items, not total bytes; each item carries full SAN paths that scale with depth, so even 46 transpositions / 50 incongruencies overflow the ~2k-token target. → Issue #20.

Recurring (already filed): gap severity ignores absolute eval (#19); illustrative gamebook lines walked as real leaves (#18).

---

## v2 — 2026-06-06 — chess-mcp 0.2.9

**Focus:** verify the #18/#19/#20/#21 fixes shipped this session, on the largest tree.

| Check | v1 | v2 | Verdict |
|-------|----|----|---------|
| #20 `get_transpositions` | 32 KB — blew the cap | total=46, **returned=17, truncated=true** | Fixed — fits the output budget |
| #20 `analyze_repertoire_congruence` | 39 KB — blew the cap | shown=14, **truncated=true** | Fixed |
| #21 `structure_outlier` | 311 | **0** | Fixed — plurality (`fianchetto_black` 55%) no longer treated as a grain |
| congruence `total_flagged` | 509 | **198** | The 311 false outliers gone; only intentional `weakness_inconsistency` remains |
| #19 `find_repertoire_gaps` high-severity | 91 | **2** | Fixed — only the two genuinely White-better anti-Sicilian replies stay `high` |
| #18 illustrative leaves | n/a | **2** (`engine`) | The study's labeled `6...Ng4` "Big Blunder" line (+317/+527); 0 false positives |

The structural diversity that produced 311 outliers in v1 is now correctly read as *intended*
multi-system breadth, not inconsistency. The depth-54 tree no longer overflows any tool's
output. New minor finding: the #18 engine tier scans at most `max_positions` (20 here)
shallowest player-side candidates, so a clear blunder demo deeper than that sample can be
missed — same bounded-scan trade-off as `find_repertoire_gaps` (retro v2).
