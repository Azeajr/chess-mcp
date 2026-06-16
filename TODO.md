# TODO

## Plugin / marketplace → Node MCP server

The installable Claude Code plugin still distributes the **legacy Python/Docker** server, not the
Node one now used in-repo (`.mcp.json`). To ship the Node server via the plugin:

- `plugin/.claude-plugin/plugin.json` — replace the SessionStart Docker hook + `mcpServers`
  (`chess-analysis` SSE on :8000 + `chess-files` via `uvx`) with a single stdio `chess-analysis`
  that launches the Node server **without a repo clone**.
  - Needs the Node server runnable standalone → **publish it to npm** (e.g. `@chess-mcp/server` with a
    `bin`) and point the plugin at `npx -y @chess-mcp/server`, or bundle a built dist in the plugin.
  - The package must include `apps/mcp-server` built + `packages/chess-tools` + `data/openings.tsv`
    + the engine-copy step (the `stockfish` wasm), with no `tsx` runtime dependency for end users.
- `.claude-plugin/marketplace.json` — drop "Requires Docker + uv"; bump version.
- `.github/workflows/ci.yml` — the `docker` / `publish` (GHCR image) / `release` jobs exist for the
  legacy plugin. After the plugin moves to npm, replace GHCR publish with an npm publish on tags
  (or drop image publishing entirely).

## Other follow-ups

- **Retire the Python server** (`server/`): delete once the plugin no longer depends on it, plus the
  Docker tooling (`compose.yml`, `Dockerfile`, `install.sh`, `Makefile`) and the legacy "Setup"
  section in `README.md`.
- **Manual test** the File System Access re-open flow (native picker + handle permission re-grant) —
  can't run headless. Open a PGN, reload, click "Reopen <name>".
- **MCP smoke in CI**: `apps/mcp-server/test/smoke-client.mjs` is excluded from CI because it hits
  live Lichess/Chess.com. Gate the network assertions behind an env flag to run the rest in CI.
