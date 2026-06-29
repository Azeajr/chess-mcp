# Fit Unification — Design Spec

Unify the repertoire-fit signal onto ONE mechanism — the blended `buildFitProfile` / `fitScore`
(center + themes + named structure) already used by gap-fill — replacing the named-structure-only
`profileStructureShares` dot-product in `compare_shortcut_lines` and the two `suggest_*` tools.

Related: `SHORTEN_SEMANTICS_DESIGN.md` (C3, the fit being revised), `SUGGEST_PRUNE_DESIGN.md`,
`STRUCTURE_CLASSIFIER_DESIGN.md` (the classifier + signals), `GAP_FILL_PWA_DESIGN.md` (where the
blended fit already lives).

## Problem

Three overlapping "fit" mechanisms exist; the weakest one drives shorten + suggest:

| Mechanism | Signals | Robust to `unknown`? | Used by |
|---|---|---|---|
| `profileStructureShares` + dot-product (`fitOf`) | named structure **only** | no — collapses to 0 | `compareShortcutLines`, `suggestComplementaryLines` (low_memorization), `suggestReplacementLine` |
| `buildFitProfile` / `fitScore` (`structuralSignals`) | center + themes + named structure | yes ("rarely collapses to 0", per its own doc) | `apps/ui/src/store/gaps.ts` (gap-fill) |
| inline PV-theme walk | themes only, when structure unknown | partial | `suggestReplacementLine` fallback (`enginetools.ts` ~541–558) |

Symptom (observed, and recorded in `SHORTEN_IMPROVEMENTS_TODO.md` Tier-2 verification as "working as
designed"): two sibling replies at a fork — one reaching an IQP (`fit 0.03`), one an unclassified
structure (`fit 0`, `unknownShare 1.0`). The unclassified branch scores 0 **not because it is
off-theme** but because `unknown` is excluded from the named-only fit by construction. A `...g6` King's
Indian still carries `center:semi-open` + `fianchetto_black` + a wing majority — real, on-theme signal
the named-only fit cannot see.

`buildFitProfile`/`fitScore` was built later (for gap-fill) precisely to fix this, but shorten (C3) and
the suggest tools predate it and never migrated. That is the duplication.

## Goal

One fit mechanism repo-wide: the blended `fitScore`. More capacity to match more structures **without
touching the pinned 19-structure classifier** — themes + center carry the signal when no named
structure matches. Removes the dot-product `fitOf` and the hand-rolled PV-theme fallback.

## Proposed change (all in `packages/chess-tools/src/enginetools.ts` — shared by MCP + PWA)

Build one profile per call from the repertoire's leaf boards:
`const profile = buildFitProfile(tree.leafPositions().map((p) => p.board), color);`

1. **`compareShortcutLines`** — replace `fitOf` (the `profileStructureShares` dot-product over a
   branch) with the branch's **mean `fitScore`** over its subtree leaf boards:
   `fitOf(boards) = mean(boards.map((b) => fitScore(profile, b, color)))`.
   Keep returning `unknownShareStay/Transpose` (still computed from `profileStructureShares(boards).unknown`)
   — informational, but it no longer forces fit to 0.

2. **`suggestComplementaryLines`** (low_memorization) — `profile_match = fitScore(profile, after.board, color)`
   (replaces `resultStruct === "unknown" ? 0 : shares[resultStruct]`). `sharp` mode is unchanged (it is an
   imbalance axis, not a fit axis).

3. **`suggestReplacementLine`** — `match = fitScore(profile, after.board, color)`, deleting the entire
   `unknown` PV-theme fallback (`domSet`, `BOOL_THEMES`, `PV_THEME_WINDOW`, the walk loop ~541–558).
   The fallback was a partial hand-rolled re-implementation of exactly what `structuralSignals` already
   blends in; `fitScore` subsumes it. `solid` mode (pure eval sort) is unchanged.

`color` is needed for `fitScore`/`buildFitProfile`; both functions already receive it.

## What stays the same (contract)

- Output field NAMES: `fitStay`, `fitTranspose`, `evalDelta`, `recommend`, `basis`,
  `eval_disagrees_with_fit`, `unknownShareStay/Transpose`, `profile_match`, `resulting_structure`. No
  new/removed fields, no new error codes, nesting unchanged.
- The eval axis, the eval-vs-fit tiebreak, `sharp`/`solid` modes, `savedPlies`, coverage — untouched.
- The 19-structure classifier and its confidence thresholds — untouched (pinned by
  `structure-accuracy.mjs`). This pass only changes which fit *aggregator* consumes them.

## Behavior changes (expected, and the point)

- Fit **values** change (richer signal). For unknown-but-thematic branches, fit becomes **non-zero**
  instead of 0 — so `recommend`/`eval_disagrees_with_fit` can flip in unknown-heavy ties (the sibling
  `g6` case now gets a real fit instead of a misleading 0).
- `unknownShare*` stays but no longer implies fit 0. The PWA "fit weak" inspector flag (Tier-4 PWA
  C3/C4) currently keys off high `unknownShare`; it should key off **low blended fit** instead — a
  small follow-up in `apps/ui` (the shorten inspect card), tracked separately, not in the core change.
- Tool descriptions that say "subtree structure distribution vs the repertoire aggregate" → "blended
  structural fit (named structure + center + themes) vs the repertoire" (`index.ts` +
  `apps/ui/src/llm/tools.ts`, kept in sync).

## Cross-surface

All edits land in `chess-tools`, so MCP (`apps/mcp-server`) and PWA (`apps/ui/src/llm/tools.ts`) get
the change from one place; gap-fill already uses the same blended fit, so the surfaces converge rather
than diverge. Gate: `pnpm -r typecheck` + `pnpm --filter @chess-mcp/ui build`.

## Smoke / validation

- `smoke-gametree.mjs` #30 already pins `fitScore` in (0,1] and self-fit > 0. **Add:** a branch whose
  leaves are structurally `unknown` but thematic (e.g. a `g6` fianchetto line) scores `fitScore` **> 0**
  — the regression this fixes — and that `compareShortcutLines` on the sibling fork now returns a
  non-zero `fitTranspose` for the unclassified branch.
- Pin that the relative ranking still discriminates (two structurally-different branches get different
  blended fit), so "everything scores ~equal" can't slip in.
- `structure-accuracy.mjs` unaffected (no scorer change). `smoke-client.mjs`: re-run
  `suggest_*` / `compare_shortcut_lines` end-to-end.

## Scope guards

- Pure aggregator swap. No classifier re-tuning, no eval/POV change, no new tool/field/error code.
- `sharp` (suggest_complementary) and `solid` (suggest_replacement) modes are NOT fit axes — leave them.
- The sibling-fork "branch-swap" framing issue (savedPlies on a non-shortcut) is a SEPARATE concern
  (see the Shorten discussion) — not folded into this fit change.

## Open question for sign-off

- Branch fit for `compareShortcutLines` = **mean** `fitScore` over the branch's leaf boards (the natural
  analog of the old per-branch aggregate, and how gap-fill scores positions). Confirm mean (vs. e.g.
  max/median) before implementing.
