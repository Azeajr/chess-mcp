# Chess UI — Design Document

## Overview

A local SPA/PWA for building and studying opening repertoires. Visual chess board, move tree,
engine overlay, AI-suggested lines, and integrated Claude chat — zero deploy friction, no server
required. It shares one TypeScript tool library (`packages/chess-tools`) with the Node MCP server:
single language, single codebase, two entry points.

---

## Goals

- Load/edit PGN repertoire files from disk (white or black)
- Play moves on the board; moves auto-append to the working PGN tree
- Visualize engine evaluation and repertoire congruence as colored board arrows
- AI-suggested lines (proposed, not auto-added; explicit accept per line)
- Chat with Claude about the current position/repertoire using the same tool workflow as the skills
- Installable as a PWA; no server dependency at runtime

## Non-Goals

- Multi-user or hosted deployment
- Game database search
- Puzzles / tactics trainer
- Real-time play against engine (engine is analysis-only)

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | SolidJS + Vite | Fine-grained signals, tiny bundle, stable primitives |
| Board | chessground (vanilla JS) | Lichess-grade, shapes API for multi-color arrows |
| Board wrapper | Custom SolidJS ref wrapper (~200 lines) | No maintained solidjs-chessground; one-time cost, full API control |
| UI components | shadcn-solid | Tailwind-based, sufficient for this scope |
| Chess logic | chessops (Lichess) | TypeScript-first python-chess equivalent; handles complex PGN + variations |
| Engine | stockfish.js (WASM) | Runs in browser (Web Worker) and Node.js; same package everywhere |
| MCP server | Node.js + @modelcontextprotocol/sdk | Official SDK; shares chess-tools with UI |
| Claude chat | Anthropic SDK (browser fetch) | API key in localStorage; streaming via SSE |
| PGN I/O | chessops + File System Access API | Parse/serialize; native file picker with persistent handle |
| PWA | vite-plugin-pwa (Workbox) | Service worker, installable, offline shell |
| State | SolidJS stores | Reactive game tree, repertoire, engine state |
| Monorepo | pnpm workspaces | Shared packages without publish/link overhead |

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

`packages/chess-tools` is the single source of truth — the TypeScript port of the original Python
MCP tools — imported directly by both the PWA and the Node MCP server (`apps/mcp-server`). It holds
the engine-free domain logic: the GameTree variation walker + edits, the structural classifier and
theme tags, congruence, gaps, transposition keying, illustrative-line NAG tiers, ECO lookup, and the
rate-limited offline-safe HTTP client (cloud eval / tablebase / games). Engine evals come from
stockfish.js (a Web Worker in the browser, the `stockfish` npm package in Node).

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
- Claude API calls: network-only (no offline cache)
- Install prompt: shown after 2 sessions if not already installed
- **Cross-origin isolation headers required** — see Browser Constraints below; the service
  worker and dev server must both send `COOP: same-origin` + `COEP: require-corp`

---

## Browser Constraints & Security

The browser host imposes constraints the Python server never hit.

### Threaded WASM needs cross-origin isolation

Multi-threaded stockfish.js uses `SharedArrayBuffer`, which requires the page to be
cross-origin isolated: `Cross-Origin-Opener-Policy: same-origin` +
`Cross-Origin-Embedder-Policy: require-corp`. This must be set by the dev server (Vite plugin)
**and** the service worker for the installed PWA. Caveat: COEP `require-corp` blocks
cross-origin assets that don't send CORP/CORS headers — audit any externally loaded resource.
If isolation proves impractical, fall back to single-threaded stockfish.js (slower).

### Network tools — CORS and forbidden headers (browser only)

The HTTP client sets a `User-Agent` and runs at 1 req/s. In the browser:

- **`User-Agent` is a forbidden header** — the browser will not let JS set it. Lichess asks
  unauthenticated clients to identify via UA; without it, expect tighter rate limiting.
- **CORS must be allowed by each endpoint.** Verify per API (Lichess cloud-eval / tablebase /
  games, Chess.com archives). Any that block CORS must run on the Node side only, or behind a
  proxy — they cannot be called from the PWA directly.
- The **offline-safe degrade-to-None** contract still holds: a blocked/failed fetch behaves as
  a cache miss, never throws.

### Claude API key handling

The key lives in `localStorage` (Settings). It is therefore **readable by any injected
script (XSS)** — a real exfiltration risk for a key that bills the user. Mitigations:

- Anthropic browser calls need `dangerouslyAllowBrowser: true`; confirm CORS support.
- Prefer session-only in-memory storage, or warn the user the key is stored locally in plaintext.
- Treat any third-party script (analytics, fonts) as able to read the key — keep the bundle
  dependency-minimal.
