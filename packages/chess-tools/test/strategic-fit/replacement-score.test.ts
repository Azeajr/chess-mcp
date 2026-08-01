import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  REPLACEMENT_PARETO_AXES,
  REPLACEMENT_PARETO_STATUSES,
  REPLACEMENT_SCORING_ERROR_CODES,
  REPLACEMENT_SCORING_RESULT_STATUSES,
  REPLACEMENT_SCORE_STATES,
  REPLACEMENT_STRATEGIC_SCORE_AXES,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  buildRepertoireGraph,
  buildStrategicConceptDictionary,
  buildStrategicTrajectories,
  scoreReplacementCandidates,
  type ReplacementActionablePivotEvidence,
  type ReplacementCandidateExpansion,
  type ReplacementCandidateExpansionResult,
  type ReplacementCandidateSourceProvenance,
  type ReplacementCompleteCandidateExpansion,
  type ReplacementEngineCandidateSeed,
  type ReplacementObjectiveQuality,
  type ReplacementRequest,
  type RepertoireGraph,
  type RepertoireGraphDecision,
  type RepertoireGraphRoute,
  type ScoreReplacementCandidatesInput,
  type StrategicCohort,
  type StrategicFitMetric,
  type StrategicFitMetricId,
  type StrategicFitMetrics,
  type StrategicFitProfile,
  type StrategicFitSourceProvenance,
  type StrategicTrainingMetricEvidence,
} from "../../src/index.ts";

const version = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
} as const;

const source: StrategicFitSourceProvenance = {
  source_id: "test:replacement-score",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:score",
  reason: null,
};

const profileSource: StrategicFitSourceProvenance = {
  source_id: "test:replacement-score:profile",
  kind: "user-profile",
  state: "available",
  version: STRATEGIC_FIT_SCHEMA_VERSION,
  snapshot: "profile:score",
  reason: null,
};

const PGN = `[Event "Current Ruy"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 *

[Event "Prepared Italian"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. d3 Nf6 5. O-O d6 6. c3 O-O 7. Re1 a6 *

[Event "Prepared Italian Two Knights"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. d3 Bc5 5. O-O d6 6. c3 O-O 7. Re1 a6 *

[Event "Prepared Scotch"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. d4 exd4 4. Nxd4 Nf6 5. Nc3 Bb4 6. Nxc6 bxc6 7. Bd3 O-O *

[Event "Prepared Four Knights"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Nc3 Nf6 4. Bb5 Bb4 5. O-O O-O 6. d3 d6 7. Bg5 Be6 *

[Event "Prepared Berlin"]
[Result "*"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 4. Nf3 Nxe4 5. d4 d5 6. Bd3 Bd6 7. O-O O-O *`;

function profile(overrides: Partial<StrategicFitProfile["preferences"]> = {}): StrategicFitProfile {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    mode: "custom",
    source: "explicit",
    provisional: false,
    preferences: {
      maximum_engine_loss_cp: 100,
      opponent_popularity_importance: 1,
      personal_game_frequency_importance: 0,
      manual_weight_importance: 0,
      additional_memorization_tolerance: 0.25,
      preferred_concept_ids: [],
      avoided_concept_ids: [],
      preferred_tactical_character: [],
      minimum_opponent_coverage: 0.8,
      feature_family_weights: {
        "pawn-topology": 1,
        "center-dynamics": 1,
        "king-and-piece-setup": 1,
        "space-and-files": 1,
        "dynamic-character": 1,
        "learning-concepts": 1,
      },
      ...overrides,
    },
  };
}

function routeStarting(graph: RepertoireGraph, prefix: string): RepertoireGraphRoute {
  const route = graph.routes.find((item) => item.san_moves.join(" ").startsWith(prefix));
  assert.ok(route, prefix);
  return route;
}

function decisionAt(
  graph: RepertoireGraph,
  route: RepertoireGraphRoute,
  ply: number,
): RepertoireGraphDecision {
  const id = route.decision_ids[ply - 1];
  const decision = graph.decisions.find((item) => item.decision_id === id);
  assert.ok(decision);
  return decision;
}

function quality(loss: number, whiteCp: number): ReplacementObjectiveQuality {
  return {
    ...version,
    state: "available",
    white_pov_evaluation_cp: whiteCp,
    white_pov_mate_in: null,
    white_pov_best_evaluation_cp: whiteCp + loss,
    white_pov_best_mate_in: null,
    repertoire_pov_evaluation_cp: whiteCp,
    repertoire_pov_mate_in: null,
    repertoire_pov_loss_from_best_cp: loss,
    repertoire_pov_verdict: "within-tolerance",
    engine_depth: 24,
    engine_multipv: 3,
    evaluation_uncertainty_cp: 6,
    tactical_volatility: 0.2,
    evaluation_sensitivity_cp: 8,
    forcing_density: 0.25,
    king_safety_risk: 0.1,
    viable_move_width: 3,
    database_performance: null,
    theoretical_status: null,
    reason: null,
    provenance: [source],
  };
}

function candidateSource(
  candidateId: string,
  decision: RepertoireGraphDecision,
): ReplacementCandidateSourceProvenance {
  return {
    ...version,
    source_id: `source:${candidateId}`,
    kind: "existing-repertoire-transposition",
    status: "available",
    provider: "repertoire-graph",
    version: STRATEGIC_FIT_ANALYSIS_VERSION,
    snapshot: "revision:score",
    reason: null,
    position_ids: [decision.to_position_id],
    decision_ids: [decision.decision_id],
    route_ids: [],
    details: { candidate_id: candidateId },
    provenance: [source],
  };
}

interface FixtureContext {
  readonly graph: RepertoireGraph;
  readonly request: ReplacementRequest;
  readonly cohort: StrategicCohort;
  readonly trajectories: ReturnType<typeof buildStrategicTrajectories>;
  readonly concepts: ReturnType<typeof buildStrategicConceptDictionary>;
  readonly pivot: ReplacementActionablePivotEvidence;
  readonly pivotRoute: RepertoireGraphRoute;
}

function contextFixture(
  requestProfile = profile(),
  color: "white" | "black" = "white",
  modePrefix = "e4 e5 Nf3 Nc6 Bc4",
): FixtureContext {
  const graph = buildRepertoireGraph(GameTree.fromPgn(PGN), color);
  const pivotRoute = routeStarting(graph, "e4 e5 Nf3 Nc6 Bb5");
  const pivotPly = color === "white" ? 5 : 4;
  const pivotDecision = decisionAt(graph, pivotRoute, pivotPly);
  const pivot: ReplacementActionablePivotEvidence = {
    ...version,
    pivot_id: "pivot:score",
    repertoire_color: color,
    controllability: 0.9,
    control_label: "mostly-player-controlled",
    player_contribution: 0.9,
    opponent_contribution: 0.1,
    causal_event_ids: ["event:score"],
    affected_feature_ids: ["center-dynamics.openness"],
    alternative_decision_ids: [],
    transposition_position_ids: graph.transposition_links.map((link) => link.position_id),
    source_san_paths: pivotRoute.source_san_paths.map((path) => [...path]),
    explanation: "Fixture player-owned pivot.",
    provenance: [source],
    status: "actionable",
    owner: "repertoire",
    decision_id: pivotDecision.decision_id,
    position_id: pivotDecision.from_position_id,
    ply: pivotPly,
    san: pivotDecision.san,
    uci: pivotDecision.uci,
  };
  const trajectories = buildStrategicTrajectories(graph, { configuredPlies: [6, 8, 10, 12, 14] });
  const concepts = buildStrategicConceptDictionary(trajectories);
  const modeRoute = routeStarting(graph, modePrefix);
  const modeConcepts = concepts.routes.find((route) => route.route_id === modeRoute.route_id)!;
  const cohort: StrategicCohort = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_id: "cohort:score",
    state: "actionable",
    opening_scope_ids: ["opening:king-pawn"],
    decision_scope_ids: [pivotDecision.decision_id],
    route_ids: graph.routes.map((route) => route.route_id).sort(),
    excluded_route_ids: [],
    route_weights: graph.routes
      .map((route) => ({
        route_id: route.route_id,
        normalized_weight: 1 / graph.routes.length,
      }))
      .sort((left, right) => left.route_id.localeCompare(right.route_id)),
    effective_sample_size: graph.routes.length,
    modes: [
      {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        mode_id: "mode:score",
        cohort_id: "cohort:score",
        representative_route_id: modeRoute.route_id,
        supporting_route_ids: [modeRoute.route_id],
        concept_ids: modeConcepts.concepts.map((concept) => concept.concept_id).sort(),
        normalized_weight: 1,
        effective_sample_size: 1,
        source: "explicit-target",
        provenance: [source],
      },
    ],
    override_ids: [],
    provenance: [source],
  };
  const request: ReplacementRequest = {
    ...version,
    request_id: "request:score",
    report_id: "report:score",
    finding_id: "finding:score",
    semantic_finding_id: "semantic-finding:score",
    cohort_id: cohort.cohort_id,
    repertoire_revision: "revision:score",
    repertoire_color: color,
    pivot_selection: { kind: "automatic", decision_id: null },
    profile: requestProfile,
    candidate_sources: ["existing-repertoire-transposition", "engine-multipv"],
    user_candidate_san_lines: [],
    maximum_repertoire_pov_loss_from_best_cp: 100,
    minimum_expected_opponent_coverage: 0.8,
    budget: {
      maximum_candidates: 3,
      maximum_subtree_nodes_per_candidate: 20,
      maximum_engine_positions: 8,
      maximum_explorer_queries: 8,
      engine_depth: 24,
      engine_multipv: 3,
      strategic_horizon_ply: 14,
      minimum_reply_popularity: 0.05,
      include_all_forcing_replies: true,
    },
    provenance: [source, profileSource],
  };
  return { graph, request, cohort, trajectories, concepts, pivot, pivotRoute };
}

function completeCandidate(
  fixture: FixtureContext,
  san: string,
  candidateId: string,
  loss: number,
  popularity: number,
): ReplacementCompleteCandidateExpansion {
  const rootPosition = fixture.graph.positions.find(
    (position) => position.position_id === fixture.pivot.position_id,
  )!;
  const decision = fixture.graph.decisions.find(
    (item) => item.from_position_id === fixture.pivot.position_id && item.san === san,
  );
  assert.ok(decision, san);
  const outcome = fixture.graph.positions.find(
    (position) => position.position_id === decision.to_position_id,
  )!;
  const sourceRecord = candidateSource(candidateId, decision);
  const objective = quality(loss, 40 - loss);
  const seed: ReplacementEngineCandidateSeed = {
    ...version,
    candidate_id: candidateId,
    rank: 1,
    status: "ready-for-expansion",
    request_id: fixture.request.request_id,
    report_id: fixture.request.report_id,
    finding_id: fixture.request.finding_id,
    semantic_finding_id: fixture.request.semantic_finding_id,
    cohort_id: fixture.request.cohort_id,
    repertoire_revision: fixture.request.repertoire_revision,
    repertoire_color: fixture.request.repertoire_color,
    pivot: fixture.pivot,
    san: decision.san,
    uci: decision.uci,
    mover_color: decision.mover_color,
    outcome_position_id: outcome.position_id,
    outcome_position_key: outcome.position_key,
    outcome_fen: outcome.fen,
    existing_preparation: true,
    memory_class: "existing-preparation",
    rank_hint: "low-memory-existing-preparation",
    maximum_database_popularity: popularity,
    source_kinds: ["existing-repertoire-transposition", "engine-multipv"],
    source_san_paths: outcome.source_san_paths.map((path) => [...path]),
    database_evidence_ids: [`database:${candidateId}`],
    provenance: [sourceRecord],
    expansion: {
      ...version,
      status: "full-subtree-required",
      full_subtree_required: true,
      required_contract: "ReplacementCandidateSubtree",
      reason: "Fixture requires a full subtree.",
    },
    objective_quality: objective,
    engine_evidence_ids: [`engine:${candidateId}`],
  };
  const rootNodeId = `node:${candidateId}:root`;
  const outcomeNodeId = `node:${candidateId}:outcome`;
  const edgeId = `edge:${candidateId}`;
  const routeId = `route:${candidateId}`;
  return {
    ...version,
    candidate_id: candidateId,
    rank: 1,
    seed,
    evidence_item_results: [],
    source_results: [],
    omissions: [],
    unresolved_risks: [],
    status: "complete",
    subtree: {
      ...version,
      subtree_id: `subtree:${candidateId}`,
      root_position_id: rootPosition.position_id,
      root_node_id: rootNodeId,
      nodes: [
        {
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          node_id: rootNodeId,
          kind: "root",
          position_id: rootPosition.position_id,
          fen: rootPosition.fen,
          ply: fixture.pivot.ply - 1,
          outgoing_edge_ids: [edgeId],
          source_san_paths: rootPosition.source_san_paths,
          transposition_target_position_id: null,
        },
        {
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          node_id: outcomeNodeId,
          kind: "transposition",
          position_id: outcome.position_id,
          fen: outcome.fen,
          ply: fixture.pivot.ply,
          outgoing_edge_ids: [],
          source_san_paths: outcome.source_san_paths,
          transposition_target_position_id: outcome.position_id,
        },
      ],
      edges: [
        {
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          edge_id: edgeId,
          from_node_id: rootNodeId,
          to_node_id: outcomeNodeId,
          decision_id: decision.decision_id,
          san: decision.san,
          uci: decision.uci,
          mover_color: decision.mover_color,
          owner: decision.owner,
          forcing: false,
          expected_opponent_frequency: null,
          source_san_paths: decision.source_san_paths,
          annotation_text: [],
        },
      ],
      routes: [
        {
          analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
          route_id: routeId,
          node_ids: [rootNodeId, outcomeNodeId],
          edge_ids: [edgeId],
          terminal_node_id: outcomeNodeId,
          termination: "existing-preparation",
          expected_opponent_frequency: 1,
        },
      ],
      strategic_horizon_ply: 14,
      important_reply_count: 0,
      covered_important_reply_count: 0,
      forcing_reply_count: 0,
      covered_forcing_reply_count: 0,
      unresolved_risk_ids: [],
      provenance: [sourceRecord],
      status: "complete",
      completion: { kind: "immediate-transposition", target_position_id: outcome.position_id },
      truncation_reasons: [],
    },
  };
}

function incompleteCandidate(
  complete: ReplacementCompleteCandidateExpansion,
): ReplacementCandidateExpansion {
  return {
    ...complete,
    status: "truncated",
    subtree: {
      ...complete.subtree,
      status: "truncated",
      completion: null,
      truncation_reasons: ["subtree-node-budget-exhausted"],
    },
  };
}

function branchedCandidate(
  fixture: FixtureContext,
  complete: ReplacementCompleteCandidateExpansion,
): ReplacementCompleteCandidateExpansion {
  const subtree = complete.subtree;
  const outcome = subtree.nodes[1]!;
  const replies = fixture.graph.decisions
    .filter(
      (decision) =>
        decision.from_position_id === outcome.position_id && decision.owner === "opponent",
    )
    .sort((left, right) => left.san.localeCompare(right.san));
  assert.equal(replies.length, 2);
  const replyNodes = replies.map((decision, index) => {
    const position = fixture.graph.positions.find(
      (item) => item.position_id === decision.to_position_id,
    )!;
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      node_id: `node:${complete.candidate_id}:reply:${index}`,
      kind: "transposition" as const,
      position_id: position.position_id,
      fen: position.fen,
      ply: fixture.pivot.ply + 1,
      outgoing_edge_ids: [],
      source_san_paths: position.source_san_paths,
      transposition_target_position_id: position.position_id,
    };
  });
  const replyEdges = replies.map((decision, index) => ({
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    edge_id: `edge:${complete.candidate_id}:reply:${index}`,
    from_node_id: outcome.node_id,
    to_node_id: replyNodes[index]!.node_id,
    decision_id: decision.decision_id,
    san: decision.san,
    uci: decision.uci,
    mover_color: decision.mover_color,
    owner: decision.owner,
    forcing: false,
    expected_opponent_frequency: index === 0 ? 0.8 : 0.2,
    source_san_paths: decision.source_san_paths,
    annotation_text: [],
  }));
  const firstEdge = subtree.edges[0]!;
  return {
    ...complete,
    subtree: {
      ...subtree,
      subtree_id: `${subtree.subtree_id}:branched`,
      nodes: [
        subtree.nodes[0]!,
        {
          ...outcome,
          kind: "repertoire-decision",
          outgoing_edge_ids: replyEdges.map((edge) => edge.edge_id),
          transposition_target_position_id: null,
        },
        ...replyNodes,
      ],
      edges: [firstEdge, ...replyEdges],
      routes: replyEdges.map((edge, index) => ({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        route_id: `route:${complete.candidate_id}:reply:${index}`,
        node_ids: [subtree.root_node_id, outcome.node_id, replyNodes[index]!.node_id],
        edge_ids: [firstEdge.edge_id, edge.edge_id],
        terminal_node_id: replyNodes[index]!.node_id,
        termination: "existing-preparation" as const,
        expected_opponent_frequency: index === 0 ? 0.8 : 0.2,
      })) as [(typeof subtree.routes)[number], ...(typeof subtree.routes)[number][]],
      important_reply_count: 2,
      covered_important_reply_count: 2,
      completion: {
        kind: "expanded-opponent-replies",
        opponent_reply_edge_ids: replyEdges.map((edge) => edge.edge_id) as [string, ...string[]],
        comparable_strategic_horizon_reached: true,
      },
    },
  };
}

function convergentCandidate(
  fixture: FixtureContext,
  complete: ReplacementCompleteCandidateExpansion,
): ReplacementCompleteCandidateExpansion {
  const prefixes = ["e4 e5 Nf3 Nc6 Bc4 Bc5 d3 Nf6", "e4 e5 Nf3 Nc6 Bc4 Nf6 d3 Bc5"];
  const frequencies = [0.8, 0.2];
  const outcome = complete.subtree.nodes[1]!;
  const rootEdge = complete.subtree.edges[0]!;
  const branchNodes: Array<ReturnType<typeof makeBranchNode>> = [];
  const branchEdges: Array<ReturnType<typeof makeBranchEdge>> = [];
  const routes = prefixes.map((prefix, branchIndex) => {
    const graphRoute = routeStarting(fixture.graph, prefix);
    const nodeIds = [complete.subtree.root_node_id, outcome.node_id];
    const edgeIds = [rootEdge.edge_id];
    let fromNodeId = outcome.node_id;
    for (const ply of [6, 7, 8]) {
      const decision = decisionAt(fixture.graph, graphRoute, ply);
      const position = fixture.graph.positions.find(
        (item) => item.position_id === decision.to_position_id,
      )!;
      const node = makeBranchNode(
        complete.candidate_id,
        branchIndex,
        ply,
        position,
        ply === 8 ? position.position_id : null,
      );
      const edge = makeBranchEdge(
        complete.candidate_id,
        branchIndex,
        ply,
        fromNodeId,
        node.node_id,
        decision,
        ply === 6 ? frequencies[branchIndex]! : ply === 8 ? 1 : null,
      );
      branchNodes.push(node);
      branchEdges.push(edge);
      nodeIds.push(node.node_id);
      edgeIds.push(edge.edge_id);
      fromNodeId = node.node_id;
    }
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      route_id: `route:${complete.candidate_id}:convergent:${branchIndex}`,
      node_ids: nodeIds,
      edge_ids: edgeIds,
      terminal_node_id: nodeIds.at(-1)!,
      termination: "existing-preparation" as const,
      expected_opponent_frequency: frequencies[branchIndex]!,
    };
  });
  const outgoing = new Map<string, string[]>();
  for (const edge of branchEdges) {
    const values = outgoing.get(edge.from_node_id) ?? [];
    values.push(edge.edge_id);
    outgoing.set(edge.from_node_id, values);
  }
  const firstReplyIds = branchEdges
    .filter((edge) => edge.from_node_id === outcome.node_id)
    .map((edge) => edge.edge_id);
  return {
    ...complete,
    subtree: {
      ...complete.subtree,
      subtree_id: `${complete.subtree.subtree_id}:convergent`,
      nodes: [
        complete.subtree.nodes[0]!,
        {
          ...outcome,
          kind: "repertoire-decision",
          outgoing_edge_ids: firstReplyIds,
          transposition_target_position_id: null,
        },
        ...branchNodes.map((node) => ({
          ...node,
          outgoing_edge_ids: outgoing.get(node.node_id) ?? [],
        })),
      ],
      edges: [rootEdge, ...branchEdges],
      routes: routes as typeof complete.subtree.routes,
      important_reply_count: 2,
      covered_important_reply_count: 2,
      completion: {
        kind: "expanded-opponent-replies",
        opponent_reply_edge_ids: firstReplyIds as [string, ...string[]],
        comparable_strategic_horizon_reached: true,
      },
    },
  };
}

function makeBranchNode(
  candidateId: string,
  branchIndex: number,
  ply: number,
  position: RepertoireGraph["positions"][number],
  transpositionTargetPositionId: string | null,
) {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    node_id: `node:${candidateId}:convergent:${branchIndex}:${ply}`,
    kind: (ply === 8
      ? "transposition"
      : ply % 2 === 0
        ? "opponent-reply"
        : "repertoire-decision") as "transposition" | "opponent-reply" | "repertoire-decision",
    position_id: position.position_id,
    fen: position.fen,
    ply,
    outgoing_edge_ids: [] as string[],
    source_san_paths: position.source_san_paths,
    transposition_target_position_id: transpositionTargetPositionId,
  };
}

function makeBranchEdge(
  candidateId: string,
  branchIndex: number,
  ply: number,
  fromNodeId: string,
  toNodeId: string,
  decision: RepertoireGraphDecision,
  expectedFrequency: number | null,
) {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    edge_id: `edge:${candidateId}:convergent:${branchIndex}:${ply}`,
    from_node_id: fromNodeId,
    to_node_id: toNodeId,
    decision_id: decision.decision_id,
    san: decision.san,
    uci: decision.uci,
    mover_color: decision.mover_color,
    owner: decision.owner,
    forcing: false,
    expected_opponent_frequency: expectedFrequency,
    source_san_paths: decision.source_san_paths,
    annotation_text: [],
  };
}

function expansionResult(
  fixture: FixtureContext,
  candidates: readonly ReplacementCandidateExpansion[],
  status: ReplacementCandidateExpansionResult["status"] = "complete",
): ReplacementCandidateExpansionResult {
  return {
    ...version,
    status,
    error_code: null,
    explanation: "Fixture expansion.",
    request_id: fixture.request.request_id,
    report_id: fixture.request.report_id,
    finding_id: fixture.request.finding_id,
    semantic_finding_id: fixture.request.semantic_finding_id,
    cohort_id: fixture.request.cohort_id,
    repertoire_revision: fixture.request.repertoire_revision,
    repertoire_color: fixture.request.repertoire_color,
    pivot_id: fixture.pivot.pivot_id,
    maximum_candidates: fixture.request.budget.maximum_candidates,
    maximum_subtree_nodes_per_candidate: fixture.request.budget.maximum_subtree_nodes_per_candidate,
    maximum_engine_positions: fixture.request.budget.maximum_engine_positions,
    maximum_explorer_queries: fixture.request.budget.maximum_explorer_queries,
    strategic_horizon_ply: fixture.request.budget.strategic_horizon_ply,
    minimum_reply_popularity: fixture.request.budget.minimum_reply_popularity,
    include_all_forcing_replies: fixture.request.budget.include_all_forcing_replies,
    discovered_candidate_count: candidates.length,
    expanded_candidate_count: candidates.filter((candidate) => candidate.status === "complete")
      .length,
    engine_positions_scheduled: 0,
    explorer_queries_scheduled: 0,
    visited_position_count: candidates.length,
    candidates,
    source_results: [],
    evidence_item_results: [],
    omissions: [],
    unresolved_risks: [],
    task_8_4_engine_item_results: [],
    task_8_4_source_results: [],
    task_8_4_cache_write: null,
    engine_cache_writes: [],
    provenance: [source],
    source_repertoire_unchanged: true,
    source_graph_unchanged: true,
    pivot_result_unchanged: true,
    candidate_generation_unchanged: true,
    engine_generation_unchanged: true,
    providers_unchanged: true,
    cache_inputs_unchanged: true,
    evidence_unchanged: true,
  };
}

function unavailableMetric(metricId: StrategicFitMetricId): StrategicFitMetric<never> {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: metricId,
    state: "unavailable",
    value: null,
    unit: "score",
    reason: "Fixture evidence unavailable.",
    provenance: [source],
  };
}

function metrics(): StrategicFitMetrics {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    strategic_entropy: unavailableMetric("strategic-entropy"),
    concept_reuse: unavailableMetric("concept-reuse"),
    exception_burden: unavailableMetric("exception-burden"),
    forced_diversity_floor: unavailableMetric("forced-diversity-floor"),
    homogenization_cost: unavailableMetric("homogenization-cost"),
    familiarity_adjusted_coverage: unavailableMetric("familiarity-adjusted-coverage"),
    training_adjusted_workload: unavailableMetric("training-adjusted-workload"),
    repertoire_regret: unavailableMetric("repertoire-regret"),
    move_order_resilience: unavailableMetric("move-order-resilience"),
    concept_centrality: unavailableMetric("concept-centrality"),
  } as StrategicFitMetrics;
}

function input(
  fixture: FixtureContext,
  candidates: readonly ReplacementCandidateExpansion[],
  training: StrategicTrainingMetricEvidence | null = null,
  expansionStatus: ReplacementCandidateExpansionResult["status"] = "complete",
): ScoreReplacementCandidatesInput {
  return {
    request: fixture.request,
    graph: fixture.graph,
    cohort: fixture.cohort,
    trajectories: fixture.trajectories,
    concepts: fixture.concepts,
    metrics: metrics(),
    training,
    popularity: null,
    expansion: expansionResult(fixture, candidates, expansionStatus),
  };
}

function completeFixture(requestProfile = profile()) {
  const fixture = contextFixture(requestProfile);
  const candidates = [
    completeCandidate(fixture, "Bc4", "candidate:familiar", 30, 0.9),
    completeCandidate(fixture, "d4", "candidate:quality", 0, 0.3),
    completeCandidate(fixture, "Nc3", "candidate:dominated", 100, 0.5),
  ];
  return { fixture, candidates };
}

function allCandidateConceptMastery(
  first: ReturnType<typeof scoreReplacementCandidates>,
): StrategicTrainingMetricEvidence {
  const conceptIds = [
    ...new Set(
      first.candidates.flatMap(
        (candidate) =>
          candidate.concept_dictionary?.routes.flatMap((route) =>
            route.concepts.map((concept) => concept.concept_id),
          ) ?? [],
      ),
    ),
  ].sort();
  return {
    concept_mastery: conceptIds.map((conceptId) => ({
      concept_id: conceptId,
      mastery: 0.6,
      provenance: [source],
    })),
    provenance: [source],
  };
}

function fullyScoredFixture(requestProfile = profile()) {
  const values = completeFixture(requestProfile);
  const first = scoreReplacementCandidates(input(values.fixture, values.candidates));
  const training = allCandidateConceptMastery(first);
  return {
    ...values,
    training,
    result: scoreReplacementCandidates(input(values.fixture, values.candidates, training)),
  };
}

test("hand-built Pareto frontier retains tradeoffs, dominated candidate, and exact dominator IDs", () => {
  const { result } = fullyScoredFixture();
  assert.equal(result.error_code, null);
  assert.ok(
    result.pareto_candidate_ids.length >= 1,
    JSON.stringify(
      result.candidates.map((candidate) => ({
        id: candidate.candidate_id,
        state: candidate.state,
        axes: candidate.strategic_score.contributions.map((item) => [item.axis, item.state]),
      })),
    ),
  );
  const dominated = result.candidates.find(
    (candidate) => candidate.candidate_id === "candidate:dominated",
  )!;
  assert.equal(dominated.pareto.status, "dominated");
  assert.deepEqual(dominated.pareto.dominated_by_candidate_ids, ["candidate:familiar"]);
  assert.ok(result.candidates.some((candidate) => candidate.pareto.status === "pareto-optimal"));
  assert.equal(Object.hasOwn(result, "best_candidate_id"), false);
  assert.ok(result.candidates.every((candidate) => !Object.hasOwn(candidate, "rank")));
});

test("profile feature weights deterministically change full-trajectory score and Pareto assessment", () => {
  const scoreProfile = (requestProfile: StrategicFitProfile) => {
    const sourceFixture = contextFixture(requestProfile, "white", "e4 e5 Nf3 Nc6 Bb5");
    const modeRouteId = sourceFixture.cohort.modes[0]!.representative_route_id;
    const fixture: FixtureContext = {
      ...sourceFixture,
      cohort: {
        ...sourceFixture.cohort,
        modes: sourceFixture.cohort.modes.map((mode) => ({ ...mode, concept_ids: [] })),
      },
      concepts: {
        ...sourceFixture.concepts,
        routes: sourceFixture.concepts.routes.map((route) =>
          route.route_id === modeRouteId ? { ...route, concepts: [] } : route,
        ),
      },
    };
    const candidates = [
      completeCandidate(fixture, "Bc4", "candidate:profile-a", 10, 0.8),
      completeCandidate(fixture, "Nc3", "candidate:profile-c", 10, 0.8),
    ];
    const first = scoreReplacementCandidates(input(fixture, candidates));
    const training = allCandidateConceptMastery(first);
    return {
      fixture,
      candidates,
      training,
      result: scoreReplacementCandidates(input(fixture, candidates, training)),
    };
  };
  const pawn = scoreProfile(
    profile({
      feature_family_weights: {
        "pawn-topology": 20,
        "center-dynamics": 20,
        "king-and-piece-setup": 0,
        "space-and-files": 0,
        "dynamic-character": 0,
        "learning-concepts": 0,
      },
    }),
  );
  const king = scoreProfile(
    profile({
      feature_family_weights: {
        "pawn-topology": 0,
        "center-dynamics": 0,
        "king-and-piece-setup": 20,
        "space-and-files": 0,
        "dynamic-character": 0,
        "learning-concepts": 0,
      },
    }),
  );
  const pawnScores = pawn.result.candidates.map((candidate) => [
    candidate.candidate_id,
    candidate.strategic_score.strategic_fit_score,
  ]);
  const kingScores = king.result.candidates.map((candidate) => [
    candidate.candidate_id,
    candidate.strategic_score.strategic_fit_score,
  ]);
  assert.notDeepEqual(pawnScores, kingScores);
  assert.deepEqual(
    scoreReplacementCandidates(input(pawn.fixture, pawn.candidates, pawn.training)).candidates,
    pawn.result.candidates,
  );
  assert.notDeepEqual(
    pawn.result.candidates.map((candidate) => [candidate.candidate_id, candidate.pareto.status]),
    king.result.candidates.map((candidate) => [candidate.candidate_id, candidate.pareto.status]),
    JSON.stringify({ pawnScores, kingScores }),
  );
  const preferredConceptId = pawn.result.candidates[0]!.concept_dictionary!.routes.flatMap(
    (route) => route.concepts.map((concept) => concept.concept_id),
  )[0]!;
  const preferred = scoreProfile(profile({ preferred_concept_ids: [preferredConceptId] }));
  const avoided = scoreProfile(profile({ avoided_concept_ids: [preferredConceptId] }));
  assert.notDeepEqual(
    preferred.result.candidates.map((candidate) => candidate.strategic_score.strategic_fit_score),
    avoided.result.candidates.map((candidate) => candidate.strategic_score.strategic_fit_score),
  );
});

test("immediate-position candidates use complete prepared continuations, cohort modes, and expected frequencies", () => {
  const { result } = fullyScoredFixture();
  const familiar = result.candidates.find(
    (candidate) => candidate.candidate_id === "candidate:familiar",
  )!;
  const qualityCandidate = result.candidates.find(
    (candidate) => candidate.candidate_id === "candidate:quality",
  )!;
  assert.ok(
    familiar.trajectory_report!.trajectories[0]!.snapshots.some(
      (snapshot) => snapshot.checkpoint.ply >= 12,
    ),
  );
  assert.ok(
    qualityCandidate.trajectory_report!.trajectories[0]!.snapshots.some(
      (snapshot) => snapshot.checkpoint.ply >= 12,
    ),
  );
  assert.notEqual(
    familiar.strategic_score.strategic_fit_score,
    qualityCandidate.strategic_score.strategic_fit_score,
  );
  assert.equal(familiar.strategic_score.cohort_id, "cohort:score");
  assert.equal(familiar.strategic_score.expected_opponent_coverage, 1);
  assert.ok(familiar.route_weighting!.routes.every((route) => route.normalized_weight >= 0));
});

test("expected-frequency weighting spans every continuation without leaf-count bias", () => {
  const values = completeFixture();
  const branched = branchedCandidate(values.fixture, values.candidates[0]!);
  const first = scoreReplacementCandidates(input(values.fixture, [branched]));
  const result = scoreReplacementCandidates(
    input(values.fixture, [branched], allCandidateConceptMastery(first)),
  );
  const weights = result.candidates[0]!.route_weighting!.routes.map(
    (route) => route.normalized_weight,
  ).sort((left, right) => left - right);
  assert.deepEqual(weights, [0.2, 0.8]);
  assert.equal(result.candidates[0]!.strategic_score.expected_opponent_coverage, 1);
  assert.equal(result.candidates[0]!.trajectory_report!.trajectories.length, 2);
});

test("transpositions and navigation paths never manufacture theory or trajectory observations", () => {
  const { result } = fullyScoredFixture();
  for (const candidate of result.candidates) {
    assert.equal(candidate.strategic_score.theory_nodes_added, 0);
    assert.deepEqual(candidate.strategic_score.transposition_position_ids, [
      candidate.expansion.seed.outcome_position_id,
    ]);
    const routeIds = candidate.trajectory_report!.trajectories.map(
      (trajectory) => trajectory.route_id,
    );
    assert.equal(new Set(routeIds).size, routeIds.length);
    assert.equal(
      new Set(candidate.strategic_score.trajectory_ids).size,
      candidate.strategic_score.trajectory_ids.length,
    );
  }
});

test("distinct expected-game routes retain coverage when they converge by transposition", () => {
  const values = completeFixture();
  const convergent = convergentCandidate(values.fixture, values.candidates[0]!);
  const result = scoreReplacementCandidates(input(values.fixture, [convergent]));
  assert.equal(result.error_code, null);
  assert.equal(result.candidates[0]!.strategic_score.expected_opponent_coverage, 1);
  assert.equal(result.candidates[0]!.strategic_score.transposition_position_ids.length, 1);
});

test("all nine strategic axes emit complete inspectable contribution metadata and keep objective quality separate", () => {
  const { result } = fullyScoredFixture();
  for (const candidate of result.candidates) {
    assert.deepEqual(
      candidate.strategic_score.contributions.map((item) => item.axis),
      REPLACEMENT_STRATEGIC_SCORE_AXES,
    );
    for (const item of candidate.strategic_score.contributions) {
      assert.ok(REPLACEMENT_SCORE_STATES.includes(item.state));
      assert.equal(typeof item.unit, "string");
      assert.equal(typeof item.higher_is_better, "boolean");
      assert.equal(typeof item.reason, "string");
      assert.ok(item.provenance.length > 0);
      if (item.state === "available") {
        assert.equal(typeof item.raw_value, "number");
        assert.equal(typeof item.normalized_score, "number");
      }
    }
    assert.equal(
      candidate.strategic_score.contributions.some((item) => item.axis === "objective-quality"),
      false,
    );
    assert.ok(candidate.pareto.axis_ids.includes("objective-quality"));
    assert.equal(
      candidate.objective_quality.white_pov_evaluation_cp,
      candidate.expansion.seed.objective_quality.white_pov_evaluation_cp,
    );
  }
});

test("missing metadata remains null and explicit and cannot improve or dominate", () => {
  const values = completeFixture();
  const missing = {
    ...values.candidates[1]!,
    seed: {
      ...values.candidates[1]!.seed,
      maximum_database_popularity: null,
      objective_quality: {
        ...values.candidates[1]!.seed.objective_quality,
        state: "unavailable" as const,
        repertoire_pov_loss_from_best_cp: null,
        reason: "engine unavailable",
      },
    },
  };
  const result = scoreReplacementCandidates(
    input(values.fixture, [values.candidates[0]!, missing], null),
  );
  const candidate = result.candidates.find((item) => item.candidate_id === missing.candidate_id)!;
  assert.equal(candidate.strategic_score.popularity, null);
  assert.equal(
    candidate.strategic_score.contributions.find((item) => item.axis === "popularity")!.state,
    "unavailable",
  );
  assert.equal(
    candidate.strategic_score.contributions.find((item) => item.axis === "popularity")!.raw_value,
    null,
  );
  assert.equal(candidate.pareto.status, "unscored");
  assert.deepEqual(candidate.pareto.dominated_by_candidate_ids, []);
});

test("missing route frequency stays null and its partial axes cannot enter Pareto dominance", () => {
  const values = completeFixture();
  const branched = branchedCandidate(values.fixture, values.candidates[0]!);
  const missingEdgeId = branched.subtree.routes[1]!.edge_ids.at(-1)!;
  const partial = {
    ...branched,
    subtree: {
      ...branched.subtree,
      edges: branched.subtree.edges.map((edge) =>
        edge.edge_id === missingEdgeId ? { ...edge, expected_opponent_frequency: null } : edge,
      ) as typeof branched.subtree.edges,
      routes: branched.subtree.routes.map((route, index) =>
        index === 1 ? { ...route, expected_opponent_frequency: null } : route,
      ) as typeof branched.subtree.routes,
    },
  };
  const first = scoreReplacementCandidates(input(values.fixture, [partial]));
  const result = scoreReplacementCandidates(
    input(values.fixture, [partial], allCandidateConceptMastery(first)),
  );
  const candidate = result.candidates[0]!;
  assert.equal(candidate.route_weighting, null);
  assert.equal(
    candidate.strategic_score.contributions.find((item) => item.axis === "strategic-fit")!.state,
    "partial",
  );
  assert.equal(candidate.pareto.axis_ids.includes("strategic-fit"), false);
  assert.deepEqual(candidate.pareto.dominated_by_candidate_ids, []);
});

test("forged complete and stale incomplete Task 8.5 identities fail the scoring boundary", () => {
  const values = completeFixture();
  const complete = values.candidates[0]!;
  const forged = {
    ...complete,
    subtree: {
      ...complete.subtree,
      nodes: [
        complete.subtree.nodes[0]!,
        {
          ...complete.subtree.nodes[1]!,
          position_id: "position:forged",
        },
      ] as typeof complete.subtree.nodes,
    },
  };
  const malformed = scoreReplacementCandidates(input(values.fixture, [forged]));
  assert.equal(malformed.status, "stale");
  assert.equal(malformed.error_code, "malformed-expansion");
  assert.deepEqual(malformed.candidates, []);

  const falseJoin = {
    ...complete,
    subtree: {
      ...complete.subtree,
      nodes: [
        complete.subtree.nodes[0]!,
        {
          ...complete.subtree.nodes[1]!,
          transposition_target_position_id: null,
        },
      ] as typeof complete.subtree.nodes,
    },
  };
  const falseJoinResult = scoreReplacementCandidates(input(values.fixture, [falseJoin]));
  assert.equal(falseJoinResult.status, "stale");
  assert.equal(falseJoinResult.error_code, "malformed-expansion");

  const incomplete = incompleteCandidate(complete);
  const stale = {
    ...incomplete,
    seed: { ...incomplete.seed, request_id: "request:stale" },
  };
  const staleResult = scoreReplacementCandidates(input(values.fixture, [stale], null, "partial"));
  assert.equal(staleResult.status, "stale");
  assert.equal(staleResult.error_code, "malformed-expansion");
});

test("duplicate or out-of-range training mastery is rejected independently of evidence order", () => {
  const values = completeFixture();
  const duplicate: StrategicTrainingMetricEvidence = {
    concept_mastery: [
      { concept_id: "concept:duplicate", mastery: 0.2 },
      { concept_id: "concept:duplicate", mastery: 0.8 },
    ],
  };
  const runtimeNull = {
    concept_mastery: [{ concept_id: "concept:null", mastery: null }],
  } as unknown as StrategicTrainingMetricEvidence;
  for (const training of [
    duplicate,
    {
      concept_mastery: [{ concept_id: "concept:invalid", mastery: 1.1 }],
    } satisfies StrategicTrainingMetricEvidence,
    runtimeNull,
  ]) {
    const result = scoreReplacementCandidates(input(values.fixture, values.candidates, training));
    assert.equal(result.status, "invalid-request");
    assert.equal(result.error_code, "invalid-training-evidence");
    assert.deepEqual(result.candidates, []);
  }
  const validProfile = profile();
  const nullProfile = {
    ...validProfile,
    preferences: { ...validProfile.preferences, additional_memorization_tolerance: null },
  };
  const invalidProfileResult = scoreReplacementCandidates(
    input(
      {
        ...values.fixture,
        request: {
          ...values.fixture.request,
          profile: nullProfile as unknown as StrategicFitProfile,
        },
      },
      values.candidates,
    ),
  );
  assert.equal(invalidProfileResult.status, "invalid-request");
  assert.equal(invalidProfileResult.error_code, "invalid-profile");
});

test("partial, truncated, and blocked Task 8.5 boundary remains explicit and unscored", () => {
  const values = completeFixture();
  const truncated = incompleteCandidate(values.candidates[0]!);
  const blocked = {
    ...incompleteCandidate(values.candidates[1]!),
    status: "unavailable" as const,
    subtree: {
      ...incompleteCandidate(values.candidates[1]!).subtree!,
      status: "blocked" as const,
      truncation_reasons: ["provider-unavailable"] as [string, ...string[]],
    },
  };
  const result = scoreReplacementCandidates(
    input(values.fixture, [values.candidates[2]!, truncated, blocked], null, "partial"),
  );
  assert.equal(result.status, "partial");
  for (const id of [truncated.candidate_id, blocked.candidate_id]) {
    const candidate = result.candidates.find((item) => item.candidate_id === id)!;
    assert.equal(candidate.state, "unavailable");
    assert.equal(candidate.pareto.status, "unscored");
    assert.equal(candidate.trajectory_report, null);
    assert.equal(candidate.strategic_score.trajectory_ids.length, 0);
    assert.ok(candidate.reason!.includes("not complete"));
  }
});

test("ordering is deterministic across candidate, subtree, source, and evidence order", () => {
  const values = completeFixture();
  const ordered = values.candidates.map((candidate) => ({
    ...candidate,
    seed: {
      ...candidate.seed,
      objective_quality: {
        ...candidate.seed.objective_quality,
        provenance: [source, profileSource],
      },
      source_san_paths: [["z-path"], ["a-path"]],
      database_evidence_ids: ["evidence:z", "evidence:a"],
      provenance: candidate.seed.provenance.map((item) => ({
        ...item,
        provenance: [source, profileSource],
      })),
    },
    subtree: {
      ...candidate.subtree,
      nodes: candidate.subtree.nodes.map((node) => ({
        ...node,
        source_san_paths: [["z-path"], ["a-path"]],
      })) as typeof candidate.subtree.nodes,
      edges: candidate.subtree.edges.map((edge) => ({
        ...edge,
        source_san_paths: [["z-path"], ["a-path"]],
        annotation_text: ["z-note", "a-note"],
      })) as typeof candidate.subtree.edges,
      provenance: candidate.subtree.provenance.map((item) => ({
        ...item,
        provenance: [source, profileSource],
      })),
    },
  }));
  const trainingFirst = allCandidateConceptMastery(
    scoreReplacementCandidates(input(values.fixture, ordered)),
  );
  const reversed = ordered
    .slice()
    .reverse()
    .map((candidate) => ({
      ...candidate,
      seed: {
        ...candidate.seed,
        objective_quality: {
          ...candidate.seed.objective_quality,
          provenance: [...candidate.seed.objective_quality.provenance].reverse(),
        },
        source_san_paths: [...candidate.seed.source_san_paths].reverse(),
        database_evidence_ids: [...candidate.seed.database_evidence_ids].reverse(),
        provenance: [...candidate.seed.provenance].reverse().map((item) => ({
          ...item,
          provenance: [...item.provenance].reverse(),
        })),
      },
      subtree: {
        ...candidate.subtree,
        nodes: [...candidate.subtree.nodes].reverse().map((node) => ({
          ...node,
          outgoing_edge_ids: [...node.outgoing_edge_ids].reverse(),
          source_san_paths: [...node.source_san_paths].reverse(),
        })) as typeof candidate.subtree.nodes,
        edges: [...candidate.subtree.edges].reverse().map((edge) => ({
          ...edge,
          source_san_paths: [...edge.source_san_paths].reverse(),
          annotation_text: [...edge.annotation_text].reverse(),
        })) as typeof candidate.subtree.edges,
        routes: [...candidate.subtree.routes].reverse() as typeof candidate.subtree.routes,
        provenance: [...candidate.subtree.provenance].reverse().map((item) => ({
          ...item,
          provenance: [...item.provenance].reverse(),
        })),
      },
    }));
  const firstBase = input(values.fixture, ordered, {
    ...trainingFirst,
    provenance: [source, profileSource],
  });
  const secondBase = input(values.fixture, reversed, {
    ...trainingFirst,
    concept_mastery: [...trainingFirst.concept_mastery].reverse(),
    provenance: [profileSource, source],
  });
  const firstInput: ScoreReplacementCandidatesInput = {
    ...firstBase,
    metrics: {
      ...firstBase.metrics,
      strategic_entropy: {
        ...firstBase.metrics.strategic_entropy,
        provenance: [source, profileSource],
      },
    },
  };
  const secondInput: ScoreReplacementCandidatesInput = {
    ...secondBase,
    metrics: {
      ...secondBase.metrics,
      strategic_entropy: {
        ...secondBase.metrics.strategic_entropy,
        provenance: [profileSource, source],
      },
    },
  };
  const first = scoreReplacementCandidates(firstInput);
  const second = scoreReplacementCandidates(secondInput);
  assert.deepEqual(second, first);
});

test("Black repertoire ownership and White/repertoire POV labels remain independent", () => {
  const fixture = contextFixture(profile(), "black");
  const candidate = completeCandidate(fixture, "Nf6", "candidate:black", 12, 0.8);
  const result = scoreReplacementCandidates(input(fixture, [candidate], null));
  const scored = result.candidates[0]!;
  assert.equal(result.repertoire_color, "black");
  assert.equal(scored.repertoire_color, "black");
  assert.equal(scored.expansion.seed.pivot.owner, "repertoire");
  assert.equal(scored.expansion.subtree.edges[0]!.mover_color, "black");
  assert.equal(scored.objective_quality.white_pov_evaluation_cp, 28);
  assert.equal(scored.objective_quality.repertoire_pov_loss_from_best_cp, 12);
});

test("identity, provenance, versions, source-state evidence, and inputs serialize without mutation", () => {
  const values = completeFixture();
  const scoringInput = input(values.fixture, values.candidates, null);
  const before = JSON.stringify(scoringInput);
  const result = scoreReplacementCandidates(scoringInput);
  assert.equal(JSON.stringify(scoringInput), before);
  const serialized = JSON.stringify(result);
  assert.deepEqual(JSON.parse(serialized), result);
  assert.equal(result.request_id, "request:score");
  assert.equal(result.report_id, "report:score");
  assert.equal(result.finding_id, "finding:score");
  assert.equal(result.semantic_finding_id, "semantic-finding:score");
  assert.equal(result.cohort_id, "cohort:score");
  assert.equal(result.repertoire_revision, "revision:score");
  assert.equal(result.schema_version, STRATEGIC_FIT_SCHEMA_VERSION);
  assert.equal(result.analysis_version, STRATEGIC_FIT_ANALYSIS_VERSION);
  assert.equal(result.replacement_schema_version, STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION);
  assert.deepEqual(
    result.expansion.candidates.map((candidate) => candidate.candidate_id),
    scoringInput.expansion.candidates.map((candidate) => candidate.candidate_id).sort(),
  );
  assert.equal(result.expansion.candidates.length, scoringInput.expansion.candidates.length);
  assert.deepEqual(result.context.graph, scoringInput.graph);
  assert.deepEqual(result.context.profile, scoringInput.request.profile);
  assert.deepEqual(result.context.metrics, scoringInput.metrics);
  assert.ok(result.provenance.some((item) => item.source_id === "strategic-fit:replacement-score"));
  assert.equal(result.source_graph_unchanged, true);
  assert.equal(result.source_context_unchanged, true);
  assert.equal(result.expansion_unchanged, true);
  assert.equal(result.inputs_unchanged, true);
});

test("score, Pareto, result, and error enums are exhaustive and duplicate-free", () => {
  assert.deepEqual(REPLACEMENT_SCORE_STATES, ["available", "partial", "unavailable"]);
  assert.deepEqual(REPLACEMENT_PARETO_STATUSES, ["unscored", "pareto-optimal", "dominated"]);
  assert.deepEqual(REPLACEMENT_SCORING_RESULT_STATUSES, [
    "complete",
    "partial",
    "unavailable",
    "stale",
    "invalid-request",
  ]);
  assert.deepEqual(REPLACEMENT_SCORING_ERROR_CODES, [
    "request-expansion-mismatch",
    "expansion-not-current",
    "graph-context-mismatch",
    "cohort-context-mismatch",
    "trajectory-context-mismatch",
    "concept-context-mismatch",
    "invalid-training-evidence",
    "invalid-profile",
    "malformed-expansion",
  ]);
  for (const values of [
    REPLACEMENT_STRATEGIC_SCORE_AXES,
    REPLACEMENT_PARETO_AXES,
    REPLACEMENT_SCORE_STATES,
    REPLACEMENT_PARETO_STATUSES,
    REPLACEMENT_SCORING_RESULT_STATUSES,
    REPLACEMENT_SCORING_ERROR_CODES,
  ])
    assert.equal(new Set(values).size, values.length);
});
