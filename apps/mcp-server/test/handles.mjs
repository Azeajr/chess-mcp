// Engine-free unit test for the repertoire handle cache (handles.ts: store/get + LRU/TTL evict).
// Run: MAX_REPERTOIRES=2 node --import tsx apps/mcp-server/test/handles.mjs
// MAX must be set BEFORE the module is imported (read once at load), so this file is dynamic-import.
process.env.MAX_REPERTOIRES = "2";
const { store, get } = await import("../src/handles.ts");
const { GameTree } = await import("../../../packages/chess-tools/dist/index.js");

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

const tree = () => GameTree.fromPgn("1. e4 *");

// round-trip: store returns a live id
const a = store(tree(), "white");
ok(get(a)?.color === "white", "store/get round-trips the entry");
ok(get("nope") === null, "unknown id → null");

// LRU cap holds EXACTLY MAX_REPERTOIRES — not MAX+1. With evict-before-insert the map grew to MAX+1
// (the new entry was added after the size check), leaking one repertoire past the configured cap.
// Store MAX+1 distinct handles with no interleaved get (so insertion order == LRU order): the oldest
// must be evicted, leaving exactly the last MAX live.
const b = store(tree(), "white");
const c = store(tree(), "black"); // 3rd store at MAX=2 → 'a' (oldest) must be evicted
ok(get(a) === null, "LRU cap = MAX: the oldest handle is evicted at MAX+1 (no off-by-one leak)");
ok(get(b) !== null && get(c) !== null, "the most-recent MAX handles stay live");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
