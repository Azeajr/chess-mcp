# MCP Retro — Sicilian Defense Teaching Study

**Source analysis:** `analysis.md`
**Retro date:** 2026-06-06
**MCP version:** chess-mcp 0.2.7
**Tools exercised:** `validate_pgn`, `load_repertoire`, `get_transpositions`, `get_structural_profile`, `analyze_repertoire_congruence`, `find_repertoire_gaps`, `evaluate_position`

> Distinct repertoire (Black, Sicilian). Fresh retro at v1 — findings are not deduped against other repertoires' retros. Cross-run dedup is the gh issue list only (issues #1–#17 closed; #18/#19 open from prior runs). What makes this PGN new: it is the **largest tree exercised to date** (3946 nodes / 693 leaves / depth 54), a deliberate scale stress test.

---

## Where It Shone

- **Structural classifier — best real-repertoire showing yet.** Only 64% `unknown` (vs 95% on the English fianchetto study). Named 252 leaves across 10 structures with sensible confidences: Scheveningen 126 (0.75), Closed Sicilian 43 (0.68), Najdorf 37 (0.77), Lopez 22, IQP 8 (0.90), Maroczy 6 (0.80), Hanging pawns 6, French/Stonewall. The post-#5 canon expansion clearly pays off on mainstream 1.e4 structures.
- **Deep-line handling is solid.** `get_structural_profile` resolved a 54-ply Poisoned-Pawn path without error, and `evaluate_position` at depth 20 correctly read the forcing line `27...Qd1+` as **0.00** (perpetual: `Kf2 Bc5+ Nxc5 Qd2+ Kf3`). No truncation or path-matching failure on the deepest line in any repertoire so far.
- **`load_repertoire` scaled cleanly** — parsed and merged 21 chapters into a 3946-node forest (the Najdorf encyclopedia included) with correct node/leaf/depth stats, no crash, fast.
- **Theme fingerprint stayed meaningful at scale** — `fianchetto_black` 379, `color_complex:dark` 192, half-open `c` as the repertoire-wide constant correctly capture the Sicilian's identity even where named structures are absent.

---

## Where It Fell Short

| Area | Problem |
|------|---------|
| **Lean-output contract breaks at scale** | `get_transpositions` (32 KB) and `analyze_repertoire_congruence` (39 KB) both exceeded the MCP output cap on this 693-leaf / depth-54 tree and had to be spilled to a file. The `limit` parameter bounds item *count*, not bytes — each item embeds a full root-to-leaf SAN `paths` array that scales with depth (up to 54 plies), so even 46 transpositions / 50 incongruencies overflow the ~2k-token target. The two tools become unusable in-context on a large repertoire without manually shrinking `limit`. |
| **`structure_outlier` assumes one dominant structure** | 311 of 509 congruence flags were `structure_outlier`, because the dominant theme (`fianchetto_black`) is only a 55% plurality. The rule treats the other 45% (normal Najdorf/Scheveningen/Alapin sub-systems) as "inconsistent DNA." A deliberately multi-system defense has no single dominant structure, so the heuristic produces hundreds of false flags. Distinct from closed #14 (multi-*opening* partition); this is a single opening spanning many structures. |

---

## Actionable Issues

1. **Size-bounded output for `get_transpositions` / `analyze_repertoire_congruence`** — bound responses by bytes (elide/truncate SAN paths, or a byte budget with `truncated: true`), not just item count. Changes caller-visible output shape and is a design decision → **Issue #20, not implemented this run**.

2. **Plurality-aware `structure_outlier`** — only flag when the dominant structure covers a strong majority (or expose a `multi_structure` signal and skip per-leaf outliers otherwise). Threshold is a heuristic/design call and changes congruence semantics → **Issue #21, not implemented this run**.

---

## Skipped Tools (Not Retro'd)

- **`get_repertoire_coverage`** — not run; on a teaching tree most leaves are intentional stops, so dangling/frontier counts are low-signal here.
- **`suggest_replacement_line` / `suggest_complementary_lines`** — deferred; remediation is premature while the illustrative-line (#18) and structure_outlier (#21) noise inflates the flag set.
- **`export_annotated_pgn`** — not run.
- **`identify_opening` / `compare_moves`** — not needed; the aggregate profile + 3 targeted leaf evals characterized the repertoire.

---

## Recurring (already tracked)

- **#19 — gap severity ignores absolute eval**: reproduced — 91 gaps uniform `high` at +40…+77 cp.
- **#18 — illustrative gamebook lines walked as real leaves**: reproduced — the Intro chapter's contrast lines `1...e5` / `1...a6` seed gap flags (`["e4","a6"]`).
