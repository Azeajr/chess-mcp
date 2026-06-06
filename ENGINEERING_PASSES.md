# Engineering Passes

Reusable autonomous-execution prompts, **adapted to this repo** (`chess-mcp`: a FastMCP + python-chess
+ Stockfish MCP server; `uv` / `pytest` / Docker). Each is a full loop — the agent reviews, implements,
verifies through the toolchain, commits, and pushes. Pick a pass, paste its prompt, let it run.

Repo shape the prompts assume:
- `server/chess_mcp.py` — the FastMCP tools + the only I/O boundaries (Stockfish subprocess, SSE transport).
- `server/structure.py` — engine-free pawn-structure analysis (pure functions).
- `server/repertoire.py` — variation-tree walker, in-memory handle cache (LRU + TTL), congruence logic.
- `server/test_structure_repertoire.py` + `server/test_tools.py` — engine-free `pytest` suite (branch
  coverage on by default via `addopts`; `uv run pytest` from `server/`).
- `evals/` — token-measurement harness (`capture.py` needs Stockfish → Docker; `measure.py` engine-free).
- Design constraints live in `MCP_DESIGN.md` (lean ~2k-token outputs, stateless contract, closed
  error-code set) and `REPERTOIRE_DESIGN.md` (cache, structural classifier).

## Quick pick

| Pass | Use when |
|------|----------|
| [1. Structural Refactor](#1-structural-refactoring) | Code works but is clever / over-abstracted / hard to follow; maintainability without behavior change. |
| [2. Security Mitigation](#2-security-mitigation) | Concrete, local hardening against this server's real threat model — not security theater. |
| [3. High-Signal Testing](#3-high-signal-testing) | Coverage is thin or vanity; you want behavior tests that make refactoring safe. |

| [4. Repertoire Analysis Loop](#4-repertoire-analysis-loop) | Run the full analysis flow against `repertoires/<name>/repertoire.pgn`, document findings, capture retro friction, implement bounded fixes, ship. Repeat to iterate the MCP. |

Verification commands referenced by every pass (this repo):

```bash
# Build = import/syntax sanity (no compile step); full engine build = the image
uv run --with chess --with "mcp[cli]" python -c "import sys; sys.path.insert(0,'server'); import chess_mcp; print('import ok')"
docker compose build                      # only when engine-backed paths or the Dockerfile changed

# Lint / format (no linter is committed; ruff runs ephemerally via uv)
uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/

# Test (engine-free suite + branch coverage via addopts; needs mcp+chess+pytest from the project, no Stockfish)
cd server && uv run pytest -q

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
3. Test: `cd server && uv run pytest -q`. If anything fails, fix your implementation until it passes. If you changed any tool's output shape (you shouldn't), regen the evals snapshot in Docker.
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
3. Test: `cd server && uv run pytest -q`, and add tests for any new cap/guard (oversized input, expired handle, eviction, malformed PGN/FEN). Do not compromise core functionality for security theater. For engine-touching changes, verify in Docker (rebuild + capture.py and/or the SSE smoke client).
4. Commit: the message must state the EXACT vulnerability mitigated and the method used. No Co-Authored-By trailer.
5. Push: `git push origin main`.
```

---

## 4. Repertoire Analysis Loop

This pass is designed to be run repeatedly. Each run exercises the MCP against a real repertoire, documents what works and what breaks, and ships fixes for the bounded problems it finds. Over time this drives the MCP toward the behavior you actually need.

```text
Act as a pragmatic chess analyst and Python engineer working on chess-mcp. Run a full repertoire analysis loop against `repertoires/<name>/repertoire.pgn`, document the findings, capture retro friction, implement any bounded fixes, and ship. The goal is iterative MCP improvement: each run surfaces new shortcomings and closes the previous ones.

Set `<name>` to the repertoire under test (a short kebab opening name, e.g. `ct-white`, `ct-black`, `english-opening`). If `repertoires/<name>/` does not exist yet — i.e. a brand-new repertoire PGN — complete PHASE 0 first to create the directory structure, then proceed. On every later run for that repertoire, skip PHASE 0.

CONTEXT
- chess-mcp: FastMCP + python-chess + Stockfish MCP server (Stockfish is Docker-only — never install on host)
- MCP owns all FEN/PGN reasoning — never hand-author positions or move sequences; use tools, which return engine-verified FENs and evals
- Repertoire layout: each repertoire lives in its own folder `repertoires/<name>/` with three uniform files — `repertoire.pgn` (the PGN under test), `analysis.md` (versioned run log), `retro.md` (living retro — append, never overwrite). `sample-*.pgn` at repo root are eval fixtures, NOT repertoires — leave them.
- Analysis docs: `repertoires/<name>/analysis.md` and `repertoires/<name>/retro.md`
- Design constraints: `MCP_DESIGN.md` (lean ~2k-token outputs, stateless contract, closed error-code set), `REPERTOIRE_DESIGN.md` (cache, structural classifier)
- Open issues: check `gh issue list` before logging a new shortcoming — don't duplicate

PHASE 0 — FIRST-PASS SETUP (new repertoire only; skip if `repertoires/<name>/` already exists)
When the loop is pointed at a brand-new PGN that has no folder yet:
1. Pick `<name>` — a short kebab opening label (e.g. `english-opening`).
2. `mkdir -p repertoires/<name>/`.
3. Create `repertoires/<name>/repertoire.pgn` as an ANONYMIZED, reproducible fixture of the source PGN:
   - strip PII headers and prose (`Annotator`, `ChapterURL`, `StudyName`, UTC stamps, @-mentions); keep `Event`/`ECO`/`Opening` and ALL moves + side variations so the tree is unchanged.
   - confirm the fixture loads to the same nodes/leaves/max_depth as the source before relying on it.
   - delete the original PII-named source file once the anonymized fixture is committed; never commit the PII-named original.
4. Seed `repertoires/<name>/analysis.md` and `repertoires/<name>/retro.md` from the existing repertoires' format (version table starting at v1, the standard subheadings). Each repertoire's retro starts fresh at v1 — do NOT dedup its findings against another repertoire's retro; the only cross-run dedup is the gh issue list.
5. Determine the repertoire color from the PGN (whose moves are being recommended) and run the loop only for that side — a White study has no value analyzed `as black`, and vice versa.

PHASE 1 — RUN THE ANALYSIS FLOW
Run tools in this exact order against `repertoires/<name>/repertoire.pgn`:

1. `validate_pgn` — confirm the file is valid before loading
2. `load_repertoire` — get the repertoire handle; record tree stats (nodes, leaves, max depth, color)
3. `get_transpositions` — PRE-FLIGHT REQUIRED before any gap or depth analysis; record all convergence points
4. `get_structural_profile` — full tree; record named structures, confidence, theme tags, center distribution
5. `analyze_repertoire_congruence` — record all flags; for each flagged line cross-check the transposition map before treating it as a real issue
6. `find_repertoire_gaps` — cross-check every reported gap against the transposition map before recording it; suppress any gap that resolves to a transposition endpoint
7. `evaluate_position` (depth 20) — run on: the repertoire's deepest main-line leaf, any structurally-defining leaf (a forced-weakness or space-bind position the repertoire bets on — e.g. a bxc3 / Maroczy / IQP / KID-bind leaf if present), and any leaf flagged by congruence or gaps that survived transposition cross-check

Assess each result against what the tool was supposed to do. Note: incorrect output, missing signal, false flags, unexplained `unknown` returns, or output that required manual multi-step chaining to interpret.

PHASE 2 — UPDATE ANALYSIS DOC
Append a new versioned section to `repertoires/<name>/analysis.md`. Follow the existing format exactly:
- Header: `## v<N> — <date> — chess-mcp <version>`
- Subheadings: Tools used, Tree Stats, Structural Identity, Congruence Results, Soundness Checks, Gaps, MCP Retro Notes
- Bump the version table at the top of the file (add new row, mark it current)
- Do not edit previous version sections

PHASE 3 — APPEND RETRO
Append a new `## v<N> Update — chess-mcp <version> (<date>)` section to `repertoires/<name>/retro.md`. Rules:
- Only record NEW findings not already in the retro
- For each new shortcoming: describe the observed behavior, the expected behavior, and a concrete one-sentence fix
- For each tool that shone: record what it got right (evidence-based, not general praise)
- Update the "Skipped Tools" section to reflect current status
- SCOPE: the retro captures MCP/tool/workflow shortcomings ONLY. Do not record user-side content issues (missing PGN lines, unresolved repertoire islands, PGN update tasks). Those belong in the analysis doc as observations. Ask: "is this a tool limitation or a content gap?" — only tool limitations go in the retro.

PHASE 4 — IMPLEMENT BOUNDED FIXES
For each new shortcoming identified in Phase 3, classify it:

IMPLEMENT NOW (all must be true):
- Engine-free change (server/structure.py or server/repertoire.py only — no chess_mcp.py tool signature changes)
- ≤ 2 files touched
- Existing test suite covers the behavior being changed, or you can add ≤ 5 targeted tests
- No new tool, no new output field visible to callers, no change to closed error-code set

OPEN ISSUE ONLY (any one is true):
- New tool or changed tool signature
- Requires Stockfish / Docker to verify
- Design-doc-worthy (non-obvious architecture or data-model decision)
- Touches more than 2 files

For issues: `gh issue create` with a body that includes: problem statement, proposed fix, acceptance criteria, and a reference back to the retro section. Check `gh issue list` first to avoid duplicates.

PHASE 5 — VERIFY AND SHIP
Run in order; do not proceed past a failure:
1. Import sanity: `uv run --with chess --with "mcp[cli]" python -c "import sys; sys.path.insert(0,'server'); import chess_mcp; print('import ok')"`
2. Lint/format: `uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/`
3. Test: `cd server && uv run pytest -q` — if you changed engine-touching paths, also verify in Docker
4. If all green: bump the patch version in `pyproject.toml` (or wherever version is stored), commit all changes in a single commit with a message of the form `feat/fix: <what changed> — retro v<N>` describing the BEHAVIOR change. No Co-Authored-By trailer.
5. Push: `git push origin main`

GUARDRAILS
- First-pass fixtures (PHASE 0) must be anonymized and neutrally named (`repertoire.pgn`) before commit — never commit a PII-named source PGN
- Never edit or delete prior sections of either analysis doc or the retro
- Never hand-author a FEN or move sequence — if you need a position, derive it from tool output
- Never install Stockfish on the host — engine-backed verification goes in Docker
- If a shortcoming's fix is ambiguous, open the issue and skip implementation; do not guess at architecture
- If Phase 5 fails, revert your implementation changes (do NOT use --no-verify), fix the root cause, and re-run from the lint step
```

---

## 3. High-Signal Testing

```text
Act as a pragmatic, veteran Python engineer extending the chess-mcp test suite (server/test_structure_repertoire.py, pytest). Write tests optimized for high confidence, safe refactoring, and zero maintenance burden. No vanity/coverage-chasing tests; do not test python-chess or FastMCP themselves.

Enforce these principles:
1. Test behavior, not implementation: call the public functions/tools as a consumer would and assert on the OUTPUTS — returned dicts (structure_class, confidence, cp_loss, the closed error codes), parsed game trees, resolved FENs, cache hits/misses. Don't assert on internal call sequencing.
2. Real instances over mocks: build real chess.Board / chess.pgn.Game / SquareSet positions and feed them through structure.py and repertoire.py. The engine-free layer needs NO mocks. Stockfish is the only true external boundary (and the host has none — engine-backed paths like suggest_complementary_lines and evals/capture.py are verified in Docker, not unit-mocked here).
3. High-signal targeting: pawn primitives (doubled/isolated/passed/chains/half-open/open), classify_structure (the 19-structure canon + unknown + confidence; brittleness/specificity/bidirectional cases — each scorer has an MCP-verified canonical FEN fixture) and themes (the always-on theme tags), center_state, the variation walker (iter_nodes/walk_leaves/tree_stats), resolve_path + san_path round-trips, the cache (store/get, TTL expiry, LRU eviction), and the congruence rules. Skip trivial passthroughs.
4. Clean state hygiene: guarantee isolation. Clear the module-level repertoire._CACHE between tests (autouse fixture); monkeypatch repertoire.MAX_REPERTOIRES / REPERTOIRE_TTL_S for eviction/expiry tests so they are deterministic and don't leak across cases.
5. Defensive boundaries: malformed/empty PGN and FEN, empty or single-node trees, expired/unknown handles (repertoire_not_found), unknown structures (must return "unknown", never a guessed label), terminal positions for suggest, oversized input vs the byte caps. Assert the app degrades into a structured error, never a crash.

Match the existing file's style (pytest, parametrize, a `pawns(...)` helper for hand-built positions, the autouse cache-clearing fixture).

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build: import-sanity command.
2. Lint/format: `uv run --with ruff ruff check --fix server/ evals/ && uv run --with ruff ruff format server/ evals/`.
3. Test: `cd server && uv run pytest -q`. If new tests fail or break existing ones, debug and fix the TEST — unless you uncovered a real bug in structure.py/repertoire.py/chess_mcp.py, in which case fix the source and note it in the commit.
4. Commit with a concise message describing the BEHAVIOR now covered. No Co-Authored-By trailer.
5. Push: `git push origin main`.
```
