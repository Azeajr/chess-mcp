# Roadmap

This file lists unshipped work only. Current behavior belongs in `README.md`, `docs/`, source, and
tests; completed chronology belongs in Git history and releases.

## Release verification

Run these journeys on release candidates; deterministic tests cover their contracts but not every
native browser, provider, resource-usage, or external-client behavior:

1. Open a repertoire and ask “What are the biggest problems here?” without choosing a preset.
2. Ask naturally for prescribed-move audit, only moves, structure search, opponent preparation,
   and annotated repertoire export; confirm each exact operation is selected.
3. Evaluate a position, then ask “what about g4?” and confirm the follow-up remains grounded.
4. Switch position → repertoire → game work in one conversation without losing command access.
5. Navigate from a chat finding to the exact board position.
6. Request a replacement, reject its preview, request another, then accept it.
7. Run the same audit directly without an API key and compare its semantics with chat.
8. Cancel representative audit, only-move, gap, shortening, annotation, and game scans; confirm
   prompt settlement, no late artifact/cache write, bounded CPU recovery, and clean retry.
9. Review a game, inspect a mistake, and save the annotated PGN.
10. Generate and save annotated-repertoire PGN and only-move CSV artifacts from chat and direct UI.
11. Confirm IndexedDB autosave and browser file reopen across a production-build restart.
12. Exercise supported OpenRouter models with the complete tool payload and record tool selection,
    follow-up quality, latency, context/billing impact, and provider/model payload limits. Run
    `OPENROUTER_API_KEY=… OPENROUTER_MODELS=model-a,model-b pnpm verify:openrouter` to exercise the
    actual chat store and emit a credential-free JSON report.
13. Exercise all synchronized Claude Code plugin workflows after contract or skill changes.

## Linting

Phase 1 (landing now): ESLint 9 flat config, type-aware `typescript-eslint`
(`strictTypeChecked` + `stylisticTypeChecked`) scoped to each package's `src`,
`eslint-plugin-solid` (`flat/typescript`) scoped to `apps/ui/src`, non-type-checked
linting for tests/scripts/config files outside each tsconfig's `include`. Oxfmt as a
separate formatter, not wired into ESLint. No root `tsconfig.json` exists — only
`tsconfig.base.json`, which each package's tsconfig extends.

Phase 2 (add after phase 1 is clean and run for a while, one at a time, not bundled):

- `eslint-plugin-import-x` + `eslint-import-resolver-typescript` for import hygiene.
- `eslint-plugin-security` (start with `detect-object-injection` at `warn`, known noisy).
- `eslint-plugin-regexp`.
- `@vitest/eslint-plugin` scoped to `*.test.ts`; `eslint-plugin-playwright` scoped to
  `apps/ui/test/e2e`.
- `knip` for dead exports/dependencies, as its own script, not folded into `lint`.
- `eslint-plugin-unicorn`, pinned to the last ESLint-9-compatible release, once core
  rules are settled (current Unicorn requires ESLint 10.4+).

Do not bundle phase 2 additions into one PR — each plugin needs its own signal-to-noise
pass against this repo before enabling by default.

## Built but not wired

The nineteen knip-flagged symbols an earlier audit found here are resolved. Thirteen were genuinely
dead (a taxonomy declaration nothing rendered, plural "list every staged item" readers whose
singular "current item" sibling was already wired and whose product design deliberately keeps one
staged item active at a time, and a handful of unused type aliases) and were deleted rather than
kept as decoration. Five had a real missing affordance and are now wired: `clearComplementary` and
`clearSuggestions` are Clear buttons on the Extend-here and chat-suggestions panels;
`strategicFitArchivePayload` backs a "View archived line" control on `ResolutionProof` that fetches
a past accepted change's pruned PGN by its durable `archive_id` reference;
`exportStrategicFitTrainingPerformance`/`importStrategicFitTrainingPerformance` back Export/Import
controls in `ProfileSettings`'s data-sources section, now that `DrillRunner` produces real attempts
worth exporting.

One is deliberately left unwired: `flushStrategicFitTrainingPerformance` forces a pending debounced
IndexedDB write. Nothing in this app calls it because nothing in this app has a page-unload/lifecycle
flush hook of any kind — wiring it would mean inventing that pattern from scratch, not connecting to
an existing one, which is a different and larger change than closing a dead-code gap.

## Deliberately ungated

CI does not gate these, and that is a decision, not an oversight. Each has resurfaced as an audit
finding at least once; the reasoning lives here so it stops being rediscovered as a defect.

- **Live provider paths (`SMOKE_NETWORK=0`).** `apps/mcp-server/test/smoke-client.mjs` runs with
  network assertions gated out, so the live Lichess and Chess.com paths are never exercised in CI.
  Turning them on buys a job that fails on someone else's outage, on a schedule nobody controls,
  for a signal that is almost never about a change in this repo. The provider clients are covered
  deterministically instead; run the smoke script with `SMOKE_NETWORK=1` locally when touching
  `apiclient.ts`, `games.ts`, or `cloudeval.ts`.
- **Warm eval cache (`EVAL_CACHE_DIR=0`).** CI runs cold on purpose — a warm-cache dependency would
  make results depend on runner state carried between jobs, which is exactly the kind of hidden
  coupling that makes a red build unreproducible. The cache's own behavior is covered by
  `apps/mcp-server/test/cache.mjs`.
- **`pnpm verify:openrouter`.** Spends real OpenRouter tokens on every invocation and needs a live
  API key in repository secrets. It is a release-verification journey (see above), run by hand
  against candidates, not a per-push gate.
- **`pnpm bench:strategic-fit`.** The baseline JSON is committed, but no gate consumes it. Timing
  on shared GitHub runners varies enough that a threshold tight enough to catch a real regression
  also fires on neighbour noise, and a threshold loose enough to be quiet catches nothing worth
  catching. Treat the baseline as a local before/after instrument for performance work.

A gate that flaps gates nothing — it trains you to ignore a red build. That is the same reasoning
that retired the `AG-*` accessibility pipeline; prefer no gate over a gate nobody trusts.

## Follow-up quality work

- **Investigate `core-keyboard.spec.ts` "WP-014 AC-3" if the historical failure recurs.**
  September 2 runs reported a missing `2 legal destinations.` announcement, but nine fresh
  container executions in the September 4 audit passed. The broad gridcell focus check is a
  hypothesis, not a demonstrated cause. The announcement-reset bridge is now awaitable; this
  does not establish that it fixed the historical failure. Capture focused square, selection,
  reset completion, and announcement history before changing assertions or dismissing a failure.
  See [the verified PWA/browser review](PWA_TESTING_REVIEW.md).
- **A training target is keyed more coarsely than the drills that map to it.** `target_id` hashes
  `(training_id, position_id, decision_id)` in `strategic-fit/training.ts`, while drills dedupe on
  `(position_id, expected_san)` — so two drills sharing a position and decision but differing in
  expected move would collapse onto one target and pool their recall evidence. No reachable case
  was constructed: the causal-move and checkpoint drills at one node should yield the same SAN and
  dedupe before that happens. Worth a comment at `strategicFitTrainingTargetForDrill` recording why
  the mapping is safe, since its docstring currently presents the match as exact.
- **`<button>` inside `<summary>` in `RepertoirePanel`.** Every `rep-section` summary holds
  interactive content — a `<Select>`, a `scan-btn`, and now a Clear button — which is invalid HTML
  and exposed inconsistently by assistive tech, `<summary>` being interactive itself. It is the
  panel's idiom rather than a slip, and `core-a11y.spec.ts:56-57` pins both the summary and the
  nested button as keyboard-reachable, so it works today. Fixing it means restructuring every
  `rep-section` summary, not patching one button; expect it to resurface in review until then.
- **Announcement assertions in `core-keyboard.spec.ts` read the log once, without retrying.**
  `announcementLog` is awaited immediately after a keypress while neighbouring locator assertions
  poll. Selection and history insertion are synchronous, so a delayed-announcement failure has
  not been established. Revisit polling only if a recurrence supplies evidence for that mechanism.
- **`positionKey` compares the en-passant field verbatim, so a stale target breaks transposition
  matching.** The key is the first four FEN fields, and the library only records an en-passant
  target when a capture is actually legal — `makeFen` after 1. e4 ends `KQkq -`, not `KQkq e3`.
  Every FEN generated inside the library is therefore self-consistent, but a FEN supplied from
  outside that still carries `e3` keys differently from the same position generated internally, and
  the transposition is silently missed. Normalising through `validateFen` at the boundary would
  close it. Pinned by a test in `test/core/congruence.test.ts`.
- **Castling must be spelled `O-O`; `0-0` is rejected.** `validateLine` defers to chessops'
  `parseSan`, which accepts only the letter-O spelling, so a line containing the digit form fails
  at the castling index instead of being normalised. The digit form is common in PGN emitted by
  other tools and is exactly what a chat-proposed line is liable to contain, and `validateLine`
  exists to vet chat-proposed lines. Normalising `0-0`/`0-0-0` on input would cost little; the
  current behaviour is pinned by a test in `test/core/validate.test.ts` so changing it is
  deliberate.
- Add summary-to-detail references where any result still approaches model-context limits.
- Measure long-scan progress and cancellation on representative large repertoires.
- Revisit public-tool consolidation only with usage evidence. Preserve summary/detail/artifact
  bounds, host adaptations, and migration guidance for external MCP clients.

## Design follow-ups

Deferred deliberately during the UI/interaction passes. Each was considered, priced, and left —
the reasoning lives here so it stops being rediscovered as an oversight. Ordered roughly by value.

- **A persistent finding rail in Strategic Fit.** The review loop's missing edge is closed (the
  Resolution stage offers the next unresolved finding), but the queue itself still disappears
  whenever the reader leaves it, so there is no sense of how much of a twelve-finding pass is
  left or what is coming. A read-only rail — finding title plus state pill, no resolution
  controls — would restore that without reopening WP-033: the constraint that broke the old wide
  tier was the same _controls_ rendering into two panes, and a rail renders none of them. This is
  the master/detail idea, scoped to what WP-033 actually forbids. Do not revert `data-stage`;
  four suites and four `@visual` baselines assume one pane at a time.

- **The Strategic Fit entry card is a permanent cold-start pitch.** WP-023 pins the title as a
  question about the reader's repertoire rather than the feature's name, and that reasoning is
  sound on first encounter — "Strategic Fit" means nothing to someone who has not used it. It is
  scoped wrong, not written wrong: on the eleventh visit the question is the loudest thing in a
  column whose job is a list of tools, on a document that may be empty.

  Spiked 2026-09-03, and the good version is not reachable yet. `strategicFitMetadata()` is
  document-scoped, persisted to IndexedDB and restored at startup by `restoreStrategicFitMetadata()`,
  so `resolutions.length > 0` answers "has this document ever had a decision recorded" outside the
  workspace. But only _recorded decisions_ are persisted — the finding set lives in the report,
  and the report lives in the workspace lifecycle, which is idle until the workspace is opened and
  analyzed. So the card can learn a boolean and nothing else; "3 unresolved from your last review"
  has no source. Overturning a pinned invariant to swap one pitch for a weaker pitch is not worth
  it. This becomes cheap and genuinely better the moment a completed report — or just a summary
  count — is retrievable at load; `getCachedStrategicFitReport` is keyed by PGN and options and is
  the obvious place to hang that.

- **The chat column is ~350×720px of nothing while the assistant is unconfigured.** The starters
  now render unconfigured, which gives the column something to say, but the column is still full
  width for a panel that cannot be used. Collapsing it is a layout-store change, not a CSS one:
  `--tier-panel-min-width: 240px` and the `≥192px` chat assertion in `core-layout.spec.ts` are
  both written against "visible", and a 40px rail is visible. The work is teaching those rules a
  _collapsed_ state; the styling afterwards is trivial. Unmounting is not an option — the panel
  stays mounted so the chat log survives tab switches.

- **The `Repertoire` top-bar menu is ambiguously named.** It is the document menu (Open, Re-link,
  New, Recover) in an application whose documents are repertoires, so the name describes the
  domain rather than the action. This is not theoretical: once the chat starters began rendering
  unconfigured, `getByRole("button", { name: "Repertoire" })` in `core-layout.spec.ts` matched
  both the trigger and a starter reading "Suggest a line that fits the rest of my repertoire."
  The locators are exact now, but a reader gets no such qualifier. `WP-017` pins the trigger's
  accessible name across several tests, so renaming it is a contract change, not a copy change.

- **The chat setup card's body now restates what the starters demonstrate.** "The assistant
  answers questions about the current position, game, and repertoire" sits directly under three
  concrete examples of exactly that. The sentence should shrink to the part the starters cannot
  show — that it needs an OpenRouter key — but `chat-setup.spec.ts` asserts
  `/assistant answers questions/i`, so this is a coordinated copy-and-test change.

- **The Overview stage leads with absences.** "Strategic map unavailable" and the concept heatmap's
  empty state occupy the top of the stage before any finding is summarised. The heatmap no longer
  repeats its own heading, but the ordering is unchanged: what the report _found_ should precede
  what it could not draw, and two unavailable visualisations should collapse into one quiet line
  rather than two full-width cards.

- **The decision-flow chart carries almost no information for its size.** Four ~30px columns, 300px
  tall, uniformly dark, with labels floating at their vertical centres and no colour encoding —
  it reads as a broken chart rather than as a flow. Assessed only against the deterministic worker
  fixture, where every step is a single route, so measure it against a real multi-cohort report
  before redesigning: the encoding may be fine and the fixture degenerate.

- **The finding card is still dense below its title.** The title now leads and the scope labels
  recede, but six facts, a priorities line and a disclosure remain at 0.7–0.8rem. The facts are
  already value-first strings ("78% weighted baseline"); giving the numbers their own weight means
  splitting value from label in `buildFindingCardPresentation`, which is a presentation-layer
  change rather than a stylesheet one.

- **`strategic-map-print-linux.png` captures the application behind it.** The snapshot's element is
  transparent in print-and-export mode, so the chat column and repertoire panel show through and
  any unrelated layout change on the main shell drifts this baseline — it was regenerated twice in
  one session for changes that had nothing to do with the strategic map. Give the print view an
  opaque ground, or scope the snapshot to an element that has one.
