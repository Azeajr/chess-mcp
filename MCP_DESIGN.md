# MCP Server Design Principles

Opinionated guide for building MCP servers that work well as AI tool backends.
Apply before writing any tool.

---

## The one constraint that drives everything

**Tool output lands in the model's context window.**

Every byte returned by a tool is a byte the model must read, compress, and reason over.
Large outputs degrade reasoning quality and hit hard token limits.
Design output shape first. Implementation second.

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
Estimate before implementing. For lists: cap length or add filter params.
Provide a `min_relevance` / `limit` / `filter` param so callers can narrow scope.
Default to narrow. Let callers widen.

### Summary → detail hierarchy
Design at two levels:
1. **Summary tool** — always small, always fits. Counts, worst N items, top-level verdict.
2. **Detail tool** — accepts an ID/index from the summary, returns one item's full data.

Model calls summary first, drills into what matters. One round trip for the common case.

### Stateless
Each tool call is a pure function of its inputs. No stored state between calls.
SSE/stdio is transport only — tools themselves have no session state.

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

---

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

---

## Checklist before shipping a tool

- [ ] Output fits in ~2k tokens for the common case
- [ ] Description names what comes back, not just what it does
- [ ] List outputs have a filter/limit param
- [ ] Errors return structured JSON
- [ ] No state carried between calls
- [ ] Summary tool exists if detail tool output is large
- [ ] No fields that can be inferred from other fields
