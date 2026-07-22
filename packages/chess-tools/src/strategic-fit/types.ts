/**
 * Framework-free, JSON-safe contracts for the Congruence 2.0 Strategic Fit domain.
 *
 * These types intentionally contain no host, validation-library, engine-provider, or UI types.
 * Hosts may validate and adapt them at their boundaries, but the shared domain contract remains
 * deterministic and serializable.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface SchemaVersioned {
  readonly schema_version: string;
}

export interface AnalysisVersioned {
  readonly analysis_version: string;
}

export interface StrategicFitVersioned extends SchemaVersioned, AnalysisVersioned {}

export const STRATEGIC_FIT_PROFILE_MODES = ["familiar-plans", "balanced", "versatile", "custom"] as const;
export type StrategicFitProfileMode = (typeof STRATEGIC_FIT_PROFILE_MODES)[number];

export const STRATEGIC_FIT_PROFILE_SOURCES = ["explicit", "inferred"] as const;
export type StrategicFitProfileSource = (typeof STRATEGIC_FIT_PROFILE_SOURCES)[number];

export interface StrategicFitProfilePreferences {
  /** Maximum acceptable loss from engine best, in centipawns. Null means not configured. */
  readonly maximum_engine_loss_cp: number | null;
  /** Normalized preference weights. */
  readonly opponent_popularity_importance: number;
  readonly personal_game_frequency_importance: number;
  readonly manual_weight_importance: number;
  readonly additional_memorization_tolerance: number;
  readonly preferred_concept_ids: readonly string[];
  readonly avoided_concept_ids: readonly string[];
  readonly preferred_tactical_character: readonly string[];
  readonly minimum_opponent_coverage: number | null;
}

export interface StrategicFitProfile extends SchemaVersioned {
  readonly mode: StrategicFitProfileMode;
  readonly source: StrategicFitProfileSource;
  /** Inferred profiles remain provisional until the user confirms them. */
  readonly provisional: boolean;
  readonly preferences: StrategicFitProfilePreferences;
}

export const STRATEGIC_FIT_SOURCE_KINDS = [
  "deterministic-core",
  "repertoire",
  "user-profile",
  "repertoire-annotation",
  "opening-taxonomy",
  "structure-classifier",
  "concept-classifier",
  "opening-explorer",
  "personal-history",
  "training-metadata",
  "engine",
  "ai-explanation",
] as const;
export type StrategicFitSourceKind = (typeof STRATEGIC_FIT_SOURCE_KINDS)[number];

export const STRATEGIC_FIT_SOURCE_STATES = ["available", "partial", "unavailable", "stale"] as const;
export type StrategicFitSourceState = (typeof STRATEGIC_FIT_SOURCE_STATES)[number];

export interface StrategicFitSourceProvenance {
  readonly source_id: string;
  readonly kind: StrategicFitSourceKind;
  readonly state: StrategicFitSourceState;
  readonly version: string | null;
  readonly snapshot: string | null;
  readonly reason: string | null;
}

export interface StrategicFitProvenance extends StrategicFitVersioned {
  readonly repertoire_revision: string;
  readonly generated_at: string;
  readonly deterministic: boolean;
  readonly sources: readonly StrategicFitSourceProvenance[];
}

export const STRATEGIC_SIGNAL_FAMILIES = [
  "pawn-topology",
  "center-dynamics",
  "king-and-piece-setup",
  "space-and-files",
  "dynamic-character",
  "learning-concepts",
] as const;
export type StrategicSignalFamily = (typeof STRATEGIC_SIGNAL_FAMILIES)[number];

export const STRATEGIC_SIGNAL_KINDS = ["observation", "derived-concept"] as const;
export type StrategicSignalKind = (typeof STRATEGIC_SIGNAL_KINDS)[number];

export const SIGNAL_PERSISTENCE_STATES = ["unknown", "transient", "stable", "irreversible"] as const;
export type SignalPersistenceState = (typeof SIGNAL_PERSISTENCE_STATES)[number];

export interface StrategicSignal<T = JsonValue> extends AnalysisVersioned {
  readonly signal_id: string;
  readonly family: StrategicSignalFamily;
  /** Stable language-neutral identifier; display labels live outside the identity. */
  readonly feature_id: string;
  readonly kind: StrategicSignalKind;
  readonly value: T;
  /** Normalized classifier confidence in the range 0–1. */
  readonly confidence: number;
  readonly persistence: SignalPersistenceState;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const STRATEGIC_CHECKPOINT_KINDS = [
  "opening-exit",
  "central-resolution",
  "irreversible-transformation",
  "configured-ply",
  "final-valid-position",
] as const;
export type StrategicCheckpointKind = (typeof STRATEGIC_CHECKPOINT_KINDS)[number];

export const CHECKPOINT_COMPARABILITY_STATES = ["comparable", "incomplete", "not-comparable"] as const;
export type CheckpointComparabilityState = (typeof CHECKPOINT_COMPARABILITY_STATES)[number];

export interface StrategicCheckpoint extends AnalysisVersioned {
  readonly checkpoint_id: string;
  readonly kind: StrategicCheckpointKind;
  readonly ply: number;
  readonly reason: string;
  readonly comparability: CheckpointComparabilityState;
}

export interface StrategicSnapshot extends AnalysisVersioned {
  readonly snapshot_id: string;
  readonly route_id: string;
  readonly position_id: string;
  readonly fen: string;
  readonly checkpoint: StrategicCheckpoint;
  readonly signals: readonly StrategicSignal[];
  readonly classifier_confidence: number;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const STRATEGIC_TRAJECTORY_STATES = ["complete", "incomplete", "unsupported", "terminal"] as const;
export type StrategicTrajectoryState = (typeof STRATEGIC_TRAJECTORY_STATES)[number];

export interface MissingStrategicCheckpoint {
  readonly kind: StrategicCheckpointKind;
  readonly reason: string;
}

export interface StrategicTrajectory extends AnalysisVersioned {
  readonly trajectory_id: string;
  readonly route_id: string;
  readonly state: StrategicTrajectoryState;
  readonly snapshots: readonly StrategicSnapshot[];
  readonly missing_checkpoints: readonly MissingStrategicCheckpoint[];
  /** Fraction of requested comparable checkpoints with usable evidence. */
  readonly evidence_coverage: number;
  readonly stable_signal_ids: readonly string[];
  readonly transient_signal_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface WeightedRouteReference {
  readonly route_id: string;
  readonly normalized_weight: number;
}

export interface StrategicMode extends AnalysisVersioned {
  readonly mode_id: string;
  readonly cohort_id: string;
  /** A mode is represented by a real route rather than a synthetic centroid. */
  readonly representative_route_id: string;
  readonly supporting_route_ids: readonly string[];
  readonly concept_ids: readonly string[];
  readonly normalized_weight: number;
  readonly effective_sample_size: number;
  readonly source: "explicit-target" | "inferred-medoid";
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const STRATEGIC_COHORT_STATES = ["actionable", "mixed-profile", "insufficient-evidence", "excluded"] as const;
export type StrategicCohortState = (typeof STRATEGIC_COHORT_STATES)[number];

export interface StrategicCohort extends AnalysisVersioned {
  readonly cohort_id: string;
  readonly state: StrategicCohortState;
  readonly opening_scope_ids: readonly string[];
  readonly decision_scope_ids: readonly string[];
  readonly route_ids: readonly string[];
  readonly excluded_route_ids: readonly string[];
  readonly route_weights: readonly WeightedRouteReference[];
  readonly effective_sample_size: number;
  readonly modes: readonly StrategicMode[];
  readonly override_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const CONFIDENCE_LABELS = ["low", "moderate", "high"] as const;
export type ConfidenceLabel = (typeof CONFIDENCE_LABELS)[number];

export const CONFIDENCE_COMPONENTS = [
  "classifier-confidence",
  "checkpoint-completeness",
  "effective-sample-size",
  "temporal-persistence",
  "cohort-coherence",
  "opening-data-quality",
  "causal-attribution-quality",
] as const;
export type ConfidenceComponentKind = (typeof CONFIDENCE_COMPONENTS)[number];

export const CONFIDENCE_CAP_REASONS = [
  "effective-sample-below-four",
  "substantial-incomplete-line-share",
  "unresolved-classifier-conflict",
  "missing-taxonomy-with-strong-structural-evidence",
] as const;
export type ConfidenceCapReason = (typeof CONFIDENCE_CAP_REASONS)[number];

export interface ConfidenceComponent {
  readonly component: ConfidenceComponentKind;
  readonly score: number;
  readonly weight: number;
  readonly explanation: string;
}

export interface ConfidenceCap {
  readonly reason: ConfidenceCapReason;
  readonly maximum_score: number;
  readonly explanation: string;
}

export interface FindingConfidence extends AnalysisVersioned {
  /** Display score in the range 0–100. */
  readonly score: number;
  readonly label: ConfidenceLabel;
  readonly components: readonly ConfidenceComponent[];
  readonly applied_caps: readonly ConfidenceCap[];
  readonly explanation: string;
}

export const DIFFERENCE_MAGNITUDES = ["minor", "moderate", "major"] as const;
export type DifferenceMagnitude = (typeof DIFFERENCE_MAGNITUDES)[number];

export interface StrategicDifference extends AnalysisVersioned {
  /** Normalized strategic distance in the range 0–1. */
  readonly distance: number;
  readonly magnitude: DifferenceMagnitude;
  readonly persistence: number;
  readonly new_concept_count: number;
  readonly stable_from_ply: number | null;
}

export const OBJECTIVE_QUALITY_STATES = ["unavailable", "partial", "available"] as const;
export type ObjectiveQualityState = (typeof OBJECTIVE_QUALITY_STATES)[number];

export const OBJECTIVE_QUALITY_VERDICTS = ["unknown", "sound", "dubious"] as const;
export type ObjectiveQualityVerdict = (typeof OBJECTIVE_QUALITY_VERDICTS)[number];

export interface ObjectiveQuality extends AnalysisVersioned {
  readonly state: ObjectiveQualityState;
  readonly verdict: ObjectiveQualityVerdict;
  /** User-facing scores use repertoire POV. */
  readonly repertoire_pov_cp: number | null;
  readonly loss_from_best_cp: number | null;
  readonly engine_depth: number | null;
  readonly engine_lines: number | null;
  readonly database_performance: number | null;
  readonly theoretical_status: string | null;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const FINDING_PRIORITY_LABELS = ["review-now", "review-later", "informational", "insufficient-evidence"] as const;
export type FindingPriorityLabel = (typeof FINDING_PRIORITY_LABELS)[number];

export const FINDING_PRIORITY_KINDS = ["replacement", "training"] as const;
export type FindingPriorityKind = (typeof FINDING_PRIORITY_KINDS)[number];

export interface FindingPriority extends AnalysisVersioned {
  readonly kind: FindingPriorityKind;
  /** Normalized priority in the range 0–1. */
  readonly score: number;
  readonly label: FindingPriorityLabel;
  readonly confidence: number;
  readonly difference: number;
  readonly expected_frequency: number;
  readonly learning_burden: number;
  readonly preference_mismatch: number;
  readonly actionability: number;
}

export const STRATEGIC_FIT_CLASSIFICATIONS = [
  "genuine-inconsistency",
  "forced-diversity",
  "intentional-diversity",
  "productive-diversity",
  "mixed-strategic-profile",
  "uncertain",
  "data-quality-issue",
  "transpositional-equivalence",
] as const;
export type StrategicFitClassification = (typeof STRATEGIC_FIT_CLASSIFICATIONS)[number];

export const CAUSAL_CONTROL_LABELS = [
  "mostly-opponent-forced",
  "shared-or-uncertain",
  "mostly-player-controlled",
  "unknown",
] as const;
export type CausalControlLabel = (typeof CAUSAL_CONTROL_LABELS)[number];

export const CAUSAL_EVENT_KINDS = [
  "opponent-divergence",
  "player-decision",
  "irreversible-event",
  "first-strategic-difference",
  "difference-stable",
  "transposition",
] as const;
export type CausalEventKind = (typeof CAUSAL_EVENT_KINDS)[number];

export interface CausalEvent {
  readonly event_id: string;
  readonly kind: CausalEventKind;
  readonly ply: number;
  readonly position_id: string;
  readonly decision_id: string | null;
  readonly san: string | null;
  readonly explanation: string;
}

export interface CausalAttribution extends AnalysisVersioned {
  /** Null when evidence cannot support a numerical attribution. */
  readonly controllability: number | null;
  readonly label: CausalControlLabel;
  readonly player_contribution: number | null;
  readonly opponent_contribution: number | null;
  readonly likely_causal_decision_ids: readonly string[];
  readonly timeline: readonly CausalEvent[];
  readonly explanation: string;
}

export interface EvidenceComparisonDimension {
  readonly dimension_id: string;
  readonly typical_value: JsonValue;
  readonly affected_value: JsonValue;
  readonly contribution: number;
  readonly explanation: string;
}

export interface EvidenceComparisonBasis {
  readonly effective_branches: number;
  readonly weighted_reference_games: number | null;
  readonly structural_classification_coverage: number;
  readonly analysis_window: readonly [number, number] | null;
  readonly taxonomy_version: string | null;
  readonly profile_mode: StrategicFitProfileMode;
}

export interface FindingEvidence extends AnalysisVersioned {
  readonly cohort_id: string;
  readonly baseline_mode_ids: readonly string[];
  readonly representative_route_ids: readonly string[];
  readonly dimensions: readonly EvidenceComparisonDimension[];
  readonly comparison_basis: EvidenceComparisonBasis;
  readonly causality: CausalAttribution;
  readonly data_quality_issue_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const FINDING_RESOLUTION_STATES = [
  "unresolved",
  "change-repertoire",
  "keep-intentionally",
  "train-as-exception",
  "reclassify-cohort",
  "exclude-from-analysis",
  "defer",
  "insufficient-evidence",
  "automatically-resolved-by-another-edit",
] as const;
export type FindingResolutionState = (typeof FINDING_RESOLUTION_STATES)[number];
export type TerminalFindingResolutionState = Exclude<FindingResolutionState, "unresolved">;

export const INTENTIONAL_RESOLUTION_REASONS = [
  "objectively-strongest",
  "surprise-weapon",
  "tournament-specific",
  "strategically-desirable",
  "opponent-forced",
  "already-understood",
  "custom",
] as const;
export type IntentionalResolutionReason = (typeof INTENTIONAL_RESOLUTION_REASONS)[number];

export interface SemanticReferences {
  readonly position_ids: readonly string[];
  readonly decision_ids: readonly string[];
  readonly route_ids: readonly string[];
  /** SAN paths are retained for navigation and are never the primary identity. */
  readonly source_san_paths: readonly (readonly string[])[];
}

export interface StrategicFinding extends StrategicFitVersioned {
  readonly finding_id: string;
  /** Revision-independent identity used to carry resolutions across harmless repertoire reordering. */
  readonly semantic_finding_id: string;
  readonly repertoire_revision: string;
  readonly classification: StrategicFitClassification;
  readonly plain_language_category: string;
  readonly opening_scope: string;
  readonly affected_line_summary: string;
  readonly explanation: string;
  readonly references: SemanticReferences;
  readonly weighted_baseline_percentage: number;
  readonly expected_frequency: number | null;
  readonly learning_burden: number;
  readonly confidence: FindingConfidence;
  readonly difference: StrategicDifference;
  readonly objective_quality: ObjectiveQuality;
  readonly replacement_priority: FindingPriority;
  readonly training_priority: FindingPriority;
  readonly evidence: FindingEvidence;
  readonly resolution_state: FindingResolutionState;
  readonly provisional: boolean;
  readonly provenance: StrategicFitProvenance;
}

export const RESOLUTION_INVALIDATION_RULES = [
  "referenced-position-changed",
  "referenced-decision-changed",
  "referenced-route-changed",
  "repertoire-revision-changed",
  "profile-changed",
  "never",
] as const;
export type ResolutionInvalidationRule = (typeof RESOLUTION_INVALIDATION_RULES)[number];

export interface FindingResolution extends SchemaVersioned {
  readonly resolution_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly repertoire_revision: string;
  readonly state: TerminalFindingResolutionState;
  readonly intentional_reason: IntentionalResolutionReason | null;
  readonly note: string | null;
  readonly references: SemanticReferences;
  readonly invalidation_rules: readonly ResolutionInvalidationRule[];
  readonly expires_at: string | null;
  readonly linked_training_ids: readonly string[];
  readonly linked_staged_edit_ids: readonly string[];
  readonly created_at: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const PREFLIGHT_ISSUE_KINDS = ["error", "warning", "evidence-limitation"] as const;
export type PreflightIssueKind = (typeof PREFLIGHT_ISSUE_KINDS)[number];

export const PREFLIGHT_ISSUE_SEVERITIES = ["blocking", "degraded", "informational"] as const;
export type PreflightIssueSeverity = (typeof PREFLIGHT_ISSUE_SEVERITIES)[number];

export const PREFLIGHT_ISSUE_CODES = [
  "empty-repertoire",
  "single-route",
  "illegal-line",
  "malformed-data",
  "duplicate-branch",
  "transposition-detected",
  "shallow-route",
  "incomplete-route",
  "missing-opening-classification",
  "stale-training-metadata",
  "stale-game-metadata",
  "unsupported-custom-start",
  "missing-repertoire-color",
  "terminal-tactical-route",
  "terminal-endgame-route",
  "insufficient-comparable-positions",
] as const;
export type PreflightIssueCode = (typeof PREFLIGHT_ISSUE_CODES)[number];

export interface PreflightIssue extends AnalysisVersioned {
  readonly issue_id: string;
  readonly code: PreflightIssueCode;
  readonly kind: PreflightIssueKind;
  readonly severity: PreflightIssueSeverity;
  readonly message: string;
  readonly affected_route_ids: readonly string[];
  readonly affected_source_paths: readonly (readonly string[])[];
  readonly details: Readonly<Record<string, JsonValue>>;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export const PREFLIGHT_STATES = ["ready", "degraded", "blocked"] as const;
export type PreflightState = (typeof PREFLIGHT_STATES)[number];

export interface StrategicFitPreflight extends AnalysisVersioned {
  readonly state: PreflightState;
  readonly issues: readonly PreflightIssue[];
  readonly route_count: number;
  readonly comparable_route_count: number;
  readonly incomplete_route_count: number;
}

export const STRATEGIC_FIT_METRIC_IDS = [
  "strategic-entropy",
  "concept-reuse",
  "exception-burden",
  "forced-diversity-floor",
  "homogenization-cost",
  "familiarity-adjusted-coverage",
  "training-adjusted-workload",
  "repertoire-regret",
  "move-order-resilience",
  "concept-centrality",
] as const;
export type StrategicFitMetricId = (typeof STRATEGIC_FIT_METRIC_IDS)[number];

export const METRIC_STATES = ["available", "partial", "unavailable"] as const;
export type MetricState = (typeof METRIC_STATES)[number];

export const METRIC_UNITS = ["count", "fraction", "entropy", "score", "centipawns", "composite"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];

export interface StrategicFitMetric<T> extends AnalysisVersioned {
  readonly metric_id: StrategicFitMetricId;
  readonly state: MetricState;
  readonly value: T | null;
  readonly unit: MetricUnit;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ExceptionBurdenMetricValue {
  readonly expected_frequency: number;
  readonly training_cost: number | null;
}

export interface HomogenizationCostMetricValue {
  readonly evaluation_loss_cp: number | null;
  readonly popularity_loss: number | null;
  readonly coverage_loss: number | null;
}

export interface ConceptCentralityMetricValue {
  readonly concept_id: string;
  readonly expected_frequency: number;
  readonly cohort_ids: readonly string[];
}

export interface StrategicFitMetrics extends AnalysisVersioned {
  readonly strategic_entropy: StrategicFitMetric<number>;
  readonly concept_reuse: StrategicFitMetric<number>;
  readonly exception_burden: StrategicFitMetric<ExceptionBurdenMetricValue>;
  readonly forced_diversity_floor: StrategicFitMetric<number>;
  readonly homogenization_cost: StrategicFitMetric<HomogenizationCostMetricValue>;
  readonly familiarity_adjusted_coverage: StrategicFitMetric<number>;
  readonly training_adjusted_workload: StrategicFitMetric<number>;
  readonly repertoire_regret: StrategicFitMetric<number>;
  readonly move_order_resilience: StrategicFitMetric<number>;
  readonly concept_centrality: StrategicFitMetric<readonly ConceptCentralityMetricValue[]>;
}

export interface StrategicFitOverview extends AnalysisVersioned {
  readonly workload: "low" | "moderate" | "high" | "unavailable";
  readonly strategic_family_count: number;
  readonly expected_concept_burden: number | null;
  readonly intentional_exception_count: number;
  readonly unresolved_finding_count: number;
  readonly insufficient_evidence_branch_count: number;
  readonly metrics: StrategicFitMetrics;
}

export const STRATEGIC_FIT_PROGRESS_PHASES = [
  "normalizing-move-orders",
  "identifying-comparable-branches",
  "extracting-strategic-patterns",
  "measuring-learning-burden",
  "attributing-differences-to-decisions",
  "ranking-findings",
] as const;
export type StrategicFitProgressPhase = (typeof STRATEGIC_FIT_PROGRESS_PHASES)[number];

export const STRATEGIC_FIT_PROGRESS_STATES = ["pending", "running", "completed", "cancelled"] as const;
export type StrategicFitProgressState = (typeof STRATEGIC_FIT_PROGRESS_STATES)[number];

export interface StrategicFitProgress extends AnalysisVersioned {
  readonly run_id: string;
  readonly phase: StrategicFitProgressPhase;
  readonly phase_index: number;
  readonly phase_count: 6;
  readonly state: StrategicFitProgressState;
  readonly completed_units: number;
  readonly total_units: number | null;
  readonly provisional_findings: boolean;
  readonly message: string;
}

export const STRATEGIC_FIT_MANIFEST_COMPONENTS = [
  "graph",
  "taxonomy",
  "checkpoints",
  "pawn-signals",
  "position-signals",
  "trajectory",
  "concepts",
  "weights",
  "popularity",
  "cohorts",
  "modes",
  "distance",
  "confidence",
  "causality",
  "findings",
  "metrics",
] as const;
export type StrategicFitManifestComponent = (typeof STRATEGIC_FIT_MANIFEST_COMPONENTS)[number];

export interface StrategicFitAnalysisManifest extends StrategicFitVersioned {
  readonly components: Readonly<Record<StrategicFitManifestComponent, string>>;
}

export interface StrategicFitReport extends StrategicFitVersioned {
  readonly report_id: string;
  readonly repertoire_revision: string;
  readonly manifest: StrategicFitAnalysisManifest;
  readonly profile: StrategicFitProfile;
  readonly preflight: StrategicFitPreflight;
  readonly trajectories: readonly StrategicTrajectory[];
  readonly cohorts: readonly StrategicCohort[];
  readonly summary: StrategicFitOverview;
  readonly findings: readonly StrategicFinding[];
  readonly provenance: StrategicFitProvenance;
}
