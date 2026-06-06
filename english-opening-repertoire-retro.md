# MCP Retro — English Opening Teaching Study

**Source analysis:** `english-opening-repertoire-analysis.md`
**Retro date:** 2026-06-06
**MCP version:** chess-mcp 0.2.7
**Tools exercised:** `validate_pgn`, `load_repertoire`, `get_transpositions`, `get_structural_profile`, `analyze_repertoire_congruence`, `find_repertoire_gaps`, `evaluate_position`

> This is a **distinct repertoire** from `ct-white-repertoire.pgn`. Its retro starts fresh at v1; findings are not deduped against the ct-white retro. The only cross-run dedup is the gh issue list (all 17 issues currently CLOSED). What makes this PGN new: it is a **gamebook teaching study** with deliberate wrong-answer side variations, a shape the prior repertoires never exercised.

---

## Where It Shone

- **Structural classifier named the two non-fianchetto structures correctly** — `Carlsbad` (0.85) for the Caro-Kann-system line and `Hanging pawns` (0.75) for the Jaenisch endpoint. The 11 added structures (since v1 of the ct-white loop) pay off here: on a 1.c4 repertoire the classifier now names structures it used to miss instead of returning all-`unknown`.
- **Theme tags carried the fingerprint where names couldn't** — 36/38 leaves are `unknown`, but `fianchetto_white: 16`, `double_fianchetto: 7`, `minority_attack_black: 11` correctly communicate the `c4/Nc3/g3/Bg2/d3/Nf3` system's DNA. This is the intended D2 behavior working as designed.
- **`get_transpositions` cleanly found the Anglo-Indian ↔ Great Snake convergence** — 3 transpositions, correct FENs and full SAN paths, no spurious matches. Move-order equivalence detected exactly where it exists.
- **`evaluate_position` at depth 20 was deterministic and corroborated the study** — +106 / +114 / +124 on the three checked leaves, each consistent with the study's own structural claims (and exposing one overstatement: Jaenisch is "+edge", not "winning").
- **`analyze_repertoire_congruence` traced all 6 Myers flags to the one `bxc3`/doubled-c root** — no invented root causes; the doubled c4+c5 it reports genuinely exists in those positions.

---

## Where It Fell Short

| Area | Problem |
|------|---------|
| **No annotation/NAG awareness** | Illustrative "wrong-answer" side variations (`(6.Bd2 {-7})`, `(6.Nd2 {-7.5})`, `(6.Qd2)`, `(8.Qd4 {fails})`, `(3.Bxg5)`, `(7.Nxg5)`) are walked as first-class repertoire leaves. This inflates leaf count (38 vs ~18 chapters), produces congruence `weakness_inconsistency` flags on moves the author explicitly marks as blunders (3 of the 6 Myers flags), and feeds losing positions to the gap scanner. No tool distinguishes "the recommended line" from "a deliberately bad line shown for contrast." |
| **`find_repertoire_gaps` severity ignores absolute eval** | All 154 gaps are severity `high` with evals spanning only −15…+28 cp. Severity is set solely by closeness to the opponent's best move, so a gap leaving White at +0.2 ranks identical to one dropping White to −2.0. On a single-recommendation teaching study (one taught reply per move) this produces O(100) uniform-`high` gaps with zero prioritization — the user cannot tell a cosmetic move-order gap from a real equality threat without manually evaluating each. (Distinct from closed #6, which raised default *depth*.) |
| **Gap scanner still not transposition-aware here** | `transposition_endpoints: []` despite 3 known transpositions. As in prior runs, the Anglo-Indian ↔ Great Snake convergences are White-to-move / not deduplicated, so the scanner can't credit a move answered in one branch as covering its transposed twin. (Re-confirms the closed #3 scope gap; no new issue — noted for continuity.) |

---

## Actionable Issues

1. **Annotation-aware repertoire walking** — give the walker a way to exclude (or tag) illustrative wrong-answer variations so they don't pollute leaf counts, congruence flags, and gap scans. NAG-filtering alone is insufficient (this study encodes badness only in prose, no `$2/$4` glyphs); needs a heuristic ("short side line that is immediately refuted / scores far below the sibling mainline") or an opt-in `primary_line_only` walk. Design-worthy, touches the shared walker → **Issue #18, not implemented this run**.

2. **Eval-aware gap severity** — fold the absolute white-POV eval (or an `eval_spread` vs the covered alternatives) into `find_repertoire_gaps` severity so gaps that don't actually threaten White's standing drop below `high`. Lives in `chess_mcp.py` gap logic and changes caller-visible severity semantics → **Issue #19, not implemented this run**.

---

## Skipped Tools (Not Retro'd)

- **`get_repertoire_coverage`** — not run this loop; the dangling/frontier split is less informative for a teaching study where most leaves are intentional stops. Candidate for a future run once the study is converted toward a playable tree.
- **`suggest_replacement_line` / `suggest_complementary_lines`** — deferred; remediation is premature while the wrong-answer variations still inflate the tree (Issue 1 above is the precondition for clean anchors).
- **`export_annotated_pgn`** — not run.
- **`identify_opening` / `compare_moves` / `get_structural_profile` on more leaves** — covered enough via the aggregate + 3 targeted leaf profiles to characterize the repertoire.
