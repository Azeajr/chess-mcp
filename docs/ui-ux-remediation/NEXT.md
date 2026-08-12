# Next step

No UI/UX remediation package is currently executable from the live manifest and state.

The dependency-satisfied candidates are blocked by unresolved gates:

- **WP-007** — AG-1
- **WP-009** — AG-5
- **WP-011** — AG-3
- **WP-021** — PD-4
- **WP-030** — PD-6

After its gates are recorded, **WP-011 — InteractiveRow and MoveButton** is the highest-leverage
next package: it resolves the critical keyboard-operability gap and unlocks WP-015, WP-022, and
WP-029. DV-2 is resolved through its documented inconclusive-evidence default, with two synthetic
proxy evaluations recorded in its decision record. Its only remaining gate is AG-3&rsquo;s NVDA and
VoiceOver move-tree evaluation; do not implement it until `pnpm ux:task WP-011` reports ready.

After completing a package, derive the next handoff from the live manifest and state, update this file,
then explicitly stage the completed package's scoped files, `state.json`, and `NEXT.md` before
committing and pushing. Preserve unrelated dirty-worktree changes.
