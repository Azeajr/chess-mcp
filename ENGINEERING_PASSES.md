# Engineering Passes

Reusable autonomous-execution prompts, **adapted to this repo** (`chess-mcp`: a Node.js/TypeScript
MCP server over `@modelcontextprotocol/sdk` + `chessops` + a bundled `stockfish` wasm engine; pnpm
monorepo, stdio transport, no Docker). Each is a full loop — the agent reviews, implements, verifies
through the toolchain, commits, and pushes. Pick a pass, paste its prompt, let it run.

Repo shape the prompts assume:
- `apps/mcp-server/src/index.ts` — the tool definitions (`@modelcontextprotocol/sdk`) + the file-path
  tools confined to `REPERTOIRE_DIR`. The MCP surface and its validation/error shaping.
- `apps/mcp-server/src/engine.ts` — the only engine I/O boundary (the `stockfish` wasm; UCI driven via
  `sendCommand`, output captured through a `console.log` override so it never corrupts stdout JSON-RPC).
- `apps/mcp-server/src/gameanalysis.ts` — the cached game-tree analysis pass (memoized per
  `(pgn, depth, multipv, time_limit)`).
- `apps/mcp-server/src/handles.ts` — the in-memory repertoire handle cache (LRU + idle TTL).
- `packages/chess-tools/src/` — the pure, engine-free chess logic (chessops, not python-chess):
  `structure.ts` (pawn-structure classifier + theme tags), `game.ts` (GameTree walker + edits),
  `repcongruence.ts` (system-clustered congruence), `gaps.ts` (gaps + coverage), `congruence.ts`
  (eval congruence), `openings.ts` (ECO lookup), `pgn.ts`/`validate.ts` (PGN/FEN parsing + validation),
  `apiclient.ts`/`games.ts`/`cloudeval.ts`/`tablebase.ts` (rate-limited, offline-safe HTTP),
  `boardimage.ts` (board SVG/PNG).
- `scripts/smoke-gametree.mjs` + `scripts/structure-accuracy.mjs` — the deterministic engine-free smoke
  suites that gate CI. `apps/mcp-server/test/smoke-client.mjs` exercises all 32 tools end-to-end
  through the bundled engine (hits live Lichess/Chess.com, so it's excluded from CI);
  `apps/mcp-server/test/cache.mjs` covers the engine cache.
- Design constraints live in `docs/design/MCP_DESIGN.md` (lean ~2k-token outputs, stateless contract,
  closed error-code set) and `docs/design/REPERTOIRE_DESIGN.md` (cache, structural classifier).

## Quick pick

| Pass | Use when |
|------|----------|
| [1. Structural Refactor](#1-structural-refactoring) | Code works but is clever / over-abstracted / hard to follow; maintainability without behavior change. |
| [2. Security Mitigation](#2-security-mitigation) | Concrete, local hardening against this server's real threat model — not security theater. |
| [3. High-Signal Testing](#3-high-signal-testing) | Smoke coverage is thin or vanity; you want behavior checks that make refactoring safe. |
| [4. Repertoire Analysis Loop](#4-repertoire-analysis-loop) | Run the full analysis flow against `repertoires/<name>/repertoire.pgn`, document findings, capture retro friction, implement bounded fixes, ship. Repeat to iterate the MCP. |

Verification commands referenced by every pass (this repo):

```bash
pnpm install --frozen-lockfile          # once per checkout
pnpm --filter @chess-mcp/chess-tools build   # build the shared lib (its dist is what the smoke scripts import)

# Static correctness gate (there is no separate linter — typecheck is the net):
pnpm -r typecheck

# Deterministic engine-free smoke suites (these are what CI runs):
node scripts/smoke-gametree.mjs
node scripts/structure-accuracy.mjs

# Engine + network end-to-end (the wasm engine is bundled — runs locally, no Docker):
node apps/mcp-server/test/smoke-client.mjs    # spawns the server, exercises 32 tools; hits live Lichess/Chess.com
node apps/mcp-server/test/cache.mjs           # engine cache behavior

# Run the server directly (stdio):
pnpm mcp                                       # node --import tsx apps/mcp-server/src/index.ts

# Commit + push — Conventional Commits, NO Co-Authored-By trailer (project preference); trunk-based.
git commit -m "..." && git push origin main
# A pass is done only when CI is green (build + typecheck + the two engine-free smoke suites):
gh run watch "$(gh run list -L1 --json databaseId -q '.[0].databaseId')" --exit-status
# Do NOT create tags: a v* tag triggers the GitHub release. Releases are a separate, explicitly
# requested step (bump the version in plugin/.claude-plugin/plugin.json + .claude-plugin/marketplace.json).
```

---

## 1. Structural Refactoring

```text
Act as a pragmatic, veteran TypeScript engineer working on chess-mcp, a Node MCP server (@modelcontextprotocol/sdk + chessops + a bundled stockfish wasm). Perform a deep code review of apps/mcp-server/src/ (index.ts, engine.ts, gameanalysis.ts, handles.ts) and the pure logic in packages/chess-tools/src/ (structure.ts, game.ts, repcongruence.ts, gaps.ts, congruence.ts). Your dual mandate is to (1) hunt down and fix hidden bugs, logic errors, and edge-case failures, and (2) immediately implement structural changes that maximize maintainability, testability, and immediate obviousness.

Ruthlessly remove "clever" code, premature abstractions, and over-engineering. Do not change tool behavior, output shapes, or the closed error-code set.

Evaluate and modify against these criteria:
1. Correctness & Defensive Execution: Treat every line as a potential failure point. Actively spot and fix silent failures, off-by-one errors, state leaks, and edge-case logic bugs — especially around FEN handling, terminal nodes, async engine output (the console.log capture in engine.ts), and score/POV semantics (the highest-yield hunting ground: a checkmated side-to-move and every white-POV flip or mover-POV negation is a place a sign can silently die; mate scores map to ±10000 cp). Do not mask errors; handle them using the existing closed error-code set.
2. Verify before fixing: a suspected bug in third-party API usage (chessops, @modelcontextprotocol/sdk, the stockfish wasm) must be confirmed against the INSTALLED version first — read the source under node_modules, or test empirically by running the server (`pnpm mcp`) / the smoke clients. The engine is bundled and runs locally, so engine paths are verifiable here — no Docker. Do not add dead defensive code for behavior the library doesn't have.
3. YAGNI: Remove abstractions solving hypothetical future problems. Prefer simple, slightly repetitive code if it lowers cognitive load.
4. Locality of Behavior: Keep related logic together — e.g. a tool's validation, computation, and result shaping in one readable flow; cache mutation next to its eviction.
5. Explicit data flow: Remove hidden side effects and tight coupling. packages/chess-tools must stay pure and engine-free; the ONLY I/O boundaries (the stockfish wasm in engine.ts, the MCP stdio transport and host filesystem in index.ts) live in apps/mcp-server — keep them there.
6. Structural flattening: Replace deep nesting and complex conditionals with early returns and linear paths. The error-guard-then-compute shape (return a structured {error, reason} early) is the house style — follow it.
7. Output discipline: Tool outputs must stay lean (~2k tokens, see docs/design/MCP_DESIGN.md), nesting <= 2 levels, no field inferable from another. Do not regress this while refactoring or fixing bugs.
8. Test before restructuring: before you refactor a path, make sure a smoke suite reaches it. If neither scripts/smoke-gametree.mjs nor scripts/structure-accuracy.mjs exercises the pre-engine behavior (guards, path resolution, error returns), add a focused assertion there first so the refactor lands verified, not hopeful. Engine paths are checked via apps/mcp-server/test/smoke-client.mjs.

SCOPE GUARDS:
- structure.ts scorer heuristics (confidence thresholds, theme cutoffs) are validated canon with FEN fixtures (scripts/structure-accuracy.mjs) — tuning them is a BEHAVIOR change, out of scope for this pass. Restructure around them, never re-weigh them.
- Tool descriptions/schemas in index.ts are part of the contract (the model reads them); update any description your change makes stale, and prefer documenting a sharp edge (consumed inputs, cache read-only contracts) over restructuring code that is merely subtle.

Honor the existing contract: stateless interface (the repertoire_id handle is the one exception), closed error codes (invalid_pgn, invalid_fen, invalid_color, move_not_found, pgn_too_large, too_many_moves, repertoire_not_found, variation_not_found, invalid_mode, invalid_line, invalid_edit), white-POV centipawns.

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build + typecheck: `pnpm --filter @chess-mcp/chess-tools build && pnpm -r typecheck`.
2. Smoke: `node scripts/smoke-gametree.mjs && node scripts/structure-accuracy.mjs`. For engine/network paths also run `node apps/mcp-server/test/smoke-client.mjs`. Fix your implementation until green.
3. Commit with a concise message explaining WHY the bug was fixed or the structural change was made (not what). No Co-Authored-By trailer.
4. Push `git push origin main`, then confirm CI green (`gh run watch ... --exit-status`). Do not tag — releases are a separate, requested step.
```

---

## 2. Security Mitigation

```text
Act as a pragmatic, veteran security architect reviewing chess-mcp: a local stdio MCP server (Node) that runs a bundled stockfish wasm on caller-supplied PGN/FEN, holds an in-memory repertoire cache, and exposes file-path tools (load_repertoire_from_file / export_repertoire_to_file) that read/write PGN files by caller-supplied path. It runs as a local child process of the MCP client — there is NO network surface and NO authentication boundary to defend; the real threat model is untrusted PGN/FEN/path input reaching the engine, the cache, or the filesystem. Implement concrete, local mitigations strictly for THIS threat model — no web/browser/CORS/CSP concerns apply.

Focus your implementation on:
1. Untrusted PGN/FEN input: enforce the input caps (max PGN bytes, max repertoire bytes, max line moves, depth clamped to [1,30], multipv cap) and SEMANTIC validation (chessops rejects illegal-but-parseable positions; reject zero-move / garbage PGN). Return only structured closed-set errors. No raw exceptions or stack traces reach the caller.
2. Denial of service via input/state: bound per-call engine work (depth clamp, multipv ceiling, the time_limit ceiling) and bound the handle cache (MAX_REPERTOIRES LRU + REPERTOIRE_TTL_S idle expiry in handles.ts). Confirm a flood of load_repertoire calls cannot grow memory without bound.
3. Engine subprocess safety: confirm the engine is the bundled wasm (no caller-controlled binary path, no shell), and that no caller-controlled UCI options are passed. Fix anything that lets caller input reach the engine config.
4. File-path tool safety (index.ts REPERTOIRE_DIR guard): every caller path must resolve-then-prove inside REPERTOIRE_DIR (symlinks resolved BEFORE the containment check); size caps must hold on the bytes actually read, not just a pre-read stat (TOCTOU); exports must never write outside the base dir or follow a caller-controlled parent that doesn't exist. Cover any new guard with traversal (`../`), absolute-path, and symlink-escape cases in a smoke assertion.
5. Internal interpolation / injection surfaces: audit any template-string or interpolation that builds something executed or path-like (FENs, engine args, file paths); add allowlists or explicit inline justification.
6. Error hygiene: do not leak internal host paths or state in error messages — return closed-set error codes, not raw filesystem errors.

Do not add authentication, a network listener, or a heavy security framework — that contradicts the local stdio model. Do not weaken the lean output or stateless contract.

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build + typecheck: `pnpm --filter @chess-mcp/chess-tools build && pnpm -r typecheck`.
2. Smoke: `node scripts/smoke-gametree.mjs && node scripts/structure-accuracy.mjs`, and add an assertion for any new cap/guard (oversized input, expired handle, eviction, malformed PGN/FEN, path escape). For engine/network paths also run `node apps/mcp-server/test/smoke-client.mjs`. Do not compromise core functionality for security theater.
3. Commit: the message must state the EXACT vulnerability mitigated and the method used. No Co-Authored-By trailer.
4. Push `git push origin main`, then confirm CI green (`gh run watch ... --exit-status`). Do not tag — releases are a separate, requested step.
```

---

## 4. Repertoire Analysis Loop

This pass is designed to be run repeatedly. Each run exercises the MCP against a real repertoire, documents what works and what breaks, and ships fixes for the bounded problems it finds. Over time this drives the MCP toward the behavior you actually need.

```text
Act as a pragmatic chess analyst and TypeScript engineer working on chess-mcp. Run a full repertoire analysis loop against `repertoires/<name>/repertoire.pgn`, document the findings, capture retro friction, implement any bounded fixes, and ship. The goal is iterative MCP improvement: each run surfaces new shortcomings and closes the previous ones.

Set `<name>` to the repertoire under test (a short kebab opening name, e.g. `ct-white`, `ct-black`, `english-opening`). If `repertoires/<name>/` does not exist yet — i.e. a brand-new repertoire PGN — complete PHASE 0 first to create the directory structure, then proceed. On every later run for that repertoire, skip PHASE 0.

CONTEXT
- chess-mcp: a Node MCP server (@modelcontextprotocol/sdk + chessops + bundled stockfish wasm). The engine ships as an npm wasm package — nothing to install, no Docker; engine paths run locally.
- MCP owns all FEN/PGN reasoning — never hand-author positions or move sequences; use tools, which return engine-verified FENs and evals
- Repertoire layout: each repertoire lives in its own folder `repertoires/<name>/` with three uniform files — `repertoire.pgn` (the PGN under test), `analysis.md` (versioned run log), `retro.md` (living retro — append, never overwrite). `sample-*.pgn` at repo root are eval fixtures, NOT repertoires — leave them.
- Analysis docs: `repertoires/<name>/analysis.md` and `repertoires/<name>/retro.md`
- Design constraints: `docs/design/MCP_DESIGN.md` (lean ~2k-token outputs, stateless contract, closed error-code set), `docs/design/REPERTOIRE_DESIGN.md` (cache, structural classifier)
- Open issues: check `gh issue list` before logging a new shortcoming — don't duplicate

PHASE 0 — FIRST-PASS SETUP (new repertoire only; skip if `repertoires/<name>/` already exists)
When the loop is pointed at a brand-new PGN that has no folder yet:
1. Pick `<name>` — a short kebab opening label (e.g. `english-opening`).
2. `mkdir -p repertoires/<name>/`.
3. Create `repertoires/<name>/repertoire.pgn` as an ANONYMIZED, reproducible fixture of the source PGN:
   - strip PII headers and prose comments (`Annotator`, `ChapterURL`, `StudyName`, UTC stamps, @-mentions); keep `Event`/`ECO`/`Opening`, ALL moves + side variations (tree unchanged), and PRESERVE move NAGs (`?`/`??`/`?!` → `$2/$4/$6`) so illustrative-line detection (#18 Tier 1) keeps its signal.
   - confirm the fixture loads to the same nodes/leaves/max_depth as the source before relying on it.
   - delete the original PII-named source file once the anonymized fixture is committed; never commit the PII-named original.
4. Seed `repertoires/<name>/analysis.md` and `repertoires/<name>/retro.md` from the existing repertoires' format (version table starting at v1, the standard subheadings). Each repertoire's retro starts fresh at v1 — do NOT dedup its findings against another repertoire's retro; the only cross-run dedup is the gh issue list.
5. Determine the repertoire color from the PGN (whose moves are being recommended) and run the loop only for that side — a White study has no value analyzed `as black`, and vice versa.

PHASE 1 — RUN THE ANALYSIS FLOW
Run tools in this exact order against `repertoires/<name>/repertoire.pgn`:

1. `load_repertoire_from_file` — the token-cheap load: the PGN never enters your context, validation
   errors (invalid_pgn etc.) come back structured. Record tree stats (nodes, leaves, max depth, color).
   Fall back to validate_pgn + load_repertoire(pgn=...) only if file access is unavailable. Handles are
   process-state: a server restart or TTL expiry invalidates them — just reload, never treat a dead
   handle as a finding.
2. `classify_illustrative_lines` — flag the gamebook "wrong-answer" side lines FIRST; pass the flagged paths as exclude_paths to congruence and gaps below so they don't seed false flags or burn the gap budget
3. `get_transpositions` — PRE-FLIGHT REQUIRED before any gap or depth analysis; record all convergence points
4. `get_structural_profile` — full tree; record named structures, confidence, theme tags, center distribution
5. `get_repertoire_coverage` — tree-shape hygiene: dangling lines (your move owed) vs natural frontiers
6. `analyze_repertoire_congruence` (with exclude_paths from step 2) — flags are clustered by opening SYSTEM (move-order-robust), so record the `clusters` partition and read each flag relative to its `cluster`; for each flagged line cross-check the transposition map before treating it as a real issue
7. `find_repertoire_gaps` (with exclude_paths from step 2) — cross-check every reported gap against the transposition map before recording it; suppress any gap that resolves to a transposition endpoint. If `budget_exhausted` comes back true, narrow with max_positions/exclude_paths and re-run rather than reporting a partial scan as complete
8. `evaluate_position` (depth 20) — run on: the repertoire's deepest main-line leaf, any structurally-defining leaf (a forced-weakness or space-bind position the repertoire bets on — e.g. a bxc3 / Maroczy / IQP / KID-bind leaf if present), and any leaf flagged by congruence or gaps that survived transposition cross-check

Assess each result against what the tool was supposed to do. Note: incorrect output, missing signal, false flags, unexplained `unknown` returns, or output that required manual multi-step chaining to interpret.

In-session edit loop (optional, when the analysis surfaces a concrete repertoire-CONTENT fix — a refuted line to prune, a missing reply to add, a move-order to reorder): apply it with `modify_repertoire_line(repertoire_id, path, action, …)` → re-run the relevant tools above on the returned NEW id to confirm the fix, then `export_repertoire_to_file` straight to `repertoires/<name>/repertoire.pgn` — the PGN never passes through your context. Pass only paths + SAN the MCP surfaced; never hand-author content. This is distinct from PHASE 4 (which fixes the MCP CODE) — here you fix the repertoire fixture itself, in one session, no re-download.

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
- Engine-free change (packages/chess-tools/src/ only — e.g. structure.ts, game.ts, repcongruence.ts, gaps.ts — no change to a tool signature in apps/mcp-server/src/index.ts)
- ≤ 2 files touched
- A smoke suite covers the behavior being changed, or you can add a focused assertion to scripts/smoke-gametree.mjs or scripts/structure-accuracy.mjs
- No new tool, no new output field visible to callers, no change to closed error-code set

OPEN ISSUE ONLY (any one is true):
- New tool or changed tool signature
- Design-doc-worthy (non-obvious architecture or data-model decision)
- Touches more than 2 files

For issues: `gh issue create` with a body that includes: problem statement, proposed fix, acceptance criteria, and a reference back to the retro section. Check `gh issue list` first to avoid duplicates.

PHASE 5 — VERIFY AND SHIP
Run in order; do not proceed past a failure:
1. Build + typecheck: `pnpm --filter @chess-mcp/chess-tools build && pnpm -r typecheck`
2. Smoke: `node scripts/smoke-gametree.mjs && node scripts/structure-accuracy.mjs` — if you changed engine-touching paths, also run `node apps/mcp-server/test/smoke-client.mjs`
3. If all green: commit all changes in a single commit with a message of the form `feat/fix: <what changed> — retro v<N>` describing the BEHAVIOR change. No Co-Authored-By trailer.
4. Push `git push origin main`, then confirm CI green (`gh run watch ... --exit-status`). Do not tag — the v* tag (GitHub release) is a separate, requested step.

GUARDRAILS
- First-pass fixtures (PHASE 0) must be anonymized and neutrally named (`repertoire.pgn`) before commit — never commit a PII-named source PGN
- Never edit or delete prior sections of either analysis doc or the retro
- Never hand-author a FEN or move sequence — if you need a position, derive it from tool output
- If a shortcoming's fix is ambiguous, open the issue and skip implementation; do not guess at architecture
- If Phase 5 fails, revert your implementation changes (do NOT use --no-verify), fix the root cause, and re-run from the typecheck step
```

---

## 3. High-Signal Testing

```text
Act as a pragmatic, veteran TypeScript engineer extending the chess-mcp checks. This repo's "tests" are the deterministic smoke suites (scripts/smoke-gametree.mjs, scripts/structure-accuracy.mjs — engine-free, run in CI) plus the engine/network end-to-end client (apps/mcp-server/test/smoke-client.mjs) and the cache check (apps/mcp-server/test/cache.mjs); `pnpm -r typecheck` is the static net. Add high-confidence behavior checks that make refactoring safe. No vanity assertions; do not test chessops or @modelcontextprotocol/sdk themselves — pin OUR usage of them, not their behavior.

Route each check to the suite that owns the layer:
- scripts/smoke-gametree.mjs — the pure layers in packages/chess-tools/src: the GameTree walker (game.ts), path resolution + san-path round-trips, the congruence/coverage/gap helpers (repcongruence.ts, gaps.ts, congruence.ts), the edit loop (modify/export), and the pre-engine guards/clamps/error returns the tools rely on.
- scripts/structure-accuracy.mjs — structure.ts: the 19-structure canon + unknown + confidence (brittleness/specificity/bidirectional cases), the always-on theme tags, center_state. Each scorer has a canonical FEN fixture; keep them.
- apps/mcp-server/test/smoke-client.mjs — the full tool surface through the bundled engine and live network (Lichess/Chess.com). Excluded from CI (network), so keep its assertions self-checking when run locally.
- apps/mcp-server/test/cache.mjs — the engine cache: hit/miss, depth-reuse.

Enforce these principles:
1. Test behavior, not implementation: call the public functions/tools as a consumer would and assert on the OUTPUTS — returned objects (structure_class, confidence, cp_loss, the closed error codes), parsed game trees, resolved FENs, cache hits/misses. Don't assert on internal call sequencing.
2. Real instances over mocks: build real chessops positions / parsed games and feed them through the chess-tools functions. The engine-free layer needs NO mocks. The engine (the stockfish wasm) is the one true external boundary — it's bundled, so the smoke-client exercises it locally; but every guard, clamp, and error return that fires BEFORE the engine is invoked is testable engine-free, and that pre-engine slice is where tool regressions actually live. Score/POV semantics (white-POV centipawns, mate → ±10000, mover-POV negation) get pinned wherever the eval shaping is pure.
3. High-signal targeting: pawn primitives (doubled/isolated/passed/chains/half-open/open), classify_structure (the 19-structure canon + unknown + confidence — each scorer has a canonical FEN fixture) and the theme tags, center_state, the variation walker (iter/walk/tree_stats), resolve_path + san_path round-trips, the handle cache (store/get, TTL expiry, LRU eviction), the congruence rules, and the pure helpers behind the engine tools — pv-rejoins-prep, continued-position key sets, opponent-reply-node selection, path exclusion, NAG illustrative-node detection / player-side variations, the tree edit, the gap budget fit. Skip trivial passthroughs.
4. Clean state hygiene: guarantee isolation. Reset the module-level handle cache between cases; override MAX_REPERTOIRES / REPERTOIRE_TTL_S for eviction/expiry checks so they are deterministic and don't leak across cases.
5. Defensive boundaries: malformed/empty PGN and FEN, garbled-tail PGN (assert the tools REJECT, not silently analyze half a game), empty or single-node trees, expired/unknown handles (repertoire_not_found), unknown structures (must return "unknown", never a guessed label), terminal positions for suggest, oversized input vs the byte caps, action↔payload mismatches in modify_repertoire_line. Assert the code degrades into a structured error from the closed set, never a crash.
6. Assert meaning, not prose: pin error CODES and structural fields (paths, counts, severity ranks), not reason strings or float confidences to exact decimals — those are allowed to be reworded/re-tuned without breaking the suite.

Match the existing smoke scripts' style (plain node:assert, hand-built positions via the existing helpers, shared fixture PGNs — reuse them instead of inventing new ones; keep all fixtures synthetic, never from real user games).

EXECUTION WORKFLOW (run in order; do not stop until green):
1. Build + typecheck: `pnpm --filter @chess-mcp/chess-tools build && pnpm -r typecheck`.
2. Smoke: `node scripts/smoke-gametree.mjs && node scripts/structure-accuracy.mjs`. If new assertions fail or break existing ones, debug and fix the CHECK — unless you uncovered a real bug in chess-tools/the server, in which case fix the source and note it in the commit.
3. Commit with a concise message describing the BEHAVIOR now covered. No Co-Authored-By trailer.
4. Push `git push origin main`, then confirm CI green (`gh run watch ... --exit-status`). Do not tag — releases are a separate, requested step.
```
