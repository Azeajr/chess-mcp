# DV-2 — move-tree arrow semantics

**Gate:** DV-2
**Date:** 2026-08-12
**Status:** resolved using the documented default-if-inconclusive
**Blocks:** WP-011

## Decision

Use the documented default: **Right Arrow enters a variation; Up and Down move among siblings.**

At a node with non-mainline alternatives, Right Arrow moves to the first variation rather than
advancing the mainline. Up and Down traverse the ordered sibling replies (mainline, first variation,
second variation, and so on), and Left Arrow returns to the parent. At a node without a variation to
enter, Right Arrow follows its mainline child.

## Evidence

The move-tree-only prototype is
[`dv-2-move-tree.html`](../../../apps/ui/public/prototypes/dv-2-move-tree.html). Its two mappings
are available behind query flags:

- [`?mapping=enter-variation`](../../../apps/ui/public/prototypes/dv-2-move-tree.html?mapping=enter-variation)
- [`?mapping=advance-mainline`](../../../apps/ui/public/prototypes/dv-2-move-tree.html?mapping=advance-mainline)

The prototype starts at `2. Nf3` and uses the required task: “Find the second variation after 2.Nf3
and go to its last move.” It is isolated from `MoveTree`, `RepertoirePanel`, the board, WP-011, and
AG-3.

Two synthetic proxy evaluations ran through
[`dv-2-move-tree-prototype.spec.ts`](../../../apps/ui/test/e2e/dv-2-move-tree-prototype.spec.ts):

| Proxy evaluation | Mapping            | Scripted keys      | Result                                              |
| ---------------- | ------------------ | ------------------ | --------------------------------------------------- |
| Synthetic 1      | `enter-variation`  | `→`, `↓`, `→`      | Reached `3. Nxe5`; 0 scripted wrong navigation keys |
| Synthetic 2      | `advance-mainline` | `→`, `↓`, `↓`, `→` | Reached `3. Nxe5`; 0 scripted wrong navigation keys |

These are deterministic browser checks, not people. Their metrics prove only that the expected
keystroke sequences work; they do not establish a human completion time, wrong-key rate, stated
model, or preference. The full protocol and this distinction are recorded in
[`dv-2-evaluation.md`](../prototypes/dv-2-evaluation.md).

Real repertoire-builder evidence was unavailable: no two real, consenting repertoire builders were
available to run the task. No human evidence was fabricated. The participant result is therefore
**inconclusive**.

## Why the fallback applies

Section 14 of `docs/ui-ux-remediation-plan.md` explicitly provides this default for an inconclusive
DV-2 result: Right Arrow enters a variation and Up/Down move among siblings, because it matches the
tree-role ARIA pattern that screen readers already teach. That section also says defaults exist so a
gate cannot block the roadmap indefinitely. The fallback, rather than the synthetic results,
therefore resolves DV-2.

## Validation and scope

- `pnpm exec playwright test --config apps/ui/playwright.config.ts apps/ui/test/e2e/dv-2-move-tree-prototype.spec.ts --project chromium --reporter=dot` — 5 passed.
- The canonical three-browser container run is recorded in `state.json` alongside this decision.
- The tests also cover invalid-query fallback, distinct Right Arrow behavior at `2. Nf3`, sibling and
  parent traversal, Home, End, and Enter's navigation target.

No production WP-011 implementation was made. `MoveTree.tsx`, `RepertoirePanel.tsx`, and all AG-3
screen-reader work remain unchanged. AG-3 remains the only gate blocking WP-011.
