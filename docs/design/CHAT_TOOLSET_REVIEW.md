# PWA Chat Toolset — Weak-Point Review

Audit of the 28 chat tools (`apps/ui/src/llm/tools.ts`) + workflow prompts
(`apps/ui/src/llm/workflows.ts`) against the shared `chess-tools` core, the MCP server, and the
repertoire panel. Captured 2026-07-12. Each item: the defect, why it matters, fix direction.
Companion: `MCP_DESIGN.md` (the "tool output lands in the model's context window" constraint drives
most of the token items below).

Status key: **bug** (something lies or breaks), **token** (context cost), **parity** (surface gap
vs server/panel), **ux** (dead end or missing affordance).

---

## Bugs / stale instructions

### 1. `find_repertoire_gaps` has no `exclude_paths` — workflow step 5 instructs a nonexistent param — **bug**

`workflows.ts` repertoire step 5: *"classify_illustrative_lines FIRST, then pass its paths as
exclude_paths to find_repertoire_gaps"*. No such parameter exists anywhere: not in chess-tools
`GapsOptions` (`enginetools.ts:132`), not in the server schema (`index.ts` find_repertoire_gaps),
not in the chat schema. Only `analyze_repertoire_congruence` takes `exclude_paths`. The model emits
the param, it's silently ignored, illustrative ($2/$4/$6) side lines still seed false gaps — the
exact failure the step exists to prevent. `classify_illustrative_lines` output currently has **no
consumer mechanism** at all.

Fix: implement `excludePaths` in `findRepertoireGaps` (filter decision nodes whose path has an
excluded prefix), expose on server + chat schemas, keep workflow text. Alternative: auto-skip
NAG-flagged lines inside `decisionNodes` (no param needed) and update the workflow.

### 2. Chat `analyze_game` always strips `best_move` — review workflow claims it's there — **bug**

Review workflow step 2 (workflows.ts:41): *"analyze_game → the per-move list (cp_loss,
classification, best_move)"*. The chat executor maps every record through `lean()`
(tools.ts — `records.map(lean)`; `lean` keeps only ply/color/san/cp_loss/classification) and has
no `verbose` flag — the server does (`verbose=true`). The model is told the field exists; when
it isn't there, the likely failure is hallucinating a best move — a grounding-contract violation.

Fix: add `verbose` to the chat schema/executor (mirror server), or lean-but-keep `best_move`.

### 3. Repertoire workflow step 9 is pre-C1 shorten text — **bug (stale)**

Same drift fixed in `tools.ts:99` (commit 3f41fdb): step 9 still says *"the earliest of YOUR
moves"* (one re-route per line) — the scan returns ALL re-routes with `bestSavings`/`bestEval`
tags. It also says *"apply by pruning the tail (modify_repertoire_line prune)"* — which in the PWA
only previews (see §7), so the instruction dead-ends.

Fix: rewrite step 9 to match the shipped C1 semantics + point application at the panel (or at a
future stage-edit affordance, §7).

### 4. Repertoire workflow step 8 uses `get_transpositions` for stub wiring — superseded — **bug (stale)**

Step 8: *"a stub whose position already appears in get_transpositions is covered by
transposition"*. That job moved to `get_repertoire_coverage(connect_stubs=true)` (engine-vetted
bridges with `connects_via` + `joins_path`); gap-side false-transposition handling moved into the
scan itself (`covered_by_transposition`). Step text sends the model on a manual cross-reference the
tools already do.

Fix: rewrite step 8 around `connect_stubs=true`; see §13 for whether `get_transpositions` stays at
all.

## Token / context cost

### 5. `modify_repertoire_line` returns the full repertoire PGN every call — **token**

`pgn: edited.toPgn()` — the entire edited tree lands in model context per preview. A large
repertoire makes every edit-loop turn cost the whole PGN; the handle model exists server-side to
avoid exactly this. The model only needs `nodes/leaves/max_depth` + `added_from`/`added_moves` to
confirm the edit.

Fix: drop the `pgn` field. (If a diff cue is wanted, return the edited line only.)

### 6. `batch_review` routes the multi-game PGN through model context — **token**

The `pgn` arg is model-emitted: user pastes N games into chat, the model re-emits them as
tool-call args. The PWA is already file-based (`store/files.ts`: FS Access picker, persisted
handle, reopen flow) — the infra to hold PGN text browser-side exists; the chat tool just doesn't
use it. Note: `showOpenFilePicker` requires user activation, so a tool call can't open the picker
itself — the shape is "reference a file the user already opened" (second games-file slot alongside
the repertoire handle) or a picker button in the chat panel.

Also: wasm engine is single-threaded — N games × depth 12 inside one chat turn, no progress, no
cancel (§12).

Fix: browser-held games source (opened file or fetched-games cache, §8) referenced by the tool;
progress/cancel per §12.

### 7. `modify_repertoire_line` preview is a dead end — **ux**

`note: "preview only — apply via the board to keep it"` — but no affordance consumes the previewed
edit: `ChatPanel.tsx` special-cases exactly one tool result (`propose_line` → `PreviewChip`,
ChatPanel.tsx:128); every other result renders as collapsed raw JSON. The user must redo the
prune/reorder by hand. `propose_line` covers adds at the current position only. So the edit loop
the server has (clone-on-write → re-analyze → export) has no PWA-chat equivalent past the first
preview.

Fix: a stage-edit affordance — the edit analog of `stagePreviewLine` (gold-arrow accept/reject),
applying the previewed `tree.edit` on Accept.

### 8. `lichess_games`/`chesscom_games` `include_pgn=true` → PGNs through context twice — **token**

Fetched PGNs land in model context, then the model re-emits one into `analyze_game`/`batch_review`.
Functional but 2× cost per game reviewed.

Fix: cache fetched games browser-side keyed by index/id; let `analyze_game`/`batch_review` accept a
`game_ref` instead of raw PGN. Pairs with §6's games source.

### 9. `export_annotated_pgn` → context → model re-emits fenced block — **token**

The annotated PGN transits the model twice (tool result, then the reply). The annotate workflow
even tells the model to offer saving as `<name>-annotated.pgn` — an offer nothing can fulfill:
ChatPanel renders tool results as collapsed `<pre>` JSON and has no save/download affordance for
PGN blocks (verified against `ChatPanel.tsx` — `propose_line` is the only special-cased result).

Fix: save-to-file affordance (reuse `files.ts` `showSaveFilePicker` path) triggered from the chat
panel; the model's reply then only needs the summary.

### 10. 28 schemas ship with every ROUND, full PGN in the system message — **token**

Worse than per-turn: the tool loop re-sends everything per **round** — `chat.ts:83-88` rebuilds
`[systemMessage(), ...history]` + all 28 `toolSchemas` on each of up to `MAX_ROUNDS = 12`
iterations of a single send. And `systemMessage()` (chat.ts:60) embeds the **full working PGN**
(`actions.toPgn()`) every time — grounding by injection is deliberate (header comment), but it
scales with repertoire size × rounds × turns, and it makes `get_position`'s PGN payload largely
redundant (the system message already carries FEN + color + PGN; workflows still say "call
get_position first"). History is never trimmed either — large tool results (a full shorten scan)
are re-sent on every subsequent round and turn. The `find_pruning_transpositions` schema
description alone is ~250 words.

Fix, in increasing ambition: (a) filter `toolSchemas` by chat mode (the mode selector already
partitions intent); (b) system message carries FEN + color + tree stats, PGN on demand via
`get_position`; (c) cap/elide old tool results in the re-sent history.

## Parity gaps

### 11. C3/C4 shortcut vetting missing from chat — **parity**

`compare_shortcut_lines` (quality) and `check_shortcut_coverage` (coverage safety) exist on the
server and in the panel's "?" inspect, but not in the chat schema. Workflow step 9 tells the model
to weigh the eval trade — it lacks the tools to vet a shortcut before recommending it (notably
whether the prune opens a new gap).

Fix: expose both to chat (handle-free wrappers exist in chess-tools; executor is ~10 lines each).

### 12. No cancel/progress for long chat tool calls — **ux**

`streamChat` accepts a `signal?: AbortSignal` (openrouter.ts:59) but `chat.ts` never passes one,
`ChatPanel` has no stop button (input + Send are simply disabled while `busy()`), and `runTool` /
the engine layer have no cancellation regardless — so aborting the fetch would still leave a wasm
search running. A chat-invoked gap scan runs chess-tools defaults (20 positions × depth 14
multipv-4, single-threaded wasm — `engine/stockfish.ts` serialises to one eval at a time) — the
turn blocks for minutes with no feedback and no way out. The panel versions have cancel tokens +
determinate progress for exactly this reason (and run lighter: 12 × depth 12).

Fix: wire an AbortSignal from a ChatPanel stop button through `send` → `streamChat` AND a cancel
token into `runTool`'s engine calls; consider browser-tuned defaults for chat-invoked scans.

### 13. `get_transpositions` mostly superseded — **parity/token**

Its two workflow jobs moved into `covered_by_transposition` (gap scan) and
`connect_stubs=true` (coverage). Remaining value: the direct "what transposes?" question.
Engine-free, so the only cost is schema bloat (§10).

Fix: either drop from chat (fold the direct question into mode-filtered schemas) or keep and fix
step 8 text (§4). Decide with §10.

### 14. `propose_line` is current-position-only — **ux**

The panel's `stagePreviewLine(fromPath, sans)` stages from any node; the chat tool only stages from
the current board position, so the model must ask the user to navigate first (or fall back to the
§7 dead end).

Fix: optional `from_path` (SAN list) arg mapping to `stagePreviewLine`.

---

## Fixed during this review

- `find_pruning_transpositions` chat description: pre-C1 "one earliest re-route per line" text →
  full C1/C6 semantics (3f41fdb).
- `acknowledged_weaknesses` missing from chat congruence schema/executor (f4200ef).

## Suggested order

1. §1, §2 — grounding-contract bugs (workflow instructs the impossible).
2. §5 — one-line deletion, immediate token win on every edit preview.
3. §3, §4 — workflow rewrites (bundle with §13 decision).
4. §11 — C3/C4 parity (small executors, closes the shorten story in chat).
5. §10 (+§13) — mode-filtered schemas.
6. §12 — abortable tool calls.
7. §6, §8, §9 — browser-held PGN sources + save affordance (one design: "files/games the chat can
   reference without transiting the model").
8. §7, §14 — stage-edit affordance + `from_path` (one design: staging beyond the current position).
