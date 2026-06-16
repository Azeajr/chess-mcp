# UI ↔ MCP Bridge — Design Spec

Design for letting the **in-app browser chat** reach the repertoire tools that today only the
Claude Code harness can call. Closes retro issue #6 (`docs/retro-2026-06-16.md`), the root cause
of #3 and #5. Companion to `MCP_DESIGN.md` (tool-surface discipline), `UI_DESIGN.md` (browser
constraints), and `NODE_MIGRATION_DESIGN.md` (the Node MCP server this bridges to).

Status: **implemented** — Vite dev plugin + browser MCP client + curated tool merge + handle
management + graceful degradation, smoke-tested end-to-end (`load_repertoire` → handle →
`find_repertoire_gaps`). This doc is the contract; if reality forces a change, the doc changes in
the same commit.

---

## 1. Background — the gap this fixes

The MCP server (`apps/mcp-server/src/index.ts`) registers **32 tools** over `StdioServerTransport`
(`index.ts:814`). Claude Code spawns it as a stdio subprocess and gets the full surface —
`load_repertoire`, `find_repertoire_gaps`, `get_structural_profile`,
`analyze_repertoire_congruence`, `get_repertoire_coverage`, `get_transpositions`, `batch_review`,
`suggest_complementary_lines`, …

The in-app chat (`apps/ui/src/store/chat.ts`) takes a different path: it calls **OpenRouter
directly** with the **4 active tools** hand-defined in `apps/ui/src/llm/tools.ts`
(`get_position`, `get_legal_moves`, `evaluate_position`, `propose_line`; `cloud_eval` was disabled
in retro #3). It has **no connection to the MCP process**. So the browser model cannot call
`find_repertoire_gaps` or `get_structural_profile`; it falls back to evaluating positions one at a
time — exactly the session pattern that produced retro #3 (per-position double calls) and #5
(hitting `MAX_ROUNDS` before producing structured output).

## 2. The constraint that drives the shape

Two hard constraints set the architecture:

- **C1 — the MCP server is stdio-only.** A browser cannot speak stdio. Something server-side must
  spawn the process and relay over HTTP.
- **C2 — the UI runs under cross-origin isolation.** `vite.config.ts` sets
  `COOP: same-origin` + `COEP: require-corp` (needed for SharedArrayBuffer / threaded Stockfish).
  Any bridge endpoint the browser fetches must be **same-origin** (served through Vite), or it is
  blocked by COEP. This rules out the browser talking to a separate `localhost:NNNN` MCP port
  directly; it must go through a Vite-served path.

A third, non-technical constraint shapes *scope*:

- **C3 — the deployed artifact is a static PWA; the plugin is the distribution target.** In the
  deployed PWA there is **no Node process** alongside the page, so the bridge is inherently a
  **local-dev / self-hosted** capability. In the Claude Code plugin path, the harness already has
  the MCP tools — the browser chat is the only place missing them. So this bridge enriches the
  *dev/self-host* browser experience; it does not change the plugin, and the PWA must still run
  (degraded) with no bridge present.

## 3. Architecture (recommended)

A **Vite dev plugin** spawns the MCP server as a child process over stdio and exposes a single
same-origin endpoint that speaks the MCP **Streamable HTTP** wire format. The browser connects
with the MCP SDK's HTTP client, so the tool list and JSON-RPC framing are spec-compliant and
auto-synced — no second hand-maintained schema list.

```
browser chat ──fetch /__mcp (same-origin, JSON-RPC)──▶ Vite dev plugin
   (MCP HTTP client)                                        │ spawns + pipes stdio
                                                            ▼
                                              apps/mcp-server (Node, stdio)
                                                   the 32-tool backend, unchanged
```

- **Same-origin** (`/__mcp` served by Vite) satisfies C2 — no COEP breakage.
- **Auto-spawn** in `configureServer` means `pnpm dev` just works; no extra process for the user
  to start.
- **Streamable-HTTP wire format** (not an ad-hoc REST shim) keeps the door open to C3's
  self-hosted case later: the same browser client could point at a standalone MCP HTTP server
  without a UI rewrite.

### 3.1 Why not the alternatives

- **Add `StreamableHTTPServerTransport` to the MCP server, run it standalone, browser connects
  direct.** More spec-pure and reusable, but (a) violates C2 unless still proxied through Vite,
  (b) makes the user start a second process, (c) needs new transport wiring in the server. The
  recommended plugin gets the same wire format with auto-spawn and zero server change. If the
  self-hosted case (C3) becomes real, promote the relay into a real transport then — the contract
  doesn't move.
- **Ad-hoc REST shim (one route per tool).** Simplest to write, but re-hand-maintains the tool
  list (the very coupling that caused this gap) and throws away MCP framing. Rejected.

## 4. Tool curation — bridge only what the browser lacks (decision D1)

The browser already runs its **own** WASM Stockfish and owns the live board state. Bridging the
overlapping MCP tools would create two engines and two sources of truth. So the bridge exposes a
**curated subset** — the repertoire-structure tools the browser has no local equivalent for:

| Bridge (add) | Keep browser-native (do NOT bridge) |
|---|---|
| `load_repertoire` / `load_repertoire_from_file` | `get_position` (live board) |
| `find_repertoire_gaps` | `get_legal_moves` |
| `get_structural_profile` | `evaluate_position` (browser WASM engine) |
| `analyze_repertoire_congruence` | `propose_line` (stages onto the board) |
| `get_repertoire_coverage`, `get_transpositions` | `cloud_eval` (disabled, retro #3) |
| `batch_review`, `suggest_complementary_lines`, … | |

The exact include-list is a curated constant, not "all 32" — keeping the model's tool menu small
(per `MCP_DESIGN.md`: the tool surface is a reasoning primitive, not a dump).

## 5. The repertoire handle (decision D2)

The structure tools operate on a `repertoire_id` returned by `load_repertoire(pgn)`. The browser
already holds the working PGN (`actions.toPgn()`). Flow:

1. When a repertoire loads, the bridge auto-calls `load_repertoire` with the current PGN and
   caches the returned `repertoire_id` in the chat store. This ties into the existing
   auto-analyze hook (retro #1, `files.ts`).
2. Bridged tool calls that need a handle inject the cached `repertoire_id` if the model omits it.
3. On handle expiry (`repertoire_not_found`), the bridge transparently re-loads from the current
   PGN once and retries.

## 6. Graceful degradation (decision D3)

`tools.ts` must register the bridged tools **only when the bridge answers**. On startup the chat
store probes `/__mcp` (a `tools/list`); if it fails (deployed PWA, bridge off), the chat keeps
exactly today's 4 browser-native tools. No bridge ⇒ no regression. A small UI indicator ("MCP
tools: on/off") tells the user which mode they're in.

## 7. Files (anticipated)

New:
- `apps/ui/vite-plugin-mcp-bridge.ts` — spawn child, pipe stdio ↔ `/__mcp`, lifecycle/cleanup.
- `apps/ui/src/llm/mcp-client.ts` — browser MCP HTTP client: `listTools()`, `callTool()`.

Edited:
- `apps/ui/vite.config.ts` — register the plugin (dev only).
- `apps/ui/src/llm/tools.ts` — merge bridged tool schemas from `listTools()` with the native set.
- `apps/ui/src/store/chat.ts` — probe on init; route bridged names through `mcp-client`, native
  names through `runTool`; cache `repertoire_id` (D2).
- `apps/ui/src/store/files.ts` — auto-`load_repertoire` on PGN load when the bridge is up (D2).
- `README.md` — document the dev-only bridge and the deployed-PWA limitation (C3).

## 8. Build order

1. This doc (approval gate — design-doc-first).
2. `mcp-client.ts` against the running stdio server through a minimal `/__mcp` relay; prove
   `tools/list` + one `callTool` round-trip.
3. `vite-plugin-mcp-bridge.ts` — spawn lifecycle, cleanup on server close, error surfacing.
4. `tools.ts` merge + `chat.ts` routing + probe/degrade (D3).
5. Handle wiring (D2) + `files.ts` auto-load.
6. README + a manual smoke run (load a repertoire in the browser, confirm `find_repertoire_gaps`
   fires).

## 9. Risks

- **C3 confusion.** Users may expect the deployed PWA to have these tools. Mitigation: the on/off
  indicator (D3) + an explicit README note.
- **Two Stockfish engines if curation slips.** D1's include-list is load-bearing — bridging
  `evaluate_position` would split the eval source of truth. Keep evals browser-native.
- **Child-process lifecycle.** A leaked MCP child on Vite restart. Mitigation: kill on
  `buildEnd` / server `close`; one child per dev server.
- **Handle TTL drift.** Covered by D2's re-load-and-retry, mirroring today's
  `repertoire_not_found → reload` contract.

## 10. Non-goals / deferred

- **Bridging in the deployed PWA / standalone HTTP transport** (C3 self-host) — deferred until
  there's a real self-host use case; §3.1 keeps the wire format compatible.
- **Bridging the full 32-tool surface** — only the curated subset (D1) ships first.
- **Replacing the browser WASM engine with MCP `evaluate_position`** — explicitly not a goal.
