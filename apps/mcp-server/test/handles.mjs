process.env.MAX_REPERTOIRES = "2";
process.env.REPERTOIRE_TTL_S = "0.2";
process.env.MAX_STRATEGIC_FIT_REPORTS_PER_REPERTOIRE = "2";
const {
  store,
  get,
  getOrCreateStrategicFitReport,
  strategicFitReportCacheSize,
  strategicFitJobRecovery,
  hasStrategicFitJobCheckpoint,
} = await import("../src/handles.ts");
const {
  GameTree,
  analyzeStrategicFit,
  completeStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
  StrategicFitAnalysisCancelledError,
} = await import("../../../packages/chess-tools/dist/index.js");

let pass = 0,
  fail = 0;
const ok = (c, m) => (c ? pass++ : (fail++, console.log("FAIL:", m)));

const tree = () => GameTree.fromPgn("1. e4 *");

const a = store(tree(), "white");
ok(get(a)?.color === "white", "store/get round-trips the entry");
ok(get("nope") === null, "unknown id → null");

const aEntry = get(a);
let analyses = 0;
const report = (options) =>
  getOrCreateStrategicFitReport(aEntry, options, (completeOptions) => {
    analyses++;
    return analyzeStrategicFit(aEntry.tree, completeOptions);
  });
const baseOptions = { repertoireColor: "white", repertoireRevision: aEntry.revision };
report({ ...baseOptions, page: { offset: 0, limit: 1 } });
report({ ...baseOptions, page: { offset: 20, limit: 2 }, sort: "opening-scope" });
ok(analyses === 1, "paging and sorting reuse one complete handle report");
report({ ...baseOptions, repertoireColor: "black" });
report({ ...baseOptions, weighting: { mode: "manual" } });
ok(
  analyses === 3 && strategicFitReportCacheSize(aEntry) === 2,
  "color/settings miss and report cache stays bounded",
);

const b = store(tree(), "white");
const c = store(tree(), "black");
ok(get(a) === null, "LRU cap = MAX: the oldest handle is evicted at MAX+1 (no off-by-one leak)");
ok(strategicFitReportCacheSize(aEntry) === 0, "handle eviction drops its Strategic Fit reports");
ok(get(b) !== null && get(c) !== null, "the most-recent MAX handles stay live");

const d = store(tree(), "white");
const dEntry = get(d);
getOrCreateStrategicFitReport(
  dEntry,
  { repertoireColor: "white", repertoireRevision: dEntry.revision },
  (completeOptions) => analyzeStrategicFit(dEntry.tree, completeOptions),
);
await new Promise((r) => setTimeout(r, 250));
ok(get(d) === null, "expired handle → null on get (TTL enforced on read)");
ok(strategicFitReportCacheSize(dEntry) === 0, "handle expiry drops its Strategic Fit reports");

const SCAN_PGN = `1. e4 (1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3) e5
2. Nf3 (2. Nc3 Nf6 3. f4 d5 4. exd5 Nxd5 5. Nf3) Nc6 3. Bb5 a6 4. Ba4 Nf6
5. O-O Be7 6. Re1 *`;
const scanTree = () => GameTree.fromPgn(SCAN_PGN);

const runInterrupted = (entry, options) => {
  let interrupted = false;
  try {
    getOrCreateStrategicFitReport(entry, options, (completeOptions) =>
      analyzeStrategicFit(entry.tree, {
        ...completeOptions,
        onCheckpoint: (stage) => {
          completeOptions.onCheckpoint?.(stage);
          if (stage.completed_phase_index >= 1) interrupted = true;
        },
        shouldCancel: () => interrupted,
      }),
    );
    return false;
  } catch (error) {
    return error instanceof StrategicFitAnalysisCancelledError;
  }
};

const scanHandle = store(scanTree(), "white");
const scanEntry = get(scanHandle);
const scanOptions = { repertoireColor: "white", repertoireRevision: scanEntry.revision };
ok(runInterrupted(scanEntry, scanOptions), "an interrupted analysis surfaces its cancellation");
ok(hasStrategicFitJobCheckpoint(scanEntry), "the interrupted job stays on its handle");
ok(strategicFitJobRecovery(scanEntry)?.state === "cold", "the interrupted run itself started cold");

const resumed = getOrCreateStrategicFitReport(scanEntry, scanOptions, (completeOptions) =>
  analyzeStrategicFit(scanEntry.tree, completeOptions),
);
const resumedRecovery = strategicFitJobRecovery(scanEntry);
ok(resumedRecovery?.state === "resumed", "the next call continues the interrupted job");
ok(
  resumedRecovery?.restored_stages.join() === "graph,trajectories" &&
    typeof resumedRecovery?.saved_at === "string",
  "recovery provenance names the restored stages and when they were saved",
);
ok(!hasStrategicFitJobCheckpoint(scanEntry), "a settled job no longer holds a checkpoint");

const cold = completeStrategicFitReport(
  analyzeStrategicFit(scanTree(), strategicFitCompleteAnalysisOptions(scanOptions)),
);
ok(
  JSON.stringify(resumed) === JSON.stringify(cold),
  "a resumed report is byte-identical to a cold full scan",
);

ok(
  runInterrupted(scanEntry, { ...scanOptions, weighting: { mode: "manual" } }),
  "second interruption",
);
getOrCreateStrategicFitReport(
  scanEntry,
  { ...scanOptions, trajectory: { configuredPlies: [6, 10] } },
  (completeOptions) => analyzeStrategicFit(scanEntry.tree, completeOptions),
);
const discarded = strategicFitJobRecovery(scanEntry);
ok(
  discarded?.state === "discarded" && discarded.code === "strategic_fit_checkpoint_stale_settings",
  "a checkpoint from other analysis settings is discarded with a stated reason",
);

ok(
  runInterrupted(scanEntry, { ...scanOptions, weighting: { mode: "manual" } }),
  "third interruption",
);
ok(hasStrategicFitJobCheckpoint(scanEntry), "the job is held before eviction");
store(tree(), "white");
store(tree(), "black");
ok(get(scanHandle) === null, "the scan handle is evicted");
ok(!hasStrategicFitJobCheckpoint(scanEntry), "handle eviction drops its interrupted job");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
