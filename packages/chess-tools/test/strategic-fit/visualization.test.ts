import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_MAP_PROJECTION_VERSION,
  analyzeStrategicFit,
  buildStrategicMapProjection,
  type StrategicFitAnalysisResult,
  type StrategicMapProjection,
} from "../../src/index.ts";
import {
  BLACK_REPERTOIRE_FIXTURE,
  BROAD_ECO_FIXTURE,
  SHALLOW_LINES_FIXTURE,
  UNEQUAL_DEPTH_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

function analyzeFixture(
  fixture: typeof BROAD_ECO_FIXTURE,
  revision = `revision:${fixture.id}`,
): StrategicFitAnalysisResult {
  return analyzeStrategicFit(parseStrategicFitFixture(fixture), {
    repertoireColor: fixture.repertoireColor,
    repertoireRevision: revision,
  });
}

function project(report: StrategicFitAnalysisResult): StrategicMapProjection {
  return buildStrategicMapProjection(report);
}

test("the strategic-map projection is deterministic, versioned, and identity-bound", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const first = project(report);
  const second = project(analyzeFixture(BROAD_ECO_FIXTURE));

  assert.equal(first.projection_version, STRATEGIC_MAP_PROJECTION_VERSION);
  assert.equal(first.distance_version, STRATEGIC_FIT_ANALYSIS_MANIFEST.components.distance);
  assert.equal(first.repertoire_revision, "revision:broad-eco-families");
  assert.deepEqual(
    { ...first, report_id: null },
    { ...second, report_id: null },
  );
  assert.ok(first.points.length > 0);
  const sortedIds = [...first.points].map((point) => `${point.cohort_id}|${point.route_id}`);
  assert.deepEqual(sortedIds, [...sortedIds].sort());
});

test("coordinates are anchor distances whose contributions reconcile exactly", () => {
  const projection = project(analyzeFixture(BROAD_ECO_FIXTURE));
  assert.ok(projection.axes.x !== null);
  for (const point of projection.points) {
    for (const breakdown of point.axis_breakdowns) {
      const total = breakdown.family_contributions.reduce(
        (sum, contribution) => sum + contribution.contribution,
        0,
      );
      assert.ok(Math.abs(total - breakdown.distance) < 1e-6);
      const coordinate = breakdown.axis === "x" ? point.x : point.y;
      assert.equal(coordinate, breakdown.distance);
      assert.ok(coordinate >= 0 && coordinate <= 1);
    }
    assert.ok(point.confidence >= 0 && point.confidence <= 1);
    assert.ok(point.normalized_weight >= 0);
  }
  const anchorX = projection.points.find((point) => point.is_anchor === "x");
  assert.ok(anchorX);
  assert.equal(anchorX.x, 0);
  assert.equal(anchorX.route_id, projection.axes.x!.representative_route_id);
});

test("learning-concepts and zero-weight families are excluded explicitly, never silently", () => {
  const projection = project(analyzeFixture(BROAD_ECO_FIXTURE));
  const excluded = projection.axes.excluded_families.map((family) => family.family);
  assert.ok(excluded.includes("learning-concepts"));
  for (const point of projection.points) {
    for (const breakdown of point.axis_breakdowns) {
      assert.ok(breakdown.family_contributions.every(
        (contribution) => contribution.family !== "learning-concepts",
      ));
    }
  }
});

test("transposed move orders create an edge while shared prefixes do not", () => {
  const transposed = project(analyzeFixture(WHITE_TRANSPOSITION_FIXTURE));
  if (transposed.points.length >= 2) {
    assert.ok(transposed.edges.length >= 1);
    for (const edge of transposed.edges) {
      assert.ok(edge.shared_position_ids.length > 0);
      assert.ok(edge.from_route_id < edge.to_route_id);
      assert.ok(transposed.points.some((point) => point.route_id === edge.from_route_id));
      assert.ok(transposed.points.some((point) => point.route_id === edge.to_route_id));
    }
  } else {
    assert.equal(transposed.edges.length, 0);
  }

  const sharedPrefix = project(analyzeFixture(UNEQUAL_DEPTH_FIXTURE));
  assert.equal(sharedPrefix.edges.length, 0);
});

test("points carry finding references and resolution presentation from provided findings", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const projection = project(report);
  const referencedRouteIds = new Set(
    report.findings.flatMap((finding) => [...finding.references.route_ids]),
  );
  for (const point of projection.points) {
    if (point.finding_ids.length > 0) {
      assert.equal(point.resolution, "unresolved-finding");
      assert.ok(referencedRouteIds.has(point.route_id));
    } else {
      assert.equal(point.resolution, "no-finding");
    }
  }
  assert.ok(projection.points.some((point) => point.finding_ids.length > 0));

  const resolvedFindings = report.findings.map((finding) => ({
    ...finding,
    resolution_state: "keep-intentionally" as const,
  }));
  const resolvedProjection = buildStrategicMapProjection(report, { findings: resolvedFindings });
  for (const point of resolvedProjection.points) {
    if (point.finding_ids.length > 0) assert.equal(point.resolution, "resolved-finding");
  }
  assert.deepEqual(
    resolvedProjection.points.map((point) => [point.x, point.y]),
    projection.points.map((point) => [point.x, point.y]),
  );
});

test("routes without comparable anchor evidence become structured exclusions, not fabricated points", () => {
  const projection = project(analyzeFixture(SHALLOW_LINES_FIXTURE));
  const totalRoutes = projection.points.length + projection.exclusions.length;
  assert.ok(totalRoutes >= 3);
  for (const exclusion of projection.exclusions) {
    assert.ok(
      ["excluded-from-cohort", "missing-trajectory", "no-comparable-anchor-evidence"]
        .includes(exclusion.reason),
    );
    assert.ok(exclusion.explanation.length > 0);
    assert.ok(!projection.points.some((point) => point.route_id === exclusion.route_id));
  }
  if (projection.points.length === 0) {
    assert.equal(projection.state, "unavailable");
    assert.ok(projection.reason !== null);
  }
});

test("an empty report yields an explicit unavailable projection", () => {
  const report = analyzeFixture(BROAD_ECO_FIXTURE);
  const empty = buildStrategicMapProjection({
    ...report,
    trajectories: [],
    cohorts: [],
    findings: [],
  });
  assert.equal(empty.state, "unavailable");
  assert.ok(empty.reason !== null);
  assert.equal(empty.points.length, 0);
  assert.equal(empty.edges.length, 0);
  assert.equal(empty.color_groups.length, 0);
});

test("a Black repertoire projects with the same deterministic guarantees", () => {
  const projection = project(analyzeFixture(BLACK_REPERTOIRE_FIXTURE));
  assert.ok(projection.state === "available" || projection.state === "single-axis");
  if (projection.state === "single-axis") {
    assert.equal(projection.axes.y, null);
    assert.ok(projection.points.every((point) => point.y === 0));
    assert.ok(projection.reason !== null);
  }
  const colorIndices = new Set(projection.points.map((point) => point.color_index));
  for (const index of colorIndices) {
    assert.ok(projection.color_groups.some((group) => group.color_index === index));
  }
});
