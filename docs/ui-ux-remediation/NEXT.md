# Next step

The next executable UI/UX remediation package is **WP-011 — InteractiveRow and MoveButton**.

WP-011 is executable because DV-2 is resolved and AG-3 is now its completion gate: implement the
move tree, run the automated accessibility checks, then complete the required NVDA and VoiceOver
validation before marking the package complete.

Other dependency-satisfied candidates remain blocked by unresolved gates:

- **WP-007** — AG-1
- **WP-009** — AG-5
- **WP-021** — PD-4
- **WP-030** — PD-6

WP-011 remains the highest-leverage package: it resolves the critical keyboard-operability gap and
unlocks WP-015, WP-022, and WP-029. DV-2 is resolved through its documented inconclusive-evidence
default, with two synthetic proxy evaluations recorded in its decision record. AG-3 is the required
completion gate for the implemented move tree.

After completing a package, derive the next handoff from the live manifest and state, update this file,
then explicitly stage the completed package's scoped files, `state.json`, and `NEXT.md` before
committing and pushing. Preserve unrelated dirty-worktree changes.
