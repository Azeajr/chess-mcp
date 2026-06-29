# Tool Consolidation — Audit, Surface-Trim, and the Bridges/Shorten Dedup

Status: **planned**. Drives the `retro.md` "are all tools valuable / is there a point to bridges
when there is shorten" follow-ups.

> **Revised:** the bridges/shorten conclusion in Plan C is superseded by
> `GAP_RESOLUTION_DESIGN.md` — bridges does **not** survive as a tool; it dissolves into a
> transposition-first gap-resolution pipeline. The `engine_move` + `board_image` deletions (Plans A,
> B) and the shared-primitive extraction stand, with the primitive now serving **three** consumers
> (gaps, stub resolution, shorten) rather than two.

Repo-relative paths: `chess-tools/src/` = `packages/chess-tools/src/`, MCP server under
`apps/mcp-server/src/`, PWA under `apps/ui/src/`.

---

## Motivation (from retro.md)

> Are all the tools valuable / do they serve a useful purpose? Some tools don't provide actionable
> functionality. Maybe there's overlap — is there a point to bridges when there is shorten?

Two surfaces expose the toolset, and they are **not** the same context:

- **MCP server** (`apps/mcp-server/src/index.ts`) — headless, text-only. The model has **no board**,
  constructs FENs/PGNs itself, and is driven by the four skills under `plugin/skills/`.
- **PWA** (`apps/ui/src/llm/tools.ts`) — the deployed `chess-repertoire-analysis.pages.dev` chat.
  The model sits **next to a live board** and a repertoire tree.

A tool that looks idle on one surface can be pivotal on the other. **Hard constraint: do not remove
a tool that is pivotal or otherwise useful to the MCP side.** This audit weighs every cut candidate
against *both* surfaces plus skill/workflow/doc dependencies before touching anything.

---

## Surface diff

The two surfaces are near-identical (~30 shared tools). Divergences:

| Only on… | Tools | Why |
|---|---|---|
| **MCP** | `load_repertoire`, `load_repertoire_from_file`, `export_repertoire`, `export_repertoire_to_file` | Stateful `repertoire_id` handles + file IO; the PWA operates on the one live `currentTree()` |
| **PWA** | `propose_line` | UI staging (blue arrow + accept/reject); the MCP has no board to stage on |

Everything else is registered on both.

---

## Audit — verdict per cut candidate

A PWA-only first pass flagged six tools as dead weight or overlap. Re-judged against the MCP side +
skill/workflow/doc references, **four of six flip to KEEP** (`board_image` stays a cut, but for a
sharper reason than the first pass had — see its row):

| Tool | PWA-only first call | Corrected verdict | Binding dependency |
|---|---|---|---|
| `validate_fen` / `validate_pgn` / `validate_line` | "dead weight" | **KEEP (both)** | All **4 skills** call them; MCP's anti-hallucination guardrail (model builds FEN/PGN itself) |
| `board_image` | "dead weight here" | **DELETE (both)** | Returns SVG-as-*text* via `ok()` (`{type:"text"}`), not an MCP `image` block; the model can't see it (strictly worse than the FEN it holds), no client renders JSON-stringified SVG, and the Claude Code terminal target can't either; 0 skill refs; `boardSvg` has no other consumer |
| `get_game_summary` | cut (⊂ `analyze_game`) | **KEEP** | `chess-game-review` skill's documented summary entry point; returns compact tokens vs the full per-move list |
| `classify_illustrative_lines` | weak standalone | **KEEP** | `find_repertoire_gaps` pre-filter step in `workflows.ts`; own `ILLUSTRATIVE_LINE_DESIGN.md` |
| `cloud_eval` | fallback only | **KEEP** | Distinct data source (Lichess community cloud); no skill churn worth the removal |
| `engine_move` | redundant | **DELETE (both)** | True subset of `evaluate_position(lines=1)`; **0** skill/workflow refs — only its own design doc + a smoke test reference it |

Net: **two genuine cuts** (`engine_move`, `board_image`) + one internal refactor — still not a
blanket sweep; the six skill/MCP-bound tools stay (`validate_*` ×3, `get_game_summary`,
`classify_illustrative_lines`, `cloud_eval`).

---

## Plan A — delete `engine_move`

`engine_move` returns the single best move + eval; `evaluate_position` with `lines: 1` returns the
same in a one-element list. The only behavioural difference is a default depth (16 vs 14), trivially
absorbed. Reference scan (`grep` across `--include=*.ts,*.tsx,*.md,*.mjs`, excluding registrations):
no skill, no `workflows.ts`, no store calls it — only `ENGINE_MOVE_DESIGN.md` and
`apps/mcp-server/test/smoke-client.mjs`.

| File | Change |
|---|---|
| `apps/mcp-server/src/index.ts` | remove the `engine_move` `server.tool(…)` block |
| `apps/ui/src/llm/tools.ts` | remove the `fn("engine_move", …)` schema + the `case "engine_move"` executor |
| `apps/mcp-server/test/smoke-client.mjs` | drop the `engine_move` call (or repoint to `evaluate_position` `lines:1`) |
| `docs/design/ENGINE_MOVE_DESIGN.md` | prepend `Status: superseded by evaluate_position(lines:1)` note; keep as history |

Skills already use `evaluate_position`, so no skill edit is needed.

---

## Plan B — delete `board_image` (both surfaces) + dead `boardSvg`

`board_image` returns `{ format: "svg", svg }` wrapped by `ok()` as a **text** content block
(`{ type: "text" }`) — not an MCP `image` block. Consequences:

- **The model can't see it.** It receives `<svg…>` markup as text, which carries nothing the FEN
  doesn't already give it (and the project grounds on FEN/SAN/eval by design).
- **No client renders it.** A JSON-stringified SVG in a text result is not an image to any MCP
  client; the Claude Code terminal (the distribution target) can't display SVG at all.
- **Nothing depends on it.** 0 skill refs; `boardSvg`'s only consumers are the two `board_image`
  registrations + its own smoke test + the `chess-tools` re-export.

Dead on MCP, redundant on the PWA (live board already on screen). Delete the tool from both surfaces
**and** the now-orphaned `boardSvg` impl.

| File | Change |
|---|---|
| `apps/mcp-server/src/index.ts` | remove the `board_image` `server.tool(…)` + the `boardSvg` import |
| `apps/ui/src/llm/tools.ts` | remove `fn("board_image", …)` + `case "board_image"` + the `boardSvg` import |
| `packages/chess-tools/src/boardimage.ts` | **delete** the file |
| `packages/chess-tools/src/index.ts` | remove `export { boardSvg }` |
| `scripts/smoke-gametree.mjs` | drop the `boardSvg` render assertions (§19) |
| `apps/mcp-server/test/smoke-client.mjs` | drop the `board_image` call |

**Resurrection path (if ever needed):** a *rendered* board is only worth re-adding as a proper MCP
`image` content block (base64 raster, e.g. PNG) for an image-capable client — a new feature, not the
current SVG-text. Even then the model wouldn't benefit (FEN reasoning beats board vision); the value
is purely showing a human a picture. Out of scope until such a client/use case is real.

---

## Plan C — the bridges/shorten dedup (refactor, not a cut)

> **Superseded in part by `GAP_RESOLUTION_DESIGN.md`.** The "keep both tool faces" conclusion below
> no longer holds: `find_transposition_opportunities` is **removed** as a tool and its useful logic
> absorbed into gap resolution. What survives from this section is the **shared-primitive
> extraction** (`buildKeyIndex` / `landsInCrossBranchPrep` / `isPrefix` / `enumerateLegal` /
> `moverCp` / `nearBest`) — now consumed by gap resolution, stub resolution (`extendedBridges`), and
> `shorten` (`pruneTranspositions`). Read the rest of Plan C as the rationale for *why* bridges-the-
> tool collapses, not as a plan to retain it.

### Answer to "is there a point to bridges when there is shorten?"

Yes. They are **mirror operations with opposite intent**, and bridges has unique value shorten can
never produce:

| | `find_transposition_opportunities` (bridges) | `find_pruning_transpositions` (shorten) |
|---|---|---|
| Source | a STOPPED frontier leaf, or a branch point | a COMPLETE leaf line |
| Move does | EXTENDS forward into existing prep | RE-ROUTES earlier → the tail goes redundant |
| Net effect | grows coverage / interlinks | cuts plies (`savedPlies`) |
| Engine | `opportunities` engine-FREE; `extensions` (`max_depth>1`) engine-backed | always engine-backed |

The **engine-free 1-ply `opportunities`** — `frontier_link`, `move_order_merge`,
`coverage_confirmed` — are bridges' irreplaceable core: shorten only ever cuts complete lines and
has no analog for "you already cover this opponent try by transposition." So **both tool faces
stay.**

### Where the overlap actually is

Only bridges' multi-ply engine path (`extendedBridges`) and shorten (`pruneTranspositions`) share
machinery — and it is currently **copy-pasted**, not shared:

| Duplicated primitive | Copies today |
|---|---|
| `isPrefix(a, b)` | **3** — `transpositionBridges`, `extendedBridges`, `pruneTranspositions` |
| `indexAll` → `keyMap` (positionKey → shallowest `{path, sanPath, ply}`) | **3** — same three methods |
| legal-move enumerator (`chessgroundDests` + `makeSan` + queen-promo) | **4** uses across `pgn.ts` (also one in `validate.ts`) |
| `moverCp` / near-best gate (white-POV → side-to-move, filter within cp of #1) | hand-rolled in `pruneTranspositions`, in the PWA `pickMoves` (`tools.ts`), and in the MCP `pickMoves` (`index.ts`); `gaps.ts` has its own |
| cross-branch-prep test (`keyMap.get(key)` + prefix-either-way guard) | inline in both `extendedBridges` and `pruneTranspositions` |

This is exactly the "overlap" the retro smelled — duplicated plumbing, not a redundant feature.

### Extraction (behaviour-preserving)

Hoist module-private helpers in `chess-tools/src/pgn.ts` (or a small `transposition.ts`), consumed by
all three methods:

- `buildKeyIndex(tree)` → `{ keyMap, keyCount }` — the one `indexAll` walk.
- `isPrefix` → module scope (delete the 3 local copies).
- `enumerateLegal(pos)` → the single legal-move materializer (replaces the in-method copies; align
  `validate.ts` to it).
- `landsInCrossBranchPrep(keyMap, afterPos, ownPath)` → the `keyMap` lookup + prefix guard, returning
  the target node or `null`.
- `moverCp(fen, line)` + `nearBest(lines, cpThreshold)` → centralize the white-POV→mover projection
  and the near-best filter; reuse the eval projection `gaps.ts` already needs rather than minting a
  fourth. Both `pickMoves` implementations (`tools.ts`, `index.ts`) call `nearBest` instead of the
  hand-rolled `best - moverCp(l) <= 50`, unifying the threshold (default **50**, preserved).

The two public methods, their signatures, and their outputs stay **identical** — only the shared
internals move. Smoke tests (`scripts/smoke-gametree.mjs`) already cover both; they must stay green
with no assertion changes (the proof the refactor is behaviour-preserving).

### Considered and rejected — merging the tool faces

A single tool with a `direction: extend | shorten` flag was considered. Rejected: the user is
*already* unsure whether these are the same thing; collapsing them onto one tool worsens the mental
model. They start from different node sets (frontier stubs vs complete leaves), have opposite output
semantics (graft vs prune), feed different UI panels, and want different bounds. Keep two clear
faces; share the primitive underneath. This dedup also shrinks the future "deepen shorten with a
movetime/total-budget dial" thread (see `SUGGEST_PRUNE_DESIGN.md`), since both tools would then walk
one shared, budget-aware engine primitive.

---

## Deferred (out of scope here)

- **`classify_illustrative_lines` → fold into `find_repertoire_gaps` as a flag.** Tempting, but it's
  load-bearing in the documented workflow; a separate change once the chain is revisited.
- **Shorten depth → movetime + total-budget dial** (the third retro thread). Tracked in
  `SUGGEST_PRUNE_DESIGN.md`; easier after Plan C lands the shared engine walk. Today shorten is
  hardcoded `analyseMulti(fen, mpv, 14)` with no depth knob.
- **Mobile optimization** of the PWA — separate frontend pass; a leaner toolset (Plans A/B) reduces
  what the chat surface must lay out.

---

## File changes (Plans A–C)

| File | Change |
|---|---|
| `apps/mcp-server/src/index.ts` | remove `engine_move` + `board_image` + the `boardSvg` import; `pickMoves` calls shared `nearBest` |
| `apps/ui/src/llm/tools.ts` | remove `engine_move` + `board_image` (schema + executor + `boardSvg` import); `pickMoves` calls shared `nearBest` |
| `packages/chess-tools/src/boardimage.ts` | **delete** (orphaned) |
| `packages/chess-tools/src/pgn.ts` | extract `buildKeyIndex` / `isPrefix` / `enumerateLegal` / `landsInCrossBranchPrep` / `moverCp` / `nearBest`; rewire the 3 methods |
| `packages/chess-tools/src/index.ts` | remove `export { boardSvg }`; export the newly shared helpers the surfaces need |
| `packages/chess-tools/src/validate.ts` | use the shared `enumerateLegal` |
| `scripts/smoke-gametree.mjs` | drop the `boardSvg` render assertions (§19) |
| `apps/mcp-server/test/smoke-client.mjs` | drop the `engine_move` + `board_image` calls |
| `docs/design/ENGINE_MOVE_DESIGN.md` | mark superseded |

---

## Testing

- `scripts/smoke-gametree.mjs` — unchanged assertions for `transpositionBridges` / `extendedBridges`
  / `pruneTranspositions` must stay green (Plan C is behaviour-preserving).
- `apps/mcp-server/test/smoke-client.mjs` — passes after the `engine_move` call is removed; confirm
  `evaluate_position` covers the single-best need.
- Manual: neither surface offers `engine_move` or `board_image`; `evaluate_position` covers the
  single-best need; MCP still answers `validate_*`, `cloud_eval`, `get_game_summary`.

---

## Non-Goals

- Removing any tool a skill, workflow, or the MCP side depends on (`validate_*`, `get_game_summary`,
  `classify_illustrative_lines`, `cloud_eval`).
- Merging `find_transposition_opportunities` and `find_pruning_transpositions` into one tool.
- Changing the output shape of any retained tool — Plan C moves internals only.
</content>
</invoke>
