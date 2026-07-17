import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  calculateStrategicFitMetrics,
  calculateStrategicFitOverview,
  calculateStrategicRouteWeights,
  type RepertoireGraph,
  type StrategicComparableCohort,
  type StrategicConcept,
  type StrategicConceptDictionary,
  type StrategicFitMetricFinding,
  type StrategicFitMetricsInput,
  type StrategicFitProvenance,
  type StrategicFitSourceProvenance,
  type StrategicMode,
  type StrategicModeMedoidCandidate,
  type StrategicModeReport,
  type StrategicRouteWeightingReport,
  type StrategicTrainingMetricEvidence,
} from "../../src/index.ts";
import {
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

const BRANCH_DEPTH_PGN = `[Event "One leaf after 1...e5"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *

[Event "First leaf after 1...c5"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *

[Event "Second leaf after 1...c5"]
[Result "*"]

1. e4 c5 2. Nf3 Nc6 *`;

const SOURCE: StrategicFitSourceProvenance = {
  source_id: "fixture:metrics",
  kind: "deterministic-core",
  state: "available",
  version: "fixture-1",
  snapshot: null,
  reason: null,
};

const TRAINING_SOURCE: StrategicFitSourceProvenance = {
  source_id: "fixture:training",
  kind: "training-metadata",
  state: "available",
  version: "fixture-1",
  snapshot: "2026-07-17",
  reason: null,
};

function close(actual: number, expected: number, epsilon = 1e-6): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

function concept(conceptId: string): StrategicConcept {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: "fixture-1",
    concept_id: conceptId,
    category: "plan",
    rule_id: "observed-pawn-expansion",
    confidence: 1,
    persistence: "stable",
    first_observed_ply: 8,
    evidence: [],
    provenance: [SOURCE],
  };
}

function conceptsFor(
  graph: RepertoireGraph,
  conceptsByRoute: ReadonlyMap<string, readonly string[]>,
): StrategicConceptDictionary {
  const conceptIds = [...new Set([...conceptsByRoute.values()].flat())].sort();
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    classifier_version: "fixture-1",
    graph_id: graph.graph_id,
    routes: graph.routes.map((route) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      classifier_version: "fixture-1",
      trajectory_id: `trajectory:${route.route_id}`,
      route_id: route.route_id,
      concepts: (conceptsByRoute.get(route.route_id) ?? []).map(concept),
      provenance: [SOURCE],
    })),
    labels: conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      locale: "en",
      label: conceptId,
    })),
    provenance: [SOURCE],
  };
}

function modeReports(
  graph: RepertoireGraph,
  weights: StrategicRouteWeightingReport,
  candidateGroups: readonly (readonly string[])[],
  selectedCandidateIndexes: readonly number[] = candidateGroups.map((_, index) => index),
): StrategicModeReport {
  const cohortId = `cohort:${graph.graph_id}`;
  const routeWeight = new Map(weights.routes.map((route) => [route.route_id, route.normalized_weight]));
  const candidates: StrategicModeMedoidCandidate[] = candidateGroups.map((routeIds) => ({
    representative_route_id: [...routeIds].sort()[0]!,
    supporting_route_ids: [...routeIds].sort(),
    normalized_weight: routeIds.reduce((sum, routeId) => sum + routeWeight.get(routeId)!, 0),
    effective_sample_size: routeIds.length,
    weighted_distance: 0,
    supported: true,
  }));
  const modes: StrategicMode[] = selectedCandidateIndexes.map((candidateIndex) => {
    const candidate = candidates[candidateIndex]!;
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      mode_id: `mode:${candidate.representative_route_id}`,
      cohort_id: cohortId,
      representative_route_id: candidate.representative_route_id,
      supporting_route_ids: candidate.supporting_route_ids,
      concept_ids: [],
      normalized_weight: candidate.normalized_weight,
      effective_sample_size: candidate.effective_sample_size,
      source: "inferred-medoid",
      provenance: [SOURCE],
    };
  });
  const selectedRouteIds = new Set(modes.flatMap((mode) => mode.supporting_route_ids));
  const state = modes.length > 1 ? "mixed-profile" as const : "actionable" as const;
  const cohort: StrategicComparableCohort = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_id: cohortId,
    state,
    opening_scope_ids: [],
    decision_scope_ids: [],
    route_ids: graph.routes.map((route) => route.route_id),
    excluded_route_ids: [],
    route_weights: weights.routes.map((route) => ({
      route_id: route.route_id,
      normalized_weight: route.normalized_weight,
    })),
    effective_sample_size: weights.effective_sample_size,
    modes,
    override_ids: [],
    provenance: [SOURCE],
    opening_container_ids: [],
    shared_strategic_ancestor_position_ids: [],
    transposition_position_ids: graph.transposition_links.map((link) => link.position_id),
    comparable_checkpoint_kinds: ["configured-ply"],
    common_stable_signal_families: ["learning-concepts"],
    insufficiency_reasons: [],
  };
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    mode_version: "fixture-1",
    graph_id: graph.graph_id,
    taxonomy_version: "fixture-1",
    weighting_version: weights.weighting_version,
    cohort_version: "fixture-1",
    containers: [],
    cohorts: [cohort],
    data_quality: {
      total_route_count: graph.routes.length,
      included_route_count: graph.routes.length,
      excluded_route_count: 0,
      complete_trajectory_route_count: graph.routes.length,
      incomplete_trajectory_route_count: 0,
      insufficient_evidence_route_count: 0,
    },
    applied_override_ids: [],
    selections: [{
      cohort_id: cohortId,
      state: modes.length > 1 ? "mixed-profile" : "single-mode",
      selected_mode_ids: modes.map((mode) => mode.mode_id),
      candidates,
      unassigned_route_ids: graph.routes
        .map((route) => route.route_id)
        .filter((routeId) => !selectedRouteIds.has(routeId)),
      effective_sample_size: weights.effective_sample_size,
      reasons: modes.length > 1 ? ["multiple-supported-modes"] : ["single-supported-mode"],
    }],
    provenance: [SOURCE],
  };
}

function finding(
  routeIds: readonly string[],
  classification: StrategicFitMetricFinding["classification"] = "forced-diversity",
  learningBurden = 0.8,
): StrategicFitMetricFinding {
  const provenance: StrategicFitProvenance = {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    repertoire_revision: "fixture-revision",
    generated_at: "2026-07-17T00:00:00.000Z",
    deterministic: true,
    sources: [SOURCE],
  };
  return {
    finding_id: `finding:${routeIds.join(":")}`,
    classification,
    references: { route_ids: routeIds },
    learning_burden: learningBurden,
    resolution_state: "unresolved",
    provenance,
  };
}

function input(
  graph: RepertoireGraph,
  weights: StrategicRouteWeightingReport,
  candidateGroups: readonly (readonly string[])[],
  conceptsByRoute: ReadonlyMap<string, readonly string[]>,
  options: {
    readonly selectedCandidateIndexes?: readonly number[];
    readonly findings?: readonly StrategicFitMetricFinding[];
    readonly training?: StrategicTrainingMetricEvidence;
  } = {},
): StrategicFitMetricsInput {
  return {
    graph,
    weights,
    modes: modeReports(graph, weights, candidateGroups, options.selectedCandidateIndexes),
    concepts: conceptsFor(graph, conceptsByRoute),
    findings: options.findings ?? [],
    training: options.training,
  };
}

function branchGroups(graph: RepertoireGraph): {
  e5: string[];
  c5: string[];
  concepts: Map<string, readonly string[]>;
} {
  const e5 = graph.routes.filter((route) => route.san_moves[1] === "e5").map((route) => route.route_id);
  const c5 = graph.routes.filter((route) => route.san_moves[1] === "c5").map((route) => route.route_id);
  return {
    e5,
    c5,
    concepts: new Map([
      ...e5.map((routeId) => [routeId, ["plan.e5"]] as const),
      ...c5.map((routeId) => [routeId, ["plan.c5"]] as const),
    ]),
  };
}

test("hand-calculated metrics use expected branch weights instead of raw leaf counts", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(BRANCH_DEPTH_PGN), "white");
  const weights = calculateStrategicRouteWeights(graph);
  const groups = branchGroups(graph);
  const report = calculateStrategicFitOverview(input(
    graph,
    weights,
    [groups.e5, groups.c5],
    groups.concepts,
  ));

  assert.equal(graph.routes.length, 3);
  close(report.metrics.strategic_entropy.value!, 1);
  close(report.metrics.concept_reuse.value!, 0.5);
  assert.equal(report.strategic_family_count, 2);
  assert.equal(report.expected_concept_burden, 1);
  assert.equal(report.metrics.strategic_entropy.reason, null);
  assert.ok(!JSON.stringify(report.metrics.strategic_entropy).toLowerCase().includes("better"));
  assert.deepEqual(report.metrics.concept_centrality.value, [
    { concept_id: "plan.c5", expected_frequency: 0.5, cohort_ids: [`cohort:${graph.graph_id}`] },
    { concept_id: "plan.e5", expected_frequency: 0.5, cohort_ids: [`cohort:${graph.graph_id}`] },
  ]);
});

test("popularity-style external weights deterministically change entropy and centrality", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(BRANCH_DEPTH_PGN), "white");
  const groups = branchGroups(graph);
  const firstOpponentPosition = graph.decisions.find((decision) => decision.san === "e5")!.from_position_id;
  const rootBranches = graph.decisions.filter((decision) =>
    decision.owner === "opponent" && decision.from_position_id === firstOpponentPosition
  );
  const weights = calculateStrategicRouteWeights(graph, {
    mode: "external",
    decision_weights: rootBranches.map((decision) => ({
      decision_id: decision.decision_id,
      weight: decision.san === "e5" ? 8 : 2,
      provenance: [SOURCE],
    })),
  });
  const metrics = calculateStrategicFitMetrics(input(
    graph,
    weights,
    [groups.e5, groups.c5],
    groups.concepts,
  ));

  close(metrics.strategic_entropy.value!, 0.721928);
  assert.deepEqual(metrics.concept_centrality.value?.map((value) => [
    value.concept_id,
    value.expected_frequency,
  ]), [
    ["plan.e5", 0.8],
    ["plan.c5", 0.2],
  ]);
  assert.ok(metrics.strategic_entropy.provenance.some((source) => source.source_id === SOURCE.source_id));
});

test("missing training metadata stays unavailable while cohort totals and provisional floor reconcile", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(BRANCH_DEPTH_PGN), "white");
  const weights = calculateStrategicRouteWeights(graph);
  const groups = branchGroups(graph);
  const forced = finding(groups.c5);
  const report = calculateStrategicFitOverview(input(
    graph,
    weights,
    [groups.e5, groups.c5],
    groups.concepts,
    { selectedCandidateIndexes: [0], findings: [forced] },
  ));

  assert.deepEqual(report.metrics.exception_burden.value, {
    expected_frequency: 0.5,
    training_cost: null,
  });
  assert.equal(report.metrics.exception_burden.state, "partial");
  assert.equal(report.metrics.forced_diversity_floor.state, "partial");
  close(report.metrics.forced_diversity_floor.value!, 0.5);
  assert.equal(report.metrics.familiarity_adjusted_coverage.state, "unavailable");
  assert.equal(report.metrics.familiarity_adjusted_coverage.value, null);
  assert.match(report.metrics.familiarity_adjusted_coverage.reason!, /requires calibrated concept-mastery/);
  assert.equal(report.metrics.training_adjusted_workload.state, "unavailable");
  assert.equal(report.metrics.homogenization_cost.state, "unavailable");
  assert.equal(report.metrics.repertoire_regret.state, "unavailable");
  assert.equal(report.unresolved_finding_count, 1);

  const primaryWeight = groups.e5.reduce(
    (sum, routeId) => sum + weights.routes.find((route) => route.route_id === routeId)!.normalized_weight,
    0,
  );
  close(primaryWeight + report.metrics.exception_burden.value!.expected_frequency, 1);
});

test("optional mastery produces familiarity and training-adjusted workload inputs", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(BRANCH_DEPTH_PGN), "white");
  const weights = calculateStrategicRouteWeights(graph);
  const groups = branchGroups(graph);
  const metrics = calculateStrategicFitMetrics(input(
    graph,
    weights,
    [groups.e5, groups.c5],
    groups.concepts,
    {
      selectedCandidateIndexes: [0],
      findings: [finding(groups.c5)],
      training: {
        concept_mastery: [
          { concept_id: "plan.e5", mastery: 1, provenance: [TRAINING_SOURCE] },
          { concept_id: "plan.c5", mastery: 0.5, provenance: [TRAINING_SOURCE] },
        ],
        provenance: [TRAINING_SOURCE],
      },
    },
  ));

  assert.equal(metrics.familiarity_adjusted_coverage.state, "available");
  close(metrics.familiarity_adjusted_coverage.value!, 0.5);
  assert.equal(metrics.training_adjusted_workload.state, "available");
  close(metrics.training_adjusted_workload.value!, 0.2);
  assert.deepEqual(metrics.exception_burden.value, {
    expected_frequency: 0.5,
    training_cost: 0.2,
  });
  assert.ok(metrics.training_adjusted_workload.provenance.some((source) =>
    source.source_id === TRAINING_SOURCE.source_id
  ));
});

test("transposition resilience recognizes shared modes without double-counting concept reuse", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const weights = calculateStrategicRouteWeights(graph);
  const routeIds = graph.routes.map((route) => route.route_id);
  const concepts = new Map(routeIds.map((routeId) => [routeId, ["plan.shared"]] as const));
  const metrics = calculateStrategicFitMetrics(input(
    graph,
    weights,
    [routeIds],
    concepts,
  ));

  assert.equal(graph.transposition_links.length > 0, true);
  assert.equal(weights.weighting_units.length, 1);
  close(metrics.move_order_resilience.value!, 1);
  // Two move orders into one canonical evidence unit are not two independent concept observations.
  close(metrics.concept_reuse.value!, 0);
  assert.deepEqual(metrics.concept_centrality.value, [{
    concept_id: "plan.shared",
    expected_frequency: 1,
    cohort_ids: [`cohort:${graph.graph_id}`],
  }]);
});
