# chess-files Gateway (plugin support) — Plan

Status: **planned, not built.** Executes Option A from `PROXY_DESIGN.md` §9 (deferred). Written to
be self-contained so a fresh session can build it end to end. Companions: `PROXY_DESIGN.md` (the
forward-mode proxy this extends) and `MCP_DESIGN.md`.

This doc is the contract. Implementation follows it; if reality forces a change, change this doc in
the same commit.

---

## 1. Goal

Make the `chess-files` file-path tools (`load_repertoire_from_file` / `export_repertoire_to_file`)
work in the **published plugin**, where `chess-analysis` is stdio-over-docker (a fresh container
spawned per session, no shared `:8000`). Today the proxy is registered only for the in-repo SSE
workflow; plugin users fall back to Read + paste.

## 2. The two hard constraints (read before designing)

1. **Shared handle cache.** A `repertoire_id` from a load must resolve in the model's later analysis
   calls. With no shared `:8000`, the gateway must route **every** chess call through **one** backend
   it owns — see `PROXY_DESIGN.md` §3.1. This is what forces the gateway shape (not a side proxy).

2. **Host file read vs "Docker-only."** Reading a host file *without the model* requires the reader to
   run **on the host** (host python) **or** the container to **bind-mount** the host dir. The plugin's
   "Docker-only, no host deps" promise and the user's rejection of bind mounts collide here.
   → **Accepted trade (this plan): the gateway runs as a host process (`uv`/python), opt-in.**
   Mount-free, but adds a host python/uv dependency for users who want the file proxy. The default
   plugin stays Docker-stdio `chess-analysis` without it. (If host-python is unacceptable, the only
   alternative is the bind-mount — Option B — which this plan does **not** take. Revisit §2 before
   building if that constraint has changed.)

## 3. Shape — gateway, host-process realization

```
plugin user's host
  Claude Code ──stdio──►  chess-files (host, uv/python)         ← the gateway (opt-in)
                              │  reads host PGN files (no mount)
                              │  owns ONE backend, mirrors all its tools
                              ▼ stdio
                          docker run … chess-mcp:latest (Stockfish)   ← single backend, single cache
```

- `chess-files` is the **only** chess MCP server the plugin registers in gateway mode. The model never
  talks to the backend directly.
- It spawns **one** backend (`docker run -i --rm -e MCP_TRANSPORT=stdio …`) at startup and holds it for
  the session.
- It advertises: **every backend tool (mirrored verbatim)** + `load_repertoire_from_file` +
  `export_repertoire_to_file`.
- One backend process ⇒ one handle cache ⇒ ids resolve across load *and* analysis. ✓
- Stockfish stays Docker-only (the backend is the container); only the thin gateway is host python.

## 4. Two modes, one codebase

`chess-files` keeps both deployments:

| mode | trigger | backend transport | tools exposed |
|------|---------|-------------------|---------------|
| **forward** (today, dev/SSE) | `CHESS_MCP_URL` set | SSE client to an existing `:8000` | the 2 file tools only (`chess-analysis` is registered separately) |
| **gateway** (new, plugin) | `CHESS_MCP_BACKEND` set (a spawn command) | stdio client to an **owned** child | **all** backend tools (mirrored) + the 2 file tools |

Transport implies mode: a spawned stdio child ⇒ gateway (mirror all); an SSE URL ⇒ forward (files
only). Exactly one of `CHESS_MCP_URL` / `CHESS_MCP_BACKEND` is set; error if both/neither.

## 5. Implementation notes

### 5.1 Use the low-level `mcp.server.Server` for gateway mode
A gateway is "advertise a dynamic tool list + dispatch generically" — which the low-level
`mcp.server.Server` expresses directly, instead of fighting FastMCP's signature introspection to
register dynamically-schema'd tools.
- `@server.list_tools()` → return the child's tools (fetched once at startup) **+** the 2 file tools
  (hand-written schemas). Pass child `description` + `inputSchema` through verbatim so the model sees
  identical docs.
- `@server.call_tool(name, arguments)` → if `name` is a file tool, handle locally (host-side guards,
  read/write the file, forward bytes to the child's `load_repertoire`/`export_repertoire`); else
  forward `session.call_tool(name, arguments)` to the child and return its content unchanged.
- Forward mode can stay on FastMCP (unchanged). **Minimum invariant:** the file-tool *logic* stays as
  standalone functions so the existing 18 `test_chess_files.py` tests keep calling them directly.

### 5.2 Backend lifecycle (the main risk)
Spawn once, hold for the session, tear down at exit — a per-call `docker run` (~1–2 s) is too slow for
every tool call.
- Async lifespan: `async with stdio_client(StdioServerParameters(command, args)) as (r, w), \
  ClientSession(r, w) as session: <serve>`. The `--rm` child exits on close.
- `await session.list_tools()` once at startup; cache for `list_tools` responses.
- Concurrency: `ClientSession` multiplexes responses by request id, so concurrent `call_tool` is fine;
  add an `asyncio.Lock` only if races surface.
- Crash handling: if the child dies mid-session, calls fail → return `backend_unreachable`; re-spawn
  once on a dead session, else error.

### 5.3 File tools in gateway mode
Same host-side guards as today (`_resolve_in_base` under `REPERTOIRE_DIR`, size cap, decode), then
forward bytes to the **held stdio session** instead of an SSE backend. Parameterize the existing
`_call_backend` seam over transport (a "caller" that is either an SSE round-trip or the held session's
`call_tool`), so both modes share the guard + relay logic.

### 5.4 Config — `plugin/.mcp.json` (gateway entry)
Replace the `chess-analysis` stdio entry with the gateway:
```json
{
  "mcpServers": {
    "chess-files": {
      "command": "uv",
      "args": ["run", "--directory", "${CLAUDE_PLUGIN_ROOT}/server", "chess_files.py"],
      "env": {
        "CHESS_MCP_BACKEND": "docker run -i --rm -e MCP_TRANSPORT=stdio ghcr.io/azeajr/chess-mcp:latest",
        "REPERTOIRE_DIR": "${PWD}"
      }
    }
  }
}
```
- Requires **shipping `server/`** (at least `chess_files.py` + a minimal `pyproject.toml` with
  `mcp[cli]`) in the plugin bundle, and **uv/python on the host**. → keep this as an **opt-in /
  advanced** config; the Docker-only `chess-analysis` stdio entry stays the documented default.
- Verify `${CLAUDE_PLUGIN_ROOT}` (plugin path var) and `${PWD}` expansion are supported by the client
  in `plugin/.mcp.json`; if not, fall back to a user-set absolute `REPERTOIRE_DIR`.

### 5.5 Mirroring details
- No name collisions: mirrored `load_repertoire` and local `load_repertoire_from_file` coexist (as in
  dev); same for export.
- Reuse `_payload` to unwrap the child's `CallToolResult`; for mirrored tools, pass content straight
  back (text + structured) without reshaping — the gateway is transparent.

## 6. Build order
1. Extract file-tool logic + guards behind a transport-agnostic `_call_backend(caller, …)` seam.
2. Gateway entrypoint: low-level `Server`, lifespan-spawned stdio child, `list_tools` mirror,
   `call_tool` dispatch (file tools local, rest forwarded).
3. Mode select from env (`CHESS_MCP_URL` ⇒ forward; `CHESS_MCP_BACKEND` ⇒ gateway).
4. Tests (child mocked — no live docker): `list_tools` mirrors child + adds the 2 file tools;
   `call_tool` routes file tools locally and others to the child; dead-child re-spawn; existing 18
   forward-mode tests still green.
5. Plugin bundle: ship `server/` (chess_files.py + minimal pyproject), add the opt-in gateway config,
   document the uv/python requirement and that it's opt-in.
6. Live-verify in a real plugin install: `load_repertoire_from_file` → id; `evaluate_position` via the
   mirror resolves on the **same** backend; `export_repertoire_to_file` round-trips.

## 7. Risks / open
- **Host python/uv requirement** breaks the plugin's Docker-only promise → opt-in, default unchanged
  (the accepted trade, §2). This is the decision to re-confirm before building.
- **`${CLAUDE_PLUGIN_ROOT}` / `${PWD}` expansion** in `plugin/.mcp.json` — verify support; else require
  an absolute `REPERTOIRE_DIR`.
- **Child lifecycle** — dead-child re-spawn, no zombies, concurrency lock only if needed.
- **Latency** — every plugin tool call now hops gateway → child stdio. Small; measure.
- **Maintenance (the payoff):** mirroring is generic (auto from `list_tools`), so backend tool changes
  need **no** gateway change. This is what makes the full-gateway shape worth its lifecycle cost.
