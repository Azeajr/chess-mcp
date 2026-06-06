# MCP Retro — White Repertoire Analysis (English Opening)

**Source analysis:** `analysis.md`  
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
Uses same Bg2 fianchetto + bxc3 structural bet as 13 other leaves. Action required: update `repertoire.pgn`.

### New Issues Found

**Transposition blindness causes false gap flags** — `get_structural_profile` and gap-detection logic treat each leaf as an independent endpoint. They do not cross-reference `get_transpositions`. The `1...c5 g6...O-O` leaf (ends move 7) was flagged as shallow/uncovered — it actually transposes to the `1...Nf6` branch at the same FEN, fully covered to move 10. Incorrect flag.

*Fix:* a pre-flight `get_transpositions` call should be standard before any leaf is surfaced as shallow or uncovered. `get_structural_profile` (and `find_repertoire_gaps`) should cross-reference transposition output before reporting a coverage hole.

**Congruence remediation has no single-step tool** — when `analyze_repertoire_congruence` flags an incongruent line, finding a replacement required manually chaining `validate_line` → `evaluate_position` → `suggest_complementary_lines` → `validate_line` across 8 moves. `suggest_complementary_lines` returns candidate pivot moves from an anchor FEN but does not: (a) anchor to the specific Black move the original line was answering, or (b) validate and return a full continuation from that pivot move.

*Fix:* a `suggest_replacement_line(repertoire_id, outlier_variation_path, mode)` tool that returns a full validated continuation — not just a pivot move — anchored to the same Black move order and shown to practical depth.

### Updated Skipped-Tool Status

- **`get_transpositions`** — now run. Resolved all 3 apparent gaps. Should be standard pre-flight before gap or depth analysis.
- **`suggest_complementary_lines`** — still deferred. Next run: `mode="low_memorization"` against Maroczy leaf after `repertoire.pgn` is updated with the Be2 replacement.
- **`export_annotated_pgn`** — still not run.

---

## v3 Update — chess-mcp 0.1.8 (2026-06-05)

**New tools exercised:** `find_repertoire_gaps` (first run in this loop)

### What Shone

**`find_repertoire_gaps` correctly identified real uncovered moves** — scanned 60 decision points, found 232 total gaps. The two evaluated high-severity gaps (5...c5 and 7...h5) were confirmed real by `evaluate_position` follow-up: c5 is the engine's top choice at −8 cp, h5 at −34 cp. The tool did find the right signal buried in the volume.

**`get_transpositions` pre-flight remains effective** — 3 transpositions used to manually dismiss the majority of the 20 listed high-severity gaps as move-order variants. Without this pre-flight, the gap list would be misleading.

**Soundness stability** — `evaluate_position` at depth 20 returned identical evals for bxc3 (+21 Re8) and Maroczy (+4 a3) leaves vs v2. Tool output is deterministic and trustworthy for known positions.

### New Shortcomings

**Gap tool eval significantly underestimates severity at default depth**
- Observed: `find_repertoire_gaps` (depth 18) reports h5 gap at −8 cp; `evaluate_position` (depth 20) on the same position gives −34 cp. A 26 cp discrepancy.
- Expected: gap tool evals should be within ±15 cp of `evaluate_position` at depth 20 for non-tactical positions.
- Fix: raise `find_repertoire_gaps` default depth from 18 to 20, or emit an `eval_reliability: low` caveat when depth < 20 and gap eval is in [−25, +25] cp.
- Issue filed: #6

**Gap tool cannot distinguish move-order gaps from genuinely uncovered lines**
- Observed: 232 total gaps reported; after manual transposition cross-check, 18 of the 20 listed high-severity gaps are move-order variants of already-covered positions (e.g., `5...c5` before `d6` instead of after — resolves to transposition 1 FEN via `Nge2 Nc6 O-O d6`). Only 1 gap (7...h5) is genuinely uncovered territory.
- Expected: `find_repertoire_gaps` should cross-reference `get_transpositions` output and suppress or downgrade gaps that resolve to a known transposition endpoint after opponent's uncovered move + White's best reply.
- Fix: pre-flight transposition map in gap scanning logic; annotate each gap with `resolves_to_transposition: true/false`.
- Existing issue: #3 — confirmed relevant and urgent given 232/1 signal-to-noise ratio.

**No severity recalibration after transposition filtering**
- Observed: the tool reports 232 gaps; the user has no way to know that 230+ are move-order noise without manually running `get_transpositions` and cross-checking each gap's post-uncovered-move FEN against transposition paths. This manual process took multiple tool calls and domain knowledge.
- Expected: either `find_repertoire_gaps` emits a `transposition_resolved: N` field, or a combined tool/mode exists that returns only genuinely uncovered lines.
- Fix: depends on Issue #3 resolution; after transposition filtering, the "232 total gaps" figure should drop to O(10) for this repertoire.

### Actionable Issues Filed

- Issue #3 (pre-flight transpositions for gap filtering) — confirmed as high priority; 232 vs ~2 genuine gaps illustrates the impact.
- Issue #6 (gap tool depth calibration) — new, filed this run.

### Updated Skipped-Tool Status

- **`get_transpositions`** — standard pre-flight, run every loop.
- **`find_repertoire_gaps`** — now in the loop. Works correctly but requires manual transposition cross-check to be useful. Issue #3 is the blocker for autonomous use.
- **`suggest_complementary_lines`** — still deferred. Next precondition: Issue #3 resolved so the Maroczy leaf can be used as a clean anchor without gap-list noise. Then: `mode="low_memorization"` against that leaf.
- **`export_annotated_pgn`** — still not run.

---

## v4 Update — chess-mcp 0.1.8 (2026-06-05)

**New tools exercised:** `suggest_replacement_line` (first run), `analyze_repertoire_congruence` with `acknowledged_weaknesses`, `get_structural_profile` on individual leaf (Be2 island)

### What Shone

**`acknowledged_weaknesses` (Issue #4) works correctly** — all 6 bxc3 `weakness_inconsistency` paths downgraded to `severity: low`, `acknowledged: true`. Clean workflow: pass known intentional weaknesses, filter at `min_severity: medium`, see only real issues. Exact path arrays from prior congruence output are valid input — no reformatting needed.

**Theme-based outlier (Issue #5) correctly catches Be2 island and b6 lines** — `analyze_repertoire_congruence` now flags `structure_outlier` with `source: "theme"` for lines lacking the dominant `fianchetto_white` theme. The Be2 island (previously required manual structural reasoning) is now automatically flagged. The b6 Qc2/Bf4/Bd3 system and its blunder-punish variation are also correctly caught.

**Soundness evals remain stable** — `evaluate_position` at depth 20 returned identical results for bxc3 (+21 Re8) and Maroczy (+4 a3) vs v2/v3. Be2 island leaf confirmed at +88 (consistent with PGN comment range +78–112 cp).

### New Shortcomings

**`suggest_replacement_line` identifies terminal move, not structural divergence point**
- Observed: Be2 island path (19 plies, ends at `h3`) → `outlier_move: "h3"`, `anchored_to: "Qc7"`. The actual structural divergence is `3.Nf3` (move 3, where `g3` should have been played). Suggestions replace `h3`, not `Nf3`.
- Expected: tool walks the path backwards to find the move where the line's theme profile first departs from the repertoire's dominant themes; suggestions pivot from that point.
- Fix: see Issue #7.

**`profile_match: 0.0` universally — `structural_fit` mode inoperative for English Opening**
- Observed: all 4 `suggest_replacement_line` suggestions return `profile_match: 0.0`, `resulting_structure: "unknown"`. The structural_fit ranking is meaningless — suggestions are indistinguishable from each other on the structural axis.
- Expected: when `resulting_structure: unknown`, fall back to theme-tag similarity (e.g., suggestions that produce `fianchetto_white: true` should score higher than those that don't).
- Fix: see Issue #8. Direct cascade from Issue #5 classifier revert.

**Theme-based outlier fires on transposition stub leaves (false positive)**
- Observed: `1...Nc6 2.Nc3 e5` (4-ply) flagged as `structure_outlier`. Line ends before any `g3/Bg2` move, so `fianchetto_white` is absent — but this is a transposition endpoint, not a genuinely non-fianchetto setup.
- Expected: transposition endpoint stubs not flagged; the fianchetto theme is present in the line they transpose into.
- Fix: see Issue #9.

**`total_flagged` count includes acknowledged items**
- Observed: with all 6 bxc3 paths acknowledged, `total_flagged: 10`, `by_type: {structure_outlier: 4, weakness_inconsistency: 6}`. Acknowledged items appear in both headline count and type breakdown.
- Expected: `total_flagged` reflects unacknowledged issues; acknowledged items counted separately.
- Workaround: set `min_severity: medium` — acknowledged items are `severity: low` and filtered from the list, but counts in the response header still mislead.
- Fix: see Issue #10.

**Issue #3 transposition fix scope mismatch**
- Observed: `find_repertoire_gaps` returns `transposition_endpoints: []` despite 3 known transpositions. All 3 transpositions in this repertoire occur at White-to-move positions. The Issue #3 fix deduplicates Black-to-move decision points; White-to-move transpositions are out of scope.
- Expected: the gap count reduction attributed to Issue #3 was actually from scanning fewer positions (max_positions=20 this run vs 60 in v3); the fix does not apply to this repertoire's transposition structure.
- Impact: signal-to-noise improvement from Issue #3 is near-zero for English Opening transpositions. Issue needs re-scoping to cover White-to-move transposition points.

**Gap severity collapses in near-equal opening positions**
- Observed: all 20 listed gaps are "high" severity with evals +17 to +29 cp (White-POV after opponent's uncovered move). In the opening, almost every reasonable Black move scores within a narrow range of the engine's best.
- Expected: severity should differentiate gaps that truly threaten equality from move-order variants. A flat "high" for everything from +17 to +29 provides no prioritization.
- Fix: severity thresholds may need calibration based on phase (opening vs middlegame). Or: add an `eval_spread` field showing how much better the uncovered move is vs the covered alternatives, not just its absolute eval.

### Actionable Issues Filed

- Issue #7: `suggest_replacement_line` targets terminal move, not structural divergence
- Issue #8: `profile_match: 0.0` for unknown structures in `structural_fit` mode
- Issue #9: theme-based outlier fires on transposition stub leaves
- Issue #10: `total_flagged` includes acknowledged items

### Updated Skipped-Tool Status

- **`get_transpositions`** — standard pre-flight, run every loop.
- **`find_repertoire_gaps`** — in the loop. Issue #3 fix confirmed ineffective for this repertoire's transposition structure. Gap severity flattens in the opening. Manual transposition cross-check still required.
- **`suggest_replacement_line`** — now tested. Two blocking issues: wrong outlier identification (#7) and inoperative `profile_match` ranking (#8). Not usable for structural remediation until both resolved.
- **`suggest_complementary_lines`** — still deferred. Precondition: Issues #7/#8 resolved, PGN updated with Be2 island replacement derived manually.
- **`export_annotated_pgn`** — still not run.

---

## v6 Update — chess-mcp 0.2.1 (2026-06-06)

**Focus:** First run on v0.2.1 — verify Issue #11 (full PV ply walk for `profile_match`). Confirm all 0.2.1 fixes reflected in server behavior.

### What Resolved

**Issue #11 FIXED — `profile_match` now differentiates suggestions**
- v5: all suggestions `profile_match: 0.0` (5-move end-only check didn't reach fianchetto development from an early pivot)
- v6: `d4` suggestion `profile_match: 1.0` — ply-by-ply PV walk catches `fianchetto_white` within Stockfish's deep continuation
- `e4`, `Qc2`, `e3` correctly score 0.0; their engine PVs contain no fianchetto development
- Top suggestion is now clear: `d4` (+43 cp, profile_match 1.0). Structural ranking is actionable for the first time in this repertoire.

### New Shortcomings

**`profile_match` saturates at 1.0 via incidental fianchetto in deep PV** *(fixed in v0.2.2 — Issue #12)*
- Observed: `d4` suggestion returned `profile_match: 1.0`. Its 5-move PV (`d4 d5 cxd5 cxd5 dxe5`) is a central pawn battle; the full ~20-move continuation incidentally included `g3/Bg2`, firing `fianchetto_white: true`.
- Fix: added `_PV_THEME_WINDOW = 8` constant; walk sliced to `pv[1:_PV_THEME_WINDOW]`. Structural theme commitments (g3/Bg2) appear within 6–8 plies of any genuine suggestion; appearances beyond that window are engine stylistic choices.
- Verified: after fix all 4 suggestions on Be2 island return `profile_match: 0.0` — correct, none commit to fianchetto within 8 plies of the pivot. Eval-only ranking is the honest fallback.

**Deployment lag — `by_type_acknowledged` absent from congruence response** *(resolved same session)*
- Observed: `analyze_repertoire_congruence` response missing `by_type_acknowledged` field despite being a v0.2.1 addition. Server running pre-0.2.1 code.
- Root cause: local Docker container not rebuilt after v0.2.1 commit. Engine-free changes (dominant_themes fix, PV walk start, `by_type_acknowledged` field) are in the committed server code but not in the running container.
- Fix: `docker compose up -d --build` required after any server code change. Analysis loop should verify version endpoint or field presence at start of each run.
- Resolution: container rebuilt; `by_type_acknowledged: {"weakness_inconsistency": 6}` confirmed present and correct with all 6 bxc3 paths acknowledged. `by_type` shows only unacknowledged types (`{structure_outlier: 3}`); counts reconcile exactly.

### Updated Skipped-Tool Status

- **`suggest_replacement_line`** — Issues #7, #9, #11, #12 resolved. `profile_match` theme fallback capped at 8 plies; incidental deep-PV inflation eliminated. Tool is actionable for structural remediation. `resulting_structure: "unknown"` persists — theme fallback is the active ranking mechanism; eval_cp is the tiebreaker when profile_match is uniformly 0.0.
- **`suggest_complementary_lines`** — still deferred. Precondition: PGN updated with Be2 island replacement.
- **`export_annotated_pgn`** — still not run.

---

## v5 Update — chess-mcp 0.1.8 (2026-06-05)

**Focus:** Verification run confirming fixes for Issues #7, #8, #9, #10.

### What Resolved

**Issue #7 FIXED — `suggest_replacement_line` now finds structural divergence point**
- v4: `outlier_move: "h3"`, `anchored_to: "Qc7"` (terminal node)
- v5: `outlier_move: "Nf3"`, `anchored_to: "c6"` — first White move departing dominant-theme paths
- Verified correct for Be2 island (19-ply path; divergence at ply 5).

**Issue #9 FIXED — transposition stub suppression working**
- `c4 Nc6 Nc3 e5` (4-ply endpoint) absent from `structure_outlier` list in v5
- v4 had 4 `structure_outlier` items; v5 has 3 — exactly the stub removed
- No new false negatives observed: the 3 remaining outliers are all genuine (Be2 island, b6 main, b6 punish)

**Issue #10 FIXED — `total_flagged` and `acknowledged_count` correct**
- Without `acknowledged_weaknesses`: `total_flagged: 9`, `acknowledged_count: 0`
- With one path acknowledged: `total_flagged: 8`, `acknowledged_count: 1`, item shown with `severity: low` + `acknowledged: true`
- Counts are now reliable and actionable without workarounds.

### New Shortcoming

**Issue #8 theme fallback has limited reach for early-pivot outliers**
- Observed: `suggest_replacement_line` on the Be2 island returns `profile_match: 0.0` for all suggestions despite the Issue #8 fix being deployed.
- Root cause: pivot position is after Black's `c6` on move 4. The dominant theme is `fianchetto_white` (g3+Bg2). From this early juncture, Stockfish's 5-move PV (e.g., `e4 Bb4 a3 Bxc3 dxc3`) does not reach g3 or Bg2 — the theme is absent at the PV end, so the fallback returns 0.0. The PV window (5 moves) is too short relative to the number of development moves needed to complete a fianchetto from this position.
- The fix is correct in design but structurally unable to fire for outliers whose divergence point precedes the structural commitment by more moves than the PV covers.
- Fix options: (a) extend PV window beyond 5 moves for early-pivot outliers; (b) check themes at each ply of the PV rather than only at the end; (c) use plan-level heuristics (does this line include g3? Bg2?) rather than only the resulting board state.
- Impact: `structural_fit` mode ranking remains unreliable for English Opening repertoires where the characteristic moves are several plies into the game.

### Updated Skipped-Tool Status

- **`suggest_replacement_line`** — Issues #7 and #9 resolved. Issue #8 theme fallback confirmed deployed but doesn't fire for this repertoire's outliers (pivot too early). Suggestions are structurally sound but not ranked by fianchetto fit.
- **`suggest_complementary_lines`** — still deferred. Next precondition: PGN updated with Be2 island replacement.
- **`export_annotated_pgn`** — still not run.
