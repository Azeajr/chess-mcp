import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  buildStrategicConceptDictionary,
  buildStrategicTrajectories,
  calculateStrategicDistances,
  computeStrategicTrajectoryDistance,
  type JsonValue,
  type StrategicConcept,
  type StrategicModeReport,
  type StrategicRouteConcepts,
  type StrategicSignal,
  type StrategicSignalFamily,
  type StrategicTrajectory,
  type StrategicTrajectoryReport,
} from "../../src/index.ts";

const SOURCE = {
  source_id: "test:distance",
  kind: "deterministic-core" as const,
  state: "available" as const,
  version: "test",
  snapshot: null,
  reason: null,
};

interface SignalFixture {
  readonly family: StrategicSignalFamily;
  readonly featureId: string;
  readonly value: JsonValue;
}

interface CheckpointFixture {
  readonly ply: number;
  readonly signals: readonly SignalFixture[];
}

function trajectory(routeId: string, checkpoints: readonly CheckpointFixture[]): StrategicTrajectory {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    trajectory_id: `trajectory:${routeId}`,
    route_id: routeId,
    state: "complete",
    snapshots: checkpoints.map((checkpoint) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      snapshot_id: `snapshot:${routeId}:${checkpoint.ply}`,
      route_id: routeId,
      position_id: `position:${routeId}:${checkpoint.ply}`,
      fen: "8/8/8/8/8/8/8/K6k w - - 0 1",
      checkpoint: {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        checkpoint_id: `checkpoint:${routeId}:${checkpoint.ply}`,
        kind: "configured-ply",
        ply: checkpoint.ply,
        reason: `Matched test checkpoint at ply ${checkpoint.ply}.`,
        comparability: "comparable",
      },
      signals: checkpoint.signals.map((fixture, index): StrategicSignal => ({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        signal_id: `signal:${routeId}:${checkpoint.ply}:${index}`,
        family: fixture.family,
        feature_id: fixture.featureId,
        kind: "observation",
        value: fixture.value,
        confidence: 1,
        persistence: "stable",
        provenance: [SOURCE],
      })),
      classifier_confidence: 1,
      provenance: [SOURCE],
    })),
    missing_checkpoints: [],
    evidence_coverage: 1,
    stable_signal_ids: checkpoints.flatMap((checkpoint) =>
      checkpoint.signals.map((_, index) => `signal:${routeId}:${checkpoint.ply}:${index}`)
    ),
    transient_signal_ids: [],
    provenance: [SOURCE],
  };
}

function concept(
  conceptId: string,
  routeId: string,
  category: StrategicConcept["category"] = "plan",
): StrategicConcept {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: "1.0.0",
    concept_id: conceptId,
    category,
    rule_id: "observed-pawn-expansion",
    confidence: 1,
    persistence: "stable",
    first_observed_ply: 12,
    evidence: [{
      signal_id: `signal:${routeId}:concept`,
      feature_id: "space.wing-expansion",
      snapshot_id: `snapshot:${routeId}:12`,
      position_id: `position:${routeId}:12`,
      ply: 12,
      persistence: "stable",
    }],
    provenance: [SOURCE],
  };
}

function routeConcepts(
  value: StrategicTrajectory,
  concepts: readonly StrategicConcept[] = [],
): StrategicRouteConcepts {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: "1.0.0",
    trajectory_id: value.trajectory_id,
    route_id: value.route_id,
    concepts,
    provenance: [SOURCE],
  };
}

function compare(
  left: StrategicTrajectory,
  right: StrategicTrajectory,
  options: Parameters<typeof computeStrategicTrajectoryDistance>[4] = {},
  leftConcepts: readonly StrategicConcept[] = [],
  rightConcepts: readonly StrategicConcept[] = [],
) {
  return computeStrategicTrajectoryDistance(
    left,
    right,
    routeConcepts(left, leftConcepts),
    routeConcepts(right, rightConcepts),
    options,
  );
}

test("identical and transposed routes have bounded symmetric zero distance", () => {
  const pgn = `[Event "Move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *

[Event "Move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *`;
  const trajectories = buildStrategicTrajectories(
    buildRepertoireGraph(GameTree.fromPgn(pgn), "white"),
    { configuredPlies: [7, 9, 11, 13, 15, 17] },
  );
  const concepts = buildStrategicConceptDictionary(trajectories);
  const forward = computeStrategicTrajectoryDistance(
    trajectories.trajectories[0]!,
    trajectories.trajectories[1]!,
    concepts.routes[0]!,
    concepts.routes[1]!,
  );
  const reverse = computeStrategicTrajectoryDistance(
    trajectories.trajectories[1]!,
    trajectories.trajectories[0]!,
    concepts.routes[1]!,
    concepts.routes[0]!,
  );

  assert.equal(forward.state, "available");
  assert.equal(forward.distance, 0);
  assert.equal(reverse.distance, forward.distance);
  assert.ok(forward.feature_contributions.length > 0);
  assert.ok(forward.feature_contributions.every((item) => item.distance >= 0 && item.distance <= 1));
});

test("a single-family difference remains normalized and explainable", () => {
  const left = trajectory("route:left", [{
    ply: 12,
    signals: [{
      family: "center-dynamics",
      featureId: "center-dynamics.openness",
      value: "open",
    }],
  }]);
  const right = trajectory("route:right", [{
    ply: 12,
    signals: [{
      family: "center-dynamics",
      featureId: "center-dynamics.openness",
      value: "closed",
    }],
  }]);
  const result = compare(left, right);

  assert.equal(result.distance, 1);
  assert.deepEqual(result.family_contributions, [{
    family: "center-dynamics",
    distance: 1,
    feature_count: 1,
    configured_weight: 1,
    normalized_weight: 1,
    contribution: 1,
  }]);
  assert.deepEqual(result.feature_contributions[0], {
    family: "center-dynamics",
    feature_id: "center-dynamics.openness",
    distance: 1,
    matched_evidence_count: 1,
    matched_checkpoint_keys: ["configured-ply:12"],
    normalized_weight: 1,
    contribution: 1,
  });
});

test("a missing checkpoint is disclosed but never counted as difference", () => {
  const left = trajectory("route:left", [
    {
      ply: 12,
      signals: [{ family: "center-dynamics", featureId: "center-dynamics.openness", value: "open" }],
    },
    {
      ply: 16,
      signals: [{ family: "center-dynamics", featureId: "center-dynamics.openness", value: "closed" }],
    },
  ]);
  const right = trajectory("route:right", [{
    ply: 12,
    signals: [{ family: "center-dynamics", featureId: "center-dynamics.openness", value: "open" }],
  }]);
  const result = compare(left, right);

  assert.equal(result.distance, 0);
  assert.deepEqual(result.matched_checkpoint_keys, ["configured-ply:12"]);
  assert.deepEqual(result.left_only_checkpoint_keys, ["configured-ply:16"]);
  assert.deepEqual(result.right_only_checkpoint_keys, []);
  assert.equal(result.feature_contributions[0]!.matched_evidence_count, 1);
});

test("user family weights change distance deterministically", () => {
  const left = trajectory("route:left", [{
    ply: 12,
    signals: [
      { family: "center-dynamics", featureId: "center-dynamics.openness", value: "open" },
      { family: "space-and-files", featureId: "space.test", value: 0 },
    ],
  }]);
  const right = trajectory("route:right", [{
    ply: 12,
    signals: [
      { family: "center-dynamics", featureId: "center-dynamics.openness", value: "closed" },
      { family: "space-and-files", featureId: "space.test", value: 0 },
    ],
  }]);

  assert.equal(compare(left, right).distance, 0.5);
  assert.equal(compare(left, right, {
    feature_family_weights: { "center-dynamics": 3, "space-and-files": 1 },
  }).distance, 0.75);
  assert.equal(compare(left, right, {
    feature_family_weights: { "center-dynamics": 1, "space-and-files": 3 },
  }).distance, 0.25);
  assert.deepEqual(
    compare(left, right, { feature_family_weights: { "center-dynamics": 3 } }),
    compare(left, right, { feature_family_weights: { "center-dynamics": 3 } }),
  );
});

test("stable concept IDs participate without display labels", () => {
  const signals = [{
    family: "space-and-files" as const,
    featureId: "space.test",
    value: 0,
  }];
  const left = trajectory("route:left", [{ ply: 12, signals }]);
  const right = trajectory("route:right", [{ ply: 12, signals }]);
  const result = compare(
    left,
    right,
    {},
    [concept("plan.pawn-expansion.repertoire.queenside", left.route_id)],
    [concept("plan.pawn-expansion.repertoire.kingside", right.route_id)],
  );

  assert.equal(result.distance, 0.5);
  assert.deepEqual(
    result.feature_contributions.map((item) => [item.feature_id, item.distance]),
    [
      ["space.test", 0],
      ["learning-concepts.supported-concepts", 1],
    ],
  );
});

test("feature and family contributions reconcile with route-to-mode report scores", () => {
  const left = trajectory("route:left", [{
    ply: 12,
    signals: [
      { family: "pawn-topology", featureId: "pawn.test", value: ["a"] },
      { family: "center-dynamics", featureId: "center.test", value: 0 },
      { family: "space-and-files", featureId: "space.test", value: 0 },
    ],
  }]);
  const modeRoute = trajectory("route:mode", [{
    ply: 12,
    signals: [
      { family: "pawn-topology", featureId: "pawn.test", value: ["b"] },
      { family: "center-dynamics", featureId: "center.test", value: 0.5 },
      { family: "space-and-files", featureId: "space.test", value: 0.25 },
    ],
  }]);
  const trajectories: StrategicTrajectoryReport = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    graph_id: "graph:distance",
    configured_plies: [12],
    trajectories: [left, modeRoute],
    provenance: [SOURCE],
  };
  const routeConceptEntries = [routeConcepts(left), routeConcepts(modeRoute)];
  const concepts = {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: "1.0.0",
    graph_id: "graph:distance",
    routes: routeConceptEntries,
    labels: [],
    provenance: [SOURCE],
  };
  const cohortId = "cohort:distance";
  const modeId = "mode:distance";
  const modes: StrategicModeReport = {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    mode_version: "1.0.0",
    graph_id: "graph:distance",
    taxonomy_version: "1.0.0",
    weighting_version: "1.0.0",
    cohort_version: "1.0.0",
    containers: [],
    cohorts: [{
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      cohort_id: cohortId,
      state: "actionable",
      opening_scope_ids: ["opening:test"],
      decision_scope_ids: ["decision:test"],
      route_ids: [left.route_id, modeRoute.route_id],
      excluded_route_ids: [],
      route_weights: [
        { route_id: left.route_id, normalized_weight: 0.5 },
        { route_id: modeRoute.route_id, normalized_weight: 0.5 },
      ],
      effective_sample_size: 2,
      modes: [{
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        mode_id: modeId,
        cohort_id: cohortId,
        representative_route_id: modeRoute.route_id,
        supporting_route_ids: [modeRoute.route_id],
        concept_ids: [],
        normalized_weight: 0.5,
        effective_sample_size: 1,
        source: "inferred-medoid",
        provenance: [SOURCE],
      }],
      override_ids: [],
      provenance: [SOURCE],
      opening_container_ids: [],
      shared_strategic_ancestor_position_ids: ["position:ancestor"],
      transposition_position_ids: [],
      comparable_checkpoint_kinds: ["configured-ply"],
      common_stable_signal_families: ["pawn-topology", "center-dynamics", "space-and-files"],
      insufficiency_reasons: [],
    }],
    data_quality: {
      total_route_count: 2,
      included_route_count: 2,
      excluded_route_count: 0,
      complete_trajectory_route_count: 2,
      incomplete_trajectory_route_count: 0,
      insufficient_evidence_route_count: 0,
    },
    applied_override_ids: [],
    selections: [{
      cohort_id: cohortId,
      state: "single-mode",
      selected_mode_ids: [modeId],
      candidates: [],
      unassigned_route_ids: [left.route_id],
      effective_sample_size: 2,
      reasons: ["single-supported-mode"],
    }],
    provenance: [SOURCE],
  };
  const report = calculateStrategicDistances(modes, trajectories, concepts, {
    feature_family_weights: {
      "pawn-topology": 5,
      "center-dynamics": 2,
      "space-and-files": 3,
    },
  });
  const comparison = report.comparisons.find((item) => item.left_route_id === left.route_id)!;
  const featureTotal = comparison.feature_contributions.reduce((sum, item) => sum + item.contribution, 0);
  const familyTotal = comparison.family_contributions.reduce((sum, item) => sum + item.contribution, 0);

  assert.equal(report.comparisons.length, 2);
  assert.equal(comparison.mode_id, modeId);
  assert.equal(comparison.representative_route_id, modeRoute.route_id);
  assert.equal(Math.round(featureTotal * 1_000_000) / 1_000_000, comparison.distance);
  assert.equal(Math.round(familyTotal * 1_000_000) / 1_000_000, comparison.distance);
  assert.equal(report.provenance[0]!.source_id, "strategic-fit:distance");
});

test("invalid or entirely disabled weights are rejected", () => {
  const value = trajectory("route:test", [{
    ply: 12,
    signals: [{ family: "center-dynamics", featureId: "center.test", value: 0 }],
  }]);
  assert.throws(
    () => compare(value, value, { feature_family_weights: { "center-dynamics": -1 } }),
    /strategic_fit_distance_invalid_weight/,
  );
  assert.throws(
    () => compare(value, value, {
      feature_family_weights: {
        "pawn-topology": 0,
        "center-dynamics": 0,
        "king-and-piece-setup": 0,
        "space-and-files": 0,
        "dynamic-character": 0,
        "learning-concepts": 0,
      },
    }),
    /strategic_fit_distance_all_weights_zero/,
  );
});
