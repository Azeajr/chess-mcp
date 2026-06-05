# White Repertoire Analysis — English Opening

**Source:** `ct-white-repertoire.pgn` (Chesstempo export, 2026-06-03)  
**Tool:** `chess-analysis` MCP (`load_repertoire` → `get_structural_profile` → `analyze_repertoire_congruence` → `evaluate_position`)  
**Date analyzed:** 2026-06-04

---

## Tree Stats

| Metric | Value |
|--------|-------|
| Nodes | 213 |
| Leaves (distinct lines) | 17 |
| Max depth (plies) | 21 |
| Color | White |

---

## Structural Identity

Classifier returns `unknown` for 16/17 leaves (confidence 0.0). This is expected — English Opening positions rarely map cleanly to the IQP/Carlsbad/Maroczy schemas the classifier knows. One Maroczy leaf (confidence 0.7, the 1...c5 fianchetto branch).

**Center distribution across all 17 leaves:**

| Center type | Leaves |
|-------------|--------|
| semi-open | 9 |
| tense | 3 |
| open | 3 |
| locked | 2 |

**Core structural DNA:** fianchetto on g2 + Nc3, semi-open center, delayed d3/d4 push. No consistently common open or half-open files across the tree.

---

## Congruence Results

6/17 leaves flagged. All type `weakness_inconsistency`, all severity `medium`. Single root cause: the `...Nxc3 bxc3` exchange leaves White with doubled/isolated c-pawns. Appears in 6 lines:

| Line | Exchange trigger |
|------|-----------------|
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 Rb8 Qc2 O-O d4 h6 O-O` | `...Nxc3 bxc3` (main) |
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 e4 Nd4 Nxd4 cxd4 Qe7 Rb3` | `...Nxc3 bxc3` + `...e4 cxd4` sub-line |
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 e4 Qa4+ Nc6 Qxe4+ Qe7 Qxe7+` | `...Nxc3 bxc3` blunder line (7...e4??) |
| `1.c4 e5 Nc3 Nf6 g3 Bb4 Bg2 O-O e4 Bxc3 bxc3 c6 Ne2 d5 cxd5 cxd5 exd5 Nxd5 O-O Nc6` | `...Bxc3 bxc3` (Bb4 sideline) |
| `1.c4 c5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Nc6 Nf3 e5 d3 Be7 O-O O-O Rb1 Qc7` | `...Nxc3 bxc3` (1...c5) |
| `1.c4 b6 Nc3 Bb7 d4 Nf6 Qc2 d5 cxd5 Nxd5 e4 Nxc3 bxc3 e6 Nf3 Be7 Bf4 O-O Bd3` | `...Nxc3 bxc3` (b6 line) |

**This is intentional, not a defect.** White invites the exchange to open the b-file (Rb1), gain the bishop pair, and get positional compensation. The structural classifier flags statistical inconsistency against the "clean" lines, but the plan is coherent across all 6. You need one template for managing c3/c4 doubled pawns — it covers all of them.

**Plans to know in bxc3 positions:**
- `Rb1` pressure on b-file immediately
- `c4` push to activate/free the c3 pawn when appropriate
- Bishop pair vs. knight pair imbalance — keep bishops active, avoid trades on c3 again

---

## Soundness Checks (Engine, depth 18)

### Main leaf — after `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 Rb8 Qc2 O-O d4 h6 O-O`

**FEN:** `1rbq1rk1/ppp2pp1/2nb3p/4p3/3P4/2P2NP1/P1Q1PPBP/1RB2RK1 b - - 1 11`

**Eval: +25 cp** (White, small healthy edge). Position primitives: tense center, c3-d4 pawn chain, a2 isolated (bxc3 artifact), b-file half-open.

| Black candidate | Eval (cp, white-POV) | Engine line |
|-----------------|----------------------|-------------|
| Re8 | +25 | Re8 Rd1 Qf6 e4 b6 |
| Qe8 | +28 | Qe8 e4 b6 Rd1 Bg4 |
| b6 | +29 | b6 Nh4 Bd7 Bb2 Na5 |

All Black tries leave White with a tiny persistent edge. Position is sound and on-plan.

### b6-line leaf — after `1.c4 b6 Nc3 Bb7 d4 Nf6 Qc2 d5 cxd5 Nxd5 e4 Nxc3 bxc3 e6 Nf3 Be7 Bf4 O-O Bd3`

**FEN:** `rn1q1rk1/pbp1bppp/1p2p3/8/3PPB2/2PB1N2/P1Q2PPP/R3K2R b KQ - 5 10`

**Eval: +70 cp** — best result in the repertoire. White hasn't castled yet (KQ rights available); O-O is next.

| Black candidate | Eval (cp, white-POV) | Engine line |
|-----------------|----------------------|-------------|
| Nd7 | +70 | Nd7 Rd1 Rc8 e5 g6 |
| c5 | +71 | c5 d5 exd5 exd5 h6 |
| Ba6 | +76 | Ba6 Bxa6 Nxa6 O-O c5 |

Black is passive; all tries keep White clearly better. The d4-Bf4-Bd3 setup punishes 1...b6 consistently.

---

## Gaps and Structural Observations

### Gap 1: `1...Nc6 2.Nc3` is a stub

The line `1.c4 Nc6 2.Nc3 e5` transposes to the main 1...e5 position. But if Black plays anything other than `2...e5` (e.g. `2...Nf6`, `2...d6`, `2...g6`), the repertoire has no answer. This is an open hole.

**Minimum coverage needed:**
- `2...Nf6` — likely `3.g3` into fianchetto
- `2...g6` — likely `3.g3 Bg7 4.Bg2` into Kings Indian-style

### Gap 2: Two distinct White setups coexist

The repertoire splits into two islands that require different middlegame knowledge:

| Setup | Lines |
|-------|-------|
| **Fianchetto** (g3/Bg2/Nge2 or Nf3) | 1...Nf6, 1...c5, 1...Nc6, 1...e5 main |
| **d4-based** (d4/Nf3/Be2 or d4/Qc2/Bf4/Bd3) | 2...c6 (after 1.c4 e5 2.Nc3), 1...b6 |

The `2...c6` line after `1.c4 e5 2.Nc3` answers `3.Nf3 d6 4.d4` — **Be2, not Bg2** — an entirely different development scheme. PGN evals here are very high (+78–112 cp, likely reflecting Black's passive setup), but this line demands fluency in a different middlegame. Consider whether `3.g3` transposing into the fianchetto system is acceptable, which would unify the two islands.

### Gap 3: `bxc3` positions need shared plan anchor

The 6 flagged lines all reach structurally similar positions (doubled c-pawns, b-file half-open, bishop pair) but are encoded as independent lines. No explicit transposition or plan note connects them. If you extend this repertoire in the MCP, these positions are candidates for `get_transpositions` to detect overlap and reduce redundant coverage.

---

## MCP / Codebase Retro Notes

These findings surface limitations and opportunities relevant to the tool's design:

1. **Structural classifier coverage** — 16/17 leaves returning `unknown` at confidence 0.0 is expected given the English Opening's fluid structure, but it severely limits the utility of `get_structural_profile` aggregate view for hypermodern 1.c4 repertoires. The classifier's known schemas (IQP, Carlsbad, Maroczy) are predominantly 1.d4/1.e4 derived. Worth tracking as a known gap: `structure_class: "unknown"` is not actionable for users who play the English.

2. **Congruence checker and intentional weakness** — all 6 `weakness_inconsistency` flags describe a deliberate positional choice (bxc3 bishop pair compensation). The checker cannot distinguish between "weakness accepted accidentally" and "weakness accepted knowingly as part of a system." A `severity: "low"` tier or a way to mark lines as "weakness acknowledged" would reduce noise.

3. **`suggest_complementary_lines` not yet run** — skipped because the main actionable gaps (1...Nc6 stub, 2...c6 island) are better addressed by extending existing lines manually first. Once those stubs are filled, `mode="low_memorization"` against the Maroczy leaf would be the next run.

4. **Transposition detection opportunity** — the 6 bxc3 lines likely share mid-game FENs. `get_transpositions` against those FENs could confirm overlap and flag redundant encoding in the PGN tree.
