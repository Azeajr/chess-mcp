# Repertoire design history

Historical status: Python-era proposal, partially inherited by the TypeScript implementation.

Durable decisions were: SAN-list paths; aggregate versus path-specific structural profiles; bounded
LRU/TTL repertoire handles; clone-on-write edits; a closed add/prune/reorder action; structure labels
that prefer `unknown` to a false match; opening-system congruence clusters; forward-transposition
awareness for gap scanning; and artifact export separated from reasoning reports.

Python decorators, module names, Docker assumptions, rejected implementation sketches, build
prompts, and point-in-time output/count claims were removed. Current mechanics live in
`packages/chess-tools`, `apps/mcp-server/src/handles.ts`, and `docs/ARCHITECTURE.md`.
