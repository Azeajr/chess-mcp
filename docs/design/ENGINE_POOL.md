# P1 — Engine Pool: Parallel Searches

Design for PERF_AND_TOOLS_REVIEW §P1. Both hosts currently run ONE single-threaded Stockfish wasm
instance with strictly serialized searches (`serial()` — engine.ts:196, stockfish.ts:135). Every
scan is embarrassingly parallel; an N-worker pool gives ~linear speedup on exactly the operations
users wait minutes for. Absorbs R4 (in-flight dedupe) and structurally fixes R1 (Node watchdog
race). Written 2026-07-13.

## Cost model recap

Engine searches dominate everything; tree walks are free. P2 (warm TT) + P3/P4 (persistent
transposition-keyed cache) made repeat scans cheap — the pool is the lever for *first* scans and
cache-cold positions. Benchmark baseline (fixture repertoire, 203 decision positions, depth 14
multipv 2, cache disabled): **33.9s serial** post-P2. Target with 4 workers: ~9-12s (sub-linear —
per-worker TTs are colder than one shared warm TT; P2's ~19% same-depth win partially dilutes).

## The crux the review skipped: callers are sequential

Every chess-tools scan loop awaits one search at a time (`for (const node of nodes) { await
analyse(...) }` — enginetools.ts:180, 255, 96, 510; pgn.ts prune scan). A pool behind
`analyseMulti` changes nothing until callers issue concurrent requests. So P1 is two halves:

1. **Hosts**: pool of workers behind the unchanged `analyseMulti(fen, multipv, depth, movetime?)`
   signature. The pool queue is the concurrency limiter.
2. **chess-tools**: convert the per-position loops from sequential await to fire-all-then-assemble.
   The `Analyse` type is untouched; only loop bodies change. Output must stay deterministic —
   assemble results by index, existing sorts already canonicalize order.

## Node architecture (apps/mcp-server)

**child_process, not worker_threads** (spiked 2026-07-13): the emscripten build's UMD wrapper
treats a node worker_thread as a WEB worker (`!isMainThread` selects the `self.location` branch),
so `require("stockfish")` inside worker_threads leaves exports empty — dead end. But the build has
a first-class Node CLI mode: `node stockfish-18-lite-single.js` reads UCI over stdin (readline)
and prints output via console.log. Spike: uciok in ~300ms, depth-12 multipv-2 search in ~400ms,
clean `quit`. So the pool is N child processes speaking plain UCI over stdio — no custom worker
script, no console capture, and stdout purity is free (the child's stdout is a pipe the parent
consumes; MCP JSON-RPC on the parent's own stdout is untouched). Separate processes also give
true OS-level parallelism and per-child wasm heaps.

### Per-child lifecycle

- Spawn `process.execPath` + engine path (resolved via createRequire as today). Handshake:
  `uci` → wait `uciok`, `ucinewgame` once (P2 warmth per child), `isready` → wait `readyok`.
- One search in flight per child, ever — a per-request line handler + single ownership kills the
  R1 race (a late bestmove can only belong to THIS request).
- Watchdog: mirror the browser stop-then-grace fix (84ee190): on 30s timeout send `stop`, resolve
  on the imminent bestmove with whatever was reached, 2s grace; on grace expiry kill + respawn the
  child. Mark the result `stopped` so the pool skips caching it (today's Node path caches partial
  watchdog results — bug, fixed by this).

### Pool (parent side)

- Size: `min(availableParallelism(), 4)` default; `ENGINE_POOL_SIZE` env overrides (clamped 1-8).
  ~64MB+ wasm heap per worker justifies the cap.
- Lazy: first `analyseMulti` miss spawns the pool (same laziness as today's `getEngine`).
- Dispatch: FIFO queue → first idle worker. No priorities needed — MCP tools run one at a time;
  intra-tool requests are homogeneous.
- **Cache front + R4 dedupe** (order per request):
  1. `evalCache.get` (incl. cross-multipv serve) — hit returns synchronously, as today.
  2. In-flight map probe, keyed by the same `evalCache.key(fen, multipv)` — join the pending
     promise instead of enqueueing a duplicate. (Cross-multipv in-flight join — waiting on a
     pending *wider* search — deferred: correctness identical, just an occasional extra search.)
  3. Enqueue; on completion `evalCache.put` (unless stopped) and clear the in-flight entry.
- Child death (`error`/`exit`): requeue its in-flight request once, respawn the child; after 2
  consecutive boot failures mark the pool degraded and stop respawning. All children dead →
  `analyseMulti` resolves null (engine_unavailable) — same contract as today.
- Fallback: if the FIRST child fails to boot (spawn restrictions, packaged env), fall back to the
  current in-process single-engine path (`require("stockfish")` + console.log capture + serial
  chain) — kept, not deleted. Both paths sit behind one `UciEndpoint { send, setHandler }` shape,
  so the search/parse/watchdog code is shared.

### TT warmth interaction (P2)

Per-worker TTs each see 1/N of the positions — expected dilution, parallelism dominates (review
§P1). Dispatch stays FIFO/idle — no affinity scheme; shallowest-first node ordering already gives
each worker a coherent-ish slice. Nondeterminism class unchanged from P2 (documented in AGENTS.md).

## chess-tools loop conversions

Convert with plain `Promise.all` over the sliced node list — the pool bounds real parallelism, and
`maxPositions`/`MAX_COMPARE_MOVES` caps already bound queue length. Per loop:

- `findRepertoireGaps` (enginetools.ts:180): per-node search + engine-free post-processing are
  independent → `Promise.all(nodes.map(async node => …))`, then flatten in node order. Any null →
  engine_unavailable (unchanged).
- `auditRepertoireMoves` (enginetools.ts:255): two-phase per node (multipv-2, then conditional
  single-PV for an off-line prescribed move) — keep both awaits INSIDE the per-node async fn;
  nodes run concurrently, per-node logic stays sequential and readable.
- `analyzeMainline` (enginetools.ts:96): `Promise.all(fens.map(…))` — evals indexed, terminal-[]
  handling unchanged.
- `compareMoves` (enginetools.ts:510): per-candidate concurrent; rank assembly already sorts.
- `pruneTranspositions` (pgn.ts): per-candidate searches inside a budget loop (`analyses++`,
  `maxAnalyses`) with a cross-leaf memo. Concurrency vs budget accounting conflicts — **defer**;
  the memo means later leaves mostly hit anyway, and the cursor protocol complicates fire-all.
  Revisit if the prune scan stays the slow one after phase 2.
- `extendedBridges` `pickMoves` (stub resolution): tree search expands frontier sequentially by
  design (engine-guided) — leave alone.

Error semantics: `Promise.all` + null check after preserves "any engine failure → engine_unavailable".
A rejected promise (bug, not engine-down) propagates as today via the tool-boundary catch.

## Browser architecture (apps/ui) — phase 3

- Pool of N `Worker`s for `analyseMulti`; `min(navigator.hardwareConcurrency || 2, 4)` cap
  (mobile memory). Same cache front (`multiCache` + IndexedDB persist) + in-flight dedupe.
- **Eval bar gets its own dedicated worker**: today the streaming single-PV `analyse` shares the
  serial chain with scans, so the eval bar freezes behind a gap scan. Splitting it is a UX win the
  pool gives for free. Latest-wins debouncing unchanged.
- Panel scans (store/gaps.ts fork, shorten store) keep their own loops/cancel for now; converting
  chess-tools loops (phase 2) also speeds the chat tools, and R7 (collapse the UI fork onto
  findRepertoireGaps via onProgress+cancel) becomes MORE attractive after — the shared impl would
  then be both faster and progress-capable. R7 stays a separate item.
- Cancellation note: cancel between positions (current panel semantics) maps to "stop feeding the
  queue"; in-flight searches run to completion (bounded: one per worker). Acceptable; mid-search
  abort stays out of scope (CHAT_TOOLSET_REVIEW §12 owns chat-side cancel).

## Phasing

1. ~~**Spike**~~ — done 2026-07-13: worker_threads dead (UMD wrapper), child_process CLI mode
   works (~300ms boot, clean stdio).
2. ~~**Node pool**~~ — shipped 2026-07-13: child pool + depth-aware in-flight dedupe +
   in-process fallback (`ENGINE_POOL_SIZE=0` forces it); idle children unref'd so ad-hoc scripts
   exit naturally. cache.mjs/handles/confine + smoke-client 33/33 green.
3. ~~**chess-tools conversions**~~ — shipped 2026-07-13: findRepertoireGaps, auditRepertoireMoves,
   analyzeMainline, compareMoves concurrent; checkShortcutCoverage runs before/after scans in
   parallel. Benchmark (fixture english-white.pgn, 96 decision positions, depth 14 multipv 2,
   cache off): 17.1s serial / 16.9s in-process → **6.4s pool-4 (2.7×)**, 4.9s pool-8.
4. ~~**Browser pool**~~ — shipped 2026-07-13: N-worker scan pool behind `analyseMulti` (budget
   `min(hardwareConcurrency||2, 5)`, one slot reserved for the live worker), R4 dedupe shared
   with the new `analyseLive` — a dedicated worker for the board's arrows/eval (store/analysis.ts),
   so browsing never queues behind a chat-scan burst. The dead streaming `analyse()` export
   (no importers — the eval bar reads the analysis store) was deleted. Same stop-then-grace
   watchdog; hung/errored workers terminated + respawned (2-consecutive-failure cap). Verified
   headless: Gaps scan clean, Eval On → 3 live lines + arrows, production build green.
5. ~~Docs~~ — AGENTS.md engine-pool fact, README `ENGINE_POOL_SIZE`, review-doc §P1/R1/R4 updated.

## Decisions (recommendation first)

- **Pool size default 4** (capped): wasm heap ~64MB/worker; >4 rarely helps depth-14 opening
  searches and hurts laptops. Env-tunable for big machines.
- **Fire-all over mapLimit in chess-tools**: the pool queue IS the limiter; adding a second
  limiter in the library couples it to pool sizing. Queue depth is already bounded by
  maxPositions caps.
- **Keep in-process fallback on Node**: worker_threads + emscripten has real-world failure modes
  (packagers, older Node); fallback = today's proven path at near-zero cost since init code is
  shared.
- **Defer prune-scan concurrency**: budget/cursor accounting makes it the one non-mechanical
  conversion; its memo + the persistent cache already blunt the cost.

## Risks

- Spawn failures in restricted environments (fallback covers: in-process single engine).
- Memory: 4 children × (node runtime + wasm heap) — cap + env knob; children exit with the parent
  (`quit` on close + child.unref safety).
- Per-worker TT dilution vs the P2 baseline — benchmark phase 3 confirms net win.
- Browser: >1 wasm Worker on low-end mobile — lower default via hardwareConcurrency, and the
  eval-bar worker counts toward the budget.
