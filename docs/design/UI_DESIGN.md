# Chess UI — Design Document

## Overview

A local SPA/PWA for building and studying opening repertoires. Visual chess board, move tree,
engine overlay, AI-suggested lines, and integrated Claude chat — zero deploy friction, no server
required.

The existing Python MCP server will be replaced by a Node.js MCP server that shares tool logic
with the UI. Single language, single codebase, two entry points.

---

## Goals

- Load/edit PGN repertoire files from disk (white or black)
- Play moves on the board; moves auto-append to the working PGN tree
- Visualize engine evaluation and repertoire congruence as colored board arrows
- AI-suggested lines (proposed, not auto-added; explicit accept per line)
- Chat with Claude about the current position/repertoire using the same tool workflow as existing skills
- Installable as a PWA; no server dependency at runtime

## Non-Goals

- Multi-user or hosted deployment
- Game database search
- Puzzles / tactics trainer
- Real-time play against engine (engine is analysis-only)
- Move annotations / NAGs (Phase 1; deferred)
- Multi-repertoire library (Phase 1 is single-file)

---

## Monorepo Structure

```
chess-mcp/
  packages/
    chess-tools/        ← TypeScript tool logic (shared by both apps)
      src/
        repertoire.ts
        analysis.ts
        engine.ts       ← StockfishProvider (stockfish.js) + OnnxProvider (onnxruntime)
        openings.ts
        ...
  apps/
    mcp-server/         ← Node.js MCP server (replaces Python server)
    ui/                 ← SolidJS PWA
  server/               ← existing Python server (kept until Node port complete)
```

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Browser (SolidJS PWA)                           │
│                                                  │
│  Board  │  Move Tree  │  Analysis  │  Chat       │
│                                                  │
│  ── packages/chess-tools (imported directly) ──  │
│  ── stockfish.js WASM (Web Worker) ────────────  │
│  ── onnxruntime-web (WebGPU/WASM, Maia/Leela) ─  │
│  ── Claude API (fetch, API key in localStorage)  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│  apps/mcp-server (Node.js)                       │
│  ── packages/chess-tools (same import) ────────  │
│  ── stockfish.js WASM ─────────────────────────  │
│  ── onnxruntime-node (Maia/Leela) ─────────────  │
│  ── @modelcontextprotocol/sdk ─────────────────  │
└──────────────────────────────────────────────────┘
```

No FastAPI bridge. No Python runtime required for the UI. Both apps share one tool library.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | SolidJS + Vite | Fine-grained signals, tiny bundle, stable primitives |
| Board | chessground (vanilla JS) | Lichess-grade, shapes API for multi-color arrows |
| Board wrapper | Custom SolidJS ref wrapper (~200 lines) | No maintained solidjs-chessground; one-time cost, full API control |
| UI components | shadcn-solid | Tailwind-based, sufficient for this scope |
| Chess logic | chessops (Lichess) | TypeScript-first python-chess equivalent; handles complex PGN + variations |
| Engine (Stockfish) | stockfish.js (WASM) | Runs in browser (Web Worker) and Node.js; same package everywhere |
| Engine (Maia/Leela) | onnxruntime-web (browser) / onnxruntime-node (Node.js) | ONNX weights run via WebGPU (primary) or WASM (fallback); no lc0 binary at runtime |
| MCP server | Node.js + @modelcontextprotocol/sdk | Official SDK; shares chess-tools with UI |
| Claude chat | Anthropic SDK (browser fetch) | API key in localStorage; streaming via SSE |
| PGN I/O | chessops + File System Access API | Parse/serialize; native file picker with persistent handle |
| PWA | vite-plugin-pwa (Workbox) | Service worker, installable, offline shell |
| State | SolidJS stores | Reactive game tree, repertoire, engine state |
| Monorepo | pnpm workspaces | Shared packages without publish/link overhead |

---

## Component Tree

```
App
├── TopBar (file open, color toggle white/black, settings)
├── BoardPanel
│   ├── Chessground (board, piece drag, click)
│   ├── ArrowOverlay (driven by engine + congruence signals)
│   └── EvalBar (active engine score)
├── MoveTree
│   ├── MainLine (moves in sequence)
│   └── Variation (indented, Lichess-style, recursive)
├── AnalysisPanel
│   ├── EngineLines (top-N lines from active engine backend)
│   ├── CongruenceScore (% match to repertoire for each suggested line)
│   └── SuggestedLines (AI proposals, dashed style, accept/reject per line)
├── ChatPanel
│   ├── MessageList (streamed Claude responses)
│   ├── ContextBadge (current FEN, repertoire loaded, color)
│   └── InputBar
└── SettingsDrawer
    ├── ApiKeyInput (Claude API key → localStorage)
    ├── EngineBackendSelector (stockfish / maia-{elo} / leela)
    ├── OnnxModelsDir (path to folder containing .onnx weight files)
    ├── EngineDepth
    └── ColorSchemeEditor
```

---

## Color System

Two independent dimensions encoded on each arrow:

### Color family — Repertoire fit

| Color | Meaning |
|---|---|
| Green | Move is in the loaded repertoire |
| Yellow | Adjacent to repertoire (transposition or known neighbor) |
| Red | Out of book entirely |

### Arrow weight — Engine score (from your side)

| Weight | Meaning |
|---|---|
| Thick | Clearly good for you (≥ +0.5) |
| Medium | Equal / slight edge (−0.3 to +0.5) |
| Thin | Worse for you (< −0.3) |

### Line status — Dash vs solid

| Style | Meaning |
|---|---|
| Solid | Already in the repertoire |
| Dashed | Suggested / not yet accepted |

### Combinations in practice

- **Green thick solid** — in repertoire, engine agrees. Ideal.
- **Green thin solid** — in repertoire, engine skeptical. Worth reviewing.
- **Yellow thick dashed** — adjacent, engine-good. Prime candidate to add.
- **Red thick dashed** — out of book, engine likes it. Potential new direction.
- **Red thin dashed** — out of book, engine bad. Ignore.

Congruence score (0–100%) shown as label on each suggested line in AnalysisPanel.

---

## Data Flow

### Load repertoire

```
User picks .pgn file
→ File System Access API returns FileHandle (persisted in IndexedDB across sessions)
→ chessops parses PGN into GameTree
→ SolidJS store: { repertoire: GameTree, color: 'white'|'black', currentNode: NodeId }
→ Board renders starting position
→ stockfish.js evaluates starting position (Web Worker)
→ ArrowOverlay draws top-3 engine lines with color/weight from congruence check
```

### Play a move

```
User drags/clicks a move on the board
→ chessops validates legality
→ If move in existing tree: navigate to that node
→ If move not in tree: append new node to GameTree (auto-extend)
→ Store updates → MoveTree re-renders → Board advances
→ engine re-evaluates new position (async, Web Worker)
→ ArrowOverlay updates arrows
→ Chat context badge updates (new FEN injected on next message)
```

### Accept AI-suggested line

```
AI proposes line in AnalysisPanel (dashed arrows on board)
→ User clicks Accept on specific line (or individual moves)
→ Nodes inserted into GameTree with congruence metadata
→ Arrows switch from dashed → solid
→ Store marks file as dirty → TopBar shows unsaved indicator
→ User hits Save → File System Access API writes PGN to same file handle
```

### Chat message

```
User types in ChatPanel
→ Build context payload:
    system: <skill system prompt>
    tools: <chess-tools function schemas>
    messages: [...history, { role: 'user', content: userText }]
    injected context: current FEN, full PGN, color
→ POST to Claude API (streaming, Anthropic SDK)
→ On tool_use block: call chess-tools function directly in browser
→ Inject tool_result, continue stream
→ Response streams into MessageList
→ If response includes line suggestions → AnalysisPanel updates
```

---

## chess-tools Package

TypeScript rewrite of the existing Python MCP tools. Single source of truth.

| Python (current) | TypeScript (new) |
|---|---|
| `python-chess` | `chessops` |
| `chess.engine` (Stockfish subprocess) | `stockfish.js` (WASM) |
| `chess.engine` (lc0 subprocess) | `onnxruntime-web` / `onnxruntime-node` |
| `httpx` (cloud eval, tablebase) | `fetch` |
| MCP tool functions | exported TS functions |

Scope: ~40 tools. Estimate 2–3 weeks. Each tool is a thin wrapper over chessops +
engine providers + fetch — logic is in the libraries, not the tools.

### Engine Backends

Three supported backends, matching the Python implementation:

| Backend | Description | Runtime | Where |
|---|---|---|---|
| `stockfish` | Depth/time search | stockfish.js WASM | Browser + Node.js |
| `maia-1100` … `maia-1900` | Human-like at target Elo; policy-only (nodes=1 equivalent) | onnxruntime-web / onnxruntime-node | Browser + Node.js |
| `leela` | Full Leela Chess Zero network | onnxruntime-web / onnxruntime-node | Browser + Node.js |

No server dependency for any backend. All run client-side.

Maia is evaluated at a single forward pass (raw policy head = human-like move). Search
is not applied — running MCTS over the Maia net climbs above the target rating toward
engine-best, defeating the purpose. This matches the Python implementation's `nodes=1`.

### ONNX Weight Setup (one-time)

Maia and Leela weights ship as `.pb.gz` files. Convert once with lc0:

```bash
lc0 leela2onnx --input=maia-1500.pb.gz --output=maia-1500.onnx
lc0 leela2onnx --input=leela-weights.pb.gz --output=leela.onnx
```

Place output files in a local directory. Configure path in app settings (`OnnxModelsDir`).
Models are loaded on demand and cached in IndexedDB after first load — same pattern as
[play-lc0](https://github.com/hunterchen7/play-lc0).

Inference uses **WebGPU** (primary) with **WASM** as fallback. No lc0 binary needed at runtime.

### EngineProvider interface

```typescript
type EngineBackend = 'stockfish' | `maia-${number}` | 'leela'

interface EngineProvider {
  supports(backend: EngineBackend): boolean
  move(fen: string, backend: EngineBackend, opts: EngineOptions): Promise<EngineResult>
}
```

Two implementations — no environment split:

- **StockfishProvider** — stockfish.js WASM; supports `'stockfish'`; works everywhere
- **OnnxProvider** — onnxruntime-web (browser) or onnxruntime-node (Node.js); supports
  `maia-*` and `'leela'`; loads ONNX files from configured directory, caches in IndexedDB

Both providers work in browser and Node.js. No `RemoteProvider`, no `Lc0Provider`,
no fallback server logic.

Environment differences:
- File I/O: not in chess-tools; handled at app layer (Node `fs` vs File System Access API)
- ONNX model loading: `onnxruntime-web` in browser, `onnxruntime-node` in Node.js MCP server

---

## MCP Server (Node.js)

Replaces the existing Python MCP server. Exposes chess-tools functions via the MCP protocol
for Claude Code users. Behavior identical to current server from Claude Code's perspective.

```typescript
// apps/mcp-server/src/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { loadRepertoire, analyzeCongruence, ... } from "@chess-mcp/chess-tools"

const server = new McpServer({ name: "chess-analysis", version: "2.0.0" })
server.tool("load_repertoire", schema, (args) => loadRepertoire(args))
// ...
```

Python server kept on `main` until Node port is complete and validated.

---

## PGN Persistence

- File System Access API `showOpenFilePicker` / `showSaveFilePicker`
- FileHandle stored in IndexedDB (persists across sessions; re-prompts if revoked)
- In-memory working copy is the SolidJS GameTree store (chessops)
- Autosave on Accept of AI line + on explicit Cmd/Ctrl+S
- PGN serialized by chessops with variation tree intact

---

## PWA Config

- Vite + `vite-plugin-pwa` (Workbox)
- App shell cached offline (SolidJS bundle + chessground assets + chess-tools)
- stockfish.js WASM cached on install (large; prefetch)
- ONNX model files: loaded on demand, cached in IndexedDB (not service worker cache — too large)
- Claude API calls: network-only (no offline cache)
- Install prompt: shown after 2 sessions if not already installed

---

## Phased Rollout

### Phase 1 — Board + PGN tree

- chessground SolidJS wrapper
- File System Access API (open/save PGN)
- chessops PGN parsing + GameTree store
- Move tree (Lichess-style, variations)
- Auto-append on play
- stockfish.js eval bar

### Phase 2 — Color overlay

- Arrow system (color family + weight + dash/solid)
- Engine top-N lines as arrows
- In-book vs out-of-book detection from loaded repertoire

### Phase 3 — chess-tools in browser

- chess-tools package integrated into UI
- Congruence score on suggested lines
- `findRepertoireGaps` surfaced in AnalysisPanel
- Cloud eval (Lichess API via fetch)

### Phase 4 — Claude chat

- Claude API integration (API key in settings)
- Auto-context injection (FEN + PGN + repertoire)
- Browser-side tool_use interception → chess-tools call
- Suggested lines from chat → AnalysisPanel

### Phase 5 — Node.js MCP server

- Port Python MCP server to Node.js using chess-tools
- Validate tool-for-tool parity with Python version
- Retire Python server

### Phase 6 — PWA polish

- Service worker / offline shell
- Install prompt
- Keyboard shortcuts (← → navigate, Ctrl+S save, Ctrl+Z undo move)

---

## Open Questions

1. **Multi-repertoire** — Phase 1 is single-file. Repertoire library (multiple PGN files,
   quick-switch) added in which phase?
2. **Annotations** — text comments + NAGs in move tree. Which phase?
3. **Mobile** — PWA supports it technically. Out of scope for v1 but responsive layout
   decisions should be made before Phase 1 ships.
