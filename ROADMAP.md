# Roadmap

Only unshipped work belongs here. Git history records completed work.

## Settled — do not reopen

The 2026-09-07 UX audit denied these proposals on evidence, and the five completion journeys that
followed (2026-09-08) shipped their confirmed findings. Re-implementing one undoes a decision rather
than closing a gap. Each already exists in the code named beside it:

- Document menu (`DocumentMenu.tsx`), save confirmation (`store/files.ts`), move-tree keyboard
  navigation (`MoveTree.tsx`), last-move highlighting and the board cursor (`Board.tsx`), profile
  explanation (`strategic-fit/ProfileSetup.tsx`), modal focus trap and return (`primitives/Dialog.tsx`).
- Touch target sizes were settled by measurement, not opinion: zero controls fall below 44px on the
  phone profile, guarded by `apps/ui/test/e2e/collective-ux-fixes.spec.ts`.
- Tours, global reorganization, profile animations and additional badges were rejected as subjective
  preferences rather than demonstrated defects.

## Coverage the completion journeys did not claim

Five journeys — game review, position, annotation, repertoire, Strategic Fit — were each driven
through `pnpm ux:review` and replayed after their fixes. What they deliberately left untested, worth
knowing before trusting the workflows broadly:

- Every journey ran White against one fixture. No journey used a Black repertoire, so there is no
  CT-specific coverage despite what the original source reports implied.
- Game review is not reproducible run to run: the same seed produced different worst moves, because
  browser engine search is time-sensitive. Strategic Fit, being engine-free, is reproducible.
- No Strategic Fit review was completed, so "Finish the review" and its summary export are unproven
  end to end. Cancel was available in several flows but never pressed to completion.
- Error paths beyond those with tests: game review losing the engine mid-scan, promotion moves,
  `get_legal_moves`, cloud-eval and tablebase paths, and the Replacement Lab, which no finding in
  the fixture made available.

## Quality

- Add lint rules separately after measuring repository signal: import hygiene, security, regular
  expressions, test-specific rules, dead exports, then an ESLint-9-compatible Unicorn release.
- Decide whether `flushStrategicFitTrainingPerformance` needs a page-lifecycle integration.
- Fix invalid interactive controls nested inside repertoire `<summary>` elements.
- Normalize externally supplied en-passant fields before transposition keying.
- Accept digit-zero castling forms in proposed SAN lines.
- Add summary-to-detail references where results approach model context limits.
- Measure progress and cancellation on representative large repertoires.
- Revisit public-tool consolidation only with usage evidence.

Live provider checks, warm-cache behavior, OpenRouter verification, and performance benchmarks stay
outside per-push CI because they depend on external uptime, credentials, persistent state, cost, or
machine timing. Their deterministic components remain tested. Run them manually for relevant
changes and release candidates.

## Product

- Add a read-only Strategic Fit finding rail without mounting resolution controls twice.
- Replace the permanent Strategic Fit cold-start pitch once report summary state is available at
  document load.
- Support a collapsed chat rail while preserving mounted conversation state.
- Rename the top-bar `Repertoire` document menu.
- Reduce chat setup copy to the OpenRouter requirement.
- Lead Strategic Fit Overview with findings and combine unavailable-visualization states.
- Validate the decision-flow chart against a real multi-cohort report before redesigning it.
- Increase value/label hierarchy on dense finding cards.
- Give strategic-map print capture an opaque background.

## Release checks

- Exercise natural chat requests across position, game, repertoire, and Strategic Fit workflows.
- Verify navigation, staged accept/reject, archive, undo, cancellation, retry, and artifact saves.
- Compare direct and chat-backed results for shared operations.
- Verify IndexedDB restore and file reopen across a production-build restart.
- Exercise supported OpenRouter models with `pnpm verify:openrouter`.
- Exercise synchronized plugin workflows after contract or skill changes.
