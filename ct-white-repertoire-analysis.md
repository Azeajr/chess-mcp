# White Repertoire Analysis — English Opening

**Source:** `ct-white-repertoire.pgn` (Chesstempo export, 2026-06-03)

| Run | Date | MCP version |
|-----|------|-------------|
| v2 (current) | 2026-06-04 | chess-mcp 0.1.8 |
| v1 | 2026-06-04 | chess-mcp 0.1.7 |

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
4. **Transposition detection** — bxc3 lines likely share mid-game FENs; `get_transpositions` can confirm and reduce redundant encoding.

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
