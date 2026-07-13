---
name: repertoire-builder
description: >-
  Help develop and pressure-test a chess opening repertoire — check soundness, find gaps, prepare
  the opponent's critical replies, extend lines, shorten lines to cut memorization, and analyze the
  structural themes and thematic consistency across the whole variation tree. Use when the user gives
  a repertoire PGN (a branching tree is fine) and the color they play. Drives the chess-analysis MCP
  — `load_repertoire` handle + structural tools — so every assessment is engine-grounded, never from
  memory.
---

# Repertoire builder

A repertoire is a *tree of lines* the user plays as one color — not a single game. This skill loads
the whole tree once behind a handle, then judges it on two lenses:

- **Structural / thematic** — what pawn structures and plans does the repertoire commit to, and is
  that commitment *consistent* across lines? (`get_structural_profile`, `analyze_repertoire_congruence`)
- **Tactical / soundness** — is each chosen move sound, and what must the user meet? (engine eval at
  each node)

Everything engine-grounded; nothing asserted from memory.

## Grounding contract (applies to every step)

1. **Validate the user's input first.** Pasted a FEN → call `validate_fen`; a **pasted** PGN →
   `validate_pgn`. On `valid:false`, stop and report — never analyze, guess, or "fix" it. Use the
   **normalized** `fen` the validator returns as the position from here on.
2. **Never author a move, line, FEN, or PGN from memory.** Every move/eval you state comes from a
   tool result; every line passes `validate_line`. Name a move only from `evaluate_position` (its
   ranked `lines`) or `get_legal_moves`. To explore a line, pass the moves to `validate_line` and
   continue from the `finalFen` it returns.
3. **FENs come only from the MCP.** Use the `fen` a tool returned; the one FEN you may type is the
   standard start position.
4. **Tools down → stop.** If the `chess-analysis` tools are unavailable, say so and stop — never
   fall back to analyzing from memory.
5. **Never read a PGN file into your context.** A repertoire (or any PGN) on disk goes through
   `load_repertoire_from_file(path, color)` — the file is read server-side, never by you. Do NOT
   open it with Read / `cat` / Bash: that re-introduces the client-side truncation that silently
   corrupts the tree (a whole analysis built on a half-loaded repertoire), and burns context for
   nothing. `load_repertoire(pgn, color)` is only for a PGN the user already pasted into the chat.

## Inputs

- the user's repertoire PGN — the **full branching tree**, variations and all, in one go
- the user's color: `white` or `black`

## Load once, then reuse the handle

`load_repertoire(pgn, color)` parses the tree once and returns a `repertoire_id` plus tree stats
(`nodes`, `leaves`, `max_depth`). **Every other repertoire tool takes that `repertoire_id`** instead
of the PGN — don't re-send the PGN. The handle lives in the server's cache; if a later call returns
`repertoire_not_found` (idle expiry), just call `load_repertoire` again.

**Loading from a file? Use `load_repertoire_from_file(path, color)`** —
never read the file yourself (grounding rule 5). It reads the file on the server host in full — no
client-side truncation, and the PGN never enters your context — and returns the same `repertoire_id`
+ stats. `path` is confined to the configured repertoire dir. `load_repertoire(pgn, color)` is only
for a PGN the user pasted into the chat (or if file access isn't available). Caveat:
loading from a file, you can't pre-`validate_pgn` (you never hold the PGN) — rely on the loader's
error if the file won't parse as a repertoire.

Editing returns a NEW handle: `modify_repertoire_line` deep-copies the tree, applies the edit, and
returns a fresh `repertoire_id` — the source id still resolves to the unmodified tree. So you improve
a repertoire in ONE session (load → edit → re-analyze the new id → … → export), branching and
comparing handles, with no re-download. See "Edit loop" below.

## Workflow

0. `validate_pgn(pgn)` — confirm the repertoire PGN parses (returns `{valid, games}`). On
   `valid:false`, stop and report; never load unvalidated input.
1. `load_repertoire(pgn, color)` → `repertoire_id` — or `load_repertoire_from_file(path, color)`
   when the repertoire is a file on disk (same handle, read server-side; see above). Note `leaves`
   (how many distinct lines) and `max_depth`.
2. `get_structural_profile(repertoire_id)` (no path) → the repertoire's **aggregate fingerprint**:
   which `structures` it reaches (IQP / Carlsbad / Maroczy / unknown, with counts), center tendencies,
   common open / half-open files. This is the repertoire's strategic identity — state it plainly.
3. `analyze_repertoire_congruence(repertoire_id)` → thematic **incongruencies**, judged WITHIN each
   opening system (lines are clustered by move-order-robust system, so a system reached via several
   first moves is judged as one and distinct systems under one first move don't dilute each other): a
   line that veers off its system's dominant structure (extra plans to learn), accepts a pawn weakness
   against the grain, or splits the system between locking and opening the center. Each carries `paths`
   (SAN `variation_path`s) + its `cluster` label; the result's `clusters` shows the system partition.
4. **Drill a flagged line** (or any leaf): `get_structural_profile(repertoire_id, variation_path)` →
   that node's `fen`, `structure_class`, `center`, pawn `primitives`, files.
5. **Soundness + opponent prep** at that node: `evaluate_position(fen, lines=3)` → `{fen, lines}`
   ranked best-first. `lines[0]` is the user's best option (compare to what they actually play — a
   played move that isn't near the top and drops eval is **weak**). The lines at an *opponent* node
   are the critical tries the repertoire must answer; an unanswered strong one is a **gap** (or use
   `find_repertoire_gaps` to scan for them). Ground any line with `validate_line(fen, [...])` before
   stating it. To vet the user's OWN moves tree-wide in one call, use
   `audit_repertoire_moves(repertoire_id)` — every your-turn position is engine-searched and each
   prescribed move scored vs the engine's best; findings come back worst-first with `cp_loss`,
   `classification` (good/inaccuracy/mistake/blunder), a SAN `path` to drill into, and `best_margin`
   (best − second line; a large margin means an only-move position where misremembering is punished).
   `min_cp_loss` (default 50) sets the reporting bar; it is the complement of `find_repertoire_gaps`
   (which checks OPPONENT coverage).
6. **Extend or diversify** from any position: `suggest_complementary_lines(repertoire_id, fen, mode)`.
   - `mode="low_memorization"` → continuations whose resulting structure the user **already plays**
     elsewhere (high `profile_match`) — least new theory.
   - `mode="sharp"` → maximally unbalanced / novel structures (high `sharpness`) — for breaking out of
     the comfort zone on purpose.
   Confirm a chosen suggestion with `validate_line` before recommending it.
7. **Shorten lines to cut memorization** (`find_pruning_transpositions`) — for each leaf it walks
   YOUR moves earliest-first; the earliest move within a near-best window of #1 that re-routes into a
   DIFFERENT already-prepared line makes the original tail redundant. Each suggestion returns
   `linePath`, `atPath`, `atPly`, `rerouteMove`, `joinsPath`, `savedPlies` (tail dropped), and the
   eval trade `evalStay` vs `evalTranspose` (`evalDelta` = stay − transpose).
   - **Multiple re-routes per line (C1).** EVERY viable re-route is returned, not just the earliest.
     Per line, two are tagged: `bestSavings` (earliest node, biggest tail cut) and `bestEval` (best
     resulting eval) — they often differ, so present BOTH to the user as a memorization-vs-quality
     choice rather than picking one for them.
   - **Trustworthy eval (E1).** Pass `confirm_depth` to deep-confirm each line's `bestEval` pick (it
     comes back `evalConfirmed:true` with the deeper eval). Worth it when the user will act on the eval.
   Tuning:
   - **Leave `budget` unset.** It is NOT a neutral "scan fewer positions" knob — it is spent
     leaf-by-leaf in tree order, so a low cap silently stops the walk before it reaches the *later*
     leaves and returns fewer or even ZERO suggestions **with no error**. The transposable lines are
     often last in the PGN, so a cap hides exactly what you want. Full coverage = omit `budget`. The
     user accepts a long scan (up to ~10 min) for this — do not cap it to save time.
   - Effort per position: `movetime_ms` (a better dial than `depth` for the sharp positions a
     re-route lands in) or `depth` (default 14). To match the PWA's coverage use `multipv:3`,
     `cp_threshold:50` (the near-best gate — keeps the re-route from ever being a blunder), no budget.
   - **Ranking is the tool's job, not yours (C6).** A full (no-cursor) call returns ALL suggestions
     globally sorted (`partial:false`) — that is the authoritative ranking, use it directly. P1 keeps
     the full scan cheap, so prefer it.
   - **Progress on a long scan.** Claude Code does NOT surface MCP progress notifications, so for a
     genuinely long scan drive it in chunks: `leaf_start`/`leaf_count`, reporting `next_leaf` /
     `total_leaves` between calls (`total_positions_estimate` / `estimated_positions_remaining` for an
     ETA). But chunk returns are `partial:true` and **chunk-local sorted** — do NOT merge or re-sort
     them yourself for a final ranking (that would put you, not the engine, in charge of correctness).
     For the ranked result, make one full call.
   - **Black caveat:** `evalDelta` is white-POV cp. `evalDelta ≤ 0` means the shorter line costs you
     nothing (or gains); a positive `evalDelta` is the eval you trade away for fewer moves — weigh it.
   - **Quality of the shortcut (C3).** A shortcut makes you abandon the line (`line_path`) and play the
     one you transpose into (`joins_path`). `compare_shortcut_lines(repertoire_id, line_path, at_ply,
     joins_path)` judges the two on EVAL at the fork (evalStay vs evalTranspose) and structural FIT with
     the repertoire (fitStay/fitTranspose + readable `structure*` labels), and `recommend`s one (eval
     unless the gap is ≤ ~30cp, then fit). This is the QUALITY axis — weigh `recommend` against the
     suggestion's `savedPlies` (the memorization win); a slightly-worse line can still be worth the cut.
   - **Coverage-safety before applying (C4).** A shortcut deletes the line's tail; that tail may have
     been the only cover for some opponent reply (e.g. by transposition for another line). Run
     `check_shortcut_coverage(repertoire_id, line_path, at_ply)` first — it prunes on a copy, re-runs
     the gap scan, and returns `introduces_gap` + the `new_gaps`. If it opens a gap, weigh it or pick a
     different re-route. Run it only for the suggestion you're about to apply (it's engine-backed).
   Apply a chosen suggestion in the Edit loop: prune the **redundant tail at the original line's own
   node** — `modify_repertoire_line(prune)` at `linePath` truncated to `atPly+1` moves (one ply
   deeper than `atPath`). That drops the long tail and leaves the `joinsPath` branch as the surviving
   prep. Do NOT prune at `atPath` itself — that would also delete the transposition target.
8. **Real-world grounding (opening explorer — needs `LICHESS_TOKEN`).** Engine says what's strong;
   the explorer says what actually happens. All three surfaces return `explorer_auth_required` if
   the server has no Lichess token — tell the user to set `LICHESS_TOKEN` (a personal API token,
   no scopes) and move on; never guess frequencies from memory.
   - **Prioritize gaps by frequency:** re-run `find_repertoire_gaps` with `popularity: true` —
     each gap gains `played_pct`/`played_games` and gaps re-rank by frequency within each severity
     tier. A high-severity gap at 40% frequency outranks one at 0.5%; fix the former first. A
     `played_pct` of `null` means the explorer lookup failed (the engine scan is still valid).
   - **"Do humans even play this?"** `position_popularity(fen)` → per-move frequencies + white-POV
     win rates + total games. `db: "masters"` for OTB theory; the default `lichess` db is 1800+
     blitz/rapid/classical — practical opposition.
   - **Where does memorization stop paying?** `find_theory_depth(repertoire_id)` → per line, the
     ply where explorer game counts collapse below `min_games` (`theory_exit_ply`; `null` = the
     whole line stays in book). Deep exits = well-trodden theory worth memorizing; early exits =
     original prep — pair with step 7 (shorten) to cut memorization where theory has already run
     out. Network-bound (~1 position/s, `max_positions` caps it) — warn the user a big tree takes
     a minute+.
9. **Report**: structural identity (step 2) / incongruencies with the offending line (step 3) / weak
   user moves with the engine fix (step 5) / uncovered opponent tries = gaps (step 5), frequency-
   ranked when the explorer is available (step 8) / suggested extensions (step 6) / shortenable
   lines with plies saved + eval trade (step 7) / theory-exit depths (step 8).

## Edit loop (single session — fix the repertoire without leaving)

Once analysis surfaces a change to make, apply it through the MCP and re-analyze the result in the
same session — no hand-editing, no re-download, no fresh session:

1. **Decide the edit from a tool result.** A prune target is a flagged `path`, or a shorten target
   from `find_pruning_transpositions` (prune the redundant tail — see Workflow step 7); an `add`
   continuation comes from `suggest_complementary_lines` / `evaluate_position` `lines` (confirm with
   `validate_line`); a `reorder` promotes an existing child move. You only ever pass back paths + SAN
   the MCP already surfaced.
2. **Apply it:** `modify_repertoire_line(repertoire_id, path, action, …)` →
   - `action="prune"` — drop the subtree at `path` (a refuted/illustrative/incongruent line).
   - `action="add"`, `add_moves=[…SAN…]` — graft a continuation under the node at `path`.
   - `action="reorder"`, `promote_move="…"` — make a different child the recommended mainline at `path`.
   It returns a NEW `repertoire_id` (+ a one-line `summary` and updated stats). The old id is unchanged.
3. **Re-analyze on the new id.** Run `analyze_repertoire_congruence` / `find_repertoire_gaps` /
   `get_structural_profile` / `get_repertoire_coverage` on the returned id to confirm the edit did what
   you intended (and didn't introduce a new gap). Iterate id → id → id; keep earlier ids to compare.
4. **Export + save once done:** prefer `export_repertoire_to_file(final_id, path)` — it writes the
   PGN to disk server-side and returns only `{path, bytes, leaves}`, so the
   large PGN never enters your context (`path` is confined to the configured repertoire dir).
   Otherwise `export_repertoire(final_id)` returns the `pgn` string — Write it to disk yourself;
   **do NOT print it into the conversation** (large artifact, not something to read aloud).

The agent orchestrates the loop purely with paths / actions / SAN the MCP surfaced. The ONLY chess
content it ever writes to disk is the `pgn` string `export_repertoire` returned — it never authors,
edits, or hand-writes a line, FEN, or variation itself.

## Grounding rules

- Never call a move "best", "sound", "a gap", "an IQP", or "theory" without a tool result behind it.
  The structural classifier (inside `get_structural_profile`) ships a narrow set and returns
  `structure_class: "unknown"` when unsure — relay `unknown`, don't guess a name.
- Use the `fen` from `get_structural_profile` (or `evaluate_position`) as the bridge; never hand-build
  a FEN. `variation_path` is a SAN move list (e.g. `["d4","d5","c4","e6"]`); the `paths` in a
  congruence result feed straight back into `get_structural_profile`.
- Evals are white-POV cp (±10000 = mate). For a **Black** repertoire, "good for me" = *negative* cp —
  say it in plain terms every time so the user isn't confused by sign. (Note `eval` in
  `suggest_complementary_lines` is white-POV too.)
