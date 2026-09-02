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

- **`core-keyboard.spec.ts` "WP-014 AC-3" flakes about one run in three, and one flake reds a
  shard.** Measured 2026-09-02 with `--repeat-each=3` in the container: 1/3 and 2/3 across two
  variants of an unrelated change, so it is the test, not any feature. It presents as a missing
  `2 legal destinations.` announcement, but the announcement is never produced — the `Enter` never
  selects. `announcementHistory` in `store/announce.ts` accumulates and is cleared only by an
  explicit reset, so polling the log cannot fix it; that was tried and reverted. The cause is
  upstream, in `focusBoardCursor`, which Tabs up to 120 times until something reports
  `role="gridcell"` without waiting for the board's roving-tabindex composite to settle, so focus
  lands on the wrong cell or is dropped. Synchronising on the cursor cell being focused — as
  `UX-003` at `core-keyboard.spec.ts:163` already does — before driving keys is the likely fix.
  `retries` is unset in `playwright.config.ts`, so until then a lone red shard on this test is a
  re-run, not a regression.
- **`stubFetch` in `test/core/net-helpers.ts` offers `restore()`, but no test calls it.** The
  helper used to reassign `globalThis.fetch` permanently while `withFakeClock` beside it returned
  an explicit `restore()`; the method closes that asymmetry, but every `.restore()` in
  `test/core/` is still `clock.restore()`. Until callers use it, a test added after the last
  `stubFetch` can still inherit the previous test's canned handler and pass for the wrong reason.
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
  `announcementLog` is awaited immediately after a keypress while every neighbouring
  `expect(locator)` polls. History accumulates, so this is only a narrow race — an announcement
  landing a tick late fails where a polling assertion would pass — and it is currently masked by
  the larger flake above. Fix it with the same `expect.poll` shape when that is addressed.
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
