# MCP Server Design Principles

Opinionated guide for building MCP servers that work well as AI tool backends.
Apply before writing any tool.

---

## The one constraint that drives everything

**Tool output lands in the model's context window.**

Every byte returned by a tool is a byte the model must read, compress, and reason over.
Large outputs degrade reasoning quality and hit hard token limits.
Design output shape first. Implementation second.

Inputs are context too. A stateless tool re-receives its arguments on every call, so a
large blob re-sent across a multi-call workflow is paid for each time. Keep required
inputs small; for big values reused across calls, consider a handle (see Stateless).

---

## Tool design rules

### One job, one tool
A tool does one thing. If you need to explain "and also", split it.
Bad: `analyze_and_summarize_and_classify()`
Good: `get_summary()` + `get_move_detail(move_number)`

### Output is a reasoning primitive, not a data dump
Return what the model needs to form a judgment — not everything you computed.
If a field can be inferred from other fields, drop it.
If a field is only useful for UI rendering, drop it.

### Output fits in ~2k tokens by default
Estimate before implementing — then *measure*, don't trust the estimate (this server's
`get_game_summary` lands at 167 tok against the ~2k budget; see "Measuring output size").
For lists: cap length or add filter params.
Provide a `min_relevance` / `limit` / `filter` param so callers can narrow scope.
Default to narrow. Let callers widen.

Narrow in three dimensions, not just list length:
- **Fewer items** — `limit` / `filter` params.
- **Fewer fields** — return the lean set by default; gate heavy or rarely-needed fields
  behind a `verbose` flag.
- **Tighter encoding** — for a big list of simple, uniform items the model reads but does
  not address individually, a delimited scalar string (`"Nf3 Nc3 e4 ..."`) is several×
  smaller than an array of objects — measured 2.2× vs a `{uci, san}` list for this server's
  `get_legal_moves`, and the gap widens as the per-item object grows. Offer the structured
  form behind a flag when needed. (See "Measuring output size".)

  **Boundary:** compact scalar encoding is safe only when the caller reads the list but never
  addresses an item individually. The moment an item needs a handle (drill-down, reference by
  index, follow-up tool call), return the structured `{...}` form — a compact string forces the
  model to re-parse and re-derive the handle, reintroducing the hallucination the tool exists
  to prevent.

### Summary → detail hierarchy
Design at two levels:
1. **Summary tool** — always small, always fits. Counts, worst N items, top-level verdict.
2. **Detail tool** — accepts an ID/index from the summary, returns one item's full data.

Model calls summary first, drills into what matters. One round trip for the common case.

Two rules make this work:
- The summary must emit the exact identifier the detail tool accepts. If the model has to
  synthesize it, it guesses wrong.
- Outputs carry the handles the next tool needs. If drilling means calling another tool,
  return that tool's input (an ID, a FEN, a path) in the result. Never force the model to
  reconstruct an identifier it cannot derive reliably — that reintroduces the hallucination
  the tool exists to prevent.

### Stateless interface, cached implementation
Each tool call is a pure function of its inputs: same inputs → same outputs, no session
state visible to the caller. SSE/stdio is transport only.

Stateless describes the *contract*, not the *implementation*. Transparent memoization is
fine and often necessary: if a summary tool and its detail tool run the same expensive
computation, cache it (keyed on the inputs) so the workflow computes once. The cache is
invisible to the caller — the contract stays pure and idempotent.

The one real-state case: a large input re-sent on every call. A short-lived handle
(`load_x(blob) → id`; other tools accept `id`) trades strict statelessness for fewer input
tokens. Reach for it only when the blob is big and reused across several calls.

### Idempotent
Same inputs → same outputs. No side effects unless the tool explicitly performs an action.
Label action tools clearly in their description.

---

## Descriptions are routing logic

The model reads docstrings to decide when and how to call a tool.
Write descriptions as a contract: what goes in, what comes back, when to use it.

```
Bad:  "Analyze a chess game."
Good: "Analyze moves in a PGN game. Returns moves where cp_loss >= min_cp_loss (default 50,
       i.e. inaccuracies and worse). Each entry: move_number, color, move, classification,
       cp_loss, best_move, best_pv. Use get_game_summary first for an overview."
```

Rules:
- Name what the output contains, not just what the tool does.
- Reference companion tools when a workflow has an order.
- State the default behavior explicitly.

---

## Schema design

### Inputs
- Use strong types. `int` not `str` for numbers.
- Provide sensible defaults for optional params.
- Enum fields > free strings where the domain is closed.

### Outputs
- Consistent shape across all list items.
- Null/missing fields explicit (`null`, not absent).
- No nested objects deeper than 2 levels — model reasoning degrades with deep nesting.
- Field names self-explanatory without docs (`cp_loss` not `delta`).

---

## Error handling

Return structured errors the model can reason about:
```json
{"error": "invalid_fen", "reason": "piece placement missing rank 4", "input": "..."}
```
Not: bare exceptions, 500 traces, or silent empty results.

Model can adapt to a structured error. It cannot adapt to a crash.

Beware lenient parsers: many libraries return an empty or degenerate object for garbage
input instead of raising. Validate semantic validity (did it contain anything usable?),
not just whether parsing threw — else bad input silently returns an empty result the model
reads as "nothing wrong."

---

### Closed error-code set

Keep a server's error codes **closed and enumerated** so the model can branch on the code instead
of parsing prose. This server's set: `invalid_pgn`, `invalid_fen`, `invalid_color`,
`move_not_found`, `pgn_too_large`, `too_many_moves`, `repertoire_not_found`,
`variation_not_found`, `invalid_mode`, `invalid_line`, `invalid_edit`.

(`invalid_line` — a supplied SAN line is illegal at some ply, e.g. a move in
`modify_repertoire_line` add_moves; `invalid_edit` — a tree-edit request is malformed, e.g.
empty add_moves, missing promote_move, or a prune of the root.)

## Resources vs Tools

MCP has two primitives. Use both correctly.

| Primitive | Use for |
|-----------|---------|
| **Tool** | Computation, actions, queries that require parameters |
| **Resource** | Static or slowly-changing data the model can read (reference tables, configs, knowledge bases) |

Opening theory, lookup tables, static reference data → Resources.
Engine analysis, validation, search → Tools.

---

## Transport

SSE for networked servers (remote host, containerized). Stdio for local sidecar processes.
Both are just transport — tool design is identical.

---

## Anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| God tool | One tool does everything, returns everything | Split by job and output size |
| Raw data passthrough | Returns engine/DB output directly without reshaping | Reshape to reasoning primitives |
| Unbounded list output | Returns all N items regardless of N | Add `limit` / filter param, default narrow |
| Opaque descriptions | `"Does X."` | State inputs, outputs, and when to call it |
| State between calls | Tool behavior depends on prior calls | Make each call self-contained |
| Deep nesting | `result.data.analysis.moves[0].engine.lines[0].score` | Flatten to 2 levels max |
| Duplicate fields | Same fact encoded two ways | Pick one encoding, drop the other |
| Recompute across calls | Summary and detail run the same expensive work twice | Cache the shared computation (transparent memoization) |
| Unreachable handle | Model must reconstruct an ID it can't derive | Emit the next tool's input key in the output |
| Objects for a big uniform list | Token-heavy for simple repeated items | Delimited scalar string; structured form behind a flag |

---

## Measuring output size

Never assert a token number you didn't measure. Capture real tool outputs once, commit the
snapshot, count offline:

- `evals/capture.py` — runs every tool on `sample-game.pgn`, writes `evals/snapshots/outputs.json`
  (real outputs + the live docstrings). Needs Stockfish, so run it in the Docker image; regenerate
  when any tool's output shape changes.
- `evals/measure.py` — engine-free; tiktoken `o200k_base` (OpenAI BPE, approximates Claude's
  tokenizer — ratios meaningful, absolutes approximate).
  `uv run --with tiktoken python evals/measure.py`.

Measured at depth 18, tiktoken o200k_base (game tools on `sample-game.pgn`, repertoire tools on
`sample-repertoire.pgn`):

| Output | Tokens |
|--------|-------:|
| get_game_summary | 167 |
| analyze_game (lean) | 276 |
| analyze_game (verbose) | 477 |
| get_position | 97 |
| evaluate_position | 40 |
| evaluate_position (multipv=3) | 93 |
| compare_moves | 118 |
| get_legal_moves (SAN string) | 18 |
| get_legal_moves (`{uci,san}` list) | 39 |
| validate_fen | 63 |
| validate_pgn | 47 |
| identify_opening | 24 |
| export_annotated_pgn | 502 |
| load_repertoire | 43 |
| get_structural_profile (aggregate) | 111 |
| get_structural_profile (node) | 214 |
| analyze_repertoire_congruence | 56 |
| get_transpositions | 18 |
| get_repertoire_coverage | 161 |
| find_repertoire_gaps | 32 |
| classify_illustrative_lines | 32 |
| modify_repertoire_line | 68 |
| export_repertoire | 188 |
| suggest_complementary_lines (low_memorization) | 190 |
| suggest_complementary_lines (sharp) | 187 |
| suggest_complementary_lines (gap auto-advance) | 179 |

- Summary fits the ~2k budget with room to spare (167).
- `verbose` costs 1.7× the lean list (477 vs 276) — earns the flag, not the default.
- `multipv=3` candidates cost 2.3× the single-best eval (93 vs 40) — gated behind the flag, so the
  default position eval stays lean.
- Compact SAN string is 2.2× smaller than the `{uci, san}` list (18 vs 39), and that list even
  carries extra data — the encoding win grows with richer objects.
- Every repertoire output also fits the budget: the stateful design keeps them small (the handle
  replaces a re-sent PGN; `analyze_repertoire_congruence` is a capped summary→detail list — 56 tok
  including the per-flag `cluster` label + the `clusters` partition). The edit-loop action tool
  `modify_repertoire_line` returns a handle + stats + one-line diff (62 tok) — it never returns a
  tree; the agent loops on the new id and reads back the same compact reports.
- **Two artifact outputs** (full PGN strings, the justified exception to "reshape, don't dump"):
  `export_annotated_pgn` (502 tok here) and `export_repertoire` (188 tok on the small sample; scales
  with tree size). Both are bounded by input caps (`MAX_PGN_BYTES` / `MAX_REPERTOIRE_BYTES`); the
  agent Writes the string to disk rather than reasoning over it, so its size doesn't tax the workflow.
- The path-bearing list outputs (`find_repertoire_gaps`, `get_transpositions`, congruence) are bounded
  by `limit` / `max_positions` AND a byte budget (`_fit_to_budget`, #20) so a deep tree can't blow the
  cap; their `path` fields stay structured because they are drill-down handles (a compact string would
  force the model to re-derive them — see the boundary note above). After the #19 severity-capping,
  `find_repertoire_gaps` on the sample is small (32 tok); the heaviest *reasoning* primitive is now
  `get_structural_profile` (node, 214 tok).
- All 30 tool descriptions total ~6411 tok, re-read on every `tools/list` — why descriptions are
  kept compressed (they are routing logic, paid every call). (repertoire-handle outputs embed a
  random id, so load_repertoire / modify_repertoire_line wobble a few tok between captures.)

Regenerate after any output-shape change; stale numbers are worse than none.

## Checklist before shipping a tool

- [ ] Output fits in ~2k tokens for the common case
- [ ] Description names what comes back, not just what it does
- [ ] List outputs have a filter/limit param
- [ ] Errors return structured JSON
- [ ] No state carried between calls
- [ ] Summary tool exists if detail tool output is large
- [ ] No fields that can be inferred from other fields
- [ ] Expensive work shared by summary + detail is cached (computed once per inputs)
- [ ] Outputs carry the identifiers the next tool in the workflow needs
- [ ] Heavy/optional fields gated behind a `verbose` flag; big uniform lists use a compact encoding
- [ ] Large inputs reused across calls considered for a handle vs re-send
