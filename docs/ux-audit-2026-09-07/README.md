# Source reports, 2026-09-07 collective UX audit

Seven agents each wrote a UX review report into its own secondary worktree. Those worktrees have
been pruned; none held a commit that was not already in `main`, so the reports were the only thing
worth keeping and they are copied here unedited.

**These reports are not the authority.** `UX-COLLECTIVE-FINDINGS.md` is, and it denied a number of
the claims made below on evidence — a report labelled for a workflow is not proof that the workflow
was exercised. Read a report here only to see what a source actually claimed; read the findings
document for what survived scrutiny. Its source table maps each ID (R, RP, A, P1, SF, P2, I) to the
file it came from.

Two limits worth knowing before trusting a line in these files:

- The run evidence they cite — screenshots, `manifest.json`, `faults.json`, `vite.log` — lived
  beside each report under a gitignored `.ux-review/` tree and was **not** preserved. Every path
  these reports cite into `.ux-review/` or `.worktrees/` is now dangling.
- The CT Black PGN copies in those worktrees were not preserved either. They were byte-identical to
  the working copy already present and are personal data the repository deliberately ignores.

| File                               | ID  | Worktree branch suffix                     |
| ---------------------------------- | --- | ------------------------------------------ |
| `t_53320821-review.md`             | R   | `ux-review-review-workflow-using-ct-black` |
| `t_5f8d81d4-repertoire.md`         | RP  | `ux-review-repertoire-workflow-using-ct-b` |
| `t_600f1d16-annotation.md`         | A   | `ux-review-annotation-workflow-using-ct-b` |
| `t_b85da789-position.md`           | P1  | `comprehensive-ux-review-for-chess-mcp-us` |
| `t_d6efc732-strategic-fit.md`      | SF  | `ux-review-for-chess-mcp-using-docs-ux_re` |
| `t_d9a909fb-position.md`           | P2  | `ux-review-position-workflow-using-ct-bla` |
| `t_d61aace4-workflow-inventory.md` | I   | `discover-all-ux-workflows-in-chess-mcp-f` |
