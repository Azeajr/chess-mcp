# Node-Only Migration Design

Goal: eliminate the Docker / Python runtime dependency from the plugin. After this, a fresh install
works with `node` alone (the `uv`-based `chess-files` proxy is removed — the Node server serves
`load_repertoire_from_file` / `export_repertoire_to_file` natively).
Issue scope:
- `plugin/.claude-plugin/plugin.json`
- `.mcp.json`
- `apps/mcp-server/src/engine.ts` (cache)
- `packages/chess-tools/src/boardimage.ts` (`boardSvg` — last_move highlight)
- `apps/mcp-server/src/index.ts` (`board_image` tool schema + stale comment/docstring)

Status: **in design** (design-doc-first, per house convention).

---

## Current posture

The plugin ships two MCP servers:

| Server | Runtime | Startup hook |
|--------|---------|-------------|
| `chess-analysis` | SSE → Docker (Python + full Stockfish 18) | `docker run ghcr.io/azeajr/chess-mcp:latest` |
| `chess-files` | stdio Python proxy → SSE :8000 | none (uses hook-started container) |

`.mcp.json` also registers `chess-analysis` via Node stdio (`node --import tsx
apps/mcp-server/src/index.ts`) — the working-repo dev server, project scope. Once the plugin is
Docker-free and itself runs the Node server, the plugin and `.mcp.json` entries are the same server
from two scopes (D5).

The Node server already has **tool-for-tool parity** with the Python server. Two gaps were
identified before Docker can be dropped; G2 turned out to have no caller and is deferred, leaving
**G1 (the eval cache) as the only blocker**: 

| # | Gap | Where |
|---|-----|-------|
| G1 | No eval cache — every engine call re-evaluates from scratch | `apps/mcp-server/src/engine.ts` |
| G2 | `board_image` missing `last_move` highlight (**deferred — see D2; no caller today**) | `packages/chess-tools/src/boardimage.ts` + tool schema in `apps/mcp-server/src/index.ts` |

One stale comment (`index.ts` lines 3–6: "heavy domain ports … still in the Python server (see
docs/design/UI_DESIGN.md)") tracks no real gap — the structure classifier, ECO, illustrative
lines, suggest, and batch_review are all already in the Node server. It will be removed as part of
this work.

**G2 is deferred, not in this work.** `board_image` has **no caller** — no skill invokes it, and
the UI renders boards with chessground, not this tool. The only consumer is an ad-hoc LLM call.
Adding `last_move` is work for an unused tool, so D2 is specced but **out of Phase A**; build it
only if/when a skill needs a highlighted board. The Node `board_image` also already diverges from
Python (raw SVG string vs base64; no SAN/legality/arrow) — all of that stays as-is until there's a
reason to close it.

---

## Decisions

### D1 — In-process eval cache in `engine.ts`

**Recommendation:** add a `Map<string, { depth: number; lines: MultiLine[] }>` keyed by
`${fen}|${multipv}` inside `engine.ts`. On lookup, it's a hit iff `stored.depth >= requested depth`
— return `stored.lines` immediately (skip the engine call); otherwise recompute and overwrite. No
disk persistence.

**Why the key is `fen|multipv`, not `fen|multipv|depth`.** The "a deeper cached result satisfies a
shallower request" win only works if depth is a *value to compare*, not part of the key. If depth
were in the key, a depth-16 entry and a depth-14 request would hash to different keys and miss —
defeating the optimisation. Keep `multipv` in the key: changing MultiPV changes Stockfish's search,
so a `multipv=3` entry must not serve a `multipv=1` request (and vice versa).

**Why in-process, not SQLite.** The Python server's SQLite cache (feature #28) was motivated by
Docker restart cost and a shared-process handle cache. The Node server runs in-process per Claude
Code session; per-session locality covers the dominant use case (gap scan, batch review, annotated
PGN all re-evaluate the same opening positions inside one run). Adding SQLite adds a native dep and
build complexity for a win that matters only across restarts — a stretch goal, not a blocker.

**Why not `lru_cache`.** Node has no stdlib equivalent; a plain `Map` with a size cap (1 000
entries, ~few MB at typical engine output size) is transparent and zero-dep. Eviction is FIFO on
overflow (shift the first entry).

**Design dimensions (decided):**

| Axis | Options considered | Decision | Reason |
|------|-------------------|----------|--------|
| Store | unbounded `Map` / capped `Map` / SQLite | **capped `Map`** | unbounded risks blowup on long gap-scan sessions; SQLite is the dropped #28 |
| Cap | — | **`MAX_CACHE = 1000`** | ~few KB/entry → few MB. One gap scan is ≤60 positions × a few depths, so the cap almost never trips in a session |
| Eviction | FIFO / LRU | **FIFO** (shift oldest `Map` key) | LRU's better hit-rate is moot when eviction rarely fires; not worth access-order bookkeeping |
| Scope | per-process singleton / cross-session | **per-process** (= per Claude Code session) | matches where the engine itself lives; cleared on restart; no persistence layer |
| Key / value | — | key `` `${fen}|${multipv}` ``, value `{ depth, lines }` | depth is a compared value, not a key field (see above) |
| Invalidation | TTL / none | **none** | positions are immutable and the eval is deterministic at a given depth — nothing to expire |

Cross-session persistence (SQLite) stays out — it's the Phase C / "out of scope" stretch, not a
blocker for dropping Docker.

**Cache key correctness — halfmove clock.** The key uses the **full FEN as passed to
`analyseMulti`**; it does NOT strip the halfmove clock. The earlier draft claimed the engine
"already strips it" — that is false: `engine.ts:104` sends `position fen ${fen}` with the raw,
unmodified FEN, including fields 5–6 (halfmove + fullmove counters). Stockfish therefore sees the
clock, and the clock legitimately affects the eval near the 50-move rule. Collapsing two positions
that differ only in halfmove clock onto one key would risk serving a stale/wrong eval in exactly
those drawish endgames. The minor dedup loss (same position reached with different clocks) is the
correct trade. (Fullmove number — field 6 — does not affect the search, but stripping it buys
almost nothing and adds a normalisation step, so leave the FEN whole.)

**Contract impact.** `analyseMulti` return type unchanged. Tools calling it see no change.

**Test seam (required — does not exist today).** `getEngine` is module-private and not exported, so
the "stub `getEngine`" approach in the draft cannot be wired without a refactor. Add one of:
- export an `__setEngineForTest(engine)` hook (or accept an injected engine via a module-level
  setter), or
- factor the pure cache (`Map` get/put + depth comparison + FIFO eviction) into a tiny exported
  `evalCache` object and unit-test *that* directly, independent of `analyseMulti`.

The cache-object route is preferred: it tests the actual logic (hit / depth-miss / eviction) with
zero engine and zero async, and keeps `analyseMulti` thin.

**Tests (engine-free).** Cache hit: same `fen|multipv`, stored depth ≥ requested → returns stored
lines, no engine call. Depth miss: stored depth 10, request depth 14 → miss, recompute. Eviction:
insert `MAX_CACHE + 1` distinct keys → oldest (FIFO) gone. These assert against the exported cache
object, not a stubbed engine.

### D2 — `board_image` last_move highlight (DEFERRED)

> **Status: deferred, not built in this work.** `board_image` has no caller — no skill invokes it
> and the UI uses chessground. Building `last_move` for an unused tool is unjustified. Spec kept
> below for when a skill needs a highlighted board; **not** part of Phase A. If revisited, build the
> lean version only (tint-only, UCI-only, no arrow/legality — see scope decision below).

**Recommendation (when built):** add `last_move?: string` (UCI, e.g. `"e2e4"`) to `boardSvg` opts. When
present, parse the from/to squares and render those squares with a yellow tint (`#f6f669` at 50%
opacity via SVG `rect fill-opacity`) drawn on top of the normal square color, before the piece
glyph.

**Why this matters.** `board_image` is called exclusively from Claude-Code skills (game review,
annotated PGN walkthrough). The dominant use case is "here is the blunder position" — without
`last_move`, the model must describe in text which square to look at. With it, the from/to squares
are visually obvious.

**Why UCI not SAN.** The MCP server always has the UCI move available (engine output is UCI;
`analyzeMainline` records store `best_move` as UCI). SAN requires a board to parse; UCI is
self-contained in a `boardSvg` that takes only a FEN. The tool wrapper in `index.ts` accepts
`last_move` as an optional UCI string and passes it through. This is a deliberate *parity
reduction* vs Python (whose `board_image` also accepts SAN via `_parse_move`) — acceptable because
all internal callers (skills) pass UCI.

**Scope decision vs Python parity.** Python's `board_image` also (a) validates that `last_move` is
legal in the position and returns `{"error":"invalid_move"}` otherwise, and (b) draws an arrow on
top of the tint. Recommendation: **tint only, no arrow, no legality check** for the first cut —
`boardSvg` takes only a FEN and would need a chessops board parse to validate legality, which the
~8-line change avoids. If `last_move` doesn't parse to two on-board squares, silently skip the tint
(render the plain board) rather than erroring. Revisit arrow + legality if a skill needs it. Note
this leaves the Node tool's *return shape* (raw `svg` string) still divergent from Python's base64
— out of scope here; tracked under the parity note in "Current posture".

**File.** The change is in `packages/chess-tools/src/boardimage.ts` (where `boardSvg` lives — NOT
`apps/mcp-server`), plus the optional `last_move` field on the `board_image` schema in
`apps/mcp-server/src/index.ts`.

**Implementation.** ~8 lines in `boardimage.ts`: add `last_move?: string` to the opts; extract
file/rank from the 4-char UCI string, compute display coordinates (respecting `orientation`, which
`boardSvg` already handles via `dispR`/`dispF`), emit a `<rect>` with `fill="#f6f669"
fill-opacity="0.5"` for each of the from/to squares before the piece `<text>`. No external deps.

**Tests.** Extend the existing `boardSvg` smoke test (`scripts/smoke-gametree.mjs`, test 19 already
asserts 64 rects + glyphs). Add: `boardSvg(START_FEN, { last_move: "e2e4" })` contains exactly two
`fill="#f6f669"` rects at the e2/e4 coordinates; `boardSvg(START_FEN)` (no `last_move`) contains
none. There is no snapshot framework — assert on substrings/counts like the existing tests.

### D3 — Remove Docker from plugin.json

**Recommendation:** delete the `SessionStart` Docker hook and the `chess-analysis` SSE entry from
`plugin.json`. Keep only the Node stdio entry.

The naive form below is **wrong** for one reason only (the `env` is actually fine — see below):

```jsonc
// plugin.json mcpServers — DO NOT USE (cwd-relative server path)
{
  "chess-analysis": {
    "type": "stdio",
    "command": "node",
    "args": ["--import", "tsx", "apps/mcp-server/src/index.ts"],
    "env": { "REPERTOIRE_DIR": "${CLAUDE_PLUGIN_DATA}/repertoires" }
  }
}
```

The single real problem:
1. **Relative `apps/mcp-server/src/index.ts` resolves against the subprocess `cwd`**, which for a
   plugin user is *their* project, not the marketplace checkout — the file won't be found. The path
   must be absolute, derived from `$CLAUDE_PLUGIN_ROOT`.

**Correction (verified against Claude Code plugin docs, 2026-06-15 build):** the `env` line above is
*not* wrong. `${CLAUDE_PLUGIN_DATA}` **is** a real injected var (a per-plugin directory that
persists across updates, `~/.claude/plugins/data/{id}/`), and **`${VAR}` is expanded in `plugin.json`
`env` string values at runtime**. An earlier draft of this doc — and a first review pass — claimed
neither was true; both claims were wrong. `REPERTOIRE_DIR="${CLAUDE_PLUGIN_DATA}/repertoires"` set
directly in `env` would work. The only reasons we still use an `sh -c` wrapper (D4) are: (a) locating
the server source needs `$CLAUDE_PLUGIN_ROOT` path arithmetic into the marketplace monorepo, (b)
`writeFile` needs the repertoires parent to exist, so a `mkdir -p` is required, and (c) `${VAR}`
expansion in `args` (vs `env`) is not documented, so the wrapper is the safe place to compute paths.

**Resolution:** use the same `sh -c` wrapper idiom the chess-files entry uses to compute the
marketplace root for the server source, but point `REPERTOIRE_DIR` at `$CLAUDE_PLUGIN_DATA/repertoires`
(the persistent per-plugin data dir), not the marketplace checkout. See D4 for the full rationale.

**chess-files proxy.** With the Node server handling `load_repertoire_from_file` and
`export_repertoire_to_file` natively, the `chess-files` server is redundant. Remove it from
`plugin.json`. The `chess-mcp-server` Docker container is no longer started or needed by the plugin.

**Docker stays for dev.** `compose.yml`, `Dockerfile`, `install.sh`, and the Python server source
remain. They are the dev/test path (evals run in Docker, the Python server is the reference
implementation for structural tests). Only the plugin distribution sheds Docker.

### D4 — Plugin command: tsx vs compiled JS

**Recommendation:** keep `node --import tsx` for now. Ship as compiled `node dist/index.js` in a
follow-up once a `pnpm build:mcp` target is added (the Node server has no standalone build target
today). The tsx path requires `tsx` in the monorepo's devDependencies, which is already there.

**REPERTOIRE_DIR for plugin users.** Without Docker, `REPERTOIRE_DIR` must point somewhere
persistent. **Decision: `${CLAUDE_PLUGIN_DATA}/repertoires` — the blessed per-plugin data dir, NOT
the marketplace checkout and NOT a hand-rolled `$HOME`/XDG path.**

`CLAUDE_PLUGIN_DATA` resolves to `~/.claude/plugins/data/{id}/` (plugin id, non-alphanumerics →
hyphens) and is documented as the place for "files that should persist across plugin versions" —
exactly repertoires. It survives plugin updates/reinstalls; the marketplace cache does NOT (old
version is orphaned and deleted ~7 days after an update — see "Why not the checkout" below).

```jsonc
"chess-analysis": {
  "type": "stdio",
  "command": "sh",
  "args": ["-c", "MROOT=$(dirname \"$CLAUDE_PLUGIN_ROOT\")/../../../marketplaces/chess-mcp; REPDIR=\"$CLAUDE_PLUGIN_DATA/repertoires\"; mkdir -p \"$REPDIR\"; exec env REPERTOIRE_DIR=\"$REPDIR\" node --import tsx \"$MROOT/apps/mcp-server/src/index.ts\""],
  "env": {}
}
```

Why a wrapper at all, given `env` expansion works:
- `REPERTOIRE_DIR` alone could be set directly via `"env": { "REPERTOIRE_DIR": "${CLAUDE_PLUGIN_DATA}/repertoires" }`
  (expansion is supported — see D3 correction). But the wrapper is still needed to (a) compute the
  marketplace-relative path to the server source from `$CLAUDE_PLUGIN_ROOT`, and (b) `mkdir -p` the
  repertoires dir, since Node's `writeFile` won't create the parent. Doing both in one `sh -c` keeps
  it in a single proven idiom (mirrors the existing chess-files entry).

Why `CLAUDE_PLUGIN_DATA`, not `$MROOT/repertoires` or XDG:
- **Survives updates.** The plugin is copied to `~/.claude/plugins/cache`; on update the old version
  dir is orphaned and removed after ~7 days. Data written under the checkout / `$CLAUDE_PLUGIN_ROOT`
  would be lost. `CLAUDE_PLUGIN_DATA` is purpose-built to outlive versions.
- **Blessed + namespaced.** No hand-rolled XDG path, no dependence on the marketplace layout for
  *data* (only for locating source, which is unavoidable).
- **One-time dev migration.** The only existing files live in the old chess-files `$MROOT/repertoires`;
  `mv "$MROOT/repertoires"/* "$CLAUDE_PLUGIN_DATA/repertoires"/` once.

Readable form of the wrapper:
```sh
MROOT=$(dirname "$CLAUDE_PLUGIN_ROOT")/../../../marketplaces/chess-mcp
REPDIR="$CLAUDE_PLUGIN_DATA/repertoires"
mkdir -p "$REPDIR"
exec env REPERTOIRE_DIR="$REPDIR" \
  node --import tsx "$MROOT/apps/mcp-server/src/index.ts"
```

### D5 — `.mcp.json` in the working repo

**Recommendation:** `.mcp.json` keeps the Node stdio entry as the project-scope server for
contributors / the developer. No change needed — it already points at the Node server.

Remove the `enabledMcpjsonServers: ["chess-analysis"]` entry from `.claude/settings.json` once
the plugin is the canonical distribution: contributors cloning the repo will approve `.mcp.json`
manually. Keep it for now (it enables the Node server for the current project session).

### D6 — Stale comment removal + docstring fixes

Remove the stale "heavy domain ports … still in the Python server" comment from `index.ts`
(lines 3–6 of the file header).

Update the `get_structural_profile` docstring (`index.ts:598`). It still claims `structure_class is
currently 'unknown' (named-structure scorers not yet ported)` — that is stale. The single-node path
calls `positionProfile` (`packages/chess-tools/src/structure.ts:395`), which calls
`classifyStructure(board)` and returns the real `structure_class` + `confidence`. (The omit-path
aggregate branch goes through `aggregateProfile`, which returns a *distribution* of named
structures over the leaves, not a single `structure_class` — also built on the classifier, also not
"unknown".) Rewrite the docstring: the single-node form returns the classified named structure with
`confidence`; the aggregate form returns the structure fingerprint. Drop the "structure_class is
currently 'unknown' / themes carry the signal" caveat entirely.

---

## Phasing

**Phase A — engine cache (no Docker, self-contained):**
- D1: add the `fen|multipv` cache + exported cache object (test seam) in `apps/mcp-server/src/engine.ts`
- D6: remove stale header comment; fix `get_structural_profile` docstring
- Tests: extend `scripts/smoke-gametree.mjs` — cache hit/depth-miss/eviction against the exported
  cache object
- Verify: `pnpm typecheck` green; `./scripts/run-pass.sh` (the existing smoke scripts) green
- (D2 board_image is deferred — no caller; not in this phase.)

**Phase B — plugin.json Docker removal:**
- D3: delete SessionStart hook + SSE chess-analysis + chess-files from `plugin.json`
- D4: add Node stdio entry with the `sh -c` wrapper (`REPERTOIRE_DIR=$CLAUDE_PLUGIN_DATA/repertoires`)
- Update plugin cache + marketplace copies (same 3-file sync as the chess-files fix)
- Verify: fresh session with plugin only → `/doctor` shows one `chess-analysis` connected, no
  chess-files entry, no Docker hook output in SessionStart log
- Bump `version` to **`1.0.0`** in both `plugin.json` and `marketplace.json` (currently `0.3.0`) —
  Docker-free is the 1.0 distribution.

**Phase C — compiled server (stretch):**
- Add a `build` script to `apps/mcp-server/package.json` (`tsc -p tsconfig.json`, `outDir: dist`).
  The package currently has **only** `typecheck` (`tsc --noEmit`) — `pnpm -r build` skips it today.
- `index.ts:404` loads `data/openings.tsv` via `join(dirname(import.meta.url), "..", "data", …)`.
  With `outDir: dist`, `dist/index.js` resolves `../data` → `apps/mcp-server/data`, which works
  **only if `dist/` stays a sibling of `data/`**. Keep `data/` out of `outDir` (it is, as a sibling)
  or add a copy step. Flag in the build task.
- Switch the plugin wrapper from `tsx`-on-`src` to `node dist/index.js`; drop the `tsx` runtime
  requirement.

---

## Test plan

There is **no unit-test framework** (no vitest/jest, no `test` script in `package.json`). Tests are
hand-rolled `.mjs` smoke scripts with a local `ok()` assert, run via `./scripts/run-pass.sh`
(`scripts/smoke-gametree.mjs`, `scripts/structure-accuracy.mjs`, `apps/mcp-server/test/smoke-client.mjs`).
New tests are added there, not to a framework. `boardSvg` is already exercised by test 19 in
`smoke-gametree.mjs`.

| Test | Engine? | How |
|------|---------|-----|
| Cache hit (stored depth ≥ requested → returns stored, no engine) | no | call the exported cache object directly |
| Cache depth-miss (stored depth 10, request 14 → miss) | no | same |
| Cache eviction (insert MAX_CACHE+1 keys → oldest FIFO gone) | no | same |
| `boardSvg` last_move → exactly two `#f6f669` rects at from/to coords | no | string/count assertion in `smoke-gametree.mjs` |
| `boardSvg` no last_move → zero `#f6f669` rects | no | same |
| `validate_fen` / `get_legal_moves` unaffected | no | existing smoke scripts |
| `find_repertoire_gaps` with the Node engine (no Docker) | yes (Node) | manual: run in session, confirm gaps returned |

The cache tests hit the exported cache object, not a stubbed `getEngine` (which is module-private —
see D1's test-seam note).

---

## Out of scope

- SQLite persistent eval cache across sessions (Phase C stretch; design tracked in `CLOUD_EVAL_DESIGN.md`'s "Node port" section once written)
- `pnpm build:mcp` standalone build (Phase C)
- Python server removal from the repo (it stays as the dev/eval reference)
- Publish a new plugin version to the marketplace (user-triggered: after the `1.0.0` bump in `plugin.json` + `marketplace.json`, commit, let Claude Code pick it up on next update)

## Loose ends (track, fix in Phase B)

- **`plugin.json` `description` still says "Stockfish + Maia via Docker."** Update it when D3 lands —
  no Docker, and Maia is not in the Node server. Reword to the Node/Stockfish reality.
