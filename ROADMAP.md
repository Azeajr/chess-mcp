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

## Follow-up quality work

- Add summary-to-detail references where any result still approaches model-context limits.
- Measure long-scan progress and cancellation on representative large repertoires.
- Revisit public-tool consolidation only with usage evidence. Preserve summary/detail/artifact
  bounds, host adaptations, and migration guidance for external MCP clients.
