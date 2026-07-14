# Canonical tool/application contract

Phase 1 introduces `packages/chess-tools/src/tool-contract.ts` as the dependency-free registry for
tool identity, user-facing descriptions, capability classification, host availability, and shared
defaults. It deliberately does not import SolidJS, the MCP SDK, Zod, OpenRouter, or host state.

The domain algorithms remain in `packages/chess-tools`. The registry is the thin application
contract above them:

- MCP keeps Zod at its transport boundary and injects Node concerns: repertoire handles, the
  Stockfish process pool, explorer credentials, and confined filesystem access.
- Browser chat keeps JSON Schema at its transport boundary and injects the current `GameTree`,
  browser Stockfish workers, browser credentials, and current position/PGN defaults.
- Shared descriptions and browser JSON Schemas are emitted directly from the registry. All browser
  tool calls are validated there at runtime. MCP retains Zod as its transport adapter, and the
  stdio smoke mechanically compares every live Zod-generated schema (fields, requirements, enums,
  and bounds) with the canonical definition. Shared behavioral defaults are read with
  `toolDefault`; host-only defaults (such as an omitted browser FEN meaning the current board)
  remain explicit adapter behavior.
- Host-only operations are classified in the registry. Node handle/file operations are MCP-only;
  `propose_line` is a browser-only staged action.

Each contract also records its host adaptation: current-FEN/PGN injection, current-tree versus MCP
handle lookup, and the few intentional result differences (`get_position`, MCP verbose game review,
and clone-on-write handle edits versus browser previews). Shared application result/orchestration
functions live in `tool-operations.ts`; they cover position grounding/evaluation, repertoire gaps
and read projections, game review/annotation/batch review, and history aggregation. Engine, explorer,
filesystem, and state implementations are passed or selected by the host adapter.

Result values are classified as `data`, `artifact`, or `action` in the registry. Host adapters may wrap them for transport (MCP text
content) or attach documented context (the browser's current document). Artifacts are tagged by the
`artifact` capability; staged mutations by `action`. Phase 3 will add richer artifact/action result
models without coupling them to either transport.

`scripts/tool-contract-inventory.mjs` mechanically checks that every registered/exposed tool is in
the canonical registry and appears on exactly the classified hosts. This permits Zod and browser
JSON Schema to remain appropriately host-shaped while preventing unreviewed surface drift.
