import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
  type FindingPriority,
  type FindingResolution,
  type FindingResolutionState,
  type ObjectiveQuality,
  type PreflightIssue,
  type StrategicCohort,
  type StrategicDifference,
  type StrategicFinding,
  type StrategicFitClassification,
  type StrategicFitMetric,
  type StrategicFitMetricId,
  type StrategicFitMetrics,
  type StrategicFitPreflight,
  type StrategicFitProfile,
  type StrategicFitProgress,
  type StrategicFitProgressPhase,
  type StrategicFitProvenance,
  type StrategicFitReport,
  type StrategicFitOverview,
  type StrategicMode,
  type StrategicSignal,
  type StrategicSnapshot,
  type StrategicTrajectory,
  type TerminalFindingResolutionState,
} from "../../src/index.ts";

const source = {
  source_id: "core",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: null,
  reason: null,
} as const;

const provenance = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  repertoire_revision: "revision:fixture",
  generated_at: "2026-07-15T00:00:00.000Z",
  deterministic: true,
  sources: [source],
} satisfies StrategicFitProvenance;

const profile = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  mode: "balanced",
  source: "explicit",
  provisional: false,
  preferences: {
    maximum_engine_loss_cp: null,
    opponent_popularity_importance: 0.5,
    personal_game_frequency_importance: 0.25,
    manual_weight_importance: 0.25,
    additional_memorization_tolerance: 0.5,
    preferred_concept_ids: [],
    avoided_concept_ids: [],
    preferred_tactical_character: [],
    minimum_opponent_coverage: null,
  },
} satisfies StrategicFitProfile;

const signal = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  signal_id: "signal:center-open",
  family: "center-dynamics",
  feature_id: "center.open",
  kind: "observation",
  value: true,
  confidence: 0.9,
  persistence: "stable",
  provenance: [source],
} satisfies StrategicSignal<boolean>;

const snapshot = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot_id: "snapshot:route-a:12",
  route_id: "route:a",
  position_id: "position:a",
  fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  checkpoint: {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    checkpoint_id: "checkpoint:12",
    kind: "configured-ply",
    ply: 12,
    reason: "Configured comparison checkpoint",
    comparability: "comparable",
  },
  signals: [signal],
  classifier_confidence: 0.9,
  provenance: [source],
} satisfies StrategicSnapshot;

const trajectory = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  trajectory_id: "trajectory:a",
  route_id: "route:a",
  state: "complete",
  snapshots: [snapshot],
  missing_checkpoints: [],
  evidence_coverage: 1,
  stable_signal_ids: [signal.signal_id],
  transient_signal_ids: [],
  provenance: [source],
} satisfies StrategicTrajectory;

const mode = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  mode_id: "mode:iqp",
  cohort_id: "cohort:qgd",
  representative_route_id: "route:a",
  supporting_route_ids: ["route:a"],
  concept_ids: ["pawn-break.d5"],
  normalized_weight: 1,
  effective_sample_size: 4,
  source: "inferred-medoid",
  provenance: [source],
} satisfies StrategicMode;

const cohort = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  cohort_id: "cohort:qgd",
  state: "actionable",
  opening_scope_ids: ["opening:qgd"],
  decision_scope_ids: ["decision:a"],
  route_ids: ["route:a"],
  excluded_route_ids: [],
  route_weights: [{ route_id: "route:a", normalized_weight: 1 }],
  effective_sample_size: 4,
  modes: [mode],
  override_ids: [],
  provenance: [source],
} satisfies StrategicCohort;

const confidence = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  score: 80,
  label: "high",
  components: [
    {
      component: "classifier-confidence",
      score: 0.9,
      weight: 1,
      explanation: "Deterministic structural evidence",
    },
  ],
  applied_caps: [],
  explanation: "Complete fixture evidence",
} as const;

const difference = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  distance: 0.7,
  magnitude: "major",
  persistence: 1,
  new_concept_count: 2,
  stable_from_ply: 12,
} satisfies StrategicDifference;

const objectiveQuality = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  state: "unavailable",
  verdict: "unknown",
  repertoire_pov_cp: null,
  loss_from_best_cp: null,
  engine_depth: null,
  engine_lines: null,
  database_performance: null,
  theoretical_status: null,
  reason: "Base analysis is engine-free",
  provenance: [],
} satisfies ObjectiveQuality;

const replacementPriority = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  kind: "replacement",
  score: 0.7,
  label: "review-now",
  confidence: 0.8,
  difference: 0.7,
  expected_frequency: 0.5,
  learning_burden: 0.8,
  preference_mismatch: 0.6,
  actionability: 0.9,
} satisfies FindingPriority;

const trainingPriority = {
  ...replacementPriority,
  kind: "training",
  score: 0.5,
  label: "review-later",
} satisfies FindingPriority;

const references = {
  position_ids: ["position:a"],
  decision_ids: ["decision:a"],
  route_ids: ["route:a"],
  source_san_paths: [["d4", "d5", "c4"]],
} as const;

const finding = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  finding_id: "finding:a",
  semantic_finding_id: "semantic-finding:a",
  repertoire_revision: "revision:fixture",
  classification: "genuine-inconsistency",
  plain_language_category: "Different center plan",
  opening_scope: "Queen's Gambit",
  affected_line_summary: "The 3...c6 branch",
  explanation: "The route reaches a stable center outside the supported cohort mode.",
  references,
  weighted_baseline_percentage: 0.75,
  expected_frequency: 0.25,
  learning_burden: 0.8,
  confidence,
  difference,
  objective_quality: objectiveQuality,
  replacement_priority: replacementPriority,
  training_priority: trainingPriority,
  evidence: {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_id: cohort.cohort_id,
    baseline_mode_ids: [mode.mode_id],
    representative_route_ids: [mode.representative_route_id],
    dimensions: [
      {
        dimension_id: "center",
        typical_value: "open",
        affected_value: "closed",
        contribution: 1,
        explanation: "Different stable center state",
      },
    ],
    comparison_basis: {
      effective_branches: 4,
      weighted_reference_games: null,
      structural_classification_coverage: 1,
      analysis_window: [12, 24],
      taxonomy_version: "1.0.0",
      profile_mode: profile.mode,
    },
    causality: {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      controllability: 0.8,
      label: "mostly-player-controlled",
      player_contribution: 0.8,
      opponent_contribution: 0.2,
      likely_causal_decision_ids: ["decision:a"],
      timeline: [
        {
          event_id: "event:a",
          kind: "player-decision",
          ply: 12,
          position_id: "position:a",
          decision_id: "decision:a",
          san: "e5",
          explanation: "The player closes the center.",
        },
      ],
      explanation: "The difference follows the repertoire-side decision.",
    },
    data_quality_issue_ids: [],
    provenance: [source],
  },
  resolution_state: "unresolved",
  provisional: false,
  provenance,
} satisfies StrategicFinding;

const resolution = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  resolution_id: "resolution:a",
  finding_id: finding.finding_id,
  semantic_finding_id: finding.semantic_finding_id,
  repertoire_revision: finding.repertoire_revision,
  state: "keep-intentionally",
  intentional_reason: "strategically-desirable",
  note: null,
  references,
  invalidation_rules: ["referenced-decision-changed"],
  expires_at: null,
  linked_training_ids: [],
  linked_staged_edit_ids: [],
  created_at: "2026-07-15T00:00:00.000Z",
  provenance: [source],
} satisfies FindingResolution;

const preflightIssue = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  issue_id: "issue:transposition",
  code: "transposition-detected",
  kind: "warning",
  severity: "informational",
  message: "Two routes transpose.",
  affected_route_ids: ["route:a"],
  affected_source_paths: [["d4", "d5"]],
  details: { transposition_count: 1 },
  provenance: [source],
} satisfies PreflightIssue;

const preflight = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  state: "ready",
  issues: [preflightIssue],
  route_count: 4,
  comparable_route_count: 4,
  incomplete_route_count: 0,
} satisfies StrategicFitPreflight;

function metric<T>(metric_id: StrategicFitMetricId, value: T, unit: StrategicFitMetric<T>["unit"]): StrategicFitMetric<T> {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id,
    state: "available",
    value,
    unit,
    reason: null,
    provenance: [source],
  };
}

const metrics = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  strategic_entropy: metric("strategic-entropy", 0.4, "entropy"),
  concept_reuse: metric("concept-reuse", 0.8, "fraction"),
  exception_burden: metric("exception-burden", { expected_frequency: 0.2, training_cost: null }, "composite"),
  forced_diversity_floor: metric("forced-diversity-floor", 0.1, "fraction"),
  homogenization_cost: metric(
    "homogenization-cost",
    { evaluation_loss_cp: null, popularity_loss: null, coverage_loss: null },
    "composite",
  ),
  familiarity_adjusted_coverage: metric("familiarity-adjusted-coverage", 0.8, "fraction"),
  training_adjusted_workload: metric("training-adjusted-workload", 0.3, "score"),
  repertoire_regret: metric("repertoire-regret", 0.2, "score"),
  move_order_resilience: metric("move-order-resilience", 0.9, "fraction"),
  concept_centrality: metric(
    "concept-centrality",
    [{ concept_id: "pawn-break.d5", expected_frequency: 0.8, cohort_ids: [cohort.cohort_id] }],
    "composite",
  ),
} satisfies StrategicFitMetrics;

const summary = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  workload: "moderate",
  strategic_family_count: 1,
  expected_concept_burden: 2,
  intentional_exception_count: 0,
  unresolved_finding_count: 1,
  insufficient_evidence_branch_count: 0,
  metrics,
} satisfies StrategicFitOverview;

const progress = {
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  run_id: "run:a",
  phase: "normalizing-move-orders",
  phase_index: 0,
  phase_count: 6,
  state: "running",
  completed_units: 0,
  total_units: null,
  provisional_findings: true,
  message: "Normalizing move orders",
} satisfies StrategicFitProgress;

const report = {
  schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
  analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
  report_id: "report:a",
  repertoire_revision: "revision:fixture",
  manifest: STRATEGIC_FIT_ANALYSIS_MANIFEST,
  profile,
  preflight,
  trajectories: [trajectory],
  cohorts: [cohort],
  summary,
  findings: [finding],
  provenance,
} satisfies StrategicFitReport;

const classificationExhaustiveness: Record<StrategicFitClassification, true> = {
  "genuine-inconsistency": true,
  "forced-diversity": true,
  "intentional-diversity": true,
  "productive-diversity": true,
  "mixed-strategic-profile": true,
  uncertain: true,
  "data-quality-issue": true,
  "transpositional-equivalence": true,
};

const resolutionExhaustiveness: Record<FindingResolutionState, true> = {
  unresolved: true,
  "change-repertoire": true,
  "keep-intentionally": true,
  "train-as-exception": true,
  "reclassify-cohort": true,
  "exclude-from-analysis": true,
  defer: true,
  "insufficient-evidence": true,
  "automatically-resolved-by-another-edit": true,
};

const progressExhaustiveness: Record<StrategicFitProgressPhase, true> = {
  "normalizing-move-orders": true,
  "identifying-comparable-branches": true,
  "extracting-strategic-patterns": true,
  "measuring-learning-burden": true,
  "attributing-differences-to-decisions": true,
  "ranking-findings": true,
};

// @ts-expect-error Persisted resolutions must use a terminal state.
const invalidPersistedState: TerminalFindingResolutionState = "unresolved";

void resolution;
void progress;
void report;
void classificationExhaustiveness;
void resolutionExhaustiveness;
void progressExhaustiveness;
void invalidPersistedState;
