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
- A read-only Strategic Fit finding rail. The workspace shows exactly one pane at every width
  (`[data-stage]` in `styles.css`, settled 2026-09-02 with regenerated visual baselines), and a rail
  is a second simultaneous pane. The double-mount hazard the proposal warned about does not exist
  either: `ResolutionActions` and `FindingQueue` are each mounted once, in `StrategicFitWorkspace.tsx`.
- Cutting the chat setup card back to the OpenRouter requirement. The card deliberately replaced a
  terse "No API key. Open Settings" line, because an unconfigured panel is the one place a reader has
  no idea what an assistant in a repertoire app is for. The reasoning is in `ChatPanel.tsx` beside
  the code. Shortening it reverses that.

## Coverage the completion journeys did not claim

Five journeys — game review, position, annotation, repertoire, Strategic Fit — were each driven
through `pnpm ux:review` and replayed after their fixes, all White against one fixture. The
repertoire journey was then re-driven (2026-09-08) against both real CT repertoires, White and
Black. What remains untested, worth knowing before trusting the workflows broadly:

- Only the repertoire journey has been driven on a Black repertoire and on a tree larger than the
  fixture. Game review, position, annotation and Strategic Fit are still White-on-fixture only.
- Strategic Fit was not opened in either CT session, so its cost on a 62-leaf, 265-decision-node
  tree is unmeasured, and neither was the annotated export, whose own bound is 60 positions.
- The gap scan's truncation note is unit-tested but never rendered: neither CT repertoire produced
  more than the 12 gaps `limit` keeps, and no seam injects gap rows.
- `total_gaps` from `find_repertoire_gaps` is still counted after `limit` truncates, so it is the
  returned count rather than the found count. Nothing user-facing reads it, but `enginetools.ts`
  compares `before_total`/`after_total` across two scans in the replacement-safety path and both
  sides saturate at `limit`. Deliberately left alone rather than changed inside a UX fix.
- Game review is not reproducible run to run: the same seed produced different worst moves, because
  browser engine search is time-sensitive. Strategic Fit, being engine-free, is reproducible. The
  repertoire journey's audit and gap scan did reproduce exactly across reset on both CT sides.
- No Strategic Fit review was completed, so "Finish the review" and its summary export are unproven
  end to end. Cancel was available in several flows but never pressed to completion.
- Error paths beyond those with tests: game review losing the engine mid-scan, promotion moves,
  `get_legal_moves`, cloud-eval and tablebase paths, and the Replacement Lab, which no finding in
  the fixture made available.

## Quality

- Add lint rules separately after measuring repository signal: import hygiene, security, regular
  expressions, test-specific rules, dead exports, then an ESLint-9-compatible Unicorn release.
- Decide whether `flushStrategicFitTrainingPerformance` needs a page-lifecycle integration.
- Normalize externally supplied en-passant fields before transposition keying.
- Accept digit-zero castling forms in proposed SAN lines.
- Add summary-to-detail references where results approach model context limits.
- Revisit public-tool consolidation only with usage evidence.

Live provider checks, warm-cache behavior, OpenRouter verification, and performance benchmarks stay
outside per-push CI because they depend on external uptime, credentials, persistent state, cost, or
machine timing. Their deterministic components remain tested. Run them manually for relevant
changes and release candidates.

## UI/UX pass

One pass over the interface defects that survived assessment (2026-09-08). Each was confirmed
against the code, and each is a demonstrable defect rather than a presentation preference — the
preferences were either removed or moved to **Settled** above. Ordered by evidence, not by size.

- **Print capture drops its own background.** `styles.css` has no `print-color-adjust` anywhere, and
  its two `@media print` blocks only fix overflow and positioning. `.strategic-map` and
  `.strategic-map-chart` do set opaque backgrounds, so the original wording of this item was wrong:
  the defect is that user agents discard backgrounds when printing, so a dark-theme chart prints
  light-on-white. It applies to all three print-export visualizations — `StrategicMap`,
  `ConceptHeatmap` and `DecisionFlow` all carry a `data-*-print-export` attribute — not to the map
  alone.
- **Two different things are both called `Repertoire`.** The top-bar document menu button
  (`DocumentMenu.tsx`) and the analysis panel header (`RepertoirePanel.tsx`) render that word on the
  same screen at the same time; both appear in the CT run's screenshots. Rename the document menu.
- **A `<select>` nested inside a `<summary>`.** The repertoire panel puts 11 interactive controls
  inside `<summary>` elements, which is invalid HTML. The buttons are already worked around —
  `preventDefault()` plus an explicit `openSection()`, guarded by "a scan opens the section its
  results land in" — so they are not the risk. The `Extend here` mode `<select>` is: it has no such
  workaround and no test, and opening a dropdown inside a `<summary>` can toggle the disclosure on
  some platforms. Fix that one and the markup validity together.
- **The chat surface still hides the gap scan's scope.** `find_repertoire_gaps` in `ToolResult.tsx`
  renders bare navigation rows with no summary line, where the neighbouring audit and only-move
  cards both report `positions_scanned`. `positions_available` and `gaps_found` now exist for it to
  use. The chat surface was not driven in the CT run, so this needs a journey rather than a blind
  edit.
- **Three near-identical unavailable states.** `strategic-map-unavailable`,
  `concept-heatmap-unavailable` and `decision-flow-unavailable` are structurally parallel with
  separately worded headings. They are not identical — the map additionally carries an exclusions
  `<details>` — so this is de-duplication with a caveat, and the lowest-value item here.

Drive the pass with `pnpm ux:review` against the CT repertoires rather than the fixture, and use it
to measure progress and cancellation on a tree that is large enough for either to matter: the CT
sessions never pressed cancel to completion, and Strategic Fit's cost on a 62-leaf,
265-decision-node tree is still unmeasured.

Blocked rather than scheduled: replacing the permanent Strategic Fit cold-start pitch needs a report
summary that survives document load, and no such thing exists.
`application/strategic-fit-report-cache` is a per-session compute cache that is invalidated on
edits, colour changes and settings changes. The pitch also carries the reassurance that opening
Strategic Fit does not analyze or change the repertoire, which is worth keeping until there is
something to replace it with.

## Release checks

- Exercise natural chat requests across position, game, repertoire, and Strategic Fit workflows.
- Verify navigation, staged accept/reject, archive, undo, cancellation, retry, and artifact saves.
- Compare direct and chat-backed results for shared operations.
- Verify IndexedDB restore and file reopen across a production-build restart.
- Exercise supported OpenRouter models with `pnpm verify:openrouter`.
- Exercise synchronized plugin workflows after contract or skill changes.
