# Roadmap

This file lists unshipped work only. Current behavior belongs in `README.md`, `docs/`, source, and
tests; completed chronology belongs in Git history and releases.

## Product review completion

- Run the Phase 7 automated suite and manual product journeys in `PROJECT_REVIEW_PLAN.md`.
- Add headless Chromium coverage for the critical end-to-end journeys: natural chat routing,
  navigation from findings, stale staged edits, cancellation, artifact saving, and direct/chat
  command equivalence.
- Confirm autosave and browser file reopen behavior across a production build.
- Exercise the Claude Code plugin workflows after the final documentation and contract checks.

## Follow-up quality work

- Add summary-to-detail references where any result still approaches model-context limits.
- Measure long-scan progress and cancellation on representative large repertoires.
- Revisit public-tool consolidation only with usage evidence; follow
  `docs/TOOL_SURFACE_DISPOSITION.md` and preserve migration guidance for external MCP clients.
