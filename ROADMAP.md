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

Found by running `npx knip` and then reading each result rather than trusting the count. These
twenty symbols are referenced nowhere, but they sit inside live modules and look like unfinished
wiring, not leftovers. Deleting them would throw away working code; they are listed so the next
audit stops re-reporting them as dead exports.

- **There is no drill-attempt UI, so no training attempt can ever be recorded.** This is a missing
  feature, not broken wiring. An earlier revision of this entry called it a bug and said the
  displayed figures were "permanently zero for every user"; that was wrong and is corrected here.
  Registration _is_ wired — `TrainException.tsx:55` calls `createStrategicFitTrainingItem`, which
  reaches `register()` in `store/strategic-fit-training.ts:1101` — so creating a drill does write a
  target, and `ProfileSettings.tsx:195` counts real ones. What no screen offers is a way to _attempt_
  a drill, which is the only thing that may call
  `recordStrategicFitTrainingPerformanceAttempt`.
  - Registering a target and recording an attempt are deliberately separate: registration
    establishes an explicitly untrained state, and only a real attempt supplies recall,
    response-time, lapse, confidence, and spacing evidence. That contract is stated on
    `StrategicFitTrainingPerformanceBoundary` and pinned by the test "training targets remain
    explicitly untrained until a real attempt exists".
  - So do **not** close this by calling the writer from drill creation. That would fabricate recall
    and response-time evidence the user never gave and corrupt every mastery figure derived from
    it. Closing it properly means building the drill surface: show the position, take a move,
    time the response, and record the outcome.
- **Training performance import/export.** `exportStrategicFitTrainingPerformance`,
  `importStrategicFitTrainingPerformance`, and `flushStrategicFitTrainingPerformance` are complete
  and unreachable — there is no UI affordance for any of them. Of limited use until a drill surface
  exists, since only registered targets, never attempts, would round-trip.
- **Unread store accessors.** `strategicFitStagedChanges`, `strategicFitPlanCards`,
  `strategicFitPortfolioConstraintSets`, `strategicFitProfileProposals`, and
  `strategicFitArchivePayload` expose state nothing renders. Each store's mutations are wired; only
  these readers are orphaned.
- **Orphaned clear actions.** `clearComplementary` (`store/repertoire.ts`) and `clearSuggestions`
  (`store/suggestions.ts`) have no caller, so those two surfaces cannot be reset from the UI.
- **Smaller ones.** `browserImplementationNames`, `getLastStrategicFitJobRecovery`,
  `REPERTOIRE_SECTION_LABELS`, `REPERTOIRE_COMMAND_TOOLS`, `schemasSemanticallyEqual`, and the
  types `RepertoireGroupTitle`, `ToolExecutionOptions`, `StrategicFitChangeController`,
  `StrategicFitChangeSetStageSuccess`.

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
