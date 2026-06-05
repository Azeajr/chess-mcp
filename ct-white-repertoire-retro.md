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
