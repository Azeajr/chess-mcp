import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_PROGRESS_PHASES,
  StrategicFitAnalysisCancelledError,
  StrategicFitIndexCache,
  analyzeStrategicFit,
  buildRepertoireGraph,
  completeStrategicFitReport,
  editStrategicFitBenchmarkRepertoire,
  generateStrategicFitBenchmarkRepertoire,
  strategicFitBenchmarkScale,
  strategicFitCompleteAnalysisOptions,
  type AnalyzeStrategicFitOptions,
  type StrategicFitProgress,
  type StrategicFitRecomputationScope,
  type StrategicFitReport,
} from "../../src/index.ts";
import {
  STRATEGIC_FIT_BENCHMARK_SELF_CHECKS,
  evaluateStrategicFitBenchmark,
  runStrategicFitBenchmarkSelfCheck,
  syntheticStrategicFitBenchmarkRecord,
  // @ts-expect-error — the benchmark gate is a repository script, deliberately outside the package.
} from "../../../../scripts/lib/strategic-fit-benchmark.mjs";

const SCALE = strategicFitBenchmarkScale("small");

function options(revision: string, extra: Partial<AnalyzeStrategicFitOptions> = {}): AnalyzeStrategicFitOptions {
  return strategicFitCompleteAnalysisOptions({
    repertoireColor: SCALE.repertoire_color,
    repertoireRevision: revision,
    ...extra,
  } as AnalyzeStrategicFitOptions);
}

function scan(tree: GameTree, analysis: AnalyzeStrategicFitOptions): StrategicFitReport {
  return completeStrategicFitReport(analyzeStrategicFit(tree, analysis));
}

/** The affected-cohort scope a host derives from its own comparison, as Task 12.1 defines it. */
function affectedCohortScope(
  previous: StrategicFitReport,
  previousPgn: string,
  currentPgn: string,
): StrategicFitRecomputationScope {
  const current = new Set(
    buildRepertoireGraph(GameTree.fromPgn(currentPgn), SCALE.repertoire_color).routes
      .map((route) => route.route_id),
  );
  const removed = buildRepertoireGraph(GameTree.fromPgn(previousPgn), SCALE.repertoire_color).routes
    .map((route) => route.route_id)
    .filter((routeId) => !current.has(routeId));
  assert.ok(removed.length > 0, "the benchmark edit removes at least one route");
  return {
    kind: "affected-cohorts",
    cohort_ids: previous.cohorts
      .filter((cohort) => cohort.route_ids.some((routeId) => removed.includes(routeId)))
      .map((cohort) => cohort.cohort_id),
    reason: "Routes the benchmark edit removed map to these prior cohorts.",
  };
}

test("the benchmark gate passes a within-budget record and rejects every regression it exists to catch", () => {
  const result = runStrategicFitBenchmarkSelfCheck();
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);

  // The self-check is only meaningful if each perturbation is individually necessary.
  assert.ok(STRATEGIC_FIT_BENCHMARK_SELF_CHECKS.length >= 8);
  for (const [description, perturb] of STRATEGIC_FIT_BENCHMARK_SELF_CHECKS) {
    const record = syntheticStrategicFitBenchmarkRecord();
    perturb(record);
    const evaluation = evaluateStrategicFitBenchmark(record);
    assert.equal(evaluation.ok, false, `the gate must reject ${description}`);
    assert.equal(evaluation.failures.length, 1, `${description} must fail exactly the check it targets`);
  }
});

test("a benchmark result is compared only against a result that measured the same thing", () => {
  const baseline = syntheticStrategicFitBenchmarkRecord();
  const regressed = syntheticStrategicFitBenchmarkRecord();
  regressed.scales[0].scan.cold_ms = baseline.scales[0].scan.cold_ms * 2;
  const compared = evaluateStrategicFitBenchmark(regressed, { baseline });
  assert.equal(compared.comparability.comparable, true);
  assert.equal(compared.ok, false);

  for (const [field, value] of [
    ["cpu_model", "another machine"],
    ["platform", "another platform"],
    ["node_major", 99],
  ] as const) {
    const incomparable = syntheticStrategicFitBenchmarkRecord();
    incomparable.environment[field] = value;
    incomparable.scales[0].scan.cold_ms = baseline.scales[0].scan.cold_ms * 2;
    const evaluation = evaluateStrategicFitBenchmark(incomparable, { baseline });
    assert.equal(evaluation.comparability.comparable, false, `${field} must break comparability`);
    assert.equal(evaluation.ok, true, "an incomparable baseline must not fail a run on its own");
  }

  const otherFixture = syntheticStrategicFitBenchmarkRecord();
  otherFixture.scales[0].fixture.digest = "ffffffffffffffff";
  otherFixture.scales[0].fixture.regenerated_digest = "ffffffffffffffff";
  assert.equal(
    evaluateStrategicFitBenchmark(otherFixture, { baseline }).comparability.comparable,
    false,
    "a result measured on a different fixture is never compared",
  );
});

test("a generated benchmark repertoire is byte-identical every time it is generated", () => {
  const first = generateStrategicFitBenchmarkRepertoire(SCALE);
  const second = generateStrategicFitBenchmarkRepertoire(SCALE);
  assert.equal(first.pgn, second.pgn);
  assert.equal(first.digest, second.digest);
  assert.equal(first.nodes, SCALE.target_nodes);
  assert.ok(first.leaves > 0 && first.max_depth > 0);
  assert.ok(first.max_depth <= SCALE.maximum_ply);

  const tree = GameTree.fromPgn(first.pgn);
  assert.deepEqual(tree.stats(), {
    nodes: first.nodes,
    leaves: first.leaves,
    maxDepth: first.max_depth,
  });

  const edited = editStrategicFitBenchmarkRepertoire(SCALE, first);
  assert.equal(edited.digest, editStrategicFitBenchmarkRepertoire(SCALE, first).digest);
  assert.notEqual(edited.digest, first.digest);
  assert.equal(edited.nodes, first.nodes, "the edit replaces one reply rather than growing the tree");
  assert.notEqual(edited.pgn, first.pgn);
});

test("cold, warm, and incremental runs of a generated repertoire all return the same report", () => {
  const fixture = generateStrategicFitBenchmarkRepertoire(SCALE);
  const tree = GameTree.fromPgn(fixture.pgn);
  const cold = scan(tree, options("benchmark:test:1"));
  assert.ok(cold.findings.length > 0, "the generated fixture produces findings to page and rank");

  const index = new StrategicFitIndexCache();
  const indexed = scan(tree, options("benchmark:test:1", { index }));
  assert.equal(JSON.stringify(indexed), JSON.stringify(cold));
  const populated = index.stats;

  const warm = scan(tree, options("benchmark:test:1", { index }));
  assert.equal(JSON.stringify(warm), JSON.stringify(cold));
  assert.ok(index.stats.hits > populated.hits, "a repeated scan reads the index it populated");

  const edited = editStrategicFitBenchmarkRepertoire(SCALE, fixture);
  const editedTree = GameTree.fromPgn(edited.pgn);
  const editedCold = scan(editedTree, options("benchmark:test:2"));
  const incremental = scan(editedTree, options("benchmark:test:2", {
    index,
    recomputationScope: affectedCohortScope(cold, fixture.pgn, edited.pgn),
  }));

  assert.equal(JSON.stringify(incremental), JSON.stringify(editedCold));
  assert.equal(index.lastPlan?.mode, "incremental");
  assert.ok(
    (index.lastPlan?.reused_route_ids.length ?? 0) > 0,
    "a local edit reuses the routes it did not touch",
  );
});

test("the index stays inside its declared bound on a generated repertoire without changing results", () => {
  const fixture = generateStrategicFitBenchmarkRepertoire(SCALE);
  const tree = GameTree.fromPgn(fixture.pgn);
  const cold = scan(tree, options("benchmark:test:memory"));

  // A bound far smaller than the working set is the interesting case: it must evict, not grow.
  const index = new StrategicFitIndexCache({ maximumEntries: 8 });
  const bounded = scan(tree, options("benchmark:test:memory", { index }));
  assert.equal(JSON.stringify(bounded), JSON.stringify(cold));
  assert.ok(index.stats.size <= 8, "the bound holds after a full scan of a generated repertoire");
  assert.ok(index.stats.evictions > 0, "a working set larger than the bound must evict");

  const defaulted = new StrategicFitIndexCache();
  scan(tree, options("benchmark:test:memory", { index: defaulted }));
  assert.ok(defaulted.stats.size <= defaulted.maximumEntries);
});

test("a cancelled scan stops at the phase boundary instead of finishing", () => {
  const fixture = generateStrategicFitBenchmarkRepertoire(SCALE);
  const tree = GameTree.fromPgn(fixture.pgn);
  const completed: string[] = [];
  let cancel = false;
  let requestedAt = 0;
  let observedAt = Number.NaN;

  assert.throws(
    () => analyzeStrategicFit(tree, options("benchmark:test:cancel", {
      onProgress: (progress: StrategicFitProgress) => {
        if (progress.state === "completed") completed.push(progress.phase);
        if (progress.state === "cancelled") observedAt = performance.now();
        if (!cancel && progress.phase_index === 1 && progress.state === "completed") {
          cancel = true;
          requestedAt = performance.now();
        }
      },
      shouldCancel: () => cancel,
    })),
    (error: unknown) =>
      error instanceof StrategicFitAnalysisCancelledError &&
      error.code === "strategic_fit_analysis_cancelled" &&
      error.phase_index === 2,
  );

  assert.deepEqual(completed, [...STRATEGIC_FIT_PROGRESS_PHASES].slice(0, 2));
  assert.ok(
    Number.isFinite(observedAt) && observedAt - requestedAt < 50,
    "an observed cancellation is acted on at the boundary rather than after another phase",
  );
});
