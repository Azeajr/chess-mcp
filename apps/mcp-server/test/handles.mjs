// Engine-free unit test for the repertoire handle cache (handles.ts: store/get + LRU/TTL evict).
// Run: MAX_REPERTOIRES=2 node --import tsx apps/mcp-server/test/handles.mjs
// MAX must be set BEFORE the module is imported (read once at load), so this file is dynamic-import.
process.env.MAX_REPERTOIRES = "2";
process.env.REPERTOIRE_TTL_S = "0.2"; // short TTL so the expiry-on-read test runs fast
process.env.MAX_STRATEGIC_FIT_REPORTS_PER_REPERTOIRE = "2";
const { store, get, getOrCreateStrategicFitReport, strategicFitReportCacheSize } = await import("../src/handles.ts");
const { GameTree, analyzeStrategicFit } = await import("../../../packages/chess-tools/dist/index.js");

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

const tree = () => GameTree.fromPgn("1. e4 *");

// round-trip: store returns a live id
const a = store(tree(), "white");
ok(get(a)?.color === "white", "store/get round-trips the entry");
ok(get("nope") === null, "unknown id → null");

// Complete Strategic Fit reports are cached per immutable handle/settings identity. Projection-only
// page/sort changes reuse the report, while analysis settings miss and the per-handle LRU is bounded.
const aEntry = get(a);
let analyses = 0;
const report = (options) => getOrCreateStrategicFitReport(aEntry, options, (completeOptions) => {
  analyses++;
  return analyzeStrategicFit(aEntry.tree, completeOptions);
});
const baseOptions = { repertoireColor: "white", repertoireRevision: aEntry.revision };
report({ ...baseOptions, page: { offset: 0, limit: 1 } });
report({ ...baseOptions, page: { offset: 20, limit: 2 }, sort: "opening-scope" });
ok(analyses === 1, "paging and sorting reuse one complete handle report");
report({ ...baseOptions, repertoireColor: "black" });
report({ ...baseOptions, weighting: { mode: "manual" } });
ok(analyses === 3 && strategicFitReportCacheSize(aEntry) === 2, "color/settings miss and report cache stays bounded");

// LRU cap holds EXACTLY MAX_REPERTOIRES — not MAX+1. With evict-before-insert the map grew to MAX+1
// (the new entry was added after the size check), leaking one repertoire past the configured cap.
// Store MAX+1 distinct handles with no interleaved get (so insertion order == LRU order): the oldest
// must be evicted, leaving exactly the last MAX live.
const b = store(tree(), "white");
const c = store(tree(), "black"); // 3rd store at MAX=2 → 'a' (oldest) must be evicted
ok(get(a) === null, "LRU cap = MAX: the oldest handle is evicted at MAX+1 (no off-by-one leak)");
ok(strategicFitReportCacheSize(aEntry) === 0, "handle eviction drops its Strategic Fit reports");
ok(get(b) !== null && get(c) !== null, "the most-recent MAX handles stay live");

// R3: TTL is enforced on read, not only during a store()'s evict sweep — without the get() check
// an expired repertoire was served indefinitely if no load_* call happened to trigger evict().
const d = store(tree(), "white");
const dEntry = get(d);
getOrCreateStrategicFitReport(dEntry, { repertoireColor: "white", repertoireRevision: dEntry.revision }, (completeOptions) =>
  analyzeStrategicFit(dEntry.tree, completeOptions));
await new Promise((r) => setTimeout(r, 250));
ok(get(d) === null, "expired handle → null on get (TTL enforced on read)");
ok(strategicFitReportCacheSize(dEntry) === 0, "handle expiry drops its Strategic Fit reports");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
