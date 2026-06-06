# White Repertoire Analysis — English Opening (teaching study)

**Source:** `repertoire.pgn` (Lichess gamebook study export, anonymized; 18 chapters, all side-variations preserved)

| Run | Date | MCP version |
|-----|------|-------------|
| v1 (current) | 2026-06-06 | chess-mcp 0.2.7 |

---

## v1 — 2026-06-06 — chess-mcp 0.2.7

**Tools:** `validate_pgn` → `load_repertoire` → `get_transpositions` → `get_structural_profile` → `analyze_repertoire_congruence` → `find_repertoire_gaps` → `evaluate_position` (×3)

**Focus:** First run against a *gamebook teaching study* rather than a Chesstempo export. Unlike `../ct-white/repertoire.pgn`, this PGN embeds illustrative **wrong-answer side variations** (deliberately bad moves shown to a student, e.g. `(6. Bd2 {-7})`, `(6. Nd2 {-7.5})`, `(8. Qd4 {fails})`). This shape stresses the tools differently — see MCP Retro Notes.

### Tree Stats

| Metric | Value |
|--------|-------|
| Nodes | 216 |
| Leaves (distinct lines) | 38 |
| Max depth (plies) | 21 |
| Color | White |

The 18 study chapters merge into one variation forest under the shared `1.c4` root. Leaf count (38) is roughly double the chapter count because each chapter's "wrong-answer" side variations terminate as their own leaves (e.g. the Myers chapter alone contributes 5+ leaves from `(3.Bxg5)`, `(6.Bd2/Nd2/Qd2)`, `(7.Nxg5)`, `(8.Qd4)`).

### Structural Identity

`get_structural_profile` (aggregate over 38 leaves):

- **36/38 `unknown`** (confidence 0.0) — expected for a fianchetto English system; named-structure canon is 1.d4/1.e4-derived (Decision D2 — DNA lives in theme tags, not a forced label). Consistent with `ct-white` runs.
- **1 Carlsbad** (0.85) — the Caro-Kann Defensive System line (`...c6 ... cxd5 cxd5 d4`) reaching a Carlsbad pawn skeleton.
- **1 Hanging pawns** (0.75) — the Jaenisch Gambit endpoint (`...b5 cxb5 ... d4` with c-file half-open). Classifier correctly named both — the 11 added structures earn their keep here.

**Themes (leaf counts):** `fianchetto_white` 16, `double_fianchetto` 7, `fianchetto_black` 9, `minority_attack_black` 11, `wing_majority_white:kingside` 6, `color_complex:light` 5. avg_space_white 1.4 / black 0.7.

**Center distribution:** semi-open 29, locked 6, tense 3.

The theme fingerprint correctly captures the repertoire's DNA (light-square fianchetto, `c4/Nc3/g3/Bg2/d3/Nf3` system) even though 95% of leaves are `unknown` by name.

### Transpositions (pre-flight)

`total: 3` — all between the **Anglo-Indian** (`1.c4 Nf6 2.g3 …`) and **Great Snake** (`1.c4 g6 2.Nf3 …`) chapters, which converge on the double-fianchetto setup at move 7–8:

| FEN (to move) | Converging chapters |
|---|---|
| `r1bq1rk1/…/R1BQ1RK1 b - - 1 7` | Anglo-Indian ↔ Great Snake (after both sides' …O-O) |
| `…w - - 2 8` | same, after `…Bd7` |
| `…b - - 3 8` | same, after `Bd2` |

`find_repertoire_gaps` returned `transposition_endpoints: []` — these convergences are not exploited by the gap scanner (known limitation; see retro).

### Congruence Results

`analyze_repertoire_congruence` (min_severity `low`): **7 flagged, all `weakness_inconsistency`, severity medium**, `acknowledged_count: 0`.

- **6 flags** are on the **Myers Defence** line and its side variations (`1.c4 g5 2.d4 … 5...Bxc3+`): after `4.dxc5` White's c-pawn sits on c5 alongside c4 → doubled c-pawns, plus isolated a2 after the …Bxc3+/bxc3 trade. The structural weakness is **real and intentional** (the study's whole point: bishop pair + open b/d files as compensation, engine-confirmed +1.06 — see Soundness).
- **1 flag** is the **Jaenisch Gambit** endpoint (doubled b-pawns + isolated d4 after the forced sequence) — also intentional (White is +1.24, up a pawn).

**3 of the 6 Myers flags fall on deliberately-bad demo moves** — the side variations `(6.Bd2)`, `(6.Nd2)`, `(6.Qd2)`, which the study annotates as `-7`/`-7.5` losing tries. The doubled-pawn flag is technically correct (c4+c5 doubling exists in those positions), but flagging a move the author explicitly marks as a blunder is noise — see MCP Retro Notes.

### Soundness Checks

`evaluate_position` at depth 20 (white-POV cp; all positions Black-to-move):

| Leaf | FEN | Eval | Engine best | Verdict |
|------|-----|------|-------------|---------|
| Myers main (`…bxc3 … Nd2`) | `r1b1k1nr/pp1ppp1p/8/2n3B1/2P5/2q3P1/P2NPP1P/R2QKB1R b` | **+106** | `b6` | Sound — doubled c-pawns + isolated a2 offset by bishop pair / open b,d files |
| Anglo-Lithuanian Pt3 (`…Qa4 … Bg5`) | `r1bqkb1r/pppp1pp1/5nn1/3Pp1Bp/Q1P4P/2N5/PP2PPP1/R3KBNR b` | **+114** | `Be7` | Sound — `d5` space bind + `Bg5` bind, matches study's "enduring advantage" |
| Jaenisch endpoint (`…Bxe2`) | `rn2kb1r/pbp2ppp/3p4/1P6/3P4/5N2/PP2BPPP/R1B1K2R b` | **+124** | `a6` | White better (extra b5 pawn). Study's "winning by quite a bit" overstated — +1.2 is a clear edge, not winning |

All three engine evals corroborate the study's structural bets. The classifier's named structures (Carlsbad, Hanging pawns) and the Jaenisch +124 align.

### Gaps

`find_repertoire_gaps` (depth 20, max_positions 40): **positions_scanned 40, total_gaps 154** — all 30 listed are severity `high`, with white-POV evals spanning only **−15 to +28 cp**. White is at or near equality after every "uncovered" move; none is a genuine soundness hole.

This is the expected behavior of a **single-recommendation teaching study**: each chapter teaches exactly one Black reply per move, so every other reasonable Black move is "uncovered." The volume (154) and uniform `high` severity reflect the study's pedagogical shape, not 154 repertoire defects. The signal a real repertoire-builder wants (which gaps actually threaten White's equality) is not separable from the noise at present — see MCP Retro Notes.

**Content observations (not MCP shortcomings):**
- The study is a teaching tool, not a complete repertoire tree — by design it does not branch on every Black alternative. Converting it into a playable repertoire would require filling the high-volume gaps with real lines.
- The two "transpositional value" chapters (QGD / Queen's Gambit / KID-via-e4) intentionally hand off to *other* openings (`2.d4`, `3.e4`) — these are escape hatches, not English lines.

### MCP Retro Notes

New shortcomings observed on 0.2.7 (full detail in `retro.md` v1):

1. **No annotation/NAG awareness** — illustrative "wrong-answer" side variations are parsed as first-class repertoire leaves. Inflates leaf count (38 vs ~18 chapters), produces false congruence flags on moves the author marks as blunders, and feeds bad positions to the gap scanner. The study marks badness only in prose (`{-7}`), with no machine NAGs, so even NAG-filtering would not catch it. → Issue #18.
2. **`find_repertoire_gaps` severity ignores absolute eval** — severity is set purely by closeness to the opponent's best move, so a gap that leaves White at +0.2 is `high` exactly like one that drops White to −2. On a single-recommendation study this yields 154 uniform-`high` gaps with no prioritization. Distinct from the (closed) depth issue #6. → Issue #19.
