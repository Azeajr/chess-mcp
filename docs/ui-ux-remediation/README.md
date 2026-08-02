# UI/UX remediation execution record

This directory is a derived execution layer for [the source roadmap](../ui-ux-remediation-plan.md). The source plan remains the design record; each package capsule retains its operational sections verbatim where the plan supplies them. `manifest.json` is the machine-readable routing index, and `state.json` is the only progress record.

## Normalized execution corrections

1. **WP-008 uses a small content-label foundation, not the full WP-024 migration.** The source lists `WP-024` only for shortcut labels, but making the whole registry migration an early dependency would pull a broad, later content refactor onto the accessibility path. `content-label-foundation` is a separately tracked prerequisite: it contains only the six shortcut labels and platform-key formatter needed by WP-008. WP-024 remains in its original later position and absorbs this foundation during its full, zero-copy-change migration.
2. **Toast ownership moves from WP-019 to WP-009.** `Toast` is named as a consumer dependency of WP-005 and WP-018 before WP-019 would introduce it. WP-009 now introduces the one reusable presentation primitive beside the live-region infrastructure; it may mirror messages once `announce()` exists. WP-019 is narrowed to the PWA update consumer. WP-005 therefore additionally depends on WP-009, but not on WP-010 or any operation-registry work. This preserves the original consumers and avoids duplicate primitives.
3. **Composite keyboard widgets use one Tab stop.** The board and move tree each expose one composite entry point. Their squares/moves are reached with the package-defined internal arrow-key traversal, not by Tab-walking every child. Baseline reachability checks must assert composite entry and internal traversal, preserving the roadmap's keyboard-completion objective without creating dozens of Tab stops.
4. **The PR plan has 30 table rows, not 26—and omits WP-017.** Its Strategic Fit row is explicitly non-independent and must become three sequential PRs: names/vocabulary; evidence framing/telemetry; stage model/Dialog migration. Adding the omitted WP-017 top-bar IA PR and replacing one Strategic Fit row with three yields 33 independently reviewable PRs. `manifest.json.pullRequests` is the structured source of this accounting, and `ux:plan-check` validates it.

## State rules

- A package starts as `not-started`; it becomes execution-ready only when every manifest dependency is `complete` and every blocking gate is `resolved` with evidence recorded in `state.json`.
- A package lifecycle is `not-started`, `in-progress`, or `complete`; blocked/ready are derived readiness states. Completion requires the package capsule's Definition of Done.
- Do not use a source-plan claim as proof of completion. The initial state intentionally marks every package `not-started`.
- The normal Codex CLI request is `Implement WP-NNN.` Repository instructions make the agent inspect the tree, run `pnpm ux:task WP-NNN`, stop unless it is ready, and follow the emitted capsule through validation and completion verification. `AGENTS.md` is the standing execution protocol; the manifest, package document, and capsule remain authoritative for package-specific requirements.
- Run `pnpm ux:plan-check` after changing the manifest or state. Use `pnpm ux:test WP-NNN` for only that package's mapped tests.
