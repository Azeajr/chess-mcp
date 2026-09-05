# PWA implementation handoff

Updated 2026-09-05. Recovered from Codex session
`01a06f65-e3bb-7c92-ace0-e9b9292d3abc` (2026-09-04).

## Authorized work

The user asked to verify the three PWA/browser drafts, consolidate the supported findings,
remove the drafts, and apply the reduced review's recommendations. They then requested this
handoff before the previous session ended, then authorized committing and pushing the completed
work. No release or deployment was requested.

Keep `PWA_TESTING_REVIEW.md` as the consolidated audit. The three superseded drafts were
removed; backups remain in `/tmp/chess-mcp-pwa-drafts.5yaqo2`.
The existing `package.json` change to pnpm 11.25.0 belongs to the user and must be preserved.

## Implementation already present

- `apps/ui/vite.config.ts`: precache `openings.tsv`.
- `apps/ui/test/pwa-build.test.mjs`: validate manifest, local referenced assets, engine files,
  opening data, and absence of test bridges from deployable output.
- `apps/ui/test/pwa-lifecycle.mjs`: verify ordinary production offline reload, document
  restoration/edit persistence, cached assets, fresh Stockfish worker, opening lookup, and
  online-only evaluation unavailability; retain A/B waiting, deferral, Later, and Reload checks.
  Flagged A/B builds go to temporary directories so they cannot replace the deployment artifact.
- `apps/ui/src/index.tsx`: flagged production command bridge uses the canonical browser registry;
  development announcement reset returns an awaitable promise. Three affected browser specs updated.
- `packages/chess-tools/test/core/net-helpers.ts`: failure-safe fetch/timer teardown shared by
  four network suites. New helper regression tests cover passing and deliberately failing tests.
- `.github/workflows/ui-checks.yml`: reusable validation and revision-named production artifact.
  CI calls it; deployment requires it and downloads its artifact. Both push branches and manual
  dispatch share that dependency. Validation and deployment use Node 26.

## Verified in the previous session

- Missing precache entry and leaked fetch identity reproduced before their fixes.
- 40 network tests passed, including both teardown regressions (also rerun successfully today).
- All-package typecheck passed.
- Production build assertions passed before and after the expanded offline/A-to-B lifecycle run.
  Offline opening lookup and cloud unavailability assertions completed successfully.
- Actionlint 1.7.12 passed for all three affected workflows. Verified binary is in the draft backup
  directory above.
- Earlier audit: 45 repeated container executions for keyboard/update behavior passed. These
  predate the new announcement-reset test and do not validate that new test.

## Completion (2026-09-05)

- Authoritative container: 117 passed across Chromium, Firefox, and WebKit for
  `core-keyboard.spec.ts`, `core-status.spec.ts`, and `pwa-update.spec.ts` (1.3 minutes test time).
- UI unit suite: 397 passed, no failures or skips.
- Core-test TypeScript compilation passed; the 40 focused network tests passed again.
- Review now distinguishes the original audit from implemented changes and no longer links to
  removed drafts. Roadmap removes the completed fetch-cleanup item and qualifies the unproven
  keyboard-failure explanations.
- Focused ESLint and formatting checks passed after declaring the lifecycle harness's browser
  globals and formatting three test files. Workflow lint, documentation consistency, production
  build assertions, and `git diff --check` also passed in this session.

No implementation or local validation steps remain. Browser exclusions are unchanged.
This was a focused validation pass, not a full repository E2E run.

No live deployment or native OS installation has been performed. Workflow dependency and artifact
identity can be checked locally; their first hosted execution remains external validation.
