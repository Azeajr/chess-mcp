import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_PROGRESS_PHASES,
  STRATEGIC_FIT_SCHEMA_VERSION,
  StrategicFitAnalysisCancelledError,
  analyzeStrategicFit,
  type StrategicFitProgress,
} from "../../src/index.ts";
import {
  BLACK_REPERTOIRE_FIXTURE,
  BROAD_ECO_FIXTURE,
  SHALLOW_LINES_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

function analyzeBroad(options: Parameters<typeof analyzeStrategicFit>[1] = {
  repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
  repertoireRevision: "revision:broad",
}) {
  return analyzeStrategicFit(parseStrategicFitFixture(BROAD_ECO_FIXTURE), options);
}

test("one engine-free call composes a versioned, provenance-bearing V2 report", () => {
  let fetchCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    throw new Error("Strategic Fit core attempted network access");
  }) as typeof fetch;
  try {
    const report = analyzeBroad();

    assert.equal(report.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
    assert.equal(report.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
    assert.deepEqual(report.manifest, STRATEGIC_FIT_ANALYSIS_MANIFEST);
    assert.equal(report.repertoire_revision, "revision:broad");
    assert.equal(report.provenance.deterministic, true);
    assert.equal(report.trajectories.length, report.preflight.route_count);
    assert.equal(report.finding_page.total_count, report.summary.unresolved_finding_count);
    assert.ok(report.cohorts.length > 0);
    assert.ok(report.findings.length > 0);
    assert.ok(report.findings.every((finding) =>
      finding.objective_quality.state === "unavailable" &&
      finding.objective_quality.provenance[0]?.kind === "engine"
    ));
    assert.doesNotMatch(JSON.stringify(report), /consistent/i);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("progress traverses the six frozen phases monotonically", () => {
  const events: StrategicFitProgress[] = [];
  analyzeBroad({
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: "revision:progress",
    runId: "run:progress-test",
    onProgress: (event) => events.push(event),
  });

  assert.equal(events.length, STRATEGIC_FIT_PROGRESS_PHASES.length * 2);
  assert.deepEqual(
    events.filter((event) => event.state === "running").map((event) => event.phase),
    STRATEGIC_FIT_PROGRESS_PHASES,
  );
  assert.deepEqual(
    events.map((event) => [event.phase_index, event.state, event.completed_units]),
    STRATEGIC_FIT_PROGRESS_PHASES.flatMap((_, phaseIndex) => [
      [phaseIndex, "running", 0],
      [phaseIndex, "completed", 1],
    ]),
  );
  assert.ok(events.every((event) => event.run_id === "run:progress-test" && event.phase_count === 6));
  assert.ok(events.slice(0, -1).every((event) => event.provisional_findings));
  assert.equal(events.at(-1)?.provisional_findings, false);
});

test("cancellation is cooperative at deterministic phase boundaries", () => {
  const events: StrategicFitProgress[] = [];
  let cancelled = false;

  assert.throws(
    () => analyzeBroad({
      repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
      repertoireRevision: "revision:cancel",
      runId: "run:cancel-test",
      shouldCancel: () => cancelled,
      onProgress: (event) => {
        events.push(event);
        if (event.phase_index === 2 && event.state === "running") cancelled = true;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof StrategicFitAnalysisCancelledError);
      assert.equal(error.code, "strategic_fit_analysis_cancelled");
      assert.equal(error.run_id, "run:cancel-test");
      assert.equal(error.phase, "extracting-strategic-patterns");
      assert.equal(error.phase_index, 2);
      return true;
    },
  );
  assert.deepEqual(events.at(-1), {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    run_id: "run:cancel-test",
    phase: "extracting-strategic-patterns",
    phase_index: 2,
    phase_count: 6,
    state: "cancelled",
    completed_units: 0,
    total_units: 1,
    provisional_findings: true,
    message: "Extracting strategic patterns cancelled",
  });
  assert.ok(events.every((event) => event.phase_index <= 2));
});

test("deterministic reruns preserve report, finding, and run identities", () => {
  const options = {
    repertoireColor: WHITE_TRANSPOSITION_FIXTURE.repertoireColor,
    repertoireRevision: "revision:deterministic",
    generatedAt: "2026-07-17T12:00:00.000Z",
  } as const;
  const firstProgress: StrategicFitProgress[] = [];
  const secondProgress: StrategicFitProgress[] = [];
  const first = analyzeStrategicFit(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), {
    ...options,
    onProgress: (event) => firstProgress.push(event),
  });
  const second = analyzeStrategicFit(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), {
    ...options,
    onProgress: (event) => secondProgress.push(event),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(firstProgress, secondProgress);
  assert.ok(first.findings.some((finding) => finding.classification === "transpositional-equivalence"));
});

test("paging slices stable sorted findings without changing logical totals", () => {
  const full = analyzeBroad();
  const page = analyzeBroad({
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: "revision:broad",
    page: { offset: 1, limit: 2 },
  });
  const beyond = analyzeBroad({
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: "revision:broad",
    page: { offset: full.finding_page.total_count + 5, limit: 2 },
  });

  assert.ok(full.finding_page.total_count > 2);
  assert.equal(page.report_id, full.report_id);
  assert.equal(page.finding_page.total_count, full.finding_page.total_count);
  assert.equal(page.summary.unresolved_finding_count, full.summary.unresolved_finding_count);
  assert.deepEqual(page.findings, full.findings.slice(1, 3));
  assert.deepEqual(page.finding_page, {
    offset: 1,
    limit: 2,
    total_count: full.finding_page.total_count,
    returned_count: 2,
    has_more: 3 < full.finding_page.total_count,
  });
  assert.equal(beyond.findings.length, 0);
  assert.equal(beyond.finding_page.returned_count, 0);
  assert.equal(beyond.finding_page.has_more, false);
  assert.equal(beyond.finding_page.total_count, full.finding_page.total_count);
});

test("empty blocking input returns an explicit report without starting dependent phases", () => {
  const events: StrategicFitProgress[] = [];
  const report = analyzeStrategicFit(new GameTree(), {
    repertoireColor: "white",
    repertoireRevision: "revision:empty",
    onProgress: (event) => events.push(event),
  });

  assert.equal(report.preflight.state, "blocked");
  assert.deepEqual(report.preflight.issues.map((issue) => issue.code), [
    "empty-repertoire",
    "missing-opening-classification",
  ]);
  assert.deepEqual(report.trajectories, []);
  assert.deepEqual(report.cohorts, []);
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.workload, "unavailable");
  assert.equal(report.summary.metrics.strategic_entropy.state, "unavailable");
  assert.equal(report.summary.metrics.strategic_entropy.value, null);
  assert.equal(report.finding_page.total_count, 0);
  assert.deepEqual(events.map((event) => [event.phase_index, event.state]), [
    [0, "running"],
    [0, "completed"],
  ]);
  assert.doesNotMatch(JSON.stringify(report), /consistent/i);
});

test("distinct blocked reports cannot collide when a revision label is reused", () => {
  const empty = new GameTree();
  const malformed = GameTree.fromPgn("1. e4 e5 *");
  (malformed.game.moves.children[0]!.data as { san: unknown }).san = 42;
  const options = {
    repertoireColor: "white" as const,
    repertoireRevision: "revision:reused-blocked",
  };

  const emptyReport = analyzeStrategicFit(empty, options);
  const malformedReport = analyzeStrategicFit(malformed, options);
  assert.equal(emptyReport.preflight.state, "blocked");
  assert.equal(malformedReport.preflight.state, "blocked");
  assert.notDeepEqual(emptyReport.preflight, malformedReport.preflight);
  assert.notEqual(emptyReport.report_id, malformedReport.report_id);
  assert.equal(analyzeStrategicFit(empty, options).report_id, emptyReport.report_id);
  assert.equal(analyzeStrategicFit(malformed, options).report_id, malformedReport.report_id);
});

test("malformed trees remain structured blocking reports at the composition boundary", () => {
  const tree = GameTree.fromPgn("1. e4 e5 *");
  (tree.game.moves.children[0]!.data as { san: unknown }).san = 42;

  const report = analyzeStrategicFit(tree, {
    repertoireColor: "white",
    repertoireRevision: "revision:malformed",
  });

  assert.equal(report.preflight.state, "blocked");
  assert.ok(report.preflight.issues.some((issue) => issue.code === "malformed-data"));
  assert.deepEqual(report.findings, []);
  assert.equal(report.summary.workload, "unavailable");
});

test("degraded shallow evidence remains uncertain instead of becoming a defect", () => {
  const report = analyzeStrategicFit(parseStrategicFitFixture(SHALLOW_LINES_FIXTURE), {
    repertoireColor: SHALLOW_LINES_FIXTURE.repertoireColor,
    repertoireRevision: "revision:shallow",
  });

  assert.equal(report.preflight.state, "degraded");
  assert.equal(report.preflight.comparable_route_count, 0);
  assert.equal(report.summary.insufficient_evidence_branch_count, SHALLOW_LINES_FIXTURE.expected.leaves);
  assert.ok(report.findings.length > 0);
  assert.ok(report.findings.every((finding) =>
    finding.classification === "uncertain" &&
    finding.replacement_priority.label === "insufficient-evidence" &&
    finding.confidence.label === "low"
  ));
});

test("independent analyses do not leak global mutable state", () => {
  const broadOptions = {
    repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
    repertoireRevision: "revision:state-a",
  } as const;
  const before = analyzeStrategicFit(parseStrategicFitFixture(BROAD_ECO_FIXTURE), broadOptions);
  const black = analyzeStrategicFit(parseStrategicFitFixture(BLACK_REPERTOIRE_FIXTURE), {
    repertoireColor: BLACK_REPERTOIRE_FIXTURE.repertoireColor,
    repertoireRevision: "revision:state-b",
    sort: "opening-scope",
    page: { offset: 0, limit: 1 },
  });
  const after = analyzeStrategicFit(parseStrategicFitFixture(BROAD_ECO_FIXTURE), broadOptions);

  assert.equal(black.profile.mode, "balanced");
  assert.equal(black.trajectories.length, BLACK_REPERTOIRE_FIXTURE.expected.leaves);
  assert.deepEqual(after, before);
});

test("invalid paging and stale route assessment inputs fail explicitly", () => {
  assert.throws(
    () => analyzeBroad({
      repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
      repertoireRevision: "revision:bad-page",
      page: { offset: -1, limit: 2 },
    }),
    /strategic_fit_analyze_invalid_page_offset/,
  );
  assert.throws(
    () => analyzeBroad({
      repertoireColor: BROAD_ECO_FIXTURE.repertoireColor,
      repertoireRevision: "revision:bad-route",
      routeAssessments: [{ route_id: "route:missing", resolution_state: "keep-intentionally" }],
    }),
    /strategic_fit_analyze_unknown_assessment_route/,
  );
});
