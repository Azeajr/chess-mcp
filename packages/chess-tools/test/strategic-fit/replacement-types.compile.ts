import {
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  type ReplacementCandidate,
  type ReplacementCandidateSubtree,
  type ReplacementCandidateSourceKind,
  type ReplacementCandidateSourceStatus,
  type ReplacementChangeOperationKind,
  type ReplacementChangeSet,
  type ReplacementChangeSetFailure,
  type ReplacementChangeSetResult,
  type ReplacementChangeSetStatus,
  type ReplacementChangeSetAppliedSuccess,
  type ReplacementChangeSetPreviewSuccess,
  type ReplacementObjectiveQuality,
  type ReplacementParetoAxis,
  type ReplacementParetoStatus,
  type ReplacementRequest,
  type ReplacementRetentionChoices,
  type ReplacementRiskKind,
  type ReplacementSafetyCheckKind,
  type ReplacementStrategicScoreAxis,
  type ReplacementSubtreeStatus,
  type StrategicFitProfile,
} from "../../src/index.ts";

const version = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
} as const;

const source = {
  source_id: "strategic-fit:replacement-fixture",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: null,
  reason: null,
} as const;

const profile = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  mode: "balanced",
  source: "explicit",
  provisional: false,
  preferences: {
    maximum_engine_loss_cp: 35,
    opponent_popularity_importance: 1,
    personal_game_frequency_importance: 0,
    manual_weight_importance: 0,
    additional_memorization_tolerance: 0.5,
    preferred_concept_ids: [],
    avoided_concept_ids: [],
    preferred_tactical_character: [],
    minimum_opponent_coverage: 0.9,
    feature_family_weights: {
      "pawn-topology": 1,
      "center-dynamics": 1,
      "king-and-piece-setup": 1,
      "space-and-files": 1,
      "dynamic-character": 1,
      "learning-concepts": 1,
    },
  },
} satisfies StrategicFitProfile;

export const BLACK_REPLACEMENT_REQUEST = {
  ...version,
  request_id: "replacement-request:black-fixture",
  report_id: "report:black-fixture",
  finding_id: "finding:black-fixture",
  semantic_finding_id: "semantic-finding:black-fixture",
  cohort_id: "cohort:sicilian",
  repertoire_revision: "revision:black-fixture",
  repertoire_color: "black",
  pivot_selection: { kind: "automatic", decision_id: null },
  profile,
  candidate_sources: ["existing-repertoire-transposition", "engine-multipv"],
  user_candidate_san_lines: [],
  maximum_repertoire_pov_loss_from_best_cp: 35,
  minimum_expected_opponent_coverage: 0.9,
  budget: {
    maximum_candidates: 6,
    maximum_subtree_nodes_per_candidate: 80,
    maximum_engine_positions: 24,
    maximum_explorer_queries: 20,
    engine_depth: 20,
    engine_multipv: 4,
    strategic_horizon_ply: 24,
    minimum_reply_popularity: 0.03,
    include_all_forcing_replies: true,
  },
  provenance: [source],
} satisfies ReplacementRequest;

const candidateSource = {
  ...version,
  source_id: "source:existing-prep",
  kind: "existing-repertoire-transposition",
  status: "available",
  provider: "local-repertoire",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: "revision:black-fixture",
  reason: null,
  position_ids: ["position:pivot", "position:target"],
  decision_ids: ["decision:c5"],
  route_ids: ["route:sicilian"],
  details: { memory_class: "existing-preparation" },
  provenance: [source],
} as const;

const pivot = {
  ...version,
  pivot_id: "pivot:c5",
  status: "actionable",
  owner: "repertoire",
  repertoire_color: "black",
  decision_id: "decision:c5",
  position_id: "position:pivot",
  ply: 2,
  san: "c5",
  uci: "c7c5",
  controllability: 0.9,
  control_label: "mostly-player-controlled",
  player_contribution: 0.9,
  opponent_contribution: 0.1,
  causal_event_ids: ["event:c5"],
  affected_feature_ids: ["center.fluid"],
  alternative_decision_ids: [],
  transposition_position_ids: ["position:target"],
  source_san_paths: [["e4", "c5"]],
  explanation: "Black controls this repertoire decision.",
  provenance: [source],
} as const;

const rootNode = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  node_id: "node:pivot",
  kind: "root",
  position_id: "position:pivot",
  fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
  ply: 1,
  outgoing_edge_ids: ["edge:c5"],
  source_san_paths: [["e4"]],
  transposition_target_position_id: null,
} as const;

const terminalNode = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  node_id: "node:target",
  kind: "transposition",
  position_id: "position:target",
  fen: "rnbqkbnr/pp1p1ppp/8/2p1p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  ply: 2,
  outgoing_edge_ids: [],
  source_san_paths: [["e4", "c5"]],
  transposition_target_position_id: "position:existing-prep",
} as const;

export const BLACK_REPLACEMENT_SUBTREE = {
  ...version,
  subtree_id: "subtree:black-fixture",
  status: "complete",
  root_position_id: rootNode.position_id,
  root_node_id: rootNode.node_id,
  nodes: [rootNode, terminalNode],
  edges: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    edge_id: "edge:c5",
    from_node_id: rootNode.node_id,
    to_node_id: terminalNode.node_id,
    decision_id: "decision:c5",
    san: "c5",
    uci: "c7c5",
    mover_color: "black",
    owner: "repertoire",
    forcing: false,
    expected_opponent_frequency: null,
    source_san_paths: [["e4", "c5"]],
    annotation_text: ["Transposes to existing preparation."],
  }],
  routes: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    route_id: "candidate-route:c5",
    node_ids: [rootNode.node_id, terminalNode.node_id],
    edge_ids: ["edge:c5"],
    terminal_node_id: terminalNode.node_id,
    termination: "existing-preparation",
    expected_opponent_frequency: 1,
  }],
  completion: {
    kind: "immediate-transposition",
    target_position_id: "position:existing-prep",
  },
  strategic_horizon_ply: 2,
  important_reply_count: 0,
  covered_important_reply_count: 0,
  forcing_reply_count: 0,
  covered_forcing_reply_count: 0,
  truncation_reasons: [],
  unresolved_risk_ids: [],
  provenance: [candidateSource],
} satisfies ReplacementCandidateSubtree;

export const BLACK_REPLACEMENT_OBJECTIVE_QUALITY = {
  ...version,
  state: "available",
  /** Negative favors Black in White-POV transport. */
  white_pov_evaluation_cp: -42,
  white_pov_mate_in: null,
  white_pov_best_evaluation_cp: -50,
  white_pov_best_mate_in: null,
  /** Positive favors this Black repertoire. */
  repertoire_pov_evaluation_cp: 42,
  repertoire_pov_mate_in: null,
  repertoire_pov_loss_from_best_cp: 8,
  repertoire_pov_verdict: "within-tolerance",
  engine_depth: 20,
  engine_multipv: 4,
  evaluation_uncertainty_cp: 6,
  tactical_volatility: 0.18,
  evaluation_sensitivity_cp: 9,
  forcing_density: 0.25,
  king_safety_risk: 0.12,
  viable_move_width: 4,
  database_performance: 0.51,
  theoretical_status: "established",
  reason: null,
  provenance: [source],
} satisfies ReplacementObjectiveQuality;

const strategicScore = {
  ...version,
  state: "available",
  cohort_id: "cohort:sicilian",
  trajectory_ids: ["trajectory:c5"],
  strategic_fit_score: 0.84,
  strategic_fit_delta: 0.23,
  strategic_familiarity: 0.95,
  memorization_burden: 0.08,
  expected_opponent_coverage: 0.94,
  new_concept_ids: [],
  theory_nodes_before: 20,
  theory_nodes_after: 21,
  theory_nodes_added: 1,
  theory_nodes_removed: 0,
  popularity: 0.54,
  homogenization_cost: 0.04,
  training_cost: 0.08,
  transposition_position_ids: ["position:existing-prep"],
  contributions: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    axis: "strategic-familiarity",
    state: "available",
    normalized_score: 0.95,
    raw_value: 0.95,
    unit: "fraction",
    higher_is_better: true,
    reason: null,
    provenance: [source],
  }],
  provenance: [source],
} as const;

const coverageEffects = {
  ...version,
  state: "available",
  popularity_weighted_before: 0.91,
  popularity_weighted_after: 0.94,
  popularity_weighted_delta: 0.03,
  required_reply_count_before: 8,
  required_reply_count_after: 8,
  newly_uncovered_replies: [],
  newly_covered_replies: [],
  duplicate_branch_ids: [],
  new_transposition_position_ids: ["position:existing-prep"],
  affected_metrics: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: "familiarity-adjusted-coverage",
    before: 0.72,
    after: 0.88,
    delta: 0.16,
    unit: "fraction",
    reason: null,
  }],
  reason: null,
  provenance: [source],
} as const;

export const BLACK_REPLACEMENT_CANDIDATE = {
  ...version,
  candidate_id: "candidate:black-fixture",
  request_id: BLACK_REPLACEMENT_REQUEST.request_id,
  repertoire_revision: BLACK_REPLACEMENT_REQUEST.repertoire_revision,
  repertoire_color: "black",
  status: "viable",
  pivot,
  subtree: BLACK_REPLACEMENT_SUBTREE,
  objective_quality: BLACK_REPLACEMENT_OBJECTIVE_QUALITY,
  strategic_score: strategicScore,
  coverage_effects: coverageEffects,
  pareto: {
    ...version,
    status: "pareto-optimal",
    axis_ids: ["strategic-familiarity", "expected-coverage", "memorization-burden"],
    dominated_by_candidate_ids: [],
    reason: null,
  },
  unresolved_risks: [],
  retention: {
    archive: "keep-active",
    prune: "retain",
    prune_explicitly_confirmed: false,
    archive_before_prune: true,
  },
  proposed_change_set_id: "change-set:black-fixture",
  provenance: [candidateSource],
} satisfies ReplacementCandidate;

export const BLACK_REPLACEMENT_CHANGE_SET = {
  ...version,
  change_set_id: BLACK_REPLACEMENT_CANDIDATE.proposed_change_set_id,
  request_id: BLACK_REPLACEMENT_REQUEST.request_id,
  candidate_id: BLACK_REPLACEMENT_CANDIDATE.candidate_id,
  base_repertoire_revision: BLACK_REPLACEMENT_REQUEST.repertoire_revision,
  status: "validated",
  atomic: true,
  staged: true,
  retention: BLACK_REPLACEMENT_CANDIDATE.retention,
  operations: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: "operation:add-subtree",
    sequence: 0,
    kind: "add-subtree",
    parent: {
      position_id: "position:pivot",
      decision_id: null,
      source_san_path: ["e4"],
    },
    subtree: BLACK_REPLACEMENT_SUBTREE,
    provenance: [source],
  }],
  safety_checks: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    kind: "coverage",
    status: "passed",
    explanation: "Expected coverage does not regress.",
    risk_ids: [],
    provenance: [source],
  }],
  unresolved_risk_ids: [],
  provenance: [source],
} satisfies ReplacementChangeSet;

export const BLACK_REPLACEMENT_CHANGE_SET_FAILURE = {
  ...version,
  change_set_id: BLACK_REPLACEMENT_CHANGE_SET.change_set_id,
  base_repertoire_revision: BLACK_REPLACEMENT_CHANGE_SET.base_repertoire_revision,
  atomic: true,
  source_tree_unchanged: true,
  operation_results: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: "operation:add-subtree",
    status: "failed",
    error_code: "stale_semantic_path",
    explanation: "Source path no longer resolves to the pivot.",
  }],
  provenance: [source],
  status: "failed",
  result: null,
  failure: {
    code: "stale_semantic_path",
    operation_id: "operation:add-subtree",
    explanation: "No changed tree is returned.",
  },
} satisfies ReplacementChangeSetFailure;

export const BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS = {
  ...version,
  change_set_id: BLACK_REPLACEMENT_CHANGE_SET.change_set_id,
  base_repertoire_revision: BLACK_REPLACEMENT_CHANGE_SET.base_repertoire_revision,
  atomic: true,
  source_tree_unchanged: true,
  operation_results: [{
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    operation_id: "operation:add-subtree",
    status: "applied",
    error_code: null,
    explanation: "Candidate subtree added to clone.",
  }],
  provenance: [source],
  status: "previewed",
  result: {
    repertoire_revision: null,
    pgn: "[Event \"Replacement preview\"]\n\n1. e4 c5 *",
    preview: {
      ...version,
      before: {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        position_count: 20,
        decision_count: 19,
        route_count: 4,
        source_route_count: 4,
        transposition_count: 0,
      },
      after: {
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        position_count: 21,
        decision_count: 20,
        route_count: 5,
        source_route_count: 5,
        transposition_count: 1,
      },
      objective_quality_before: {
        ...BLACK_REPLACEMENT_OBJECTIVE_QUALITY,
        white_pov_evaluation_cp: -35,
        repertoire_pov_evaluation_cp: 35,
        repertoire_pov_loss_from_best_cp: 15,
      },
      objective_quality_after: BLACK_REPLACEMENT_OBJECTIVE_QUALITY,
      strategic_score_before: {
        ...strategicScore,
        strategic_fit_score: 0.61,
        strategic_fit_delta: 0,
      },
      strategic_score_after: strategicScore,
      coverage_effects: coverageEffects,
      affected_paths: [["e4", "c5"]],
      preserved_annotation_count: 0,
      archive_ids: [],
      changed_finding_ids: ["finding:black-fixture"],
      new_finding_ids: [],
      resolved_finding_ids: [],
    },
  },
  failure: null,
} satisfies ReplacementChangeSetPreviewSuccess;

export const BLACK_REPLACEMENT_CHANGE_SET_APPLIED_SUCCESS = {
  ...BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS,
  status: "applied",
  result: {
    ...BLACK_REPLACEMENT_CHANGE_SET_PREVIEW_SUCCESS.result,
    repertoire_revision: "revision:black-fixture:applied",
  },
} satisfies ReplacementChangeSetAppliedSuccess;

const candidateSourceExhaustiveness: Record<ReplacementCandidateSourceKind, true> = {
  "existing-repertoire-transposition": true,
  "opening-database": true,
  "engine-multipv": true,
  "user-defined": true,
  "structurally-similar-repertoire": true,
  "move-order-shortcut": true,
};

const candidateSourceStatusExhaustiveness: Record<ReplacementCandidateSourceStatus, true> = {
  available: true,
  partial: true,
  unavailable: true,
  stale: true,
  rejected: true,
  cancelled: true,
};

const candidateStatusExhaustiveness: Record<ReplacementCandidate["status"], true> = {
  viable: true,
  partial: true,
  blocked: true,
  rejected: true,
  cancelled: true,
};

const subtreeStatusExhaustiveness: Record<ReplacementSubtreeStatus, true> = {
  complete: true,
  truncated: true,
  blocked: true,
};

const paretoStatusExhaustiveness: Record<ReplacementParetoStatus, true> = {
  unscored: true,
  "pareto-optimal": true,
  dominated: true,
};

const paretoAxisExhaustiveness: Record<ReplacementParetoAxis, true> = {
  "objective-quality": true,
  "strategic-fit": true,
  "strategic-familiarity": true,
  "memorization-burden": true,
  "expected-coverage": true,
  "new-concepts": true,
  "theory-size": true,
  popularity: true,
  "homogenization-cost": true,
  "training-cost": true,
};

const changeSetStatusExhaustiveness: Record<ReplacementChangeSetStatus, true> = {
  draft: true,
  validated: true,
  blocked: true,
};

const changeSetResultStatusExhaustiveness: Record<ReplacementChangeSetResult["status"], true> = {
  previewed: true,
  applied: true,
  rejected: true,
  failed: true,
  stale: true,
};

const operationKindExhaustiveness: Record<ReplacementChangeOperationKind, true> = {
  "add-subtree": true,
  "link-transposition": true,
  "preserve-annotation": true,
  "archive-subtree": true,
  "prune-subtree": true,
  "reorder-variations": true,
  "create-training-item": true,
  "update-intent-metadata": true,
};

const safetyCheckExhaustiveness: Record<ReplacementSafetyCheckKind, true> = {
  legality: true,
  "engine-sanity": true,
  coverage: true,
  "gap-scan": true,
  transpositions: true,
  duplicates: true,
  "stale-revision": true,
  "affected-cohort-preview": true,
};

const scoreAxisExhaustiveness: Record<ReplacementStrategicScoreAxis, true> = {
  "strategic-fit": true,
  "strategic-familiarity": true,
  "memorization-burden": true,
  "expected-coverage": true,
  "new-concepts": true,
  "theory-size": true,
  popularity: true,
  "homogenization-cost": true,
  "training-cost": true,
};

const riskKindExhaustiveness: Record<ReplacementRiskKind, true> = {
  "incomplete-expansion": true,
  "unresolved-forcing-reply": true,
  "engine-unverified": true,
  "evaluation-sensitive": true,
  "tactical-volatility": true,
  "king-safety": true,
  "coverage-gap": true,
  "duplicate-line": true,
  "transposition-uncertain": true,
  "stale-source": true,
  "annotation-conflict": true,
};

const { subtree: omittedSubtree, ...oneMoveOnlyCandidate } = BLACK_REPLACEMENT_CANDIDATE;
void omittedSubtree;
// @ts-expect-error Full candidate subtrees are mandatory.
const invalidOneMoveCandidate: ReplacementCandidate = oneMoveOnlyCandidate;

const invalidEmptySubtree: ReplacementCandidateSubtree = {
  ...BLACK_REPLACEMENT_SUBTREE,
  // @ts-expect-error A full subtree must include a root and reached position.
  nodes: [],
  // @ts-expect-error A full subtree must include at least one edge.
  edges: [],
  // @ts-expect-error A full subtree must include at least one complete route.
  routes: [],
};

const invalidLinearPvSubtree: ReplacementCandidateSubtree = {
  ...BLACK_REPLACEMENT_SUBTREE,
  completion: {
    kind: "expanded-opponent-replies",
    // @ts-expect-error Nonterminal completion requires at least one expanded opponent reply.
    opponent_reply_edge_ids: [],
    comparable_strategic_horizon_reached: true,
  },
};

const invalidAutomaticPivot: ReplacementRequest = {
  ...BLACK_REPLACEMENT_REQUEST,
  // @ts-expect-error Automatic pivot selection cannot carry a user-selected decision.
  pivot_selection: { kind: "automatic", decision_id: "decision:c5" },
};

// @ts-expect-error Pruning requires archive selection and explicit confirmation.
const invalidUnarchivedPrune: ReplacementRetentionChoices = {
  archive: "keep-active",
  prune: "prune",
  prune_explicitly_confirmed: true,
  archive_before_prune: true,
};

void candidateSourceExhaustiveness;
void candidateSourceStatusExhaustiveness;
void candidateStatusExhaustiveness;
void subtreeStatusExhaustiveness;
void paretoStatusExhaustiveness;
void paretoAxisExhaustiveness;
void changeSetStatusExhaustiveness;
void changeSetResultStatusExhaustiveness;
void operationKindExhaustiveness;
void safetyCheckExhaustiveness;
void scoreAxisExhaustiveness;
void riskKindExhaustiveness;
void invalidOneMoveCandidate;
void invalidEmptySubtree;
void invalidLinearPvSubtree;
void invalidAutomaticPivot;
void invalidUnarchivedPrune;
