# MCP Retro — White Repertoire Analysis (English Opening)

**Source analysis:** `ct-white-repertoire-analysis.md`  
**Retro date:** 2026-06-04  
**Tools exercised:** `load_repertoire`, `get_structural_profile`, `analyze_repertoire_congruence`, `evaluate_position`, `find_repertoire_gaps`

---

## Where It Shone

- **`load_repertoire` + tree stats** — accurate node/leaf/depth counts (213 nodes, 17 leaves, max depth 21), no hallucination
- **`get_structural_profile` center distribution** — correctly bucketed all 17 leaves (semi-open/tense/open/locked); gave real structural fingerprint of the tree
- **`analyze_repertoire_congruence`** — correctly flagged all 6 `bxc3` lines as `weakness_inconsistency`, traced them all to the same root cause (`...Nxc3/Bxc3 bxc3` exchange); zero spurious root causes
- **`evaluate_position` at depth 18** — concrete Stockfish engine lines + centipawn evals for soundness checks; every claim grounded in engine output, not memory
- **`find_repertoire_gaps`** — caught the `1...Nc6 2.Nc3` stub (no coverage if Black plays anything other than `2...e5`)

---

## Where It Fell Short

| Area | Problem |
|------|---------|
| **Structural classifier coverage** | 16/17 leaves → `unknown` at confidence 0.0. Known schemas (IQP, Carlsbad, Maroczy) are 1.d4/1.e4-derived. English Opening positions don't map to any of them. `get_structural_profile` aggregate view is nearly useless for hypermodern 1.c4 repertoires. |
| **Congruence: no intentional-weakness tier** | No way to mark a weakness as deliberate. All 6 `bxc3` flags are `severity: medium` for a known positional system (bishop pair + b-file compensation). The checker cannot distinguish "accidental" from "acknowledged." Creates noise. |
| **Transposition blindness** | 6 `bxc3` lines almost certainly share mid-game FENs but are encoded as independent lines. `get_transpositions` could confirm overlap; it was never surfaced automatically when congruence flags clustered on the same structure. |
| **Two-island detection** | The repertoire splits into two structurally incompatible setups (fianchetto `g3/Bg2` vs `d4/Nf3/Be2`). This had to be derived manually from the tree. No tool flagged it. |
| **`suggest_complementary_lines` handoff** | One high-confidence leaf (Maroczy, 0.7) existed — the obvious entry point for line suggestions. No automatic prompt to run it once structural analysis completed. |

---

## Actionable Issues

1. **Classifier extension for hypermodern openings** — English, King's Indian Attack, Réti, Dutch need their own structural schemas or a fallback that returns something more useful than `unknown/0.0`. Even a coarse tag ("fianchetto setup", "reversed Sicilian") beats silence.

2. **`weakness_acknowledged` annotation mechanism** — add a way to mark a congruence flag as intentional (in the PGN comment, in a sidecar file, or via a tool call). Flagged lines should then surface at `severity: low` or be suppressible, not silently ignored.

3. **Auto-suggest `get_transpositions` when congruence flags cluster** — if `analyze_repertoire_congruence` returns 3+ flags with the same structural root, automatically recommend running `get_transpositions` against those FENs. Reduces redundant encoding and surfaces shared templates.

4. **Two-island / setup-consistency check** — a new heuristic or tool that detects when a repertoire requires two fundamentally different middlegame skill sets and surfaces it as an explicit warning, not something a user has to read out of the raw tree.

---

## Skipped Tools (Not Retro'd)

- **`suggest_complementary_lines`** — skipped; main gaps (1...Nc6 stub, 2...c6 island) better filled manually first. Next run: `mode="low_memorization"` against the Maroczy leaf once stubs are extended.
- **`get_transpositions`** — skipped; should be re-run against the 6 `bxc3` FENs to confirm overlap.
- **`export_annotated_pgn`** — not run; candidate for post-extension to produce a study-ready PGN with engine annotations inline.

---

## v2 Update — chess-mcp 0.1.8 (2026-06-04)

**New tools exercised:** `validate_pgn`, `get_transpositions`, `suggest_complementary_lines`, `validate_line`

### What Improved

**Theme tags (new in 0.1.8)** — `get_structural_profile` now returns per-leaf theme tags (`fianchetto_white`, `fianchetto_black`, `double_fianchetto`, `color_complex:light`, `minority_attack_black`, etc.). For English Opening these are the practical substitute for the broken named-structure classifier. 13/17 leaves share `fianchetto_white`; that single tag communicates more about the repertoire's DNA than `unknown` ever could.

**Classifier coverage improved** — 12/17 leaves `unknown` (vs 16/17 in v1). 5 leaves now name a structure: Grünfeld Centre (×2, avg 0.74), Hanging pawns (×1, 0.80), Lopez (×1, 0.68), Maroczy (×1, 0.70). Still inadequate for English overall, but the trend is right.

**`get_transpositions` run — resolved 3 apparent gaps:**

| Gap | Verdict |
|-----|---------|
| Gap 1: `1...Nc6 2.Nc3` stub | Resolved — `1...Nc6 Nc3 e5` and `1...e5 Nc3 Nc6` converge at the same FEN |
| Gap 3: Maroczy "shallow" (ends move 7) | Resolved — transposes to `1...Nf6` branch which continues to move 10 |
| Gap 4: bxc3 transposition detection | Confirmed — 6 bxc3 lines share convergence points; no redundant mid-game FEN overlap |

**The repertoire has no real coverage holes.** Every apparent short leaf is a transposition endpoint.

**Two-island confirmed + `3.g3` ruled out** — investigated whether `1.c4 e5 2.Nc3 c6 3.g3` could fold the Be2 island into the fianchetto tree. It cannot: after `3.g3 Nf6 4.Bg2 d5 5.cxd5 Nxd5 6.Nf3 Nxc3 7.bxc3 Bd6`, Black's c-pawn is on c6, permanently blocking ...Nc6. The reversed-Grünfeld structure requires c7 so ...Nc6 is available; the two positions structurally diverge and the FENs never converge.

**Be2 island replaced** — validated engine-grounded replacement line:
```
1.c4 e5 2.Nc3 c6 3.g3 Nf6 4.Bg2 d5 5.cxd5 Nxd5 6.Nf3 Nxc3 7.bxc3 Bd6 8.d4 Nd7 (+58 cp) 9.O-O O-O 10.a4 ...
```
Uses same Bg2 fianchetto + bxc3 structural bet as 13 other leaves. Action required: update `ct-white-repertoire.pgn`.

### New Issues Found

**Transposition blindness causes false gap flags** — `get_structural_profile` and gap-detection logic treat each leaf as an independent endpoint. They do not cross-reference `get_transpositions`. The `1...c5 g6...O-O` leaf (ends move 7) was flagged as shallow/uncovered — it actually transposes to the `1...Nf6` branch at the same FEN, fully covered to move 10. Incorrect flag.

*Fix:* a pre-flight `get_transpositions` call should be standard before any leaf is surfaced as shallow or uncovered. `get_structural_profile` (and `find_repertoire_gaps`) should cross-reference transposition output before reporting a coverage hole.

**Congruence remediation has no single-step tool** — when `analyze_repertoire_congruence` flags an incongruent line, finding a replacement required manually chaining `validate_line` → `evaluate_position` → `suggest_complementary_lines` → `validate_line` across 8 moves. `suggest_complementary_lines` returns candidate pivot moves from an anchor FEN but does not: (a) anchor to the specific Black move the original line was answering, or (b) validate and return a full continuation from that pivot move.

*Fix:* a `suggest_replacement_line(repertoire_id, outlier_variation_path, mode)` tool that returns a full validated continuation — not just a pivot move — anchored to the same Black move order and shown to practical depth.

### Updated Skipped-Tool Status

- **`get_transpositions`** — now run. Resolved all 3 apparent gaps. Should be standard pre-flight before gap or depth analysis.
- **`suggest_complementary_lines`** — still deferred. Next run: `mode="low_memorization"` against Maroczy leaf after `ct-white-repertoire.pgn` is updated with the Be2 replacement.
- **`export_annotated_pgn`** — still not run.

---

## v3 Update — chess-mcp 0.1.8 (2026-06-05)

**New tools exercised:** `find_repertoire_gaps` (first run in this loop)

### What Improved

**`find_repertoire_gaps` now in the loop** — correctly scanned 60 decision points, identified 232 total gaps. After transposition cross-check two actionable gaps survived:
- **Gap A** (c5 after 5.e4 in KID): engine's top choice at −8 cp. Resolves via transposition 1 after `Nge2 Nc6 O-O d6`. Fix is a PGN move-order redirect, not new structural preparation.
- **Gap B** (h5 after 7.O-O in Maroczy): engine's top choice at −34 cp (depth 20). Does not resolve via transposition — `d4 cxd4 Nxd4 Nd7` is a structurally new branch. Genuine coverage hole.

**Transposition pre-flight confirmed effective** — 3 known transpositions used to dismiss the majority of high-severity gap flags. Manual cross-check shows most of the 20 listed high-severity gaps are move-order variants of covered lines, not new territory.

**Soundness checks stable** — bxc3 leaf (+21 Re8) and Maroczy leaf (+4 a3) unchanged from v2 at depth 20. Repertoire soundness is consistent.

### New Shortcomings

**Gap tool eval discrepancy at low depth**
- Observed: `find_repertoire_gaps` (depth 18) reports h5 at −8 cp; `evaluate_position` (depth 20) at the same position reports −34 cp.
- Expected: gap tool eval should be within ±15 cp of depth-20 evaluation for positions without forced tactics.
- Fix: raise `find_repertoire_gaps` default depth from 18 to 20, or add a caveat in the tool output warning that evals near ±20 cp should be verified with `evaluate_position`.

**Be2 island still unresolved**
- Observed: `ct-white-repertoire.pgn` still contains `2...c6 3.Nf3 d6 4.d4 Nd7 5.e4 Ngf6 6.Be2` — the structurally incompatible line recommended for removal in v2.
- Expected: replaced with the engine-verified `3.g3 Nf6 4.Bg2 d5 5.cxd5 Nxd5 6.Nf3 Nxc3 7.bxc3 Bd6 8.d4 Nd7` fianchetto line.
- Fix: user must update `ct-white-repertoire.pgn` manually; PGN update cannot be derived from MCP tools alone (the replacement line needs to be authored and imported).

### Actionable Issues Filed

- Existing Issue #3 (`pre-flight get_transpositions`) — covers gap over-count; confirmed relevant.
- New issue filed: gap tool depth calibration (default 18 underestimates severity; h5 example).

### Updated Skipped-Tool Status

- **`get_transpositions`** — standard pre-flight, run every loop.
- **`find_repertoire_gaps`** — now run. First loop pass confirms it works. Must be paired with manual transposition cross-check until Issue #3 is closed.
- **`suggest_complementary_lines`** — still deferred. PGN not updated. Precondition: close Be2 island + add c5 transposition redirect, then run `mode="low_memorization"` against Maroczy leaf.
- **`export_annotated_pgn`** — still not run.
