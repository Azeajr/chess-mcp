# Illustrative-Line Detection (Issue #18)

## Problem

Gamebook / teaching-study PGNs embed **illustrative side-variations** — moves shown to a
student precisely because they are *bad* ("if you play this, you lose"). The variation
walker treats every variation as a first-class repertoire line, so these pollute:

- `load_repertoire` leaf counts (English study: 38 leaves for ~18 real chapters),
- `analyze_repertoire_congruence` (3 of 6 Myers flags landed on annotated blunders),
- `find_repertoire_gaps` (the Sicilian Intro's contrast lines `1...e5` / `1...a6` seed gaps).

No single signal is reliable: Lichess prose marks badness inconsistently (`{-7}` with no
NAG), short stubs look like real prep, and a developed-but-losing demo needs an engine to
tell from a sharp sacrifice. So detection **layers three signals**, cheap → expensive.

## What counts as illustrative

Only a **side-variation** node — a child that is *not* its parent's mainline
(`parent.variations[0]`). Mainline moves are the recommendation and are never illustrative.
A side node's whole subtree (all leaves under it) is illustrative when any tier fires.

### Tier 1 — NAG (engine-free, authoritative)
The move carries a mistake/blunder/dubious NAG (`$2` `?`, `$4` `??`, `$6` `?!`). Direct
annotator intent. Fires for any side variation (player- or opponent-to-move). A verdict on
its own. Requires the PGN to retain NAGs — see *Fixtures* below.

### Tier 2 — structural candidate selection (engine-free, NOT a verdict)
Every **player-to-move** side variation (the player chose a non-mainline move) is an engine
*candidate*. Player-only: a short opponent-to-move side line is the author addressing an
opponent try, not a wrong answer.

> **Rejected:** a standalone "structural stub" verdict (a short player-side side line ≤2
> plies that doesn't transpose). The v2 rerun showed it over-flags badly — in a *merged
> multi-chapter forest* a legitimate short chapter becomes a side branch (e.g. the
> Anti-Grünfeld `1.c4 Nf6 2.Nc3` and the QGD-transposition `1.c4 e6 2.d4` chapters), and a
> *dense theory tree* is full of legitimate short sub-variations (35 false hits on the
> Sicilian). Shortness alone does not mean "wrong answer." So the structural signal only
> *selects candidates*; the engine confirms.

### Tier 3 — engine (in `chess_mcp.py`, authoritative, bounded)
For each player-side candidate, compare its eval to the sibling mainline move from the
parent position. Flag illustrative only if the side move is worse by `> _ILLUS_LOSS_CP`
**and** leaves the player clearly lost (player-POV `<= -_ILLUS_BAD_CP`). Bounded to
`max_positions` candidates, depth-limited. A legitimate short sideline is not losing, so it
is no longer flagged; a clearly-losing demo is.

**Known limit:** a *mild* unannotated inaccuracy demo (the study's "passable, but not great"
moves — `g4`, `Nh3`, `Qc2`) is below the losing threshold and carries no NAG, so it is
indistinguishable from a real sideline and is NOT flagged. Preserving NAGs (Tier 1) is the
fix; engine recall is intentionally limited to *clear* blunders to avoid false positives.

## Architecture

- Tier 1 (`nag_illustrative_nodes`) and candidate selection (`player_side_variations`) live
  in `repertoire.py` — stays engine-free.
- Tier 3 lives in `chess_mcp.py` (the only engine boundary), layered on top.
- Exposed as a **new, additive tool** `classify_illustrative_lines(repertoire_id, …)` →
  `{color, leaves_total, illustrative_leaves, lines:[{path, reason: nag|stub|engine, eval?}],
  positions_scanned}`. No existing tool signature or output changes (zero regression risk);
  the analyst / loop reads the reported `lines`. **Phase 2 (done):** `analyze_repertoire_congruence`
  and `find_repertoire_gaps` take an `exclude_paths` argument — feed the classifier's `lines`
  paths to drop those subtrees from congruence judgement and skip them in the gap scan
  (`repertoire.path_excluded` does the prefix match). Engine-free tools stay engine-free: they
  only filter the paths the caller supplies, they don't run the engine themselves.

The classifier's engine scan is bounded by `max_positions` (default 40, max 60), shallowest
candidates first — a clear demo deeper than that sample is missed (same trade-off as
`find_repertoire_gaps`); raise it for fuller coverage on large studies.

## Constants
- `_ILLUS_LOSS_CP = 150`, `_ILLUS_BAD_CP = 120`. Conservative on purpose: better to miss a
  borderline demo than to prune a genuine repertoire sideline.

## Fixtures
The committed fixtures were anonymized with comments **and NAGs** stripped, so Tier 1 cannot
fire on them — Tiers 2–3 carry the current studies. PHASE 0 of the Repertoire Analysis Loop
is updated to **preserve NAGs** (strip only PII headers + prose comments) so future fixtures
feed Tier 1.
