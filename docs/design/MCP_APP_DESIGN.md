# MCP App: Interactive Board Browser + PGN Stepper

## Goal

Replace clunky move-by-move tool calls with an interactive HTML widget. Users can browse a repertoire tree by clicking moves on a draggable board or step through a PGN with arrow keys, seeing evaluation in real time.

## Requirements

- **R1 — Two UI modes:**
  - Mode A: Repertoire tree browser — load a PGN file, render the tree as a collapsible move list, board updates on click, transpositions highlighted, eval shown inline.
  - Mode B: PGN stepper — paste any PGN, step with arrow keys, eval bar.
- **R2 — Board interaction:** Draggable pieces, legal moves validated by chess.js.
- **R3 — Analyze position:** Button calls `evaluate_position` MCP tool and renders result in the UI.
- **R4 — Graceful degradation:** When the client lacks the apps capability (or when served as a normal resource), the widget still works as a text/HTML resource.
- **R5 — Engine-free tests:** Resource registration tested (assert HTML present, no errors), not browser-driven.

## Current Posture

- **No MCP Apps capability in FastMCP v1.27.2.** The `apps` specification was proposed but not yet standardized in the mcp package we depend on. Resources (text/uri responses to tool/list_resources) are stable and already used elsewhere.
- **MCP transport:** SSE (network) or stdio (subprocess). Resources work on both.
- **Tool registration:** `@mcp.tool()` decorator on functions in chess_mcp.py.
- **No HTML assets yet:** chess_mcp.py is Python-only; no server/apps/ directory.

## Decisions

### D1 — Serve widget as MCP Resource, not Apps capability

**Choice:** Implement as `@mcp.resource()` decorated function that returns HTML. Fall back to this for all clients until the MCP Apps spec is standardized.

**Why:** 
- The `mcp` package v1.27.2 does not expose an `@mcp.app()` decorator or apps registration method yet. Attempts to use it would break on import.
- Resources are stable: every MCP client understands `read_resource(uri)`. The URI schema `resource://chess/board` is our choice.
- FastMCP infers `@mcp.resource(name="board")` creates a resource with URI matching the function name.
- Graceful fallback is automatic: clients that don't support resources get text; clients that do get the widget.

**Rejected alternatives:**
- Embed HTML as a string constant in chess_mcp.py (works but pollutes the file; prefer a separate module).
- Store HTML on disk and read it on every request (adds I/O; memoize if we do this later).

### D2 — Single-file HTML using CDN dependencies, no build step

**Choice:** One file (`server/boardwidget.py` as a module, serving the HTML as a string) with chessboard.js + chess.js from CDN.

**Why:**
- No Node.js, no bundler, no asset compilation — aligns with this repo's tooling (pure Python + uv).
- Chess.js (umd build from CDN) validates moves client-side; chessboard.js renders and handles drag.
- FastMCP runs the Python code; the MCP client renders the HTML in a webview or panel.

**Deferred:** If the MCP Apps spec lands and FastMCP adopts it, the same HTML can be wrapped in `@mcp.app()` with no changes to the widget itself.

### D3 — Widget modes: query param driven

**Choice:** Single HTML file; mode selected by query parameter (e.g., `?mode=repertoire&repertoire_id=abc123&pgn=...`).

**Why:**
- Stateless: the MCP protocol is stateless; query params carry state on every request.
- UI branching is cheap in JavaScript (show/hide divs, initialize different event handlers).

**Parameters:**
- `mode` — "repertoire" or "pgn" (stepper).
- For repertoire: `repertoire_id` (pass to tool calls), optional `file_path` (for the display title).
- For stepper: `pgn` (URL-encoded PGN string).
- `depth` (optional, default 18) — passed to evaluate_position.

### D4 — Analyze Position calls evaluate_position tool via MCP

**Choice:** Button in the widget calls `mcp.call_tool("evaluate_position", {fen, depth})` via the MCP protocol (SSE/stdio back to the parent client).

**Why:**
- The widget runs in the client's webview/context; it has the MCP session.
- No engine in the browser; all compute stays on the host.
- Result (cp, mate, pv, candidates) rendered as text below the board.

**Note:** This requires the client (Claude Desktop) to expose an MCP tool-call API to the widget. If unavailable, the button is disabled or shows a fallback.

### D5 — Transposition highlighting (low-priority, out of scope for v0)

The design supports adding transposition detection later (highlight visited positions), but it is not implemented in the first pass. Tool: collect transposition set from `get_transpositions`, render in a legend.

### D6 — Asset location: inline module, not disk file

**Choice:** HTML template lives in `server/boardwidget.py` as a string constant (or f-string template), registered as a resource in chess_mcp.py.

**Why:**
- No I/O overhead; no risk of the file being missing at runtime.
- Stays in version control as Python source, not a binary/asset folder.
- Simpler deployment (single Python file, no asset copying).

**If changed:** Can move to `server/apps/board.html` and read it in the resource handler if performance becomes a concern (unlikely given the size).

## New/Changed Surface

### Resource: GET /resource/board

```python
@mcp.resource(name="board")
def get_board_widget() -> str:
    """
    Interactive board browser and PGN stepper. Supports two modes:
    - Mode A (repertoire): load_repertoire handle, tree nav, click to step.
    - Mode B (stepper): paste PGN, arrow keys, eval.
    
    Query parameters:
    - mode: "repertoire" | "pgn" (required)
    - repertoire_id: handle from load_repertoire (if mode=repertoire)
    - pgn: URL-encoded PGN string (if mode=pgn)
    - depth: eval search depth (optional, default 18)
    
    Returns: text/html single-file widget.
    """
    return _BOARD_WIDGET_HTML
```

The client opens this resource in a webview. Query parameters are passed as `resource://chess/board?mode=...&repertoire_id=...`.

### Tool integration: `evaluate_position` remains unchanged

The widget calls existing `evaluate_position` tool via MCP protocol. No new tool needed.

## Out of Scope / Limitations

### Spec Evolution Risk

The MCP `apps` capability (drag panels, pinned boards, etc.) is not yet standardized. Once it lands in mcp >= 2.0, we can:
1. Add `@mcp.app()` decorator (same HTML).
2. Deprecate `@mcp.resource()` version or keep both for compatibility.

This design isolates the HTML from the registration layer, so the widget survives a migration.

### Browser Testing

"Loads in Claude Desktop app panel without additional install" and "draggable board validates moves" require a real MCP client. Tests here verify:
- Resource is registered and returns valid HTML.
- HTML contains expected keywords (chessboard, chess.js, CDN links).
- No syntax errors or missing closes.

We cannot drive a browser in this environment. A manual test in Claude Desktop is the final acceptance gate.

### Transposition Highlighting

Out of scope for v0. Added later if the repertoire tree grows complex (100+ nodes).

## Test Plan

### 1. Registration Test
- Assert resource "board" is registered and callable.
- Assert returned content is valid HTML (starts with `<!DOCTYPE html` or `<html`).
- Assert CDN links present (chessboard.js, chess.js, cdn.jsdelivr.net or similar).

### 2. Content Validation Test
- Assert content includes expected JavaScript (chess move validation, board init).
- Assert no syntax errors in HTML (basic regex checks: balanced tags, no orphaned quotes).

### 3. Graceful Fallback Test
- If the resource handler throws an exception, assert it doesn't crash the MCP server.
- Test with mock query parameters (mode=repertoire, mode=pgn) — assert no errors in parameter parsing.

### 4. Integration Test (Manual, post-commit)
- Open Claude Desktop with chess-analysis server.
- Call `/resource/board?mode=pgn&pgn=1.e4%20e5%202.Nf3%20Nc6` (URL-encoded PGN).
- Assert board loads, piece drag works, arrow keys step moves.
- Call "Analyze Position" button, assert evaluate_position tool is called and eval rendered.

## Files Changed

- `server/boardwidget.py` — new; HTML template as a string constant.
- `server/chess_mcp.py` — add `@mcp.resource()` handler near other registrations.
- `server/test_tools.py` — add tests for resource registration + HTML validity.

## References

- **karayaman/lichess-mcp:** MCP Apps draggable board + opening tree (reference, not copy).
- **jalpp/chessagine-mcp:** HTML board/PGN viewers (reference, not copy).
- **MCP Spec:** https://modelcontextprotocol.io (resources section).
- **chess.js:** https://chessjs.com (client-side move validation).
- **chessboard.js:** https://chessboardjs.com (draggable board rendering).
