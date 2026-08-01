/**
 * Task 12.4 — Strategic Fit performance benchmark.
 *
 * Run it after building `@chess-mcp/chess-tools`:
 *
 *   pnpm --filter @chess-mcp/chess-tools build
 *   node scripts/strategic-fit-benchmark.mjs            # gated scales (small, standard)
 *   node scripts/strategic-fit-benchmark.mjs --record   # rewrite the committed baseline
 *   node --max-old-space-size=8192 scripts/strategic-fit-benchmark.mjs --scale large
 *
 * The ten-thousand-node scale is opt-in and needs a raised heap: a complete scan of a repertoire
 * that size does not fit in a default Node old space, which is itself part of what the benchmark
 * has to say about that size.
 *
 * The benchmark observes; it never changes analysis. Every scan it times is a scan an ordinary
 * host performs, through the same entry points, and each one is checked to return exactly the
 * report an unmeasured run returns. It adds no cache, no bound, and no second identity: paging,
 * mounted-window, and cache limits are asserted against the constants the product already exports.
 *
 * Budgets and the gate itself live in `scripts/lib/strategic-fit-benchmark.mjs`.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { cpus } from "node:os";
import process from "node:process";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_BENCHMARK_SCALES,
  STRATEGIC_FIT_CONVERSATION_LIMITS,
  STRATEGIC_FIT_DEFAULT_INDEX_ENTRIES,
  STRATEGIC_FIT_MAX_PAGE_SIZE,
  StrategicFitAnalysisCancelledError,
  StrategicFitIndexCache,
  analyzeStrategicFit,
  buildRepertoireGraph,
  completeStrategicFitReport,
  editStrategicFitBenchmarkRepertoire,
  generateStrategicFitBenchmarkRepertoire,
  projectStrategicFitConversation,
  projectStrategicFitReport,
  strategicFitCompleteAnalysisOptions,
} from "../packages/chess-tools/dist/index.js";

import {
  STRATEGIC_FIT_BENCHMARK_FORMAT_VERSION,
  evaluateStrategicFitBenchmark,
  formatStrategicFitBenchmark,
  runStrategicFitBenchmarkSelfCheck,
} from "./lib/strategic-fit-benchmark.mjs";

const BASELINE_URL = new URL("./strategic-fit-benchmark.baseline.json", import.meta.url);
const GATED_SCALES = ["small", "standard"];
const REFERENCE_SCALE = "small";
const REFERENCE_RUNS = 3;

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
  return value;
};

/**
 * The mounted-window bounds are the UI's own. Node strips the types at import time, so the
 * benchmark asserts against the exported constants rather than restating them.
 */
async function visualizationLimits() {
  try {
    return await import("../apps/ui/src/components/strategic-fit/visualization-limits.ts");
  } catch (error) {
    throw new Error(
      "The benchmark reads the UI's exported render bounds directly, which needs a Node release " +
      `that strips TypeScript types (this repository's CI runs Node 26; this is ${process.version}).`,
      { cause: error },
    );
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

function timed(run) {
  const started = performance.now();
  const value = run();
  return { ms: performance.now() - started, value };
}

function heapMb() {
  return process.memoryUsage().heapUsed / 1_048_576;
}

function scan(tree, options) {
  return completeStrategicFitReport(analyzeStrategicFit(tree, options));
}

/**
 * Byte identity of a report, reduced to a digest immediately so equivalence can be checked without
 * holding several complete reports at once. The report is folded in place rather than serialized:
 * a benchmark that runs out of memory measuring itself has measured nothing, and at the largest
 * scale a complete report has no JSON string at all — it exceeds the maximum string V8 can hold.
 * The traversal visits the same values in the same order `JSON.stringify` would, so two reports
 * share a digest exactly when they would have shared a serialization.
 */
function foldValue(value, fold) {
  if (value === null || typeof value !== "object") {
    fold(JSON.stringify(value ?? null) ?? "null");
    return;
  }
  if (Array.isArray(value)) {
    fold("[");
    for (const item of value) {
      foldValue(item === undefined ? null : item, fold);
      fold(",");
    }
    fold("]");
    return;
  }
  fold("{");
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    fold(JSON.stringify(key));
    fold(":");
    foldValue(item, fold);
    fold(",");
  }
  fold("}");
}

function reportDigest(report) {
  const hash = createHash("sha256");
  let pending = [];
  let pendingLength = 0;
  const fold = (text) => {
    pending.push(text);
    pendingLength += text.length;
    if (pendingLength >= 1_000_000) {
      hash.update(pending.join(""));
      pending = [];
      pendingLength = 0;
    }
  };
  foldValue(report, fold);
  hash.update(pending.join(""));
  return hash.digest("hex").slice(0, 32);
}

/** Time a scan and keep only its duration and digest, so the report itself becomes collectable. */
function timedScan(tree, options) {
  const { ms, value } = timed(() => scan(tree, options));
  return { ms, digest: reportDigest(value) };
}

function analysisOptions(fixture, revision, extra = {}) {
  return strategicFitCompleteAnalysisOptions({
    repertoireColor: fixture.repertoire_color,
    repertoireRevision: revision,
    ...extra,
  });
}

/**
 * A scan instrumented for phase durations and peak heap. It is timed separately from the plain
 * cold scan so the instrumentation never inflates a budgeted duration.
 */
function instrumentedScan(tree, options) {
  const phases = [];
  let peak = heapMb();
  let phaseStarted = performance.now();
  scan(tree, {
    ...options,
    onProgress: (progress) => {
      const now = performance.now();
      peak = Math.max(peak, heapMb());
      if (progress.state === "running") phaseStarted = now;
      else if (progress.state === "completed") {
        phases.push({ phase: progress.phase, ms: now - phaseStarted });
      }
    },
  });
  return { phases, peak_heap_mb: Math.max(peak, heapMb()) };
}

/**
 * Cancellation has two distinct costs. A cancellation requested mid-phase is not observable until
 * the phase boundary, so the worst case is the longest phase — that is what the gate budgets. What
 * happens once it *is* observable is measured directly: the scan must stop, not finish.
 */
function measureCancellation(tree, options, phases) {
  let requestedAt = 0;
  let cancel = false;
  const target = Math.min(3, phases.length - 1);
  let observed = Number.POSITIVE_INFINITY;
  try {
    scan(tree, {
      ...options,
      onProgress: (progress) => {
        if (!cancel && progress.phase_index === target && progress.state === "completed") {
          cancel = true;
          requestedAt = performance.now();
        }
      },
      shouldCancel: () => cancel,
    });
  } catch (error) {
    if (!(error instanceof StrategicFitAnalysisCancelledError)) throw error;
    observed = performance.now() - requestedAt;
  }
  if (!Number.isFinite(observed)) {
    throw new Error("strategic_fit_benchmark_cancellation_was_not_honoured");
  }
  return {
    worst_phase_ms: Math.max(...phases.map((entry) => entry.ms)),
    observed_ms: observed,
    phases: phases.map((entry) => ({ phase: entry.phase, ms: Number(entry.ms.toFixed(3)) })),
  };
}

/**
 * What the host's main thread does while the worker scans: walk the report by cursor, project a
 * conversation page, and compute mounted windows. Each operation is timed on its own because the
 * budget is per frame, not per session.
 */
function measureMainThread(report, limits) {
  const identity = {
    report_id: report.report_id,
    expected_repertoire_revision: report.repertoire_revision,
  };
  const operations = [];
  const bounds = [];

  let cursor = null;
  let worstPage = 0;
  let pages = 0;
  let widestPage = 0;
  for (;;) {
    const request = cursor === null
      ? { limit: STRATEGIC_FIT_MAX_PAGE_SIZE }
      : { limit: STRATEGIC_FIT_MAX_PAGE_SIZE, cursor };
    const { ms, value } = timed(() => projectStrategicFitReport(report, {
      kind: "page",
      expected_repertoire_revision: report.repertoire_revision,
      sort: "replacement-priority",
      page: request,
    }));
    pages++;
    worstPage = Math.max(worstPage, ms);
    widestPage = Math.max(widestPage, value.report.findings.length);
    cursor = value.next_cursor;
    if (cursor === null) break;
    if (pages > report.findings.length) throw new Error("strategic_fit_benchmark_cursor_did_not_terminate");
  }
  operations.push({ id: "page-projection", worst_ms: worstPage, detail: `one of ${pages} cursor pages` });
  bounds.push({
    id: "page-findings",
    actual: widestPage,
    limit: STRATEGIC_FIT_MAX_PAGE_SIZE,
    unit: "findings",
    detail: "no cursor page exceeds the exported maximum page size",
  });

  const conversation = timed(() => projectStrategicFitConversation(report, {
    view: "findings",
    ...identity,
    page: { limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum },
  }));
  operations.push({
    id: "conversation-projection",
    worst_ms: conversation.ms,
    detail: "the widest chat findings page",
  });
  bounds.push({
    id: "conversation-findings",
    actual: conversation.value.findings.length,
    limit: STRATEGIC_FIT_CONVERSATION_LIMITS.findings_page_maximum,
    unit: "findings",
    detail: "the chat projection stays inside its own exported page bound",
  });

  const rows = report.findings;
  let worstWindow = 0;
  let mounted = 0;
  for (let offset = 0; offset <= rows.length * 32; offset += 32 * 17) {
    const { ms, value } = timed(() => limits.virtualWindow(rows, {
      rowSize: 32,
      viewportSize: 640,
      scrollOffset: offset,
    }));
    worstWindow = Math.max(worstWindow, ms);
    mounted = Math.max(mounted, value.mounted);
  }
  operations.push({
    id: "virtual-window",
    worst_ms: worstWindow,
    detail: "one mounted window over the complete finding list",
  });
  bounds.push({
    id: "mounted-rows",
    actual: mounted,
    limit: limits.VISUALIZATION_RENDER_LIMITS.virtual_rows,
    unit: "rows",
    detail: "however long the list, a mounted window stays inside the exported row cap",
  });

  const grid = timed(() => limits.virtualWindow(report.cohorts, {
    rowSize: 28,
    viewportSize: 560,
    scrollOffset: 0,
    maximumMounted: limits.VISUALIZATION_RENDER_LIMITS.virtual_grid_rows,
  }));
  operations.push({
    id: "virtual-grid",
    worst_ms: grid.ms,
    detail: "one mounted heatmap row window",
  });
  bounds.push({
    id: "mounted-grid-cells",
    actual: grid.value.mounted * limits.VISUALIZATION_RENDER_LIMITS.virtual_columns,
    limit: limits.VISUALIZATION_RENDER_LIMITS.virtual_grid_rows *
      limits.VISUALIZATION_RENDER_LIMITS.virtual_columns,
    unit: "cells",
    detail: "mounted heatmap cells stay inside the exported row and column caps",
  });

  return {
    operations,
    bounds,
    conversation_bytes: JSON.stringify(conversation.value).length,
    pages,
  };
}

/**
 * The affected-cohort scope a host derives from its own semantic comparison. It bounds the reuse an
 * incremental run may claim; it can never decide a value, which is why the run is still checked
 * against a cold scan of the edited tree.
 */
function affectedCohortScope(previous, previousPgn, currentPgn, color) {
  const current = new Set(
    buildRepertoireGraph(GameTree.fromPgn(currentPgn), color).routes.map((route) => route.route_id),
  );
  const removed = buildRepertoireGraph(GameTree.fromPgn(previousPgn), color).routes
    .map((route) => route.route_id)
    .filter((routeId) => !current.has(routeId));
  const cohortIds = previous.cohorts
    .filter((cohort) => cohort.route_ids.some((routeId) => removed.includes(routeId)))
    .map((cohort) => cohort.cohort_id);
  return {
    kind: "affected-cohorts",
    cohort_ids: cohortIds,
    reason: "Routes the benchmark edit removed map to these prior cohorts.",
  };
}

async function measureScale(target, limits) {
  const fixture = generateStrategicFitBenchmarkRepertoire(target);
  const regenerated = generateStrategicFitBenchmarkRepertoire(target);
  const tree = GameTree.fromPgn(fixture.pgn);
  const baseOptions = analysisOptions(fixture, `benchmark:${target.id}:1`);

  const cold = timed(() => scan(tree, baseOptions));
  const coldDigest = reportDigest(cold.value);
  const instrumented = instrumentedScan(tree, baseOptions);
  const cancellation = measureCancellation(tree, baseOptions, instrumented.phases);

  const index = new StrategicFitIndexCache();
  const indexedDigest = reportDigest(scan(tree, { ...baseOptions, index }));
  const warm = timedScan(tree, { ...baseOptions, index });

  const edited = editStrategicFitBenchmarkRepertoire(target, fixture);
  const editedTree = GameTree.fromPgn(edited.pgn);
  const editedOptions = analysisOptions(fixture, `benchmark:${target.id}:2`);
  const editedColdDigest = reportDigest(scan(editedTree, editedOptions));
  const scope = affectedCohortScope(cold.value, fixture.pgn, edited.pgn, fixture.repertoire_color);
  const incremental = timedScan(editedTree, {
    ...editedOptions,
    index,
    recomputationScope: scope,
  });

  const graphRebuild = timed(() => buildRepertoireGraph(tree, fixture.repertoire_color));
  const mainThread = measureMainThread(cold.value, limits);

  return {
    id: target.id,
    fixture: {
      nodes: fixture.nodes,
      leaves: fixture.leaves,
      max_depth: fixture.max_depth,
      pgn_bytes: fixture.pgn.length,
      digest: fixture.digest,
      regenerated_digest: regenerated.digest,
      edited_digest: edited.digest,
    },
    findings: cold.value.findings.length,
    routes: cold.value.trajectories.length,
    cohorts: cold.value.cohorts.length,
    determinism: {
      indexed_matches_cold: indexedDigest === coldDigest,
      incremental_matches_cold: incremental.digest === editedColdDigest,
    },
    scan: {
      cold_ms: cold.ms,
      warm_ms: warm.ms,
      incremental_ms: incremental.ms,
      graph_rebuild_ms: graphRebuild.ms,
    },
    recomputation: {
      mode: index.lastPlan?.mode ?? null,
      scoped_cohort_ids: scope.cohort_ids.length,
      recomputed_cohort_ids: index.lastPlan?.recomputed_cohort_ids.length ?? null,
      reused_route_ids: index.lastPlan?.reused_route_ids.length ?? null,
    },
    cancellation,
    memory: {
      peak_heap_mb: instrumented.peak_heap_mb,
      conversation_bytes: mainThread.conversation_bytes,
    },
    main_thread: mainThread.operations.map((operation) => ({
      ...operation,
      worst_ms: Number(operation.worst_ms.toFixed(3)),
    })),
    bounds: [
      ...mainThread.bounds,
      {
        id: "index-entries",
        actual: index.stats.size,
        limit: index.maximumEntries,
        unit: "entries",
        detail: "the incremental index stays inside the bound it declares",
      },
    ],
  };
}

function environment() {
  const cores = cpus();
  return {
    node: process.versions.node,
    node_major: Number(process.versions.node.split(".")[0]),
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu_model: cores[0]?.model ?? "unknown",
    cpu_count: cores.length,
  };
}

async function readBaseline() {
  try {
    return JSON.parse(await readFile(BASELINE_URL, "utf8"));
  } catch {
    return null;
  }
}

async function main() {
  const selfCheck = runStrategicFitBenchmarkSelfCheck();
  if (!selfCheck.ok) {
    console.error(`benchmark self-check failed:\n  ${selfCheck.failures.join("\n  ")}`);
    process.exitCode = 1;
    return;
  }
  if (flag("self-check")) {
    console.log("benchmark self-check: ok");
    return;
  }

  const requested = option("scale");
  const selected = requested !== undefined
    ? [requested]
    : flag("all")
      ? STRATEGIC_FIT_BENCHMARK_SCALES.map((target) => target.id)
      : GATED_SCALES;
  const targets = selected.map((id) => {
    const target = STRATEGIC_FIT_BENCHMARK_SCALES.find((candidate) => candidate.id === id);
    if (target === undefined) throw new Error(`unknown scale: ${id}`);
    return target;
  });

  const limits = await visualizationLimits();
  const referenceScale = STRATEGIC_FIT_BENCHMARK_SCALES.find((target) => target.id === REFERENCE_SCALE);
  const referenceFixture = generateStrategicFitBenchmarkRepertoire(referenceScale);
  const referenceTree = GameTree.fromPgn(referenceFixture.pgn);
  const referenceOptions = analysisOptions(referenceFixture, "benchmark:reference");
  const referenceRuns = Array.from(
    { length: REFERENCE_RUNS },
    () => timed(() => scan(referenceTree, referenceOptions)).ms,
  );

  const scales = [];
  for (const target of targets) scales.push(await measureScale(target, limits));

  const record = {
    benchmark: "strategic-fit",
    format_version: STRATEGIC_FIT_BENCHMARK_FORMAT_VERSION,
    environment: environment(),
    manifest: JSON.parse(JSON.stringify(STRATEGIC_FIT_ANALYSIS_MANIFEST)),
    index: { default_maximum_entries: STRATEGIC_FIT_DEFAULT_INDEX_ENTRIES },
    reference: {
      scale: REFERENCE_SCALE,
      runs: referenceRuns.map((value) => Number(value.toFixed(3))),
    },
    reference_ms: median(referenceRuns),
    scales,
  };

  const baseline = await readBaseline();
  const evaluation = evaluateStrategicFitBenchmark(record, { baseline });

  if (flag("json")) console.log(JSON.stringify(record, null, 2));
  else console.log(formatStrategicFitBenchmark(record, evaluation));

  if (flag("record")) {
    if (!evaluation.ok) {
      console.error("refusing to record a baseline from a run that failed its budgets");
      process.exitCode = 1;
      return;
    }
    await writeFile(BASELINE_URL, `${JSON.stringify(record, null, 2)}\n`);
    console.log(`recorded baseline: scripts/strategic-fit-benchmark.baseline.json`);
  }

  if (!evaluation.ok) process.exitCode = 1;
}

await main();
