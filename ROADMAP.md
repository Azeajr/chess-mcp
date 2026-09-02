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

- Add summary-to-detail references where any result still approaches model-context limits.
- Measure long-scan progress and cancellation on representative large repertoires.
- Revisit public-tool consolidation only with usage evidence. Preserve summary/detail/artifact
  bounds, host adaptations, and migration guidance for external MCP clients.
