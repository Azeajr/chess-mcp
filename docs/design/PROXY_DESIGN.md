# Repertoire File-Proxy — Design Spec

Design for `chess-files`: a host-side MCP server that lets the model load a repertoire (and
write an export) by **file path**, so the PGN is read where it lives instead of being piped
through the model's context. Companion to `MCP_DESIGN.md` (every rule below traces back to it)
and `REPERTOIRE_DESIGN.md` (the repertoire tools it fronts).

Status: **implemented** — host-side stdio proxy (P1), SSE-only deployment (P2), load+export tool surface (P3), `repertoires/` base dir (P4).

This doc is the contract. Implementation follows it; if reality forces a change, change this
doc in the same commit.

---

## 1. Background — the failure this fixes

A repertoire load in a recent run (`issue.md`) went wrong before any analysis began:

- The model read the 11.5 KB repertoire PGN with its Read tool, which **truncated at the
  client's cap**, then passed the truncated string to `load_repertoire`.
- `load_repertoire` parsed it without complaint (the server-side parse tolerates illegal /
  garbled moves — see `_parse_games`, `server/chess_mcp.py:147`) and reported confident but
  wrong stats (452 nodes / 47 leaves vs the real 559 / 58).
- Every downstream step — a phantom "high" gap at `1.e4 c6 2.d4 Nf6 3.e5` — was built on the
  truncated tree. It took three rounds of user pushback to discover the input was cut.

Two distinct defects: **(a)** the server accepts a malformed PGN silently (tracked separately
as the parse-error guard, "#1"); **(b)** the model is the one assembling an 11 KB tool argument
by reading a file, so it carries the truncation risk *and* the input-token cost on every load.

This doc addresses **(b)**. (a) is an orthogonal server-side guard that lands on its own; the
proxy deliberately sits on top of it (§5.1).

## 2. The constraint that drives the shape

`MCP_DESIGN.md`: *"Inputs are context too. A large blob re-sent across a multi-call workflow is
paid for each time. For big values reused across calls, consider a handle."* `load_repertoire`
already applies the handle half — `load(pgn) → repertoire_id`. But the **PGN still enters
context once**, on the load, via the model's file read. For a branching repertoire that is the
single largest input in the workflow, and the one place truncation silently corrupts everything
after it.

The fix is to move the *read itself* off the model. The reader must sit where (i) the file
exists and (ii) a connection to the chess server exists. In the Docker-SSE deployment that place
is the **host** — not the container (can't see host files without a mount, the rejected `path`
approach) and not the model (tokens + truncation).

## 3. Architecture

```
model ──path──▶ chess-files  (host, stdio)          the proxy
                    │  reads full file (no truncation)
                    │  pgn string
                    ▼
              chess-analysis (:8000, Docker, SSE)    the backend, unchanged
                    │  repertoire_id
                    ▼
model ◀── id only ──┘
```

- **chess-files** is a `FastMCP` server run over **stdio** — the MCP client (Claude Code /
  opencode) spawns it as a subprocess per session. It runs on the host, so it has the user's
  filesystem access.
- Internally it is an **SSE client** to the existing chess server (`CHESS_MCP_URL`, default
  `http://localhost:8000/sse`), calling the real `load_repertoire` / `export_repertoire` via
  `mcp.client.sse` + `ClientSession`. The Docker image and every existing tool are untouched.
- Tool outputs to the model carry **only the handle / write-metadata** — never the PGN —
  honoring the output-size discipline.

### 3.1 The linchpin — shared backend process

A returned `repertoire_id` is only useful if the model's *other* repertoire calls
(`get_structural_profile`, `find_repertoire_gaps`, …) resolve it. They do, because the handle
cache (`_CACHE`, `server/repertoire.py`) is **process-global** and the proxy's SSE connection
and the main `chess-analysis` client connection terminate at the **same `:8000` process**. Load
via the proxy, drill via the main client — same cache, same id.

## 4. Deployment — SSE only (decision P2)

The repo ships three client configs, and they reach the chess server three ways:

| config | transport to chess server | shares a `:8000` process? |
|---|---|---|
| `.mcp.json` (local dev) | SSE `http://localhost:8000/sse` | yes |
| `opencode.json` | SSE (remote) `:8000` | yes |

The proxy forwards over SSE. `chess-files` is registered in `.mcp.json` and `opencode.json`.

## 5. Tool contracts

Lean outputs (`MCP_DESIGN.md`: output is a reasoning primitive, not a data dump). Neither tool
ever returns PGN text.

```
load_repertoire_from_file(path: str, color: "white" | "black")
  → { repertoire_id, color, nodes, leaves, max_depth }
```
Reads `path` on the host (full, no truncation), forwards the bytes to
`load_repertoire(pgn=…, color=…)` on the backend, relays the handle + tree stats.

```
export_repertoire_to_file(repertoire_id: str, path: str)
  → { path, bytes, leaves }
```
Calls `export_repertoire(repertoire_id)` on the backend, writes the returned PGN to the host
`path`, returns write-metadata only — the mirror of the load, closing the *other* half of the
token leak (the large export string never re-enters context).

### 5.1 Error model

Host-side, before the hop (fail fast — never forward a bad read), each `{ "error", "reason" }`:
- `file_not_found`, `not_a_file`, `path_not_allowed` (outside the base dir, §6),
  `pgn_too_large` (> backend cap), `decode_error` (not UTF-8).

Relayed from the backend unchanged:
- `invalid_pgn` (the parse-error guard #1 — a genuinely corrupt file still fails loudly),
  `invalid_color`, `repertoire_not_found`.

Connectivity:
- `backend_unreachable` — `:8000` down or `CHESS_MCP_URL` wrong; the reason names the URL.

## 6. Base dir & security (decision P4)

The proxy runs with the user's filesystem permissions, and a `path` argument is attacker-
controlled in the general case. Reads and writes are confined to a base dir:

- `REPERTOIRE_DIR` (env, default the repo's `repertoires/`). The **resolved real path** of
  `path` must lie under the **resolved** base dir, else `path_not_allowed`. Blocks `../`
  traversal and absolute escapes (`/etc/passwd`).
- Both load (read) and export (write) are confined to the same base — export will not write
  outside it.
- Size cap reuses the backend's `MAX_REPERTOIRE_BYTES` so the proxy rejects oversize files
  before reading them fully.

Consequence of P4: working repertoires live under `repertoires/`. The stray root-level
`ct-black-repertoire.pgn` / `ct-white-repertoire.pgn` from the run move into `repertoires/`
(already home to `ct-black`, `ct-white`, …).

## 7. Connection model

Open an SSE session **per call** (connect → call one tool → close). Stateless and robust — no
long-lived socket to leak or reconnect, and the backend *handle* (not the socket) is the unit of
continuity. The localhost round-trip is negligible against a repertoire load. If profiling later
shows per-call connect dominating, a cached session is a transparent internal change — the tool
contract does not move.

## 8. Files

New (under `server/`, reusing its `pyproject.toml` / `mcp[cli]` dep — no second uv project):
- `server/chess_files.py` — the proxy (FastMCP stdio + SSE client + path guards).
- `server/test_chess_files.py` — host-side guards and error mapping; backend mocked (no live
  `:8000` in unit tests), matching `test_tools.py` conventions.

Edited:
- `.mcp.json`, `opencode.json` — register `chess-files` (`uv run --directory server chess_files.py`).
- `server/pyproject.toml` — add `--cov=chess_files` to the pytest addopts.
- `.claude/skills/repertoire-builder/SKILL.md` — a hard grounding rule that the model **never reads a PGN file into context**; a file on disk goes through `load_repertoire_from_file(path)`, with `load_repertoire(pgn)` reserved for a PGN the user pasted into the chat.
- `README.md` — document the server and `CHESS_MCP_URL` / `REPERTOIRE_DIR`.
- Move root `*-repertoire.pgn` into `repertoires/`.

## 9. Non-goals / deferred

- **Other file tools.** `validate_pgn_file`, `export_annotated_pgn_to_file`,
  `analyze_game_from_file` are natural follow-ons; not in Phase 1.
- **Version bump.** Bump `server/pyproject.toml` when shipping a new release.

## 10. Build order

1. This doc.
2. `chess_files.py` — `load_repertoire_from_file` + `export_repertoire_to_file`, SSE client,
   path / size / decode guards, error mapping.
3. `test_chess_files.py` — guards + error mapping (backend mocked).
4. Register in `.mcp.json` + `opencode.json`; smoke-test against a live `:8000`.
5. Skill steering (both copies).
6. README + `--cov` + move stray PGNs into `repertoires/`.

## 11. Risks

- **Backend down / wrong URL.** Surfaced as `backend_unreachable` naming the URL; the smoke test
  (step 4) is the guard.
- **Two servers, one job split.** The skill steering (§8) is load-bearing, not cosmetic — without
  it the model defaults to Read + `load_repertoire` and the proxy goes unused.
- **Handle TTL.** A repertoire id can expire (`REPERTOIRE_TTL_S`, default 3600s) between a proxy
  load and a later drill — same as today's `load_repertoire`; the existing
  `repertoire_not_found → reload` contract covers it.
