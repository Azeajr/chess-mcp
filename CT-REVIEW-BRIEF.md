# Brief: UX review against the CT repertoires

For a fresh session. Everything here is current as of 2026-09-08; delete this file once the run is
recorded, the way the previous forward list was deleted when its work closed.

## Why this run

Five completion journeys — game review, position, annotation, repertoire, Strategic Fit — were
driven through `pnpm ux:review` and replayed after their fixes. **Every one of them ran White
against `apps/ui/test/fixtures/ux-review/rich-repertoire.pgn`**, a small synthetic tree. None used a
real repertoire and none used Black, so nothing established that these workflows hold for the
repertoires actually being prepared. That is the gap this run closes.

## The two fixtures

Both sit in the repository root, are **gitignored** (`/*.pgn`), and are personal data:

- `ct-white-repertoire.pgn` — English, 221 nodes, 19 leaves, max depth 21, 4.8 KB.
- `ct-black-repertoire.pgn` — 629 nodes, 62 leaves, max depth 28, 13.6 KB.

Both parse with `GameTree.fromPgn` including their `[%eval …]` comments, verified 2026-09-08.

Rules that follow from them being ignored personal data:

- Never commit them, never copy them into `apps/ui/test/fixtures/`, and never quote a game or
  handle from them in a commit, a PR, or a test. A promoted regression test uses a synthetic
  fixture that reproduces the same shape.
- Never **link** to them or to anything under `.ux-review/` from a markdown file. `pnpm check:links`
  resolves links against `git ls-files` and fails on a path only an ignored file satisfies — this is
  exactly the failure it exists to catch. Cite paths as code spans, as this file does.

## Starting a session

```sh
pnpm install --frozen-lockfile
pnpm --filter @chess-mcp/chess-tools build
pnpm ux:review -- --port 4183 preflight
pnpm ux:review -- --session ct-white --port 4183 start --workflow repertoire \
  --pgn ct-white-repertoire.pgn --color white
pnpm ux:review -- --session ct-black --port 4184 start --workflow repertoire \
  --pgn ct-black-repertoire.pgn --color black
```

`--pgn` takes any repository-contained path, ignored or not. Use a distinct `--port` per concurrent
session, and run one heavy workload at a time. `docs/UX_REVIEW.md` is the method — read it rather
than re-deriving it; it carries the practical notes these runs paid for, including the 180-second
CLI cap, HMR clearing in-memory state, and how to read the container gate's output.

## What is worth watching, given these trees

The CT repertoires are five times the size of the fixture every journey used, which is the point:

- Several scans are **bounded and silent about it**: the gap scan checks 12 positions
  (`apps/ui/src/store/gaps.ts`), the prescribed-move audit 20, the annotated export 60. On a 12-leaf
  fixture those caps never bind. On 62 leaves they do, and the question is whether the reader can
  tell that a clean result means "no problems found in the part that was checked".
- Strategic Fit is engine-free but proportional to route count; expect the analysis and each
  post-resolution reanalysis to take noticeably longer than the seconds they took on the fixture.
- Black changes the side prepared, not the side to move. The board still starts White to move. An
  earlier source report confused those two and its claim did not survive review.
- Depth 21 and 28 mean deep leaves. Watch the current-line ribbon, the move tree, and any card that
  prints a full line for truncation or overflow on the phone profile.

## What is already fixed — do not re-report as new

Each journey's defects shipped with regression cover; the spec names the behaviour:

| Journey                      | Cover                                            |
| ---------------------------- | ------------------------------------------------ |
| Game review                  | `apps/ui/test/e2e/game-review-cards.spec.ts`     |
| Position                     | `apps/ui/test/e2e/position-cards.spec.ts`        |
| Annotation / export download | `apps/ui/test/e2e/export-download.spec.ts`       |
| Repertoire                   | `apps/ui/test/e2e/repertoire-journey.spec.ts`    |
| Strategic Fit                | `apps/ui/test/e2e/strategic-fit-journey.spec.ts` |

`ROADMAP.md` holds two lists worth reading first: **Settled — do not reopen**, which names the
proposals a previous audit denied and the file that already implements each, and **Coverage the
completion journeys did not claim**, which is the honest list of what remains untested. A finding
that lands on the first list is a decision to reverse, not a gap to close.

## Recording the run

Same shape as the five journeys before it: drive only visible controls, read every result from the
rendered card before confirming it against the payload, fix, `reset`, replay the same seed through
the same controls, and promote each finding to a test. Record every attempt including the failures
in the session's own `review.md` under `.ux-review/<session>/`, which stays untracked.

Gates before opening a PR: `pnpm lint`, `pnpm format:check`, `pnpm docs:check`, `pnpm check:links`,
the UI typecheck, `pnpm --filter @chess-mcp/ui test:chat`, then `pnpm test:e2e:container` as the
authority — read its own "N passed / N failed" line rather than a wrapper's exit code.

## In flight at the time of writing

PRs #65 (the clean-checkout link check) and #66 (pruning the closed audit cluster) may still be
open; #66 removes `REMAINING-WORK.md`, `UX-COLLECTIVE-FINDINGS.md`, `docs/ux-audit-2026-09-07/` and
`docs/AGENT_UX_REVIEW_DESIGN.md`, so do not go looking for them.
