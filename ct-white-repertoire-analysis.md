# White Repertoire Analysis — English Opening

**Source:** `ct-white-repertoire.pgn` (Chesstempo export, 2026-06-03)

| Run | Date | MCP version |
|-----|------|-------------|
| v3 (current) | 2026-06-05 | chess-mcp 0.1.8 |
| v2 | 2026-06-04 | chess-mcp 0.1.8 |
| v1 | 2026-06-04 | chess-mcp 0.1.7 |

---

## v3 — 2026-06-05 — chess-mcp 0.1.8

**Tools:** `validate_pgn` → `load_repertoire` → `get_transpositions` → `get_structural_profile` → `analyze_repertoire_congruence` → `find_repertoire_gaps` → `evaluate_position`

### Tree Stats

Unchanged from v2.

| Metric | Value |
|--------|-------|
| Nodes | 213 |
| Leaves (distinct lines) | 17 |
| Max depth (plies) | 21 |
| Color | White |

### Structural Identity

Unchanged from v2.

| Structure | Leaves | Avg confidence |
|-----------|--------|----------------|
| unknown | 12 | 0.00 |
| Grünfeld Centre | 2 | 0.74 |
| Hanging pawns | 1 | 0.80 |
| Lopez | 1 | 0.68 |
| Maroczy | 1 | 0.70 |

Theme tags unchanged (fianchetto_white 13/17, double_fianchetto 6/17, etc.). Center distribution unchanged (semi-open 9, tense 3, open 3, locked 2).

### Congruence Results

Unchanged from v2. 6/17 leaves flagged, all `weakness_inconsistency / medium`, all bxc3 lines. Still intentional — bishop pair + b-file compensation plan.

### Soundness Checks (depth 20)

**Main bxc3 leaf** — FEN: `1rbq1rk1/ppp2pp1/2nb3p/4p3/3P4/2P2NP1/P1Q1PPBP/1RB2RK1 b - - 1 11`

| Black candidate | Eval (white-POV cp) | Engine line |
|-----------------|---------------------|-------------|
| Re8 | +21 | Re8 Rd1 b6 Ng5 hxg5 |
| Qe8 | +24 | Qe8 Rd1 b6 Nh4 Ne7 |
| b6 | +35 | b6 Nh4 Bd7 Bb2 b5 |

Stable vs v2. Small persistent White edge.

**Maroczy/KID bind leaf** — FEN: `r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2N3P1/PP1PNPBP/R1BQ1RK1 w - - 4 8`

| White candidate | Eval (white-POV cp) | Engine line |
|-----------------|---------------------|-------------|
| a3 | +4 | a3 Rb8 Rb1 a6 b4 |
| Rb1 | +3 | Rb1 Ne8 a3 a5 d3 |
| d3 | +1 | d3 a6 Rb1 Rb8 a3 |

Stable vs v2. Essentially equal; a3/b4 expansion is the plan.

### Transpositions (pre-flight)

3 transpositions confirmed — identical to v2:

| Convergence FEN (abbrev) | Paths |
|--------------------------|-------|
| Maroczy/KID bind after 7...O-O | `1...Nf6` deep · `1...c5 g6...Nf6 O-O` · `1...c5 Nf6...Nc6 O-O d6` |
| After `1.c4 e5 2.Nc3` | `1...e5 Nc3 Nc6` · `1...Nc6 Nc3 e5` |
| After `4.Bg2` in 1...c5 Nc6/g6 split | `2...g6...Nc6` · `2...Nc6...g6` |

### Gaps (`find_repertoire_gaps` — first run this loop)

**232 total gaps, 20 high-severity listed.** Most are move-order variants in the KID/Maroczy complex that are structurally covered by transpositions but not in the PGN. Two survive transposition cross-check as actionable:

**Gap A — 5...c5 in the KID setup (high, evaluated)**

Path: `1.c4 Nf6 2.Nc3 g6 3.g3 Bg7 4.Bg2 O-O 5.e4`  
Uncovered: `c5` | Gap tool eval: −8 cp

FEN at gap: `rnbq1rk1/ppppppbp/5np1/8/2P1P3/2N3P1/PP1P1PBP/R1BQK1NR b KQ - 0 5`

Engine evaluation (depth 20, Black to move):

| Black move | Eval (white-POV) | Engine line |
|------------|-----------------|-------------|
| **c5** | **−8** | c5 Nge2 Nc6 O-O d6 |
| d6 (covered) | +8 | d6 d4 c5 Nge2 cxd4 |
| e5 | +26 | e5 d3 c5 Nge2 Nc6 |

**c5 is the engine's top choice.** After `c5 Nge2 Nc6 O-O d6` the position reaches transposition 1's FEN (same as the covered `d6 Nge2 c5 O-O Nc6` path). The gap is a missing move-order annotation in the PGN, not a new structural problem. Fix: add `5...c5 6.Nge2` as a transposition redirect in the PGN.

**Gap B — 7...h5 in the Maroczy complex (high, evaluated)**

Path: `1.c4 c5 2.Nc3 g6 3.g3 Bg7 4.Bg2 Nc6 5.e4 d6 6.Nge2 Nf6 7.O-O`  
Uncovered: `h5` | Gap tool eval: −8 cp (depth 18)

FEN at gap: `r1bqk2r/pp2ppbp/2np1np1/2p5/2P1P3/2N3P1/PP1PNPBP/R1BQ1RK1 b kq - 3 7`

Engine evaluation (depth 20, Black to move):

| Black move | Eval (white-POV) | Engine line |
|------------|-----------------|-------------|
| **h5** | **−34** | h5 d4 cxd4 Nxd4 Nd7 |
| O-O (covered) | −10 | O-O Rb1 Ne8 a3 a5 |
| Bg4 | −2 | Bg4 d3 O-O Rb1 Rb8 |

**h5 is the engine's top choice at −34 cp** (significant Black edge). Does NOT transpose to any covered node — d4/cxd4/Nxd4 is a different structural direction. This is a genuine coverage hole requiring new lines. Note: gap tool eval (−8) differs substantially from depth-20 eval (−34) — see MCP Retro Notes.

**Note on gap volume:** 232 total gaps is inflated because `find_repertoire_gaps` does not cross-reference `get_transpositions` output (see Issue #3). After manual transposition cross-check: most of the 20 listed high-severity gaps are move-order variants reaching covered transposition endpoints. Gap A (c5) is one such case. Gap B (h5) is the only confirmed genuinely uncovered line.

### MCP Retro Notes (v3)

1. **`find_repertoire_gaps` first run** — tool works. 232 gaps is high but expected for a transposition-heavy KID/Maroczy complex with a sparse PGN. Manually filtering to 2 actionable items.

2. **Gap tool eval discrepancy** — for Gap B (h5 after 7.O-O), the gap tool reports −8 cp (depth 18) while `evaluate_position` at depth 20 finds −34 cp. A 26 cp difference changes severity assessment. The gap tool's depth-18 eval may not see far enough into the positional h5 pawn storm plan. `evaluate_position` follow-up at depth 20 is now confirmed necessary for any gap flagged within ±15 cp of even.

3. **Be2 island still present** — recommended replacement (`2...c6 3.g3` fianchetto line) from v2 not yet applied to `ct-white-repertoire.pgn`. PGN update pending.

4. **Gap A resolves via transposition** — `5...c5 6.Nge2 Nc6 7.O-O d6` reaches transposition 1's FEN. The PGN just needs a move-order redirect annotation, not new structural preparation.

5. **`suggest_complementary_lines` still deferred** — skipped again; PGN not updated since v2, so Maroczy leaf isn't the clean anchor it needs to be. Next run: update PGN first (Be2 island + c5 transposition redirect), then run `mode="low_memorization"` against Maroczy leaf.

---

## v2 — 2026-06-04 — chess-mcp 0.1.8

**Tools:** `validate_pgn` → `load_repertoire` → `get_structural_profile` → `analyze_repertoire_congruence` → `evaluate_position`

### Tree Stats

| Metric | Value |
|--------|-------|
| Nodes | 213 |
| Leaves (distinct lines) | 17 |
| Max depth (plies) | 21 |
| Color | White |

### Structural Identity

**Named structures (aggregate):**

| Structure | Leaves | Avg confidence |
|-----------|--------|----------------|
| unknown | 12 | 0.00 |
| Grünfeld Centre | 2 | 0.74 |
| Hanging pawns | 1 | 0.80 |
| Lopez | 1 | 0.68 |
| Maroczy | 1 | 0.70 |

12/17 leaves return `unknown` — expected for English Opening. Theme tags carry the real signal.

**Theme tags across all 17 leaves:**

| Theme | Leaf count |
|-------|-----------|
| `fianchetto_white` | 13 |
| `fianchetto_black` | 8 |
| `double_fianchetto` | 6 |
| `color_complex:light` | 6 |
| `minority_attack_black` | 4 |
| `minority_attack_white` | 2 |
| `flank_vs_center` | 2 |
| `wing_majority_white:kingside` | 3 |
| `avg_space_white` | 1.3 |
| `avg_space_black` | 0.8 |

**Core DNA:** Nc3/g3/Bg2 fianchetto, semi-open center, delayed d3/d4, Bg2 as light-square anchor.

**Center distribution:**

| Center type | Leaves |
|-------------|--------|
| semi-open | 9 |
| tense | 3 |
| open | 3 |
| locked | 2 |

### Congruence Results

6/17 leaves flagged. All `weakness_inconsistency / medium`. Single root cause: `...Nxc3 bxc3` exchange — White accepts doubled/isolated c-pawns for bishop pair + b-file activity.

| Line | Exchange trigger |
|------|-----------------|
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 Rb8 Qc2 O-O d4 h6 O-O` | `...Nxc3 bxc3` (main) |
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 e4 Nd4 Nxd4 cxd4 Qe7 Rb3` | `...Nxc3 bxc3` + `...e4 cxd4` |
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 e4 Qa4+ Nc6 Qxe4+ Qe7 Qxe7+` | `...Nxc3 bxc3` blunder line (7...e4??) |
| `1.c4 e5 Nc3 Nf6 g3 Bb4 Bg2 O-O e4 Bxc3 bxc3 c6 Ne2 d5 cxd5 cxd5 exd5 Nxd5 O-O Nc6` | `...Bxc3 bxc3` (Bb4 sideline) |
| `1.c4 c5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Nc6 Nf3 e5 d3 Be7 O-O O-O Rb1 Qc7` | `...Nxc3 bxc3` (1...c5) |
| `1.c4 b6 Nc3 Bb7 d4 Nf6 Qc2 d5 cxd5 Nxd5 e4 Nxc3 bxc3 e6 Nf3 Be7 Bf4 O-O Bd3` | `...Nxc3 bxc3` (b6 line) |

**Intentional, not a defect.** Plans to know: `Rb1` immediately, `c4` push when appropriate, preserve bishop pair.

### Soundness Checks (depth 20)

**Main leaf** — after `...d4 h6 O-O`  
FEN: `1rbq1rk1/ppp2pp1/2nb3p/4p3/3P4/2P2NP1/P1Q1PPBP/1RB2RK1 b - - 1 11`  
Structure: Grünfeld Centre (0.70), tense, b-file half-open

| Black candidate | Eval (white-POV cp) | Engine line |
|-----------------|---------------------|-------------|
| Re8 | +21 | Re8 Rd1 b6 Ng5 hxg5 |
| Qe8 | +24 | Qe8 Rd1 b6 Nh4 Ne7 |
| b6 | +35 | b6 Nh4 Bd7 Bb2 b5 |

Sound. Small persistent White edge.

**Maroczy / KID bind leaf** — after `...Nge2 Nf6 O-O O-O`  
FEN: `r1bq1rk1/pp2ppbp/2np1np1/2p5/2P1P3/2N3P1/PP1PNPBP/R1BQ1RK1 w - - 4 8`  
Structure: unknown (c4+e4 bind, double fianchetto, `space_white:2`), semi-open

| White candidate | Eval (white-POV cp) | Engine line |
|-----------------|---------------------|-------------|
| a3 | +4 | a3 Rb8 Rb1 a6 b4 |
| Rb1 | +3 | Rb1 Ne8 a3 a5 d3 |
| d3 | +1 | d3 a6 Rb1 Rb8 a3 |

Essentially equal at move 7-8. Engine plan: a3/b4 queenside expansion. **Depth gap — needs extension.**

### Gaps

**Gap 1: `1...Nc6 2.Nc3` stub**  
Only covers `2...e5` (transposes to main). `2...Nf6`, `2...g6`, etc. unanswered.

**Gap 2: Two distinct setups coexist**

| Setup | Lines |
|-------|-------|
| Fianchetto (g3/Bg2/Nge2 or Nf3) | 1...Nf6, 1...c5, 1...Nc6, 1...e5 main |
| d4-based (d4/Nf3/Be2 or d4/Qc2/Bf4/Bd3) | 2...c6 (after 1.c4 e5 2.Nc3), 1...b6 |

`2...c6` line uses Be2 not Bg2 — different middlegame island. Consider whether `3.g3` transposition unifies.

**Gap 3: Maroczy / KID bind depth**  
Ends at move 7-8. Needs ~8-10 more moves before usable in practice.

**Gap 4: bxc3 transposition detection**  
6 lines reach structurally similar positions but encoded independently. Run `get_transpositions` to detect overlap.

### MCP Retro Notes (0.1.8)

1. **Classifier coverage** — English Opening is underserved. `unknown` at 12/17 leaves; theme tags are the practical substitute.

2. **Congruence + intentional weakness** — all 6 flags are deliberate bxc3 bets. Checker can't distinguish intentional from accidental. A "weakness acknowledged" marker or `severity:low` tier would reduce noise.

3. **`suggest_complementary_lines` not run** — defer until Gap 1 and Gap 2 stubs are filled; then `mode="low_memorization"` against Maroczy leaf is next.

4. **Transposition blindness in leaf analysis** — `get_structural_profile` and the depth/gap assessment treat each leaf as an independent endpoint. They do not check whether a "short" leaf is already a transposition to a deeper node elsewhere in the tree. This caused an incorrect "depth gap" flag on the `1...c5 g6...O-O` leaf (ends at move 7) — it actually converges with the `1...Nf6` branch at the same FEN and is fully covered to move 10. A pre-flight `get_transpositions` call should be standard before flagging any leaf as shallow or uncovered. Tool implication: `get_structural_profile` (and any gap-detection logic) should cross-reference `get_transpositions` output before surfacing a leaf as a coverage hole.

5. **Congruence remediation needs full continuation, not a single move** — when `analyze_repertoire_congruence` flags an incongruent line, the natural follow-up is to find a replacement. `suggest_complementary_lines` returns candidate *moves* from an anchor FEN but does not: (a) anchor to the specific Black move the original line was answering, or (b) validate and show a full continuation from that replacement move. In this session, replacing the Be2 island required manually chaining `validate_line` → `evaluate_position` → `suggest_complementary_lines` → `validate_line` across 8 moves to produce a usable line. A `suggest_replacement_line(repertoire_id, outlier_variation_path, mode)` tool that returns a full validated continuation — not just a pivot move — would close this gap. The continuation must address the same Black move order and show White's plan to a practical depth.

---

### Follow-up Analysis (same session)

**Tools:** `get_transpositions` → `get_structural_profile` → `validate_line` → `evaluate_position` → `suggest_complementary_lines`

#### Gaps 1, 3, 4 revised — all resolved by transpositions

`get_transpositions` found 3 converging positions:

| FEN (abbreviated) | Paths |
|-------------------|-------|
| after move 7...O-O (Maroczy/KID bind) | `1...Nf6` deep line · `1...c5 g6...Nf6 O-O` · `1...c5 Nf6...Nc6 d6` |
| after `1.c4 e5 2.Nc3` | `1...e5 Nc3 Nc6` · `1...Nc6 Nc3 e5` |
| after `1.c4 c5 2.Nc3 g6 3.g3 Bg7 4.Bg2` | `2...g6...Nc6` · `2...Nc6...g6` |

**Corrected gap picture:**
- Gap 1 (`1...Nc6` stub) — **resolved**: transposes directly to `1...e5 2.Nc3 Nc6` main line.
- Gap 3 (Maroczy "shallow" leaf) — **resolved**: transposes to the `1...Nf6` branch which continues to 10.Be3. Not shallow at all.
- Gap 4 (bxc3 transposition detection) — **resolved**: confirmed. The 6 bxc3 lines share one structural identity; no redundant FEN overlap found at mid-game depth, but move-order overlap is confirmed at the convergence points above.

**The repertoire has no real coverage holes in the lines it covers.** Every apparent short leaf is a transposition endpoint.

#### The only genuine issue: 2...c6 Be2 island

`1.c4 e5 2.Nc3 c6 3.Nf3 d6 4.d4 Nd7 5.e4 Ngf6 6.Be2` structural profile:
- `fianchetto_white: false` — **only leaf in the entire repertoire without Bg2**
- `space_white: 3`, no fianchetto, d4+c4+e4 center — different setup, different middlegame
- Apparent eval advantage (+78–112 cp per PGN comments) reflects Black's passive play, not the line quality

Investigated whether `3.g3` instead of `3.Nf3` could transpose into existing fianchetto lines: **it cannot**. After `3.g3 Nf6 4.Bg2 d5 5.cxd5 Nxd5 6.Nf3 Nxc3 7.bxc3 Bd6`, Black's c-pawn is still on c6 (never captured). The main reversed-Grünfeld requires Black's c-pawn on c7 so that ...Nc6 is available as a key development move. With c6 on the board, ...Nc6 is permanently blocked — the positions structurally diverge and the FENs never converge.

#### Recommended replacement line

Replace the Be2 island with a fianchetto line that uses the same structural knowledge already in the repertoire:

```
1.c4  e5
2.Nc3 c6
3.g3  Nf6
4.Bg2 d5
5.cxd5 Nxd5
6.Nf3  Nxc3
7.bxc3 Bd6
8.d4   Nd7   (+58 cp)
9.O-O  O-O
10.a4  ...    (+50 cp)
```

Black's best at move 10: Re8 (+50) → Qc2 Qe7 e4 exd4. White plan: Qc2 + e4 central push.

**Why it fits:**
- Bg2 fianchetto — same as 13/17 other leaves
- `bxc3` after Nxc3 — same structural bet as 6 other lines; no new positional knowledge
- d4 + a4/Qc2 queenside plan — mirrors b4 expansion in other lines
- Better eval than the original Be2 line at equivalent depth

**Action required:** replace the `2...c6` variation in `ct-white-repertoire.pgn` with this line.

---

## v1 — 2026-06-04 — chess-mcp 0.1.7

**Tools:** `load_repertoire` → `get_structural_profile` → `analyze_repertoire_congruence` → `evaluate_position`

### Tree Stats

| Metric | Value |
|--------|-------|
| Nodes | 213 |
| Leaves (distinct lines) | 17 |
| Max depth (plies) | 21 |
| Color | White |

### Structural Identity

Classifier returns `unknown` for 16/17 leaves (confidence 0.0). Expected — English Opening positions rarely map cleanly to the IQP/Carlsbad/Maroczy schemas the classifier knows. One Maroczy leaf (confidence 0.7, the 1...c5 fianchetto branch).

**Center distribution:**

| Center type | Leaves |
|-------------|--------|
| semi-open | 9 |
| tense | 3 |
| open | 3 |
| locked | 2 |

**Core structural DNA:** fianchetto on g2 + Nc3, semi-open center, delayed d3/d4 push. No consistently common open or half-open files across the tree.

### Congruence Results

6/17 leaves flagged. All type `weakness_inconsistency`, all severity `medium`. Single root cause: the `...Nxc3 bxc3` exchange leaves White with doubled/isolated c-pawns. Appears in 6 lines:

| Line | Exchange trigger |
|------|-----------------|
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 Rb8 Qc2 O-O d4 h6 O-O` | `...Nxc3 bxc3` (main) |
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 e4 Nd4 Nxd4 cxd4 Qe7 Rb3` | `...Nxc3 bxc3` + `...e4 cxd4` sub-line |
| `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 e4 Qa4+ Nc6 Qxe4+ Qe7 Qxe7+` | `...Nxc3 bxc3` blunder line (7...e4??) |
| `1.c4 e5 Nc3 Nf6 g3 Bb4 Bg2 O-O e4 Bxc3 bxc3 c6 Ne2 d5 cxd5 cxd5 exd5 Nxd5 O-O Nc6` | `...Bxc3 bxc3` (Bb4 sideline) |
| `1.c4 c5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Nc6 Nf3 e5 d3 Be7 O-O O-O Rb1 Qc7` | `...Nxc3 bxc3` (1...c5) |
| `1.c4 b6 Nc3 Bb7 d4 Nf6 Qc2 d5 cxd5 Nxd5 e4 Nxc3 bxc3 e6 Nf3 Be7 Bf4 O-O Bd3` | `...Nxc3 bxc3` (b6 line) |

**This is intentional, not a defect.** White invites the exchange to open the b-file (Rb1), gain the bishop pair, and get positional compensation.

**Plans to know in bxc3 positions:**
- `Rb1` pressure on b-file immediately
- `c4` push to activate/free the c3 pawn when appropriate
- Bishop pair vs. knight pair imbalance — keep bishops active, avoid trades on c3 again

### Soundness Checks (depth 18)

**Main leaf** — after `1.c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nxc3 bxc3 Bd6 Nf3 Nc6 Rb1 Rb8 Qc2 O-O d4 h6 O-O`  
FEN: `1rbq1rk1/ppp2pp1/2nb3p/4p3/3P4/2P2NP1/P1Q1PPBP/1RB2RK1 b - - 1 11`  
Eval: **+25 cp**. Position primitives: tense center, c3-d4 pawn chain, a2 isolated, b-file half-open.

| Black candidate | Eval (cp, white-POV) | Engine line |
|-----------------|----------------------|-------------|
| Re8 | +25 | Re8 Rd1 Qf6 e4 b6 |
| Qe8 | +28 | Qe8 e4 b6 Rd1 Bg4 |
| b6 | +29 | b6 Nh4 Bd7 Bb2 Na5 |

**b6-line leaf** — after `1.c4 b6 Nc3 Bb7 d4 Nf6 Qc2 d5 cxd5 Nxd5 e4 Nxc3 bxc3 e6 Nf3 Be7 Bf4 O-O Bd3`  
FEN: `rn1q1rk1/pbp1bppp/1p2p3/8/3PPB2/2PB1N2/P1Q2PPP/R3K2R b KQ - 5 10`  
Eval: **+70 cp** — best result in the repertoire. White hasn't castled yet; O-O is next.

| Black candidate | Eval (cp, white-POV) | Engine line |
|-----------------|----------------------|-------------|
| Nd7 | +70 | Nd7 Rd1 Rc8 e5 g6 |
| c5 | +71 | c5 d5 exd5 exd5 h6 |
| Ba6 | +76 | Ba6 Bxa6 Nxa6 O-O c5 |

### Gaps

**Gap 1: `1...Nc6 2.Nc3` is a stub**  
Only `2...e5` covered (transposes to main). `2...Nf6`, `2...g6` unanswered.

**Gap 2: Two distinct White setups coexist**

| Setup | Lines |
|-------|-------|
| Fianchetto (g3/Bg2/Nge2 or Nf3) | 1...Nf6, 1...c5, 1...Nc6, 1...e5 main |
| d4-based (d4/Nf3/Be2 or d4/Qc2/Bf4/Bd3) | 2...c6 (after 1.c4 e5 2.Nc3), 1...b6 |

**Gap 3: `bxc3` transposition detection**  
6 lines likely share mid-game FENs. `get_transpositions` would confirm and reduce redundant encoding.

### MCP Retro Notes (0.1.7)

1. **Structural classifier coverage** — 16/17 leaves `unknown` at confidence 0.0. Classifier schemas are predominantly 1.d4/1.e4 derived; hypermodern 1.c4 is a known gap.
2. **Congruence checker and intentional weakness** — all 6 flags describe deliberate bxc3 compensation. Checker can't distinguish intentional from accidental; a `severity:low` tier or "weakness acknowledged" marker would reduce noise.
3. **`suggest_complementary_lines` not run** — defer until stubs filled; then `mode="low_memorization"` against Maroczy leaf.
4. **Transposition detection opportunity** — bxc3 lines are candidates for `get_transpositions`.
