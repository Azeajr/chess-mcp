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
- Mask the page chrome out of the `strategic-map-print.png` baseline. The map is taller than the
  viewport, so the capture scrolls and the app chrome pinned above it composites into rows 0-98.
  That strip is environment-coupled: the same commit renders identical map pixels in the local
  container and in CI while those rows differ, so the baseline currently has to be taken from CI and
  cannot be regenerated locally. Masking the chrome removes the coupling; the note sits at the
  assertion in `strategic-fit-visualization-hardening.spec.ts`.
- Have a player judge the Strategic Fit profile preset weights in
  `STRATEGIC_FIT_PRESET_PREFERENCES` (`strategic-fit/metadata.ts`). Their direction is locked by
  tests and their effect on real repertoires is measured, but the magnitudes — Familiar plans
  weighting pawn topology 1.5 against dynamic character 0.5, Versatile inverted, memorization
  tolerance 0.2/0.5/0.8 — are a reasoned guess. No test can catch them being wrong about how a
  repertoire actually feels to play.

Live provider checks, warm-cache behavior, OpenRouter verification, and performance benchmarks stay
outside per-push CI because they depend on external uptime, credentials, persistent state, cost, or
machine timing. Their deterministic components remain tested. Run them manually for relevant
changes and release candidates.

## UI/UX pass

The pass ran on 2026-09-08 and its confirmed items shipped. What is left is recorded here, with the
one item that was assessed and deliberately not done.

**Not done, on purpose: merging the three unavailable-visualization states.** `strategic-map-`,
`concept-heatmap-` and `decision-flow-unavailable` render the same shape — heading, reason, and a
`<details>` of excluded routes. (An earlier note here claimed only the map had that `<details>`;
all three do.) They differ in three tokens: the heading, the `data-*-exclusion` attribute name, and
the route-id shortener. Parameterizing that needs a component with more props than the duplication
costs, and the per-chart data attributes that tests select on are worth keeping distinct, so the
duplication stays. The copy inconsistency inside it was the part worth fixing and was fixed: the
decision flow no longer repeats its own `<h3>` in its empty state. The strategic map deliberately
still names itself there, because it renders no section title and its empty state is the only thing
that identifies it.

**Still open: measure progress and cancellation on a representative large repertoire.** Cancel has
never been pressed to completion in any session, and Strategic Fit's cost on a 62-leaf,
265-decision-node tree is unmeasured. Drive it with `pnpm ux:review` against the CT repertoires
rather than the fixture.

**Still open: a chat journey.** The chat-side `find_repertoire_gaps` card now reports what the scan
covered, and its copy is unit-tested, but no session has driven the chat surface — that needs a
provider stub, as `apps/ui/test/fixtures/ux-review/` holds for the game-review and position
journeys.

**Blocked rather than scheduled: replacing the permanent Strategic Fit cold-start pitch.** It needs
a report summary that survives document load, and no such thing exists —
`application/strategic-fit-report-cache` is a per-session compute cache invalidated on edits, colour
changes and settings changes. The pitch also carries the reassurance that opening Strategic Fit does
not analyze or change the repertoire, which is worth keeping until there is something to replace it
with.

## Release checks

- Exercise natural chat requests across position, game, repertoire, and Strategic Fit workflows.
- Verify navigation, staged accept/reject, archive, undo, cancellation, retry, and artifact saves.
- Compare direct and chat-backed results for shared operations.
- Verify IndexedDB restore and file reopen across a production-build restart.
- Exercise supported OpenRouter models with `pnpm verify:openrouter`.
- Exercise synchronized plugin workflows after contract or skill changes.
