# Engineering Passes

Reusable autonomous-execution prompts, **adapted to this repo** (`chess-mcp`: a FastMCP + python-chess
+ Stockfish MCP server; `uv` / `pytest` / Docker). Each is a full loop — the agent reviews, implements,
verifies through the toolchain, commits, and pushes. Pick a pass, paste its prompt, let it run.

Repo shape the prompts assume:
- `server/chess_mcp.py` — the FastMCP tools + the only I/O boundaries (Stockfish subprocess, SSE transport).
- `server/structure.py` — engine-free pawn-structure analysis (pure functions).
- `server/repertoire.py` — variation-tree walker, in-memory handle cache (LRU + TTL), congruence logic.
- `server/test_structure_repertoire.py` — engine-free `pytest` suite.
- `evals/` — token-measurement harness (`capture.py` needs Stockfish → Docker; `measure.py` engine-free).
- Design constraints live in `MCP_DESIGN.md` (lean ~2k-token outputs, stateless contract, closed
  error-code set) and `REPERTOIRE_DESIGN.md` (cache, structural classifier).

## Quick pick

| Pass | Use when |
|------|----------|
| [1. Structural Refactor](#1-structural-refactoring) | Code works but is clever / over-abstracted / hard to follow; maintainability without behavior change. |
| [2. Security Mitigation](#2-security-mitigation) | Concrete, local hardening against this server's real threat model — not security theater. |
| [3. High-Signal Testing](#3-high-signal-testing) | Coverage is thin or vanity; you want behavior tests that make refactoring safe. |

Verification commands referenced by every pass (this repo):

```bash
# Build = import/syntax sanity (no compile step); full engine build = the image
uv run --with chess --with "mcp[cli]" python -c "import sys; sys.path.insert(0,'server'); import chess_mcp; print('import ok')"
docker compose build                      # only when engine-backed paths or the Dockerfile changed

# Lint / format (no linter is committed; ruff runs ephemerally via uv)
uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/

# Test (engine-free suite; runs on the host, no Stockfish needed)
uv run --with chess --with pytest pytest server/test_structure_repertoire.py -q

# Engine-backed verification (Stockfish → Docker only)
docker compose up -d --build
docker run --rm -v "$PWD":/work -w /app -e STOCKFISH_PATH=/usr/games/stockfish \
  chess-mcp-chess-mcp:latest uv run python /work/evals/capture.py   # regen evals snapshot

# Commit + push — Conventional Commits, NO Co-Authored-By trailer (project preference); trunk-based
git commit -m "..." && git push origin main
```

---

## 1. Structural Refactoring

```text
Act as a pragmatic, veteran Python engineer working on chess-mcp, a FastMCP + python-chess + Stockfish MCP server. Perform a deep code review of server/chess_mcp.py, server/structure.py, and server/repertoire.py and immediately implement the structural changes that maximize maintainability, testability, and immediate obviousness. Ruthlessly remove "clever" code, premature abstractions, and over-engineering. Do not change tool behavior, output shapes, or the closed error-code set.

Evaluate and modify against these criteria:
1. YAGNI: Remove abstractions solving hypothetical future problems. Prefer simple, slightly repetitive code if it lowers cognitive load.
2. Locality of Behavior: Keep related logic together — e.g. a tool's validation, computation, and result shaping in one readable flow; cache mutation next to its eviction.
3. Explicit data flow: Remove hidden side effects and tight coupling. structure.py and repertoire.py must stay pure and engine-free; the ONLY I/O boundaries (Stockfish subprocess, FastMCP/SSE) live in chess_mcp.py — keep them there.
4. Structural flattening: Replace deep nesting and complex conditionals with early returns and linear paths. The error-guard-then-compute shape (return structured {"error","reason"} early) is the house style — follow it.
5. Output discipline: Tool outputs must stay lean (~2k tokens, see MCP_DESIGN.md), nesting <= 2 levels, no field inferable from another. Do not regress this while refactoring.

Honor the existing contract: stateless interface (the repertoire_id handle is the one exception), closed error codes (invalid_pgn, invalid_fen, invalid_color, move_not_found, pgn_too_large, too_many_moves, repertoire_not_found, variation_not_found, invalid_mode), white-POV centipawns.

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build: run the import-sanity command; if you touched the Dockerfile or engine paths, also `docker compose build`.
2. Lint/format: `uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/`.
3. Test: `uv run --with chess --with pytest pytest server/test_structure_repertoire.py -q`. If anything fails, fix your implementation until it passes. If you changed any tool's output shape (you shouldn't), regen the evals snapshot in Docker.
4. Commit with a concise message explaining WHY the structural change was made (not what). No Co-Authored-By trailer.
5. Push: `git push origin main`.
```

---

## 2. Security Mitigation

```text
Act as a pragmatic, veteran security architect reviewing chess-mcp: a FastMCP server (SSE transport) that runs Stockfish on caller-supplied PGN/FEN and holds an in-memory repertoire cache. There is NO authentication; the documented trust boundary is a trusted LAN, default bind 127.0.0.1 (the Docker image binds 0.0.0.0). Implement concrete, local mitigations strictly for THIS threat model — no web/browser/OPFS/CSP concerns apply.

Focus your implementation on:
1. Untrusted PGN/FEN input: enforce and unit-cover the input caps (MAX_PGN_BYTES, MAX_REPERTOIRE_BYTES, MAX_LINE_MOVES, depth clamped to [1,30], multipv cap). Validate SEMANTIC validity (python-chess returns an empty Game for garbage — reject zero-move games), and return only structured closed-set errors. No bare exceptions or tracebacks reach the caller.
2. Denial of service via input/state: bound per-call engine work (depth clamp, multipv ceiling) and bound the handle cache (MAX_REPERTOIRES LRU + REPERTOIRE_TTL_S idle expiry). Confirm the cache mutation is guarded by the lock against concurrent SSE calls; confirm a flood of load_repertoire calls cannot grow memory without bound.
3. Engine subprocess safety: confirm Stockfish is launched via argv (no shell), the binary path comes from STOCKFISH_PATH (env, not caller), and no caller-controlled UCI options are passed. Fix anything that lets caller input reach a shell or the engine config.
4. Internal interpolation / injection surfaces: audit any f-string or interpolation that builds something executed or path-like; add allowlists or explicit inline justification. (No SQL here — but the same discipline applies to FENs, engine args, file paths.)
5. Defense in depth / exposure: keep the code default-bind 127.0.0.1; ensure the README trust-boundary warning (no auth, never expose publicly) stays accurate; favor stdlib over custom security code. Do not leak internal paths or state in error messages.

Do not add authentication or a heavy security framework — that contradicts the local/trusted-LAN model. Do not weaken the lean output or stateless contract.

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build: import-sanity command; `docker compose build` if the image/Dockerfile changed.
2. Lint/format: `uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/`.
3. Test: `uv run --with chess --with pytest pytest server/test_structure_repertoire.py -q`, and add tests for any new cap/guard (oversized input, expired handle, eviction, malformed PGN/FEN). Do not compromise core functionality for security theater. For engine-touching changes, verify in Docker (rebuild + capture.py and/or the SSE smoke client).
4. Commit: the message must state the EXACT vulnerability mitigated and the method used. No Co-Authored-By trailer.
5. Push: `git push origin main`.
```

---

## 3. High-Signal Testing

```text
Act as a pragmatic, veteran Python engineer extending the chess-mcp test suite (server/test_structure_repertoire.py, pytest). Write tests optimized for high confidence, safe refactoring, and zero maintenance burden. No vanity/coverage-chasing tests; do not test python-chess or FastMCP themselves.

Enforce these principles:
1. Test behavior, not implementation: call the public functions/tools as a consumer would and assert on the OUTPUTS — returned dicts (structure_class, confidence, cp_loss, the closed error codes), parsed game trees, resolved FENs, cache hits/misses. Don't assert on internal call sequencing.
2. Real instances over mocks: build real chess.Board / chess.pgn.Game / SquareSet positions and feed them through structure.py and repertoire.py. The engine-free layer needs NO mocks. Stockfish is the only true external boundary (and the host has none — engine-backed paths like suggest_complementary_lines and evals/capture.py are verified in Docker, not unit-mocked here).
3. High-signal targeting: pawn primitives (doubled/isolated/passed/chains/half-open/open), classify_structure (IQP/Carlsbad/Maroczy + unknown + confidence), center_state, the variation walker (iter_nodes/walk_leaves/tree_stats), resolve_path + san_path round-trips, the cache (store/get, TTL expiry, LRU eviction), and the congruence rules. Skip trivial passthroughs.
4. Clean state hygiene: guarantee isolation. Clear the module-level repertoire._CACHE between tests (autouse fixture); monkeypatch repertoire.MAX_REPERTOIRES / REPERTOIRE_TTL_S for eviction/expiry tests so they are deterministic and don't leak across cases.
5. Defensive boundaries: malformed/empty PGN and FEN, empty or single-node trees, expired/unknown handles (repertoire_not_found), unknown structures (must return "unknown", never a guessed label), terminal positions for suggest, oversized input vs the byte caps. Assert the app degrades into a structured error, never a crash.

Match the existing file's style (pytest, parametrize, a `pawns(...)` helper for hand-built positions, the autouse cache-clearing fixture).

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build: import-sanity command.
2. Lint/format: `uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/`.
3. Test: `uv run --with chess --with pytest pytest server/test_structure_repertoire.py -q`. If new tests fail or break existing ones, debug and fix the TEST — unless you uncovered a real bug in structure.py/repertoire.py/chess_mcp.py, in which case fix the source and note it in the commit.
4. Commit with a concise message describing the BEHAVIOR now covered. No Co-Authored-By trailer.
5. Push: `git push origin main`.
```
