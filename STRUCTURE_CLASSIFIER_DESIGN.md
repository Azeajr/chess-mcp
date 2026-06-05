# Structure Classifier — Design Spec

Design for extending `server/structure.py` from a narrow 9-structure pawn matcher to
near-exhaustive canonical coverage, with graduated confidence and a primitive-derived
backstop that never returns empty.

Status: **proposed** (not yet built). This doc is the contract. Implementation follows it;
if reality forces a change, change this doc in the same commit. Companion docs:
`MCP_DESIGN.md` (server-wide principles), `REPERTOIRE_DESIGN.md` §6 (where `classify_structure`
originates), `GROUNDING_DESIGN.md` (no-guess contract — every label must be defensible).

---

## 1. Background — the gap

`classify_structure` (`server/structure.py:226`) ships a deliberately narrow set — IQP,
Carlsbad, Maroczy, French, Stonewall, King's Indian, Benoni, Closed Sicilian — via exact
pawn-square subset matching with hardcoded confidence constants, and an explicit
`{"unknown", 0.0}` fallback. Decision **D2** (`structure.py:9`) governs: *a false structure
label misleads an LLM more than "unknown" does.* The narrowness is intentional and must be
preserved as a value, not eroded.

Two failure modes surfaced during a real English-Opening repertoire analysis
(`ct-white-repertoire-analysis.md`):

1. **Coverage hole.** 16 / 17 leaves returned `unknown / 0.0`. The known schemas are
   1.d4 / 1.e4-derived; hypermodern / flank structures (English, Hedgehog, KIA, Catalan,
   symmetric) map to nothing. `get_structural_profile`'s aggregate view is near-useless for
   1.c4 repertoires.
2. **Brittleness.** Exact subset matching breaks on transposition/tempo differences (a pawn
   on c3 vs c4) even when the structure is identical. One missing pawn → `0.0`, same score as
   a wholly unrelated position. No partial-match tier.

A category error also lives in the framing: **"English" is an opening, not a structure.**
The English transposes into many *structures* (Hedgehog, reversed Sicilian, symmetric,
Maroczy, Botvinnik). The opening axis is owned by the existing `identify_opening` tool. This
doc keeps the structure classifier naming *structures*, never opening families.

---

## 2. The three-part change (A + B + C)

Ordered by dependency: **B before C** (C-exhaustive only works riding on B's graduated
confidence), **A independent** (additive backstop, no regression risk).

### A — Theme tags from primitives (backstop, never `unknown`)

`position_profile` (`structure.py:300`) already returns a rich primitive set
(doubled / isolated / passed / chains / half-open / open-files / center-state) on *every*
call. Add an always-computed `themes` descriptor block derived from those primitives plus a
few cheap piece checks. Theme tags are *descriptive*, not name-guesses, so they respect D2 by
construction — they cannot be "wrong" the way a misapplied archetype name can.

Proposed `themes` fields:

| Field | Type | Derivation |
|-------|------|------------|
| `fianchetto` | `{white: bool, black: bool}` | bishop on g2/b2 (W) or g7/b7 (B) |
| `space` | `{white: int, black: int}` | count of own pawns on ranks 4–6 (W) / 3–5 (B) |
| `flank_vs_center` | `bool` | one side's pawns mass on a flank vs other's center |
| `minority_attack` | `{white: bool, black: bool}` | pawn-minority on a half-open wing facing a majority |
| `wing_majority` | `{white: "queenside" \| "kingside" \| null, black: ...}` | which wing each side holds a pawn majority on (captures the 3-3 vs 4-2 / competing-majorities concept without a brittle named scorer) |
| `color_complex` | `"light" \| "dark" \| null` | weakened-square-complex heuristic from pawn colors |

These are emitted unconditionally and are orthogonal to `structure_class`. When the canon
matcher returns `unknown`, `themes` still carries actionable signal (the English fianchetto
leaves become *informative* without a brittle label).

### B — Graduated, fit-based confidence (replaces hardcoded constants)

Replace exact subset matching with a **core + bonus** model per scorer:

- **Core squares** — a hard gate. Absent → scorer returns `0.0` (this preserves D2: no core,
  no label).
- **Bonus squares** — graduated. Each present bonus square adds to confidence above a base
  floor, capped per structure.
- **Specificity = confidence.** A structure that specifies more pawns (Hedgehog: 4 Black
  pawns) must out-score its generic parent (Maroczy: 2 pawns) when both fire. Confidence is
  computed from how many of the structure's defining squares are matched, weighted by how
  constrained the structure is — not assigned by hand.

Concretely, each scorer declares `(core: set, bonus: set, base: float, cap: float)` and
confidence = `base + step * |bonus ∩ position|`, clamped to `cap`, gated on `core ⊆ position`.
This single change repairs brittleness across *all* scorers at once and makes
`max(candidates)` a meaningful tiebreak rather than a constant lottery.

**Implemented as the `_graded(core_ok, bonus_present, *, base, cap, step)` helper.** Scope
note: B applied core+bonus to the 5 previously-inline matchers (French, Stonewall, KID,
Benoni, Closed Sicilian) — the brittle ones, exact-set-matched. The 3 standalone private
scorers (IQP, Carlsbad, Maroczy) were already hard-gated and rank/half-open-graduated, so
they were left intact rather than churned for no behavioural gain. Closed Sicilian is now
bidirectional (the Black side is the reversed-English Grand Prix).

### C — Near-exhaustive canon (the structure set)

Implement the recognized middlegame canon (§4). 10 additions on top of the existing 8,
each as a private `_<name>_confidence(board)` scorer (the existing single-source-of-truth
pattern, `structure.py:173-176`), wired into `classify_structure`'s candidate loop. Family-2
(Sicilian) and Closed-Sicilian scorers run bidirectionally, so English structures are covered
with no extra scorers (§4 bidirectional note).

**Exhaustiveness is bounded, not absolute.** The canon is a finite, literature-attested set
(18 structures, every row TOC-traced to Flores Rios / Soltis, §4). It does not cover every
possible position — transitional / amorphous positions exist. Those fall through to A.
C-exhaustive + A-backstop = honest full coverage; C alone merely relocates the `unknown` cliff.

---

## 3. Collision & precedence model

With ~18 scorers (some bidirectional), many positions match 2–3 candidates (Hedgehog ∩
Maroczy ∩ Scheveningen all share c4/e4; Symmetric ∩ Asymmetric Benoni; Nimzo-Grünfeld ∩
Carlsbad both have doubled/half-open c-play). The resolution rule:

1. **Specificity ordering via confidence (B).** The more-constrained structure scores higher
   because it matches more defining squares. Hedgehog (4 pawns) beats Maroczy (2) when both
   gate true. No manual priority list — it falls out of B's fit-based scoring.
2. **`max(confidence)` stays the selector** (`structure.py:296`), now meaningful.
3. **Ties (equal confidence)** → break by specificity count (number of core squares), then
   lexical name for determinism. Document the tie table in tests.

This is why **B is a hard prerequisite for C**: without graduated confidence, an exhaustive
canon collides into noise.

---

## 4. The structure canon (the contract list)

Source canon: Flores Rios, *Chess Structures: A Grandmaster Guide* (2015) — 28 structures in
5 families + Various; Soltis, *Pawn Structure Chess* (1976/2013) — 12 formation chapters.
**Every row below is traced to a named chapter in one or both books** (TOC cross-check
complete — D-STRUCT-1, §8). Status column: ✅ exists in code, ➕ to add. Skeletons are the
*defining* pawns; scorers gate on core and grade on bonus per B.

Families follow Flores Rios. Each row cites its source chapter so no scorer ships on an
unattested skeleton.

**Family 1 — d4 / …d5 (Queen's-pawn)**
| Structure | Defining skeleton | Source | Status |
|-----------|-------------------|--------|--------|
| Isolani (IQP) | lone d-pawn, no c/e, opp no d-pawn | Flores ch1 | ✅ |
| Hanging pawns | c+d duo, no b/e pawns; b & e half-open | Flores ch2 | ➕ |
| Caro-Kann Formation | d4+e5 vs c6/d5, Black LSB *outside* the chain | Flores ch3 | ➕ |
| Slav Formation | d4+c-pawn vs d5+c6 triangle | Flores ch4 / Soltis ch2 | ➕ |
| Carlsbad | d4/d5, White half-open c, Black no e-pawn | Flores ch5 | ✅ |
| Stonewall | d4/e3/f4 (W) or d5/e6/f5 (B) | Flores ch6 / Soltis ch9 | ✅ |
| Grünfeld Centre | core c3+d4 + half-open b (from …Nxc3 bxc3); bonus e4 phalanx | Flores ch7 | ➕ |

**Family 2 — Open Sicilian (scorers run BIDIRECTIONALLY — see note)**
| Structure | Defining skeleton | Source | Status |
|-----------|-------------------|--------|--------|
| Najdorf I / Boleslavsky | side has e4, no d-pawn; opp d6+**e5**, no c-pawn (d5 hole, backward d6) | Flores ch8 | ➕ |
| Scheveningen / Najdorf II | side has e4, no d-pawn; opp d6+**e6** small centre (Najdorf II = same pawns) | Flores ch9, ch22 | ➕ |
| Hedgehog | a6/b6/d6/e6 6th-rank wall vs c4+e4 | Flores ch10 | ➕ |
| Maroczy bind | c4+e4, no d-pawn; opp d6, no c-pawn | Flores ch11 | ✅ |

> **Provenance merge (verified §8):** Najdorf Type II and Scheveningen reach the *identical*
> pawn skeleton (e4 vs d6/e6); the difference is move-order/piece placement, invisible to a
> pawn classifier → **one scorer**. Najdorf Type I is the Boleslavsky-hole structure (d6/e5,
> d5 hole). Hedgehog (4 Black pawns) outscores Maroczy (2) via B specificity when both fire.

**Family 3 — Benoni**
| Structure | Defining skeleton | Source | Status |
|-----------|-------------------|--------|--------|
| Asymmetric Benoni | d5+e4 vs c5+d6, e-file half-open (no opp e-pawn) | Flores ch12 | ✅ |
| Symmetric Benoni | d5+e4 vs c5+d6+**e5** (fully locked) | Flores ch13 | ➕ |

**Family 4 — King's Indian**
| Structure | Defining skeleton | Source | Status |
|-----------|-------------------|--------|--------|
| KID chain | c4/d5/e4 vs d6/e5/g6 locked chain | Flores ch14–18 / Soltis ch6 | ✅ |

> Flores splits KID into 5 sub-types (I/II/III, Open, Complex) by *piece* placement. Per
> D-STRUCT-3 the pawn classifier keeps ONE coarse `KID chain`; sub-type distinctions belong to
> `themes` (A) / `identify_opening`.

**Family 5 — French**
| Structure | Defining skeleton | Source | Status |
|-----------|-------------------|--------|--------|
| French chain | d4+e5 vs d5+e6 locked chain | Flores ch19–21 / Soltis ch4–5 | ✅ |

**Various / closed (Flores ch22, Soltis ch10–12)**
| Structure | Defining skeleton | Source | Status |
|-----------|-------------------|--------|--------|
| Closed Sicilian / Grand Prix | e4/d3/f4 vs c5/d6 | Soltis ch12 | ✅ |
| Lopez Formation | e4+d3 vs e5+d6, closed Ruy centre | Flores ch22 / Soltis ch11 | ➕ |
| **Nimzo-Grünfeld Formation** | White **doubled** c-pawns c3+c4 + d4, half-open b (from Nimzo …Bxc3 bxc3 — knight stays) | Soltis ch10 | ➕ |
| Benko structure | White d5 + a2/b2; Black c5/d6, a & b half-open, down a pawn | Flores ch22 | ➕ |

**Bidirectional Sicilian note (closes the English coverage hole).** Soltis pairs
*"Open Sicilian/English"* (ch3) and *"Closed Sicilian/English"* (ch12): **English structures
ARE Sicilian structures with colors flipped.** The Family-2 and Closed-Sicilian scorers
therefore run for *both* colors (the `_iqp_confidence` two-color loop, `structure.py:253`, is
the precedent). This covers reversed-Sicilian, symmetric-English, and English-Maroczy with
**zero extra scorers** — and is the correct fix for the original English `unknown` hole, not a
new "English" label (which would be the opening≠structure category error, D2).

**Demoted to theme tags (A), NOT scorers** — opening *systems* or color-flips, no standalone
canon chapter. A misapplied name here is the exact D2 failure mode:

| Rejected as scorer | Why | Lands in |
|--------------------|-----|----------|
| Reversed Sicilian / Symmetric English | color-flip of Family 2 | bidirectional scorers above |
| Catalan | *opening*; structures resolve to Slav / hanging / Carlsbad | existing scorers |
| KIA, Botvinnik system | *opening systems*, not pawn structures | `themes` (fianchetto + space) |
| Mobile pawn duo / "ideal centre" | no named canon chapter | `themes` (space) |
| Dragon Formation | Flores ch22 but *piece*-defined (fianchetto) | `themes` (fianchetto) |
| 3-3 vs 4-2 structure | Flores ch22, but defined by *majority distribution* not squares; skeleton UNVERIFIED (§8) | `themes` (queenside/kingside majority) |
| Doubled-isolated pair | not a named structure | `themes` / primitives |

**Total: 8 existing scorers + 10 additions = 18 canonical structures** (Najdorf II merged into
Scheveningen, and 3-3 vs 4-2 demoted to a theme tag — both per the provenance pass; Family 2 +
Closed Sicilian each count once but run bidirectionally), plus the A backstop for everything
else.

---

## 5. Public-surface impact

- `position_profile` (`structure.py:300`) gains a `themes` block (A). Additive — existing
  fields unchanged. Nesting stays ≤ 2 levels (`MCP_DESIGN.md`).
- `classify_structure` return shape unchanged (`{structure_class, confidence}`); the *set* of
  possible `structure_class` values grows. Document the closed enum in the docstring.
- Tool consumers: `get_structural_profile` (`chess_mcp.py:757`), `compare_moves`
  (`chess_mcp.py:912`). Both read existing fields; `themes` is opt-in extra.
- No new MCP tools, no new error codes, no engine dependency. Pure `python-chess` bitboard
  work — fast, unit-testable without Stockfish.

---

## 6. Test strategy

Per `structure.py` convention (scorers are the tested private API, `test_structure_repertoire.py`):

1. **One canonical FEN per structure** — a textbook position that must classify correctly at
   confidence ≥ threshold. This doubles as the **anti-hallucination harness** (§ validation).
2. **Collision fixtures** — positions matching 2+ scorers; assert the specificity winner.
3. **Brittleness fixtures** — transposed/tempo-shifted variants of a core position; assert B
   keeps them classified (where exact matching previously failed).
4. **Negative fixtures** — near-miss positions that must stay `unknown` (D2 guard: no false
   labels).
5. **Theme-tag fixtures (A)** — assert `themes` populated on positions where `structure_class`
   is `unknown`.

---

## 7. Build order

1. ✅ **A (shipped, ce65940)** — `themes` block in `position_profile` + 13 tests. Independent;
   fixes the English "empty profile" complaint (grounded on the real bxc3 leaf).
2. ✅ **B (shipped)** — `_graded` core+bonus helper; the 5 brittle inline matchers extracted to
   graded private scorers; Closed Sicilian bidirectional. 6 new tests (brittleness, bidirectional,
   reversed-colour); zero regression on the 8 canonical FENs. IQP/Carlsbad/Maroczy left intact
   (already gated+graduated).
3. **C** — add the 10 new scorers on the B foundation; one canonical + one negative fixture
   each; collision fixtures for the known overlaps. **Grünfeld Centre first** — its core+bonus
   form (core c3+d4+half-open-b, bonus e4) closes the original analysis's bxc3 congruence gap
   (`ct-white-repertoire-analysis.md`), which is single-c. **Nimzo-Grünfeld is separate** —
   doubled c3+c4 from `…Bxc3 bxc3`; it does NOT match the English `…Nxc3 bxc3` single-c
   positions (provenance pass, §8 D-STRUCT-1).
4. Update `classify_structure` docstring enum; regen any evals snapshot.

---

## 8. Open decisions

- **D-STRUCT-1: canon source of record.** ✅ **TOC cross-check complete.** All §4 rows trace
  to a named Flores Rios / Soltis chapter; 8 candidates lacking a chapter were demoted to
  theme tags (§4). MCP-FEN provenance pass ✅ **complete** — one canonical FEN per ➕ survivor,
  generated by playing a cited model game through the MCP, skeleton confirmed, captured as the
  §6.1 fixture. Outcomes: 9 verified distinct; Najdorf II merged into Scheveningen; 3-3 vs 4-2
  deferred (skeleton unobtainable) → theme tag. No scorer ships until its FEN is verified; the
  one remaining unverified row (3-3 vs 4-2) ships nothing.

  **Provenance log (MCP-verified FENs):**

  | Structure | Model line | Canonical FEN | Skeleton confirmed |
  |-----------|-----------|---------------|--------------------|
  | Nimzo-Grünfeld | 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 4.e3 b6 5.a3 Bxc3 6.bxc3 | `rnbqk2r/p1pp1ppp/1p2pn2/8/2PP4/P1P1P3/5PPP/R1BQKBNR b KQkq - 0 6` | **doubled c3+c4** + d4, half-open b ✅ |
  | Grünfeld Centre | 1.d4 Nf6 2.c4 g6 3.Nc3 d5 4.cxd5 Nxd5 5.e4 Nxc3 6.bxc3 | `rnbqkb1r/ppp1pp1p/6p1/8/3PP3/2P5/P4PPP/R1BQKBNR b KQkq - 0 6` | single c3 + d4 + **e4** phalanx, half-open b ✅ |
  | Hedgehog | 1.c4 c5 2.Nf3 Nf6 3.d4 cxd4 4.Nxd4 e6 5.Nc3 d6 6.e4 a6 7.Be2 b6 | `rnbqkb1r/5ppp/pp1ppn2/8/2PNP3/2N5/PP2BPPP/R1BQK2R w KQkq - 0 8` | White c4+e4 no d; Black a6/b6/d6/e6 wall ✅ |
  | Najdorf Type I | 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Be2 e5 | `rnbqkb1r/1p3ppp/p2p1n2/4p3/3NP3/2N5/PPP1BPPP/R1BQK2R w KQkq - 0 7` | White e4 no d; Black d6+e5, d5 hole (= Boleslavsky) ✅ |
  | Najdorf Type II | 1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6 6.Be2 e6 | `rnbqkb1r/1p3ppp/p2ppn2/8/3NP3/2N5/PPP1BPPP/R1BQK2R w KQkq - 0 7` | White e4 no d; Black d6+e6 — **identical pawns to Scheveningen** ⚠️ merge |
  | Caro-Kann | 1.e4 c6 2.d4 d5 3.e5 Bf5 4.Nf3 e6 | `rn1qkbnr/pp3ppp/2p1p3/3pPb2/3P4/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 5` | White d4+e5; Black c6/d5/e6 + Bf5 outside (vs French: c6-not-c5 + LSB) ✅ |
  | Slav | 1.d4 d5 2.c4 c6 3.Nf3 Nf6 4.e3 Bf5 5.Nc3 e6 | `rn1qkb1r/pp3ppp/2p1pn2/3p1b2/2PP4/2N1PN2/PP3PPP/R1BQKB1R w KQkq - 0 6` | White c4+d4; Black c6/d5/e6 triangle + Bf5 (vs Caro: White c4-not-e5) ✅ |
  | Lopez | 1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.d3 | `r1bq1rk1/2p1bppp/p1np1n2/1p2p3/4P3/1BPP1N2/PP3PPP/RNBQR1K1 b - - 0 9` | White e4/d3/c3; Black e5/d6 (vs Closed Sic: c3-not-f4, e5-not-c5) ✅ |
  | Benko | 1.d4 Nf6 2.c4 c5 3.d5 b5 4.cxb5 a6 5.bxa6 Bxa6 6.Nc3 d6 | `rn1qkb1r/4pppp/b2p1n2/2pP4/8/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 7` | White d5 + a2/b2; Black c5/d6, a+b half-open, down a pawn ✅ |
  | Asymmetric Benoni | 1.d4 Nf6 2.c4 c5 3.d5 e6 4.Nc3 exd5 5.cxd5 d6 6.e4 g6 | `rnbqkb1r/pp3p1p/3p1np1/2pP4/4P3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 7` | White d5+e4; Black c5/d6, e half-open, g6 — matches existing code ✅ |
  | 3-3 vs 4-2 | — | — | ⚠️ **UNVERIFIED** — Flores ch22 confirmed (TOC), but exact skeleton + model game not obtainable from accessible sources; defined by majority distribution not squares → demoted to theme tag (A), no scorer |

  **Finding (provenance pass earns its keep):** the original headline claim "Nimzo-Grünfeld =
  the English bxc3 lines" was **false**. The English `…Nxc3 bxc3` positions are **single-c**
  (c3+d4, e-pawn home, isolated a2 — FEN `…/3P4/2P2NP1/P1Q1PPBP/…`), i.e. **Grünfeld Centre
  with e4 unplayed**, NOT the doubled-c Nimzo-Grünfeld. Both structures stay in the canon as
  distinct scorers; the bxc3 gap is closed by Grünfeld Centre's bonus-e4 form, not by
  Nimzo-Grünfeld.
- **D-STRUCT-2: theme-tag thresholds.** `space` count cutoffs and `minority_attack` heuristic
  need tuning against real positions; start conservative (false-negative-biased per D2).
- **D-STRUCT-3: sub-family granularity.** Whether to split Najdorf vs Scheveningen (same
  skeleton, different piece placement). Default: keep coarse — Flores's 5 KID sub-types and
  Najdorf I/II collapse where the *pawns* match; piece-placement distinctions belong to
  `themes` / `identify_opening`, not the pawn classifier. (Najdorf I vs II kept separate only
  because the d5-hole vs small-centre distinction IS a pawn difference.)
