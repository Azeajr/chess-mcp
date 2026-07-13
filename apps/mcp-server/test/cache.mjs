// Engine-free unit test for the in-process eval cache (evalCache in src/engine.ts):
// depth-reuse, FIFO eviction, transposition keying (P4), JSONL persistence (P3).
// Run: node --import tsx apps/mcp-server/test/cache.mjs
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point persistence at a scratch dir BEFORE the module loads (it resolves the dir at import).
const cacheDir = mkdtempSync(join(tmpdir(), "chess-mcp-cache-test-"));
process.env.EVAL_CACHE_DIR = cacheDir;
const { evalCache } = await import("../src/engine.ts");

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const lines = (d) => [{ uci: "e2e4", cp: 30, mate: null, depth: d, pv: ["e2e4"] }];

evalCache.clear();
ok(evalCache.get(FEN, 1, 14) === null, "empty cache → miss");

evalCache.put(FEN, 1, 16, lines(16));
ok(evalCache.get(FEN, 1, 16) !== null, "same depth → hit");
ok(evalCache.get(FEN, 1, 14) !== null, "stored depth 16 serves request depth 14");
ok(evalCache.get(FEN, 1, 20) === null, "stored depth 16 misses deeper request depth 20");
ok(evalCache.get(FEN, 3, 16) === null, "wider multipv request than stored → miss");
ok(evalCache.get(FEN, 1, 10)?.[0]?.uci === "e2e4", "hit returns the stored lines");

// Cross-multipv serve: a stored multipv-N entry truncates to answer a narrower request at the
// same (or shallower) depth; never the other way around, and never below the stored depth.
const FEN2 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const four = [
  { uci: "e7e5", cp: -20, mate: null, depth: 14, pv: ["e7e5"] },
  { uci: "c7c5", cp: -25, mate: null, depth: 14, pv: ["c7c5"] },
  { uci: "e7e6", cp: -35, mate: null, depth: 14, pv: ["e7e6"] },
  { uci: "c7c6", cp: -40, mate: null, depth: 14, pv: ["c7c6"] },
];
evalCache.put(FEN2, 4, 14, four);
ok(evalCache.get(FEN2, 2, 14)?.length === 2, "stored multipv-4 serves multipv-2 truncated");
ok(evalCache.get(FEN2, 1, 14)?.[0]?.uci === "e7e5", "truncation keeps the engine's top line");
ok(evalCache.get(FEN2, 2, 20) === null, "cross-multipv still respects the depth rule");

// P4 — transposition keying: below halfmove clock 50 the key drops the clocks, so the same
// position with different move counters (a transposition) hits; at clock >= 50 the full FEN
// keys exactly (50-move-rule positions must not share entries across clocks).
ok(evalCache.get("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 4 12", 1, 16) !== null,
  "same position, different clocks → hit (transposition key)");
const HIGH_A = "8/8/4k3/8/8/4K3/4R3/8 w - - 60 80";
const HIGH_B = "8/8/4k3/8/8/4K3/4R3/8 w - - 99 100";
evalCache.put(HIGH_A, 1, 16, lines(16));
ok(evalCache.get(HIGH_A, 1, 16) !== null, "clock >= 50: exact FEN → hit");
ok(evalCache.get(HIGH_B, 1, 16) === null, "clock >= 50: different clock → miss (full-FEN key)");

// FIFO eviction at MAX_CACHE (1000).
evalCache.clear();
for (let i = 0; i < 1001; i++) evalCache.put(`fen${i} w - - 0 1`, 1, 10, lines(10));
ok(evalCache.get("fen0 w - - 0 1", 1, 10) === null, "oldest entry evicted at overflow");
ok(evalCache.get("fen1000 w - - 0 1", 1, 10) !== null, "newest entry retained");
ok(evalCache.store.size === 1000, "cache capped at MAX_CACHE");

// P3 — persistence: puts write through to evals.jsonl; reload() re-reads it like a fresh boot.
await evalCache.flush();
const file = readFileSync(join(cacheDir, "evals.jsonl"), "utf8");
ok(file.split("\n").filter(Boolean).length >= 1000, "puts appended to evals.jsonl");
evalCache.clear();
ok(evalCache.get("fen1000 w - - 0 1", 1, 10) === null, "clear() wipes memory");
evalCache.reload();
ok(evalCache.get("fen1000 w - - 0 1", 1, 10) !== null, "reload() restores entries from disk");
ok(evalCache.get("fen1000 w - - 0 1", 1, 10)?.[0]?.uci === "e2e4", "restored lines round-trip");
ok(evalCache.get("fen0 w - - 0 1", 1, 10) === null, "reload respects MAX_CACHE (newest win)");
ok(evalCache.store.size <= 1000, "reloaded store capped at MAX_CACHE");

// Older duplicate lines lose to newer ones (append-only file, later line wins).
evalCache.put("dup w - - 0 1", 1, 10, lines(10));
evalCache.put("dup w - - 0 1", 1, 18, lines(18));
await evalCache.flush();
evalCache.reload();
ok(evalCache.get("dup w - - 0 1", 1, 18) !== null, "newer (deeper) duplicate line wins on reload");

rmSync(cacheDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
