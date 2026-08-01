/**
 * Framework-free, JSON-safe Replacement Lab contracts.
 *
 * These contracts describe complete candidate subtrees and clone-based atomic change sets. They do
 * not generate, score, validate, stage, or apply a replacement; later domain and host tasks own
 * those behaviors. SAN paths remain navigation references while semantic IDs and repertoire
 * revisions own identity.
 */
import type { Color } from "../congruence.js";
import type { RepertoireMoveOwner } from "./graph.js";
import type {
  AnalysisVersioned,
  CausalControlLabel,
  JsonValue,
  SemanticReferences,
  StrategicFitMetricId,
  StrategicFitProfile,
  StrategicFitSourceProvenance,
  StrategicFitVersioned,
} from "./types.js";

/** Independent schema for the additive Replacement Lab contract. */
export const STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION = "1.0.0";

export interface StrategicFitReplacementVersioned extends StrategicFitVersioned {
  readonly replacement_schema_version: typeof STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION;
}

export const REPLACEMENT_CANDIDATE_SOURCE_KINDS = [
  "existing-repertoire-transposition",
  "opening-database",
  "engine-multipv",
  "user-defined",
  "structurally-similar-repertoire",
  "move-order-shortcut",
] as const;
export type ReplacementCandidateSourceKind = (typeof REPLACEMENT_CANDIDATE_SOURCE_KINDS)[number];

export const REPLACEMENT_CANDIDATE_SOURCE_STATUSES = [
  "available",
  "partial",
  "unavailable",
  "stale",
  "rejected",
  "cancelled",
] as const;
export type ReplacementCandidateSourceStatus =
  (typeof REPLACEMENT_CANDIDATE_SOURCE_STATUSES)[number];

export interface ReplacementCandidateSourceProvenance extends StrategicFitReplacementVersioned {
  readonly source_id: string;
  readonly kind: ReplacementCandidateSourceKind;
  readonly status: ReplacementCandidateSourceStatus;
  readonly provider: string | null;
  readonly version: string | null;
  readonly snapshot: string | null;
  readonly reason: string | null;
  readonly position_ids: readonly string[];
  readonly decision_ids: readonly string[];
  readonly route_ids: readonly string[];
  readonly details: Readonly<Record<string, JsonValue>>;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_PIVOT_SELECTION_KINDS = ["automatic", "user-selected"] as const;
export type ReplacementPivotSelectionKind = (typeof REPLACEMENT_PIVOT_SELECTION_KINDS)[number];

export type ReplacementPivotSelection =
  | {
      readonly kind: "automatic";
      readonly decision_id: null;
    }
  | {
      readonly kind: "user-selected";
      readonly decision_id: string;
    };

export interface ReplacementGenerationBudget {
  readonly maximum_candidates: number;
  readonly maximum_subtree_nodes_per_candidate: number;
  readonly maximum_engine_positions: number;
  readonly maximum_explorer_queries: number;
  readonly engine_depth: number;
  readonly engine_multipv: number;
  readonly strategic_horizon_ply: number;
  readonly minimum_reply_popularity: number;
  readonly include_all_forcing_replies: boolean;
}

export interface ReplacementRequest extends StrategicFitReplacementVersioned {
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly pivot_selection: ReplacementPivotSelection;
  readonly profile: StrategicFitProfile;
  readonly candidate_sources: readonly ReplacementCandidateSourceKind[];
  /** SAN move sequences supplied by the user; legality remains a deterministic tool decision. */
  readonly user_candidate_san_lines: readonly (readonly string[])[];
  readonly maximum_repertoire_pov_loss_from_best_cp: number | null;
  readonly minimum_expected_opponent_coverage: number | null;
  readonly budget: ReplacementGenerationBudget;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_PIVOT_STATUSES = ["actionable", "shared", "non-actionable"] as const;
export type ReplacementPivotStatus = (typeof REPLACEMENT_PIVOT_STATUSES)[number];

interface ReplacementCausalPivotEvidenceBase extends StrategicFitReplacementVersioned {
  readonly pivot_id: string;
  readonly repertoire_color: Color;
  readonly controllability: number | null;
  readonly control_label: CausalControlLabel;
  readonly player_contribution: number | null;
  readonly opponent_contribution: number | null;
  readonly causal_event_ids: readonly string[];
  readonly affected_feature_ids: readonly string[];
  readonly alternative_decision_ids: readonly string[];
  readonly transposition_position_ids: readonly string[];
  readonly source_san_paths: readonly (readonly string[])[];
  readonly explanation: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementActionablePivotEvidence extends ReplacementCausalPivotEvidenceBase {
  readonly status: "actionable";
  readonly owner: "repertoire";
  readonly decision_id: string;
  readonly position_id: string;
  readonly ply: number;
  readonly san: string;
  readonly uci: string;
}

export interface ReplacementSharedPivotEvidence extends ReplacementCausalPivotEvidenceBase {
  readonly status: "shared";
  readonly owner: null;
  readonly decision_id: null;
  readonly position_id: null;
  readonly ply: null;
  readonly san: null;
  readonly uci: null;
}

export interface ReplacementNonActionablePivotEvidence extends ReplacementCausalPivotEvidenceBase {
  readonly status: "non-actionable";
  readonly owner: null;
  readonly decision_id: null;
  readonly position_id: null;
  readonly ply: null;
  readonly san: null;
  readonly uci: null;
}

export type ReplacementCausalPivotEvidence =
  | ReplacementActionablePivotEvidence
  | ReplacementSharedPivotEvidence
  | ReplacementNonActionablePivotEvidence;

export const REPLACEMENT_SUBTREE_NODE_KINDS = [
  "root",
  "repertoire-decision",
  "opponent-reply",
  "transposition",
  "terminal",
] as const;
export type ReplacementSubtreeNodeKind = (typeof REPLACEMENT_SUBTREE_NODE_KINDS)[number];

export interface ReplacementSubtreeNode extends AnalysisVersioned {
  readonly node_id: string;
  readonly kind: ReplacementSubtreeNodeKind;
  readonly position_id: string;
  readonly fen: string;
  readonly ply: number;
  readonly outgoing_edge_ids: readonly string[];
  readonly source_san_paths: readonly (readonly string[])[];
  /** Set only when the node joins an existing prepared position. */
  readonly transposition_target_position_id: string | null;
}

export interface ReplacementSubtreeEdge extends AnalysisVersioned {
  readonly edge_id: string;
  readonly from_node_id: string;
  readonly to_node_id: string;
  readonly decision_id: string;
  readonly san: string;
  readonly uci: string;
  readonly mover_color: Color;
  readonly owner: RepertoireMoveOwner;
  readonly forcing: boolean;
  readonly expected_opponent_frequency: number | null;
  readonly source_san_paths: readonly (readonly string[])[];
  readonly annotation_text: readonly string[];
}

export const REPLACEMENT_SUBTREE_ROUTE_TERMINATIONS = [
  "strategic-horizon",
  "existing-preparation",
  "terminal-position",
  "budget-exhausted",
  "unresolved-reply",
] as const;
export type ReplacementSubtreeRouteTermination =
  (typeof REPLACEMENT_SUBTREE_ROUTE_TERMINATIONS)[number];

export interface ReplacementSubtreeRoute extends AnalysisVersioned {
  readonly route_id: string;
  readonly node_ids: readonly string[];
  readonly edge_ids: readonly string[];
  readonly terminal_node_id: string;
  readonly termination: ReplacementSubtreeRouteTermination;
  readonly expected_opponent_frequency: number | null;
}

export const REPLACEMENT_SUBTREE_STATUSES = ["complete", "truncated", "blocked"] as const;
export type ReplacementSubtreeStatus = (typeof REPLACEMENT_SUBTREE_STATUSES)[number];

export const REPLACEMENT_SUBTREE_COMPLETION_KINDS = [
  "expanded-opponent-replies",
  "immediate-transposition",
  "terminal-position",
] as const;
export type ReplacementSubtreeCompletionKind =
  (typeof REPLACEMENT_SUBTREE_COMPLETION_KINDS)[number];

export type ReplacementSubtreeCompletion =
  | {
      readonly kind: "expanded-opponent-replies";
      readonly opponent_reply_edge_ids: readonly [string, ...string[]];
      readonly comparable_strategic_horizon_reached: true;
    }
  | {
      readonly kind: "immediate-transposition";
      readonly target_position_id: string;
    }
  | {
      readonly kind: "terminal-position";
      readonly terminal_node_id: string;
    };

interface ReplacementCandidateSubtreeBase extends StrategicFitReplacementVersioned {
  readonly subtree_id: string;
  readonly root_position_id: string;
  readonly root_node_id: string;
  /** Root plus at least one reached position. */
  readonly nodes: readonly [
    ReplacementSubtreeNode,
    ReplacementSubtreeNode,
    ...ReplacementSubtreeNode[],
  ];
  readonly edges: readonly [ReplacementSubtreeEdge, ...ReplacementSubtreeEdge[]];
  readonly routes: readonly [ReplacementSubtreeRoute, ...ReplacementSubtreeRoute[]];
  readonly strategic_horizon_ply: number;
  readonly important_reply_count: number;
  readonly covered_important_reply_count: number;
  readonly forcing_reply_count: number;
  readonly covered_forcing_reply_count: number;
  readonly unresolved_risk_ids: readonly string[];
  readonly provenance: readonly ReplacementCandidateSourceProvenance[];
}

export interface ReplacementCompleteCandidateSubtree extends ReplacementCandidateSubtreeBase {
  readonly status: "complete";
  readonly completion: ReplacementSubtreeCompletion;
  readonly truncation_reasons: readonly [];
}

export interface ReplacementTruncatedCandidateSubtree extends ReplacementCandidateSubtreeBase {
  readonly status: "truncated";
  readonly completion: null;
  readonly truncation_reasons: readonly [string, ...string[]];
}

export interface ReplacementBlockedCandidateSubtree extends ReplacementCandidateSubtreeBase {
  readonly status: "blocked";
  readonly completion: null;
  readonly truncation_reasons: readonly [string, ...string[]];
}

/** Full bounded proposal. A nonterminal root move or linear engine PV cannot satisfy this contract. */
export type ReplacementCandidateSubtree =
  | ReplacementCompleteCandidateSubtree
  | ReplacementTruncatedCandidateSubtree
  | ReplacementBlockedCandidateSubtree;

export const REPLACEMENT_OBJECTIVE_QUALITY_STATES = [
  "available",
  "partial",
  "unavailable",
] as const;
export type ReplacementObjectiveQualityState =
  (typeof REPLACEMENT_OBJECTIVE_QUALITY_STATES)[number];

export const REPLACEMENT_REPERTOIRE_POV_VERDICTS = [
  "unverified",
  "within-tolerance",
  "outside-tolerance",
  "forced-mate-for-repertoire",
  "forced-mate-against-repertoire",
] as const;
export type ReplacementRepertoirePovVerdict = (typeof REPLACEMENT_REPERTOIRE_POV_VERDICTS)[number];

/**
 * Engine transport exposes both orientations by name. Positive centipawns favor the named side;
 * mate distances are positive when that named side can force mate and negative when it is mated.
 */
export interface ReplacementObjectiveQuality extends StrategicFitReplacementVersioned {
  readonly state: ReplacementObjectiveQualityState;
  readonly white_pov_evaluation_cp: number | null;
  readonly white_pov_mate_in: number | null;
  readonly white_pov_best_evaluation_cp: number | null;
  readonly white_pov_best_mate_in: number | null;
  readonly repertoire_pov_evaluation_cp: number | null;
  readonly repertoire_pov_mate_in: number | null;
  readonly repertoire_pov_loss_from_best_cp: number | null;
  readonly repertoire_pov_verdict: ReplacementRepertoirePovVerdict;
  readonly engine_depth: number | null;
  readonly engine_multipv: number | null;
  readonly evaluation_uncertainty_cp: number | null;
  readonly tactical_volatility: number | null;
  readonly evaluation_sensitivity_cp: number | null;
  readonly forcing_density: number | null;
  readonly king_safety_risk: number | null;
  readonly viable_move_width: number | null;
  readonly database_performance: number | null;
  readonly theoretical_status: string | null;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_SCORE_STATES = ["available", "partial", "unavailable"] as const;
export type ReplacementScoreState = (typeof REPLACEMENT_SCORE_STATES)[number];

export const REPLACEMENT_STRATEGIC_SCORE_AXES = [
  "strategic-fit",
  "strategic-familiarity",
  "memorization-burden",
  "expected-coverage",
  "new-concepts",
  "theory-size",
  "popularity",
  "homogenization-cost",
  "training-cost",
] as const;
export type ReplacementStrategicScoreAxis = (typeof REPLACEMENT_STRATEGIC_SCORE_AXES)[number];

export interface ReplacementStrategicScoreContribution extends AnalysisVersioned {
  readonly axis: ReplacementStrategicScoreAxis;
  readonly state: ReplacementScoreState;
  readonly normalized_score: number | null;
  readonly raw_value: number | null;
  readonly unit: string;
  readonly higher_is_better: boolean;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Inspectable axes only; conflicting objectives are intentionally not collapsed into one score. */
export interface ReplacementStrategicScore extends StrategicFitReplacementVersioned {
  readonly state: ReplacementScoreState;
  readonly cohort_id: string;
  readonly trajectory_ids: readonly string[];
  readonly strategic_fit_score: number | null;
  readonly strategic_fit_delta: number | null;
  readonly strategic_familiarity: number | null;
  readonly memorization_burden: number | null;
  readonly expected_opponent_coverage: number | null;
  readonly new_concept_ids: readonly string[];
  readonly theory_nodes_before: number | null;
  readonly theory_nodes_after: number | null;
  readonly theory_nodes_added: number | null;
  readonly theory_nodes_removed: number | null;
  readonly popularity: number | null;
  readonly homogenization_cost: number | null;
  readonly training_cost: number | null;
  readonly transposition_position_ids: readonly string[];
  readonly contributions: readonly ReplacementStrategicScoreContribution[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_COVERAGE_EFFECT_STATES = ["available", "partial", "unavailable"] as const;
export type ReplacementCoverageEffectState = (typeof REPLACEMENT_COVERAGE_EFFECT_STATES)[number];

export interface ReplacementCoverageReplyEffect extends AnalysisVersioned {
  readonly state: ReplacementCoverageEffectState;
  readonly position_id: string;
  readonly decision_id: string | null;
  readonly san: string | null;
  readonly expected_frequency: number | null;
  readonly forcing: boolean;
  readonly source_san_paths: readonly (readonly string[])[];
  readonly reason: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementMetricEffect extends AnalysisVersioned {
  readonly metric_id: StrategicFitMetricId;
  readonly state: ReplacementCoverageEffectState;
  readonly before: number | null;
  readonly after: number | null;
  readonly delta: number | null;
  readonly unit: string;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementCoverageEffects extends StrategicFitReplacementVersioned {
  readonly state: ReplacementCoverageEffectState;
  readonly popularity_weighted_before: number | null;
  readonly popularity_weighted_after: number | null;
  readonly popularity_weighted_delta: number | null;
  readonly required_reply_count_before: number;
  readonly required_reply_count_after: number;
  readonly newly_uncovered_replies: readonly ReplacementCoverageReplyEffect[];
  readonly newly_covered_replies: readonly ReplacementCoverageReplyEffect[];
  readonly duplicate_branch_ids: readonly string[];
  readonly new_transposition_position_ids: readonly string[];
  readonly affected_metrics: readonly ReplacementMetricEffect[];
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_PARETO_STATUSES = ["unscored", "pareto-optimal", "dominated"] as const;
export type ReplacementParetoStatus = (typeof REPLACEMENT_PARETO_STATUSES)[number];

export const REPLACEMENT_PARETO_AXES = [
  "objective-quality",
  ...REPLACEMENT_STRATEGIC_SCORE_AXES,
] as const;
export type ReplacementParetoAxis = (typeof REPLACEMENT_PARETO_AXES)[number];

export interface ReplacementParetoAssessment extends StrategicFitReplacementVersioned {
  readonly status: ReplacementParetoStatus;
  readonly axis_ids: readonly ReplacementParetoAxis[];
  readonly dominated_by_candidate_ids: readonly string[];
  readonly reason: string | null;
}

export const REPLACEMENT_RISK_KINDS = [
  "incomplete-expansion",
  "unresolved-forcing-reply",
  "engine-unverified",
  "evaluation-sensitive",
  "tactical-volatility",
  "king-safety",
  "coverage-gap",
  "duplicate-line",
  "transposition-uncertain",
  "stale-source",
  "annotation-conflict",
] as const;
export type ReplacementRiskKind = (typeof REPLACEMENT_RISK_KINDS)[number];

export const REPLACEMENT_RISK_STATUSES = ["open", "mitigated", "accepted", "blocking"] as const;
export type ReplacementRiskStatus = (typeof REPLACEMENT_RISK_STATUSES)[number];

export interface ReplacementUnresolvedRisk extends AnalysisVersioned {
  readonly risk_id: string;
  readonly kind: ReplacementRiskKind;
  readonly status: ReplacementRiskStatus;
  readonly explanation: string;
  readonly affected_position_ids: readonly string[];
  readonly affected_route_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_ARCHIVE_CHOICES = ["keep-active", "archive"] as const;
export type ReplacementArchiveChoice = (typeof REPLACEMENT_ARCHIVE_CHOICES)[number];

export const REPLACEMENT_PRUNE_CHOICES = ["retain", "prune"] as const;
export type ReplacementPruneChoice = (typeof REPLACEMENT_PRUNE_CHOICES)[number];

/** Pruning is valid only after explicit confirmation and an archive choice. */
export type ReplacementRetentionChoices =
  | {
      readonly archive: "keep-active";
      readonly prune: "retain";
      readonly prune_explicitly_confirmed: false;
      readonly archive_before_prune: true;
    }
  | {
      readonly archive: "archive";
      readonly prune: "retain";
      readonly prune_explicitly_confirmed: false;
      readonly archive_before_prune: true;
    }
  | {
      readonly archive: "archive";
      readonly prune: "prune";
      readonly prune_explicitly_confirmed: true;
      readonly archive_before_prune: true;
    };

export const REPLACEMENT_CANDIDATE_STATUSES = [
  "viable",
  "partial",
  "blocked",
  "rejected",
  "cancelled",
] as const;
export type ReplacementCandidateStatus = (typeof REPLACEMENT_CANDIDATE_STATUSES)[number];

export interface ReplacementCandidate extends StrategicFitReplacementVersioned {
  readonly candidate_id: string;
  readonly request_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly status: ReplacementCandidateStatus;
  readonly pivot: ReplacementCausalPivotEvidence;
  /** Mandatory full-subtree proposal; never replace with a root move or one engine PV. */
  readonly subtree: ReplacementCandidateSubtree;
  readonly objective_quality: ReplacementObjectiveQuality;
  readonly strategic_score: ReplacementStrategicScore;
  readonly coverage_effects: ReplacementCoverageEffects;
  readonly pareto: ReplacementParetoAssessment;
  readonly unresolved_risks: readonly ReplacementUnresolvedRisk[];
  readonly retention: ReplacementRetentionChoices;
  readonly proposed_change_set_id: string;
  readonly provenance: readonly ReplacementCandidateSourceProvenance[];
}

export const REPLACEMENT_CHANGE_OPERATION_KINDS = [
  "add-subtree",
  "link-transposition",
  "preserve-annotation",
  "archive-subtree",
  "prune-subtree",
  "reorder-variations",
  "create-training-item",
  "update-intent-metadata",
] as const;
export type ReplacementChangeOperationKind = (typeof REPLACEMENT_CHANGE_OPERATION_KINDS)[number];

export interface ReplacementChangeTarget {
  readonly position_id: string;
  readonly decision_id: string | null;
  readonly source_san_path: readonly string[];
}

interface ReplacementChangeOperationBase extends AnalysisVersioned {
  readonly operation_id: string;
  readonly sequence: number;
  readonly kind: ReplacementChangeOperationKind;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementAddSubtreeOperation extends ReplacementChangeOperationBase {
  readonly kind: "add-subtree";
  readonly parent: ReplacementChangeTarget;
  readonly subtree: ReplacementCandidateSubtree;
}

export interface ReplacementLinkTranspositionOperation extends ReplacementChangeOperationBase {
  readonly kind: "link-transposition";
  readonly source: ReplacementChangeTarget;
  readonly target_position_id: string;
}

export interface ReplacementPreserveAnnotationOperation extends ReplacementChangeOperationBase {
  readonly kind: "preserve-annotation";
  readonly source: ReplacementChangeTarget;
  readonly target: ReplacementChangeTarget;
  readonly comments: readonly string[];
  readonly nags: readonly number[];
  readonly semantic_equivalence_verified: boolean;
}

export interface ReplacementArchiveSubtreeOperation extends ReplacementChangeOperationBase {
  readonly kind: "archive-subtree";
  readonly archive_id: string;
  readonly target: ReplacementChangeTarget;
  readonly archive_pgn: string;
  readonly references: SemanticReferences;
}

export interface ReplacementPruneSubtreeOperation extends ReplacementChangeOperationBase {
  readonly kind: "prune-subtree";
  readonly target: ReplacementChangeTarget;
  readonly archive_operation_id: string;
  readonly explicitly_confirmed: true;
}

export interface ReplacementReorderVariationsOperation extends ReplacementChangeOperationBase {
  readonly kind: "reorder-variations";
  readonly parent_position_id: string;
  readonly ordered_decision_ids: readonly string[];
}

export interface ReplacementCreateTrainingItemOperation extends ReplacementChangeOperationBase {
  readonly kind: "create-training-item";
  readonly training_id: string;
  readonly references: SemanticReferences;
  readonly concept_ids: readonly string[];
}

export interface ReplacementUpdateIntentMetadataOperation extends ReplacementChangeOperationBase {
  readonly kind: "update-intent-metadata";
  readonly metadata_id: string;
  readonly references: SemanticReferences;
  readonly value: JsonValue;
}

export type ReplacementChangeOperation =
  | ReplacementAddSubtreeOperation
  | ReplacementLinkTranspositionOperation
  | ReplacementPreserveAnnotationOperation
  | ReplacementArchiveSubtreeOperation
  | ReplacementPruneSubtreeOperation
  | ReplacementReorderVariationsOperation
  | ReplacementCreateTrainingItemOperation
  | ReplacementUpdateIntentMetadataOperation;

export const REPLACEMENT_SAFETY_CHECK_KINDS = [
  "legality",
  "engine-sanity",
  "coverage",
  "gap-scan",
  "transpositions",
  "duplicates",
  "stale-revision",
  "affected-cohort-preview",
] as const;
export type ReplacementSafetyCheckKind = (typeof REPLACEMENT_SAFETY_CHECK_KINDS)[number];

export const REPLACEMENT_SAFETY_CHECK_STATUSES = [
  "passed",
  "warning",
  "blocked",
  "unavailable",
] as const;
export type ReplacementSafetyCheckStatus = (typeof REPLACEMENT_SAFETY_CHECK_STATUSES)[number];

export interface ReplacementSafetyCheck extends AnalysisVersioned {
  readonly kind: ReplacementSafetyCheckKind;
  readonly status: ReplacementSafetyCheckStatus;
  readonly explanation: string;
  readonly risk_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const REPLACEMENT_CHANGE_SET_STATUSES = ["draft", "validated", "blocked"] as const;
export type ReplacementChangeSetStatus = (typeof REPLACEMENT_CHANGE_SET_STATUSES)[number];

export interface ReplacementChangeSet extends StrategicFitReplacementVersioned {
  readonly change_set_id: string;
  readonly request_id: string;
  readonly candidate_id: string;
  readonly base_repertoire_revision: string;
  readonly status: ReplacementChangeSetStatus;
  readonly atomic: true;
  readonly staged: true;
  readonly retention: ReplacementRetentionChoices;
  readonly operations: readonly ReplacementChangeOperation[];
  readonly safety_checks: readonly ReplacementSafetyCheck[];
  readonly unresolved_risk_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementTreeStatistics extends AnalysisVersioned {
  readonly position_count: number;
  readonly decision_count: number;
  readonly route_count: number;
  readonly source_route_count: number;
  readonly transposition_count: number;
}

/** Exact archive evidence produced by the pure Task 8.8 transaction boundary. */
export interface ReplacementArchivePayload extends AnalysisVersioned {
  readonly archive_id: string;
  readonly operation_id: string;
  readonly target: ReplacementChangeTarget;
  readonly pgn: string;
  readonly references: SemanticReferences;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Per-operation structural diff. Empty arrays mean the operation was validation-only. */
export interface ReplacementOperationDiff extends AnalysisVersioned {
  readonly operation_id: string;
  readonly sequence: number;
  readonly kind: ReplacementChangeOperationKind;
  readonly added_paths: readonly (readonly string[])[];
  readonly removed_paths: readonly (readonly string[])[];
  readonly annotated_paths: readonly (readonly string[])[];
  readonly linked_paths: readonly (readonly string[])[];
  readonly archived_paths: readonly (readonly string[])[];
  readonly reordered_parent_paths: readonly (readonly string[])[];
  readonly linked_position_ids: readonly string[];
  readonly archive_ids: readonly string[];
}

export interface ReplacementChangeSetPreview extends StrategicFitReplacementVersioned {
  readonly before: ReplacementTreeStatistics;
  readonly after: ReplacementTreeStatistics;
  readonly objective_quality_before: ReplacementObjectiveQuality;
  readonly objective_quality_after: ReplacementObjectiveQuality;
  readonly strategic_score_before: ReplacementStrategicScore;
  readonly strategic_score_after: ReplacementStrategicScore;
  readonly coverage_effects: ReplacementCoverageEffects;
  readonly affected_paths: readonly (readonly string[])[];
  readonly preserved_annotation_count: number;
  readonly archive_ids: readonly string[];
  readonly operation_diffs: readonly ReplacementOperationDiff[];
  readonly archive_payloads: readonly ReplacementArchivePayload[];
  /** Finding changes require Task 8.9+ commit and reanalysis and are never inferred in Task 8.8. */
  readonly finding_changes_state: "not-reanalyzed";
  readonly changed_finding_ids: readonly string[];
  readonly new_finding_ids: readonly string[];
  readonly resolved_finding_ids: readonly string[];
}

export const REPLACEMENT_OPERATION_RESULT_STATUSES = ["applied", "skipped", "failed"] as const;
export type ReplacementOperationResultStatus =
  (typeof REPLACEMENT_OPERATION_RESULT_STATUSES)[number];

export interface ReplacementOperationResult extends AnalysisVersioned {
  readonly operation_id: string;
  readonly status: ReplacementOperationResultStatus;
  readonly error_code: string | null;
  readonly explanation: string;
}

interface ReplacementChangeSetResultBase extends StrategicFitReplacementVersioned {
  readonly change_set_id: string;
  readonly base_repertoire_revision: string;
  readonly atomic: true;
  /** Domain application always works on a clone and leaves its input tree byte-identical. */
  readonly source_tree_unchanged: true;
  readonly operation_results: readonly ReplacementOperationResult[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementChangeSetPreviewSuccess extends ReplacementChangeSetResultBase {
  readonly status: "previewed";
  readonly result: {
    readonly repertoire_revision: null;
    readonly pgn: string;
    readonly preview: ReplacementChangeSetPreview;
  };
  readonly failure: null;
}

export interface ReplacementChangeSetAppliedSuccess extends ReplacementChangeSetResultBase {
  readonly status: "applied";
  readonly result: {
    readonly repertoire_revision: string;
    readonly pgn: string;
    readonly preview: ReplacementChangeSetPreview;
  };
  readonly failure: null;
}

export type ReplacementChangeSetSuccess =
  | ReplacementChangeSetPreviewSuccess
  | ReplacementChangeSetAppliedSuccess;

export interface ReplacementChangeSetFailure extends ReplacementChangeSetResultBase {
  readonly status: "rejected" | "failed" | "stale";
  /** Atomic failure never exposes a partially changed tree. */
  readonly result: null;
  readonly failure: {
    readonly code: string;
    readonly operation_id: string | null;
    readonly explanation: string;
  };
}

export type ReplacementChangeSetResult = ReplacementChangeSetSuccess | ReplacementChangeSetFailure;

export const REPLACEMENT_CHANGE_SET_RESULT_STATUSES = [
  "previewed",
  "applied",
  "rejected",
  "failed",
  "stale",
] as const satisfies readonly ReplacementChangeSetResult["status"][];
