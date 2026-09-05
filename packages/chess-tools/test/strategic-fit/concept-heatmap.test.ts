import assert from "node:assert/strict";
import test from "node:test";

import {
  CONCEPT_HEATMAP_PROJECTION_VERSION,
  GameTree,
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  analyzeStrategicFit,
  buildConceptHeatmapProjection,
  type ConceptHeatmapProjection,
  type StrategicFitAnalysisResult,
  type StrategicFitTrainingMasteryReport,
  type StrategicFitTrainingMasteryStatistic,
} from "../../src/index.ts";
import { BROAD_ECO_FIXTURE, SHALLOW_LINES_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

const CONCEPT_RICH_PGN = `[Event "Heatmap: Queen's Gambit"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *

[Event "Heatmap: Ruy Lopez"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *

[Event "Heatmap: Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 *

[Event "Heatmap: French Advance"]
[Result "*"]

1. e4 e6 2. d4 d5 3. e5 c5 4. c3 Nc6 5. Nf3 Qb6 6. a3 Nh6 7. b4 *`;

function analyzeFixture(
  fixture: typeof BROAD_ECO_FIXTURE,
  revision = `revision:${fixture.id}`,
): StrategicFitAnalysisResult {
  return analyzeStrategicFit(parseStrategicFitFixture(fixture), {
    repertoireColor: fixture.repertoireColor,
    repertoireRevision: revision,
  });
}

function analyzeConceptRich(): StrategicFitAnalysisResult {
  return analyzeStrategicFit(GameTree.fromPgn(CONCEPT_RICH_PGN), {
    repertoireColor: "white",
    repertoireRevision: "revision:concept-rich",
  });
}

function masteryStatistic(
  conceptId: string,
  overrides: Partial<StrategicFitTrainingMasteryStatistic>,
): StrategicFitTrainingMasteryStatistic {
  return {
    identity_kind: "concept",
    identity_id: conceptId,
    target_ids: [`target:${conceptId}`],
    state: "observed",
    attempt_count: 4,
    successful_recall_count: 3,
    recall_rate: 0.75,
    average_response_time_ms: 4200,
    lapse_count: 1,
    lapse_rate: 0.25,
    average_confidence: null,
    first_attempt_at: "2026-07-01T00:00:00.000Z",
    last_attempt_at: "2026-07-20T00:00:00.000Z",
    next_due_at: null,
    mastery: 0.7,
    provenance: [],
    ...overrides,
  };
}

function masteryReport(
  statistics: readonly StrategicFitTrainingMasteryStatistic[],
): StrategicFitTrainingMasteryReport {
  return {
    training_performance_version: "1.0.0",
    document_id: "document:heatmap-test",
    generated_at: "2026-07-30T00:00:00.000Z",
    decision_mastery: [],
    concept_mastery: statistics,
    stale_target_ids: [],
    metric_evidence: { concept_mastery: [], provenance: [] },
    provenance: [],
  };
}

test("the heatmap projection is deterministic, versioned, and reconciles with report weights", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const first = buildConceptHeatmapProjection(report);
  const second = buildConceptHeatmapProjection(analyzeFixture(BROAD_ECO_FIXTURE));

  assert.equal(first.state, "available");
  assert.equal(first.projection_version, CONCEPT_HEATMAP_PROJECTION_VERSION);
  assert.equal(first.concepts_version, STRATEGIC_FIT_ANALYSIS_MANIFEST.components.concepts);
  assert.deepEqual({ ...first, report_id: null }, { ...second, report_id: null });
  assert.ok(first.rows.length > 0);
  assert.ok(first.columns.length > 0);
  assert.ok(first.cells.length > 0);

  const weightsByCohort = new Map(
    report.cohorts.map((cohort) => [
      cohort.cohort_id,
      new Map(cohort.route_weights.map((weight) => [weight.route_id, weight.normalized_weight])),
    ]),
  );
  for (const cell of first.cells) {
    const cohortWeights = weightsByCohort.get(cell.cohort_id)!;
    const expected = cell.route_ids.reduce(
      (sum, routeId) => sum + (cohortWeights.get(routeId) ?? 0),
      0,
    );
    assert.ok(Math.abs(cell.expected_frequency - Math.min(expected, 1)) < 1e-6);
    assert.ok(cell.expected_frequency >= 0 && cell.expected_frequency <= 1);
    assert.ok(cell.confidence >= 0 && cell.confidence <= 1);
    assert.ok(cell.route_ids.length > 0);
    assert.ok(first.rows.some((row) => row.cohort_id === cell.cohort_id));
    assert.ok(first.columns.some((column) => column.concept_id === cell.concept_id));
  }
  const cellKeys = first.cells.map((cell) => `${cell.cohort_id}|${cell.concept_id}`);
  assert.deepEqual(cellKeys, [...cellKeys].sort());
  for (const column of first.columns) {
    const conceptCells = first.cells.filter((cell) => cell.concept_id === column.concept_id);
    assert.equal(column.cohort_count, conceptCells.length);
    assert.equal(
      column.max_expected_frequency,
      conceptCells.reduce((maximum, cell) => Math.max(maximum, cell.expected_frequency), 0),
    );
    assert.ok(column.label.length > 0);
  }
});

test("mastery without training evidence is unavailable or untrained, never zero", () => {
  const report = analyzeConceptRich();

  const withoutEvidence = buildConceptHeatmapProjection(report);
  for (const column of withoutEvidence.columns) {
    assert.equal(column.mastery.state, "unavailable");
    assert.equal(column.mastery.value, null);
    assert.ok(column.mastery.reason !== null);
  }
  assert.ok(
    withoutEvidence.provenance.some(
      (source) => source.kind === "training-metadata" && source.state === "unavailable",
    ),
  );

  const emptyReport = buildConceptHeatmapProjection(report, { mastery: masteryReport([]) });
  for (const column of emptyReport.columns) {
    assert.equal(column.mastery.state, "untrained");
    assert.equal(column.mastery.value, null);
    assert.ok(column.mastery.reason !== null);
  }
});

test("observed, untrained, and stale mastery statistics map onto their concepts exactly", () => {
  const report = analyzeConceptRich();
  const base = buildConceptHeatmapProjection(report);
  assert.ok(base.columns.length >= 3, "fixture must observe at least three concepts");
  const [observed, untrained, stale] = base.columns.map((column) => column.concept_id);

  const projection = buildConceptHeatmapProjection(report, {
    mastery: masteryReport([
      masteryStatistic(observed!, { state: "observed", mastery: 0.7, attempt_count: 4 }),
      masteryStatistic(untrained!, {
        state: "untrained",
        mastery: null,
        attempt_count: 0,
        successful_recall_count: 0,
        recall_rate: null,
        lapse_count: 0,
        lapse_rate: null,
        first_attempt_at: null,
        last_attempt_at: null,
      }),
      masteryStatistic(stale!, { state: "stale", mastery: 0.4 }),
    ]),
  });
  const byConcept = new Map(projection.columns.map((column) => [column.concept_id, column]));
  assert.equal(byConcept.get(observed!)!.mastery.state, "observed");
  assert.equal(byConcept.get(observed!)!.mastery.value, 0.7);
  assert.equal(byConcept.get(observed!)!.mastery.attempt_count, 4);
  assert.equal(byConcept.get(untrained!)!.mastery.state, "untrained");
  assert.equal(byConcept.get(untrained!)!.mastery.value, null);
  assert.equal(byConcept.get(stale!)!.mastery.state, "stale");
  assert.equal(byConcept.get(stale!)!.mastery.value, 0.4);
  assert.ok(byConcept.get(stale!)!.mastery.reason !== null);
  assert.ok(
    projection.provenance.some(
      (source) => source.kind === "training-metadata" && source.state === "available",
    ),
  );
});

test("intentional status comes from the profile's declared concept preferences", () => {
  const report = analyzeConceptRich();
  const base = buildConceptHeatmapProjection(report);
  const [preferred, avoided] = base.columns.map((column) => column.concept_id);

  const projection = buildConceptHeatmapProjection({
    ...report,
    profile: {
      ...report.profile,
      preferences: {
        ...report.profile.preferences,
        preferred_concept_ids: [preferred!],
        avoided_concept_ids: [avoided!],
      },
    },
  });
  const byConcept = new Map(projection.columns.map((column) => [column.concept_id, column]));
  assert.equal(byConcept.get(preferred!)!.intent, "preferred");
  assert.equal(byConcept.get(avoided!)!.intent, "avoided");
  for (const column of projection.columns) {
    if (column.concept_id !== preferred && column.concept_id !== avoided) {
      assert.equal(column.intent, "not-declared");
    }
  }
  assert.deepEqual(
    projection.cells.map((cell) => [cell.cohort_id, cell.concept_id, cell.expected_frequency]),
    base.cells.map((cell) => [cell.cohort_id, cell.concept_id, cell.expected_frequency]),
  );
});

test("cells reference only findings on their supporting routes and follow provided findings", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const projection = buildConceptHeatmapProjection(report);
  const findingsByRoute = new Map<string, string[]>();
  for (const finding of report.findings) {
    for (const routeId of finding.references.route_ids) {
      findingsByRoute.set(routeId, [...(findingsByRoute.get(routeId) ?? []), finding.finding_id]);
    }
  }
  for (const cell of projection.cells) {
    const expected = [
      ...new Set(cell.route_ids.flatMap((routeId) => findingsByRoute.get(routeId) ?? [])),
    ].sort();
    assert.deepEqual([...cell.finding_ids], expected);
  }
  assert.ok(projection.cells.some((cell) => cell.finding_ids.length > 0));

  const replaced = buildConceptHeatmapProjection(report, { findings: [] });
  for (const cell of replaced.cells) assert.deepEqual([...cell.finding_ids], []);
  assert.deepEqual(
    replaced.cells.map((cell) => [cell.cohort_id, cell.concept_id, cell.expected_frequency]),
    projection.cells.map((cell) => [cell.cohort_id, cell.concept_id, cell.expected_frequency]),
  );
});

test("excluded cohorts and missing trajectories become structured exclusions, not cells", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const excludedCohortId = report.cohorts[0]!.cohort_id;
  const droppedRouteId = report.cohorts.at(-1)!.route_ids[0]!;
  const projection = buildConceptHeatmapProjection({
    ...report,
    cohorts: report.cohorts.map((cohort) =>
      cohort.cohort_id === excludedCohortId ? { ...cohort, state: "excluded" as const } : cohort,
    ),
    trajectories: report.trajectories.filter(
      (trajectory) => trajectory.route_id !== droppedRouteId,
    ),
  });

  assert.ok(!projection.rows.some((row) => row.cohort_id === excludedCohortId));
  assert.ok(!projection.cells.some((cell) => cell.cohort_id === excludedCohortId));
  assert.ok(!projection.cells.some((cell) => cell.route_ids.includes(droppedRouteId)));
  assert.ok(
    projection.exclusions.some(
      (exclusion) =>
        exclusion.cohort_id === excludedCohortId && exclusion.reason === "excluded-from-cohort",
    ),
  );
  assert.ok(
    projection.exclusions.some(
      (exclusion) =>
        exclusion.route_id === droppedRouteId && exclusion.reason === "missing-trajectory",
    ),
  );
  for (const exclusion of projection.exclusions) assert.ok(exclusion.explanation.length > 0);
});

test("empty and concept-free reports yield explicit unavailable projections with reasons", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const empty: ConceptHeatmapProjection = buildConceptHeatmapProjection({
    ...report,
    trajectories: [],
    cohorts: [],
    findings: [],
  });
  assert.equal(empty.state, "unavailable");
  assert.ok(empty.reason !== null);
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.columns.length, 0);
  assert.equal(empty.cells.length, 0);

  const shallow = buildConceptHeatmapProjection(analyzeFixture(SHALLOW_LINES_FIXTURE));
  if (shallow.state === "unavailable") {
    assert.ok(shallow.reason !== null);
    assert.equal(shallow.cells.length, 0);
  } else {
    assert.ok(shallow.columns.length > 0);
  }
});
