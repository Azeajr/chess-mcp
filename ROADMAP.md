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

## Known accessibility defects

Real defects in shipped code, deliberately deferred. Each one names how it was found so it can be
re-verified rather than re-argued.

- **Replacement Lab's focus trap is broken on macOS.** `strategic-fit/ReplacementLab.tsx:196-220`
  moves focus explicitly only at the wrap boundary and relies on native `Tab` traversal in
  between. macOS ships Safari's "Full Keyboard Access" off by default, which makes native `Tab`
  skip `<button>` elements entirely, so a Mac user tabbing through the Lab loses focus mid-dialog.
  This is the same defect that real VoiceOver CI evidence caught in `StrategicFitWorkspace.tsx`
  and that commit `85b3e2a` fixed there; the Lab was left alone because it has **no keyboard or
  focus e2e coverage at all** and no AT-tier evidence of its own.
  - Fixing it means porting all four parts of the Strategic Fit fix together — explicit `Tab`
    movement, radio groups collapsed to one stop, contents of a closed `<details>` excluded, and
    `tabindex="-1"` members excluded. Porting only the first part reintroduces a worse bug: the
    Lab has two `<details>` (`:450`, `:614`), and focus would park on the first `<summary>`
    permanently.
  - No work package owns this. `WP-007` touches the Lab only for `UX-045` (adding `inert`
    alongside `aria-hidden`), and `WP-033` migrates Strategic Fit, not the Lab, onto the `Dialog`
    primitive. It needs either its own package or an explicit addition to one of those.
  - Suggested order: write the missing keyboard e2e coverage first, then port the fix, then verify
    on all three engines via `pnpm test:e2e:container`.

## Follow-up quality work

- Add summary-to-detail references where any result still approaches model-context limits.
- Measure long-scan progress and cancellation on representative large repertoires.
- Revisit public-tool consolidation only with usage evidence. Preserve summary/detail/artifact
  bounds, host adaptations, and migration guidance for external MCP clients.
