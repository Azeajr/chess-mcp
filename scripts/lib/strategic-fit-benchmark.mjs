export const STRATEGIC_FIT_BENCHMARK_FORMAT_VERSION = 1;

const ANIMATION_FRAME_MS = 1000 / 60;

const STRATEGIC_FIT_BENCHMARK_BUDGETS = Object.freeze({
  frame_ms: ANIMATION_FRAME_MS,
  cancellation_observed_ms: 5,
  baseline_tolerance: 0.4,
  graph_rebuild_ratio: 0.15,
  scales: Object.freeze({
    small: Object.freeze({
      cold_reference_multiple: null,
      warm_ratio: 1.05,
      incremental_ratio: 1.05,
      cancellation_latency_reference_multiple: 1.0,
      peak_heap_mb: 512,
    }),
    standard: Object.freeze({
      cold_reference_multiple: 12,
      warm_ratio: 0.9,
      incremental_ratio: 1.02,
      cancellation_latency_reference_multiple: 8,
      peak_heap_mb: 1024,
    }),
    large: Object.freeze({
      cold_reference_multiple: 600,
      warm_ratio: 1.05,
      incremental_ratio: 1.05,
      cancellation_latency_reference_multiple: 400,
      peak_heap_mb: 4096,
    }),
  }),
});

function budgetsForScale(scaleId, budgets = STRATEGIC_FIT_BENCHMARK_BUDGETS) {
  const scale = budgets.scales[scaleId];
  if (scale === undefined) throw new Error(`strategic_fit_benchmark_unbudgeted_scale:${scaleId}`);
  return scale;
}

function check(id, scaleId, ok, actual, budget, unit, detail) {
  return { id, scale: scaleId, ok, actual, budget, unit, detail };
}

function round(value) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value.toFixed(3)) : value;
}

function benchmarkComparability(record, baseline) {
  const reasons = [];
  if (!baseline) return { comparable: false, reasons: ["no recorded baseline"] };
  if (baseline.format_version !== record.format_version) reasons.push("record format differs");
  if (JSON.stringify(baseline.manifest) !== JSON.stringify(record.manifest)) {
    reasons.push("analysis manifest differs");
  }
  for (const field of ["platform", "arch", "cpu_model", "cpu_count", "node_major"]) {
    if (baseline.environment?.[field] !== record.environment?.[field]) {
      reasons.push(`environment ${field} differs`);
    }
  }
  const baselineScales = new Map((baseline.scales ?? []).map((scale) => [scale.id, scale]));
  for (const scale of record.scales ?? []) {
    const other = baselineScales.get(scale.id);
    if (other === undefined) {
      reasons.push(`baseline has no ${scale.id} scale`);
      continue;
    }
    if (other.fixture?.digest !== scale.fixture?.digest) {
      reasons.push(`${scale.id} fixture digest differs`);
    }
  }
  return { comparable: reasons.length === 0, reasons };
}

function budgetChecks(record, budgets) {
  const checks = [];
  const reference = record.reference_ms;
  for (const scale of record.scales ?? []) {
    const scaleBudgets = budgetsForScale(scale.id, budgets);
    const scan = scale.scan;

    checks.push(
      check(
        "determinism",
        scale.id,
        scale.determinism?.indexed_matches_cold === true,
        scale.determinism?.indexed_matches_cold,
        true,
        "boolean",
        "an indexed scan returns byte-identical findings to an unindexed one",
      ),
    );
    checks.push(
      check(
        "incremental-determinism",
        scale.id,
        scale.determinism?.incremental_matches_cold === true,
        scale.determinism?.incremental_matches_cold,
        true,
        "boolean",
        "an incremental scan after an edit returns what a cold scan of the edited tree returns",
      ),
    );
    checks.push(
      check(
        "fixture-determinism",
        scale.id,
        scale.fixture?.regenerated_digest === scale.fixture?.digest,
        scale.fixture?.regenerated_digest,
        scale.fixture?.digest,
        "digest",
        "the generated fixture is byte-identical when generated again",
      ),
    );

    if (scaleBudgets.cold_reference_multiple !== null) {
      const budget = reference * scaleBudgets.cold_reference_multiple;
      checks.push(
        check(
          "cold-scan",
          scale.id,
          scan.cold_ms <= budget,
          round(scan.cold_ms),
          round(budget),
          "ms",
          `a cold scan costs at most ${scaleBudgets.cold_reference_multiple}x the reference workload`,
        ),
      );
    }
    const warmBudget = scan.cold_ms * scaleBudgets.warm_ratio;
    checks.push(
      check(
        "warm-scan",
        scale.id,
        scan.warm_ms <= warmBudget,
        round(scan.warm_ms),
        round(warmBudget),
        "ms",
        `a repeated scan over an unchanged tree costs at most ${scaleBudgets.warm_ratio}x the cold scan`,
      ),
    );
    const incrementalBudget = scan.cold_ms * scaleBudgets.incremental_ratio;
    checks.push(
      check(
        "incremental-scan",
        scale.id,
        scan.incremental_ms <= incrementalBudget,
        round(scan.incremental_ms),
        round(incrementalBudget),
        "ms",
        `a scan after one local edit costs at most ${scaleBudgets.incremental_ratio}x the cold scan`,
      ),
    );

    const graphBudget = scan.cold_ms * budgets.graph_rebuild_ratio;
    checks.push(
      check(
        "graph-rebuild",
        scale.id,
        scan.graph_rebuild_ms <= graphBudget,
        round(scan.graph_rebuild_ms),
        round(graphBudget),
        "ms",
        "the graph rebuild a replacement safety simulation pays stays a fraction of a full scan",
      ),
    );

    const latencyBudget = reference * scaleBudgets.cancellation_latency_reference_multiple;
    checks.push(
      check(
        "cancellation-latency",
        scale.id,
        scale.cancellation.worst_phase_ms <= latencyBudget,
        round(scale.cancellation.worst_phase_ms),
        round(latencyBudget),
        "ms",
        "worst case a mid-phase cancellation waits for the longest phase to finish",
      ),
    );
    checks.push(
      check(
        "cancellation-stop",
        scale.id,
        scale.cancellation.observed_ms <= budgets.cancellation_observed_ms,
        round(scale.cancellation.observed_ms),
        budgets.cancellation_observed_ms,
        "ms",
        "an observed cancellation stops the scan instead of finishing it",
      ),
    );

    for (const operation of scale.main_thread ?? []) {
      checks.push(
        check(
          `frame:${operation.id}`,
          scale.id,
          operation.worst_ms <= budgets.frame_ms,
          round(operation.worst_ms),
          round(budgets.frame_ms),
          "ms",
          `${operation.detail} stays inside one animation frame while the worker scans`,
        ),
      );
    }

    for (const bound of scale.bounds ?? []) {
      checks.push(
        check(
          `bound:${bound.id}`,
          scale.id,
          bound.actual <= bound.limit,
          bound.actual,
          bound.limit,
          bound.unit,
          bound.detail,
        ),
      );
    }

    checks.push(
      check(
        "peak-heap",
        scale.id,
        scale.memory.peak_heap_mb <= scaleBudgets.peak_heap_mb,
        round(scale.memory.peak_heap_mb),
        scaleBudgets.peak_heap_mb,
        "MB",
        "peak heap during the scan stays under the scale's ceiling",
      ),
    );
  }
  return checks;
}

function regressionChecks(record, baseline, tolerance) {
  const checks = [];
  const baselineScales = new Map(baseline.scales.map((scale) => [scale.id, scale]));
  for (const scale of record.scales ?? []) {
    const other = baselineScales.get(scale.id);
    if (other === undefined) continue;
    for (const metric of ["cold_ms", "warm_ms", "incremental_ms"]) {
      const before = other.scan?.[metric];
      const now = scale.scan?.[metric];
      if (typeof before !== "number" || typeof now !== "number") continue;
      const budget = before * (1 + tolerance);
      checks.push(
        check(
          `regression:${metric}`,
          scale.id,
          now <= budget,
          round(now),
          round(budget),
          "ms",
          `within ${Math.round(tolerance * 100)}% of the recorded ${metric.replace("_ms", "")} scan`,
        ),
      );
    }
  }
  return checks;
}

export function evaluateStrategicFitBenchmark(
  record,
  { budgets = STRATEGIC_FIT_BENCHMARK_BUDGETS, baseline = null } = {},
) {
  const checks = budgetChecks(record, budgets);
  const comparability = benchmarkComparability(record, baseline);
  const regressions = comparability.comparable
    ? regressionChecks(record, baseline, budgets.baseline_tolerance)
    : [];
  const all = [...checks, ...regressions];
  return {
    ok: all.every((entry) => entry.ok),
    checks: all,
    failures: all.filter((entry) => !entry.ok),
    comparability,
  };
}

export function syntheticStrategicFitBenchmarkRecord(
  manifest = { schema_version: "0", analysis_version: "0" },
) {
  return {
    benchmark: "strategic-fit",
    format_version: STRATEGIC_FIT_BENCHMARK_FORMAT_VERSION,
    environment: {
      node: "0.0.0",
      node_major: 0,
      platform: "synthetic",
      arch: "synthetic",
      cpu_model: "synthetic",
      cpu_count: 1,
    },
    manifest,
    reference_ms: 100,
    scales: [
      {
        id: "standard",
        fixture: {
          nodes: 1_000,
          leaves: 437,
          digest: "0000000000000000",
          regenerated_digest: "0000000000000000",
        },
        findings: 437,
        determinism: { indexed_matches_cold: true, incremental_matches_cold: true },
        scan: { cold_ms: 100, warm_ms: 60, incremental_ms: 70, graph_rebuild_ms: 10 },
        cancellation: { worst_phase_ms: 50, observed_ms: 0.1 },
        memory: { peak_heap_mb: 120 },
        main_thread: [{ id: "page-projection", worst_ms: 1, detail: "one cursor page" }],
        bounds: [
          {
            id: "index-entries",
            actual: 250,
            limit: 512,
            unit: "entries",
            detail: "the index stays inside its bound",
          },
        ],
      },
    ],
  };
}

export const STRATEGIC_FIT_BENCHMARK_SELF_CHECKS = Object.freeze([
  [
    "a cold scan that outgrew the reference workload",
    (record) => {
      record.scales[0].scan.cold_ms = 5_000;
    },
  ],
  [
    "a warm scan that lost its index",
    (record) => {
      record.scales[0].scan.warm_ms = 99;
    },
  ],
  [
    "an incremental scan slower than a cold one",
    (record) => {
      record.scales[0].scan.incremental_ms = 140;
    },
  ],
  [
    "a graph rebuild that grew into a full scan",
    (record) => {
      record.scales[0].scan.graph_rebuild_ms = 80;
    },
  ],
  [
    "a main-thread operation over one frame",
    (record) => {
      record.scales[0].main_thread[0].worst_ms = 40;
    },
  ],
  [
    "a cache bound exceeded",
    (record) => {
      record.scales[0].bounds[0].actual = 513;
    },
  ],
  [
    "a peak heap over the ceiling",
    (record) => {
      record.scales[0].memory.peak_heap_mb = 9_999;
    },
  ],
  [
    "a cancellation the scan did not observe",
    (record) => {
      record.scales[0].cancellation.observed_ms = 500;
    },
  ],
  [
    "a non-deterministic indexed scan",
    (record) => {
      record.scales[0].determinism.indexed_matches_cold = false;
    },
  ],
  [
    "a fixture that generated differently",
    (record) => {
      record.scales[0].fixture.regenerated_digest = "ffffffffffffffff";
    },
  ],
]);

export function runStrategicFitBenchmarkSelfCheck() {
  const failures = [];
  const passing = evaluateStrategicFitBenchmark(syntheticStrategicFitBenchmarkRecord());
  if (!passing.ok) {
    failures.push(
      `a within-budget record must pass: ${passing.failures.map((entry) => entry.id).join(", ")}`,
    );
  }
  for (const [description, perturb] of STRATEGIC_FIT_BENCHMARK_SELF_CHECKS) {
    const record = syntheticStrategicFitBenchmarkRecord();
    perturb(record);
    if (evaluateStrategicFitBenchmark(record).ok)
      failures.push(`the gate must reject ${description}`);
  }
  const baseline = syntheticStrategicFitBenchmarkRecord();
  const regressed = syntheticStrategicFitBenchmarkRecord();
  regressed.scales[0].scan.cold_ms = baseline.scales[0].scan.cold_ms * 2;
  if (evaluateStrategicFitBenchmark(regressed, { baseline }).ok) {
    failures.push("the gate must reject a doubled cold scan against a comparable baseline");
  }
  const incomparable = syntheticStrategicFitBenchmarkRecord({
    schema_version: "9",
    analysis_version: "9",
  });
  incomparable.scales[0].scan.cold_ms = baseline.scales[0].scan.cold_ms * 2;
  const skipped = evaluateStrategicFitBenchmark(incomparable, { baseline });
  if (skipped.comparability.comparable) {
    failures.push("a record from another analysis manifest must not be compared to the baseline");
  }
  if (!skipped.ok) failures.push("an incomparable baseline must not fail the run on its own");
  return { ok: failures.length === 0, failures };
}

function line(entry) {
  const status = entry.ok ? "pass" : "FAIL";
  const actual =
    entry.unit === "boolean" || entry.unit === "digest"
      ? String(entry.actual)
      : `${entry.actual} ${entry.unit}`;
  const budget =
    entry.unit === "boolean" || entry.unit === "digest"
      ? String(entry.budget)
      : `${entry.budget} ${entry.unit}`;
  return `  ${status}  ${entry.scale}/${entry.id}: ${actual} (budget ${budget}) — ${entry.detail}`;
}

export function formatStrategicFitBenchmark(record, evaluation) {
  const environment = record.environment;
  const lines = [
    "Strategic Fit performance benchmark",
    `  environment: node ${environment.node} ${environment.platform}/${environment.arch}` +
      ` — ${environment.cpu_count}x ${environment.cpu_model}`,
    `  manifest: schema ${record.manifest.schema_version}` +
      ` analysis ${record.manifest.analysis_version}`,
    `  reference workload: ${round(record.reference_ms)} ms`,
  ];
  for (const scale of record.scales ?? []) {
    lines.push(
      `  fixture ${scale.id}: ${scale.fixture.nodes} nodes, ${scale.fixture.leaves} leaves,` +
        ` ${scale.findings} findings, digest ${scale.fixture.digest}`,
    );
  }
  lines.push("");
  for (const entry of evaluation.checks) lines.push(line(entry));
  lines.push("");
  lines.push(
    evaluation.comparability.comparable
      ? "  baseline: comparable, regression checks applied"
      : `  baseline: not compared (${evaluation.comparability.reasons.join("; ")})`,
  );
  lines.push(
    evaluation.ok
      ? `  result: ok (${evaluation.checks.length} checks)`
      : `  result: FAILED (${evaluation.failures.length} of ${evaluation.checks.length} checks)`,
  );
  return lines.join("\n");
}
