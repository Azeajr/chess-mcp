import assert from "node:assert/strict";
import test from "node:test";

import {
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  calculateEffectiveSampleSize,
  detectStrategicModes,
  type StrategicCohortReport,
  type StrategicFitSourceProvenance,
  type StrategicRouteWeightingReport,
  type StrategicTrajectoryReport,
} from "../../src/index.ts";

interface RouteFixture {
  readonly routeId: string;
  readonly profile: string | readonly string[];
  readonly weight: number;
  readonly weightingUnitId?: string;
}

const SOURCE: StrategicFitSourceProvenance = {
  source_id: "test:modes",
  kind: "deterministic-core",
  state: "available",
  version: "test",
  snapshot: null,
  reason: null,
};

function modeFixture(routes: readonly RouteFixture[]) {
  const totalWeight = routes.reduce((sum, route) => sum + route.weight, 0);
  const normalized = routes.map((route) => ({
    ...route,
    weight: route.weight / totalWeight,
    weightingUnitId: route.weightingUnitId ?? `unit:${route.routeId}`,
  }));
  const unitWeights = new Map<string, number>();
  for (const route of normalized) {
    unitWeights.set(route.weightingUnitId, (unitWeights.get(route.weightingUnitId) ?? 0) + route.weight);
  }
  const effectiveSampleSize = calculateEffectiveSampleSize([...unitWeights.values()]);
  const trajectories: StrategicTrajectoryReport = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    graph_id: "graph:modes",
    configured_plies: [12],
    trajectories: normalized.map((route) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      trajectory_id: `trajectory:${route.routeId}`,
      route_id: route.routeId,
      state: "complete",
      snapshots: [{
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        snapshot_id: `snapshot:${route.routeId}`,
        route_id: route.routeId,
        position_id: `position:${route.routeId}`,
        fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
        checkpoint: {
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          checkpoint_id: `checkpoint:${route.routeId}:12`,
          kind: "configured-ply",
          ply: 12,
          reason: "Matched test checkpoint",
          comparability: "comparable",
        },
        signals: (Array.isArray(route.profile) ? route.profile : [route.profile]).map((value, index) => ({
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          signal_id: `signal:${route.routeId}:${index}`,
          family: "center-dynamics" as const,
          feature_id: `center-dynamics.feature-${index}`,
          kind: "observation" as const,
          value,
          confidence: 1,
          persistence: "stable" as const,
          provenance: [SOURCE],
        })),
        classifier_confidence: 1,
        provenance: [SOURCE],
      }],
      missing_checkpoints: [],
      evidence_coverage: 1,
      stable_signal_ids: (Array.isArray(route.profile) ? route.profile : [route.profile]).map(
        (_, index) => `signal:${route.routeId}:${index}`,
      ),
      transient_signal_ids: [],
      provenance: [SOURCE],
    })),
    provenance: [SOURCE],
  };
  const weights: StrategicRouteWeightingReport = {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    weighting_version: "1.0.0",
    graph_id: "graph:modes",
    requested_mode: "equal",
    state: "complete",
    routes: normalized.map((route) => ({
      route_id: route.routeId,
      terminal_position_id: `position:${route.routeId}`,
      weighting_unit_id: route.weightingUnitId,
      opponent_probability: 1,
      route_factor: route.weight,
      normalized_weight: route.weight,
      resolution: "equal",
      provenance: [SOURCE],
    })),
    opponent_decisions: [],
    weighting_units: [...unitWeights.entries()].map(([unitId, weight]) => ({
      weighting_unit_id: unitId,
      terminal_position_id: `position:${unitId}`,
      route_ids: normalized.filter((route) => route.weightingUnitId === unitId).map((route) => route.routeId),
      normalized_weight: weight,
    })),
    effective_sample_size: effectiveSampleSize,
    fallbacks: [],
    provenance: [SOURCE],
  };
  const cohortId = "cohort:modes";
  const cohorts: StrategicCohortReport = {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_version: "1.0.0",
    graph_id: "graph:modes",
    taxonomy_version: "1.0.0",
    weighting_version: "1.0.0",
    containers: [{
      container_id: "opening-container:test",
      taxonomy_id: "opening:test",
      taxonomy_level: "family",
      label: "Test opening",
      route_ids: normalized.map((route) => route.routeId),
      included_route_ids: normalized.map((route) => route.routeId),
      excluded_route_ids: [],
      cohort_ids: [cohortId],
    }],
    cohorts: [{
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      cohort_id: cohortId,
      state: "actionable",
      opening_scope_ids: ["opening:test"],
      decision_scope_ids: ["decision:test"],
      route_ids: normalized.map((route) => route.routeId),
      excluded_route_ids: [],
      route_weights: normalized.map((route) => ({
        route_id: route.routeId,
        normalized_weight: route.weight,
      })),
      effective_sample_size: effectiveSampleSize,
      modes: [],
      override_ids: [],
      provenance: [SOURCE],
      opening_container_ids: ["opening-container:test"],
      shared_strategic_ancestor_position_ids: ["position:ancestor"],
      transposition_position_ids: [],
      comparable_checkpoint_kinds: ["configured-ply"],
      common_stable_signal_families: ["center-dynamics"],
      insufficiency_reasons: [],
    }],
    data_quality: {
      total_route_count: normalized.length,
      included_route_count: normalized.length,
      excluded_route_count: 0,
      complete_trajectory_route_count: normalized.length,
      incomplete_trajectory_route_count: 0,
      insufficient_evidence_route_count: 0,
    },
    applied_override_ids: [],
    provenance: [SOURCE],
  };
  return { cohorts, trajectories, weights, cohortId };
}

function routes(count: number, profile: string, start = 0): RouteFixture[] {
  return Array.from({ length: count }, (_, index) => ({
    routeId: `route:${String(start + index).padStart(2, "0")}`,
    profile,
    weight: 1,
  }));
}

test("a two-route 50/50 tie is a mixed profile, never an arbitrary outlier", () => {
  const fixture = modeFixture([
    { routeId: "route:open", profile: "open", weight: 1 },
    { routeId: "route:closed", profile: "closed", weight: 1 },
  ]);
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights);

  assert.equal(report.cohorts[0]!.state, "mixed-profile");
  assert.equal(report.selections[0]!.state, "mixed-profile");
  assert.equal(report.cohorts[0]!.modes.length, 2);
  assert.deepEqual(
    report.cohorts[0]!.modes.map((mode) => mode.normalized_weight),
    [0.5, 0.5],
  );
  assert.equal(
    report.cohorts[0]!.modes.every((mode) => report.cohorts[0]!.route_ids.includes(mode.representative_route_id)),
    true,
  );
});

test("a 2-1 small sample rejects unstable majority dominance", () => {
  const fixture = modeFixture([
    ...routes(2, "open"),
    { routeId: "route:02", profile: "closed", weight: 1 },
  ]);
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights);

  assert.equal(report.cohorts[0]!.effective_sample_size, 3);
  assert.equal(report.selections[0]!.state, "mixed-profile");
  assert.equal(report.cohorts[0]!.modes.length, 2);
  assert.deepEqual(
    report.cohorts[0]!.modes.map((mode) => mode.normalized_weight),
    [0.666667, 0.333333],
  );
});

test("the minimum effective sample prevents a small homogeneous cohort from claiming a mode", () => {
  const fixture = modeFixture(routes(3, "open"));
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights);

  assert.equal(report.selections[0]!.state, "insufficient-evidence");
  assert.deepEqual(report.selections[0]!.reasons, ["minimum-effective-sample-not-met"]);
  assert.equal(report.cohorts[0]!.state, "insufficient-evidence");
  assert.deepEqual(report.cohorts[0]!.modes, []);
  assert.equal(report.selections[0]!.candidates[0]!.representative_route_id, "route:00");
});

test("a clear 90/10 distribution selects one weighted real-route medoid", () => {
  const fixture = modeFixture([
    ...routes(9, "open"),
    { routeId: "route:09", profile: "closed", weight: 1 },
  ]);
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights);
  const mode = report.cohorts[0]!.modes[0]!;

  assert.equal(report.selections[0]!.state, "single-mode");
  assert.equal(report.cohorts[0]!.state, "actionable");
  assert.equal(report.cohorts[0]!.modes.length, 1);
  assert.equal(mode.normalized_weight, 0.9);
  assert.equal(mode.supporting_route_ids.length, 9);
  assert.equal(mode.representative_route_id, "route:00");
  assert.equal(mode.source, "inferred-medoid");
  assert.deepEqual(report.selections[0]!.unassigned_route_ids, ["route:09"]);
});

test("the weighted medoid minimizes explainable distance instead of selecting the first route", () => {
  const left = ["different", "same", "same", "same", "same", "same", "same", "same"];
  const center = ["same", "same", "same", "same", "same", "same", "same", "same"];
  const right = ["same", "different", "same", "same", "same", "same", "same", "same"];
  const fixture = modeFixture([
    ...Array.from({ length: 4 }, (_, index) => ({
      routeId: `route:left-${index}`,
      profile: left,
      weight: 1,
    })),
    { routeId: "route:weighted-medoid", profile: center, weight: 1 },
    ...Array.from({ length: 4 }, (_, index) => ({
      routeId: `route:right-${index}`,
      profile: right,
      weight: 1,
    })),
  ]);
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights);

  assert.equal(report.selections[0]!.state, "single-mode");
  assert.equal(report.cohorts[0]!.modes[0]!.representative_route_id, "route:weighted-medoid");
  assert.equal(report.selections[0]!.candidates[0]!.weighted_distance, 0.111111);
});

test("two meaningfully weighted strategic modes are both preserved", () => {
  const fixture = modeFixture([
    ...routes(6, "open"),
    ...routes(4, "closed", 6),
  ]);
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights);

  assert.equal(report.cohorts[0]!.state, "mixed-profile");
  assert.equal(report.cohorts[0]!.modes.length, 2);
  assert.deepEqual(
    report.cohorts[0]!.modes.map((mode) => mode.normalized_weight),
    [0.6, 0.4],
  );
  assert.deepEqual(report.selections[0]!.unassigned_route_ids, []);
});

test("explicit profile intent overrides an inferred 90/10 medoid", () => {
  const fixture = modeFixture([
    ...routes(9, "open"),
    { routeId: "route:09", profile: "closed", weight: 1 },
  ]);
  const explicitSource: StrategicFitSourceProvenance = {
    ...SOURCE,
    source_id: "profile:confirmed",
    kind: "user-profile",
  };
  const report = detectStrategicModes(fixture.cohorts, fixture.trajectories, fixture.weights, {
    explicit_targets: [{
      target_id: "target:closed",
      cohort_id: fixture.cohortId,
      representative_route_id: "route:09",
      concept_ids: ["setup-family.closed-center"],
      provenance: [explicitSource],
    }],
  });
  const mode = report.cohorts[0]!.modes[0]!;

  assert.equal(report.selections[0]!.state, "explicit-target");
  assert.equal(report.cohorts[0]!.modes.length, 1);
  assert.equal(mode.representative_route_id, "route:09");
  assert.equal(mode.source, "explicit-target");
  assert.deepEqual(mode.concept_ids, ["setup-family.closed-center"]);
  assert.equal(mode.provenance.some((source) => source.source_id === "profile:confirmed"), true);
});

test("route and PGN child reordering cannot change selected modes", () => {
  const ordered = modeFixture([
    ...routes(9, "open"),
    { routeId: "route:09", profile: "closed", weight: 1 },
  ]);
  const reversedRoutes = [...ordered.cohorts.cohorts[0]!.route_ids].reverse();
  const reversed = {
    cohorts: {
      ...ordered.cohorts,
      cohorts: [{
        ...ordered.cohorts.cohorts[0]!,
        route_ids: reversedRoutes,
        route_weights: [...ordered.cohorts.cohorts[0]!.route_weights].reverse(),
      }],
    },
    trajectories: {
      ...ordered.trajectories,
      trajectories: [...ordered.trajectories.trajectories].reverse(),
    },
    weights: {
      ...ordered.weights,
      routes: [...ordered.weights.routes].reverse(),
      weighting_units: [...ordered.weights.weighting_units].reverse(),
    },
  };
  const first = detectStrategicModes(ordered.cohorts, ordered.trajectories, ordered.weights);
  const second = detectStrategicModes(reversed.cohorts, reversed.trajectories, reversed.weights);

  assert.deepEqual(second.cohorts[0]!.modes, first.cohorts[0]!.modes);
  assert.deepEqual(second.selections[0], first.selections[0]);
});
