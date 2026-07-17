/**
 * Pure, engine-free composition root for the Congruence 2.0 Strategic Fit pipeline.
 *
 * Every optional or non-deterministic input is injected. The analyzer does not read a clock,
 * contact a network service, use an engine, or keep module-level run state. Long-running hosts can
 * observe the six frozen phases and cooperatively cancel between deterministic stages.
 */
import type { Color } from "../congruence.js";
import type { OpeningTable } from "../openings.js";
import type { GameTree } from "../pgn.js";
import {
  calculateStrategicCausality,
  type StrategicCausalComparison,
  type StrategicCausalityReport,
} from "./causality.js";
import {
  type StrategicCohortFormationOptions,
  formStrategicCohorts,
} from "./cohorts.js";
import { buildStrategicConceptDictionary, type StrategicConceptDictionary } from "./concepts.js";
import {
  calculateFindingConfidence,
  calculateStrategicDifference,
  scoreStrategicDifferenceMagnitude,
} from "./confidence.js";
import {
  calculateStrategicDistances,
  type StrategicDistanceOptions,
  type StrategicDistanceReport,
  type StrategicRouteModeDistance,
} from "./distance.js";
import {
  assessStrategicFinding,
  type StrategicAlternativeState,
  type StrategicFindingAssessment,
} from "./findings.js";
import {
  buildRepertoireGraph,
  type RepertoireGraph,
  type RepertoireGraphRoute,
} from "./graph.js";
import {
  calculateStrategicFitOverview,
  type StrategicTrainingMetricEvidence,
} from "./metrics.js";
import {
  detectStrategicModes,
  type StrategicModeDetectionOptions,
  type StrategicModeReport,
  type StrategicModeSelectionState,
} from "./modes.js";
import { preflightStrategicFit } from "./preflight.js";
import { buildOpeningTaxonomy, type RepertoireOpeningTaxonomy } from "./taxonomy.js";
import {
  buildStrategicTrajectories,
  type StrategicTrajectoryBuildOptions,
  type StrategicTrajectoryReport,
} from "./trajectory.js";
import type {
  CausalAttribution,
  EvidenceComparisonDimension,
  FindingEvidence,
  JsonValue,
  ObjectiveQuality,
  StrategicCohort,
  StrategicDifference,
  StrategicFinding,
  StrategicFitMetric,
  StrategicFitMetricId,
  StrategicFitMetrics,
  StrategicFitOverview,
  StrategicFitPreflight,
  StrategicFitProfile,
  StrategicFitProgress,
  StrategicFitProgressPhase,
  StrategicFitProvenance,
  StrategicFitReport,
  StrategicFitSourceProvenance,
  StrategicMode,
  StrategicSnapshot,
  StrategicTrajectory,
} from "./types.js";
import { STRATEGIC_FIT_PROGRESS_PHASES } from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";
import {
  calculateStrategicRouteWeights,
  type StrategicRouteWeightingOptions,
  type StrategicRouteWeightingReport,
} from "./weights.js";
import { sortStrategicFitFindings } from "./report-projection.js";

export const STRATEGIC_FIT_DEFAULT_PAGE_LIMIT = 50;

/**
 * The core never reads the wall clock. Hosts that need a real generation time inject one; the
 * stable fallback keeps direct calls and worker replays byte-equivalent.
 */
export const STRATEGIC_FIT_DETERMINISTIC_GENERATED_AT = "1970-01-01T00:00:00.000Z";

export const STRATEGIC_FIT_FINDING_SORTS = [
  "replacement-priority",
  "training-priority",
  "expected-frequency",
  "opening-scope",
  "finding-id",
] as const;
export type StrategicFitFindingSort = (typeof STRATEGIC_FIT_FINDING_SORTS)[number];

export interface StrategicFitFindingPageInput {
  readonly offset?: number;
  readonly limit?: number;
}

export interface StrategicFitFindingPage {
  readonly offset: number;
  readonly limit: number;
  /** Count before paging; changing page size never changes this value. */
  readonly total_count: number;
  readonly returned_count: number;
  readonly has_more: boolean;
}

export interface StrategicFitRouteAssessmentInput {
  readonly route_id: string;
  /** Omitted public inputs apply to every finding on the route; persisted inputs target one finding. */
  readonly semantic_finding_id?: string;
  readonly matches_declared_objective?: boolean;
  readonly resolution_state?: StrategicFinding["resolution_state"];
  readonly alternative_state?: StrategicAlternativeState;
}

export interface AnalyzeStrategicFitOptions {
  readonly repertoireColor: Color | null;
  readonly repertoireRevision: string;
  readonly profile?: StrategicFitProfile;
  readonly openingTable?: OpeningTable | null;
  readonly trajectory?: Omit<StrategicTrajectoryBuildOptions, "openingTable" | "checkpointSelection">;
  readonly weighting?: StrategicRouteWeightingOptions;
  readonly cohorts?: StrategicCohortFormationOptions;
  readonly modes?: StrategicModeDetectionOptions;
  readonly distance?: StrategicDistanceOptions;
  readonly training?: StrategicTrainingMetricEvidence;
  /** Confirmed intent/resolution and alternative evidence; absence remains explicitly unknown. */
  readonly routeAssessments?: readonly StrategicFitRouteAssessmentInput[];
  readonly sort?: StrategicFitFindingSort;
  readonly page?: StrategicFitFindingPageInput;
  readonly generatedAt?: string;
  readonly runId?: string;
  readonly shouldCancel?: () => boolean;
  readonly onProgress?: (progress: StrategicFitProgress) => void;
}

/** A page is a projection of one immutable logical report, not a separate analysis result. */
export interface StrategicFitAnalysisResult extends StrategicFitReport {
  readonly finding_page: StrategicFitFindingPage;
}

export class StrategicFitAnalysisCancelledError extends Error {
  readonly code = "strategic_fit_analysis_cancelled";
  readonly run_id: string;
  readonly phase: StrategicFitProgressPhase;
  readonly phase_index: number;

  constructor(runId: string, phase: StrategicFitProgressPhase, phaseIndex: number) {
    super(`Strategic Fit analysis cancelled during ${phase}.`);
    this.name = "StrategicFitAnalysisCancelledError";
    this.run_id = runId;
    this.phase = phase;
    this.phase_index = phaseIndex;
  }
}

interface FindingCandidate {
  readonly kind: "route-exception" | "mixed-profile" | "insufficient-evidence" | "transposition";
  readonly cohort: StrategicCohort | null;
  readonly selectionState: StrategicModeSelectionState;
  readonly routeIds: readonly string[];
  readonly modes: readonly StrategicMode[];
  readonly comparison: StrategicRouteModeDistance | null;
  readonly causality: CausalAttribution;
  readonly transpositionallyEquivalent: boolean;
}

interface FindingContext {
  readonly options: AnalyzeStrategicFitOptions;
  readonly graph: RepertoireGraph;
  readonly preflight: StrategicFitPreflight;
  readonly taxonomy: RepertoireOpeningTaxonomy;
  readonly trajectories: StrategicTrajectoryReport;
  readonly concepts: StrategicConceptDictionary;
  readonly weights: StrategicRouteWeightingReport;
  readonly modes: StrategicModeReport;
  readonly distances: StrategicDistanceReport;
  readonly causality: StrategicCausalityReport;
  readonly provenance: StrategicFitProvenance;
}

const ID_SEPARATOR = "\u001f";

const PHASE_MESSAGES: Readonly<Record<StrategicFitProgressPhase, string>> = Object.freeze({
  "normalizing-move-orders": "Normalizing move orders",
  "identifying-comparable-branches": "Identifying comparable branches",
  "extracting-strategic-patterns": "Extracting strategic patterns",
  "measuring-learning-burden": "Measuring learning burden",
  "attributing-differences-to-decisions": "Attributing differences to decisions",
  "ranking-findings": "Ranking findings",
});

const CORE_SOURCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:analyzer",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_VERSION,
  snapshot: null,
  reason: null,
});

const REPERTOIRE_SOURCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:repertoire",
  kind: "repertoire",
  state: "available",
  version: null,
  snapshot: null,
  reason: null,
});

const ENGINE_UNAVAILABLE_SOURCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:engine",
  kind: "engine",
  state: "unavailable",
  version: null,
  snapshot: null,
  reason: "The deterministic core analysis does not use an engine.",
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

function semanticId(kind: string, values: readonly unknown[]): string {
  return `${kind}:${stableHash(values.map(stableSerialize).join(ID_SEPARATOR))}`;
}

function openingTableIdentity(table: OpeningTable | null | undefined): readonly unknown[] {
  if (!table) return [];
  return [...table.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([positionKey, entry]) => [positionKey, entry.eco, entry.name]);
}

function analysisIdentity(options: AnalyzeStrategicFitOptions): readonly unknown[] {
  return [
    options.repertoireColor,
    options.trajectory ?? {},
    options.weighting ?? {},
    options.cohorts ?? {},
    options.modes ?? {},
    options.distance ?? {},
    options.training ?? {},
    options.routeAssessments ?? [],
    openingTableIdentity(options.openingTable),
  ];
}

function mergeSources(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const sources = new Map<string, StrategicFitSourceProvenance>();
  for (const source of groups.flat()) {
    const key = [source.source_id, source.version, source.snapshot, source.state].join(ID_SEPARATOR);
    if (!sources.has(key)) sources.set(key, source);
  }
  return [...sources.values()].sort((left, right) =>
    compareStrings(left.source_id, right.source_id) ||
    compareStrings(left.version ?? "", right.version ?? "") ||
    compareStrings(left.state, right.state)
  );
}

function defaultProfile(): StrategicFitProfile {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    mode: "balanced",
    source: "inferred",
    provisional: true,
    preferences: {
      maximum_engine_loss_cp: null,
      opponent_popularity_importance: 0,
      personal_game_frequency_importance: 0,
      manual_weight_importance: 0,
      additional_memorization_tolerance: 0.5,
      preferred_concept_ids: [],
      avoided_concept_ids: [],
      preferred_tactical_character: [],
      minimum_opponent_coverage: null,
    },
  };
}

function profileSource(profile: StrategicFitProfile): StrategicFitSourceProvenance {
  return {
    source_id: "strategic-fit:user-profile",
    kind: "user-profile",
    state: "available",
    version: profile.schema_version,
    snapshot: null,
    reason: profile.source === "inferred"
      ? "The deterministic default or inferred profile remains provisional."
      : null,
  };
}

function validateOptions(options: AnalyzeStrategicFitOptions): void {
  if (options.repertoireRevision.length === 0) {
    throw new Error("strategic_fit_analyze_missing_repertoire_revision");
  }
  if (options.profile && options.profile.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION) {
    throw new Error(`strategic_fit_analyze_profile_version_mismatch: ${options.profile.schema_version}`);
  }
  const offset = options.page?.offset ?? 0;
  const limit = options.page?.limit ?? STRATEGIC_FIT_DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`strategic_fit_analyze_invalid_page_offset: ${String(offset)}`);
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`strategic_fit_analyze_invalid_page_limit: ${String(limit)}`);
  }
  const seenRouteIds = new Set<string>();
  const seenAssessmentIds = new Set<string>();
  for (const assessment of options.routeAssessments ?? []) {
    const assessmentId = assessment.semantic_finding_id === undefined
      ? assessment.route_id
      : `${assessment.route_id}${ID_SEPARATOR}${assessment.semantic_finding_id}`;
    if (
      seenAssessmentIds.has(assessmentId) ||
      (assessment.semantic_finding_id === undefined && seenRouteIds.has(assessment.route_id)) ||
      (assessment.semantic_finding_id !== undefined && seenAssessmentIds.has(assessment.route_id))
    ) {
      throw new Error(`strategic_fit_analyze_duplicate_route_assessment: ${assessment.route_id}`);
    }
    seenAssessmentIds.add(assessmentId);
    seenRouteIds.add(assessment.route_id);
  }
}

function progress(
  runId: string,
  phaseIndex: number,
  state: StrategicFitProgress["state"],
): StrategicFitProgress {
  const phase = STRATEGIC_FIT_PROGRESS_PHASES[phaseIndex]!;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    run_id: runId,
    phase,
    phase_index: phaseIndex,
    phase_count: 6,
    state,
    completed_units: state === "completed" ? 1 : 0,
    total_units: 1,
    provisional_findings: !(phaseIndex === STRATEGIC_FIT_PROGRESS_PHASES.length - 1 && state === "completed"),
    message: state === "cancelled"
      ? `${PHASE_MESSAGES[phase]} cancelled`
      : PHASE_MESSAGES[phase],
  };
}

function runPhase<T>(
  options: AnalyzeStrategicFitOptions,
  runId: string,
  phaseIndex: number,
  work: () => T,
): T {
  const phase = STRATEGIC_FIT_PROGRESS_PHASES[phaseIndex]!;
  if (options.shouldCancel?.()) {
    options.onProgress?.(progress(runId, phaseIndex, "cancelled"));
    throw new StrategicFitAnalysisCancelledError(runId, phase, phaseIndex);
  }
  options.onProgress?.(progress(runId, phaseIndex, "running"));
  if (options.shouldCancel?.()) {
    options.onProgress?.(progress(runId, phaseIndex, "cancelled"));
    throw new StrategicFitAnalysisCancelledError(runId, phase, phaseIndex);
  }
  const value = work();
  if (options.shouldCancel?.()) {
    options.onProgress?.(progress(runId, phaseIndex, "cancelled"));
    throw new StrategicFitAnalysisCancelledError(runId, phase, phaseIndex);
  }
  options.onProgress?.(progress(runId, phaseIndex, "completed"));
  return value;
}

function unavailableMetric<T>(
  metricId: StrategicFitMetricId,
  unit: StrategicFitMetric<T>["unit"],
  reason: string,
  sources: readonly StrategicFitSourceProvenance[],
): StrategicFitMetric<T> {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: metricId,
    state: "unavailable",
    value: null,
    unit,
    reason,
    provenance: mergeSources([CORE_SOURCE], sources),
  };
}

function blockedOverview(preflight: StrategicFitPreflight): StrategicFitOverview {
  const reason = "Strategic Fit metrics are unavailable because preflight blocked position analysis.";
  const sources = preflight.issues.flatMap((issue) => issue.provenance);
  const metrics: StrategicFitMetrics = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    strategic_entropy: unavailableMetric("strategic-entropy", "entropy", reason, sources),
    concept_reuse: unavailableMetric("concept-reuse", "fraction", reason, sources),
    exception_burden: unavailableMetric("exception-burden", "composite", reason, sources),
    forced_diversity_floor: unavailableMetric("forced-diversity-floor", "fraction", reason, sources),
    homogenization_cost: unavailableMetric("homogenization-cost", "composite", reason, sources),
    familiarity_adjusted_coverage: unavailableMetric("familiarity-adjusted-coverage", "fraction", reason, sources),
    training_adjusted_workload: unavailableMetric("training-adjusted-workload", "score", reason, sources),
    repertoire_regret: unavailableMetric("repertoire-regret", "score", reason, sources),
    move_order_resilience: unavailableMetric("move-order-resilience", "fraction", reason, sources),
    concept_centrality: unavailableMetric("concept-centrality", "composite", reason, sources),
  };
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    workload: "unavailable",
    strategic_family_count: 0,
    expected_concept_burden: null,
    intentional_exception_count: 0,
    unresolved_finding_count: 0,
    insufficient_evidence_branch_count: preflight.incomplete_route_count,
    metrics,
  };
}

function provenance(
  options: AnalyzeStrategicFitOptions,
  sources: readonly StrategicFitSourceProvenance[],
): StrategicFitProvenance {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    repertoire_revision: options.repertoireRevision,
    generated_at: options.generatedAt ?? STRATEGIC_FIT_DETERMINISTIC_GENERATED_AT,
    deterministic: true,
    sources: mergeSources([CORE_SOURCE, REPERTOIRE_SOURCE], sources),
  };
}

function pageInfo(totalCount: number, options: AnalyzeStrategicFitOptions): StrategicFitFindingPage {
  const offset = options.page?.offset ?? 0;
  const limit = options.page?.limit ?? STRATEGIC_FIT_DEFAULT_PAGE_LIMIT;
  const returnedCount = Math.max(0, Math.min(limit, totalCount - offset));
  return {
    offset,
    limit,
    total_count: totalCount,
    returned_count: returnedCount,
    has_more: offset + returnedCount < totalCount,
  };
}

function objectiveQuality(): ObjectiveQuality {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    state: "unavailable",
    verdict: "unknown",
    repertoire_pov_cp: null,
    loss_from_best_cp: null,
    engine_depth: null,
    engine_lines: null,
    database_performance: null,
    theoretical_status: null,
    reason: "Objective quality requires optional engine or database evidence.",
    provenance: [ENGINE_UNAVAILABLE_SOURCE],
  };
}

function isPathPrefix(left: readonly string[], right: readonly string[]): boolean {
  return left.length <= right.length && left.every((value, index) => right[index] === value);
}

function attachPreflightRouteIds(
  preflight: StrategicFitPreflight,
  graph: RepertoireGraph,
): StrategicFitPreflight {
  return {
    ...preflight,
    issues: preflight.issues.map((issue) => ({
      ...issue,
      affected_route_ids: issue.affected_source_paths.length === 0
        ? []
        : graph.routes
          .filter((route) => route.source_san_paths.some((routePath) =>
            issue.affected_source_paths.some((issuePath) =>
              isPathPrefix(issuePath, routePath) || isPathPrefix(routePath, issuePath)
            )
          ))
          .map((route) => route.route_id)
          .sort(compareStrings),
    })),
  };
}

function unknownCausality(reason: string): CausalAttribution {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    controllability: null,
    label: "unknown",
    player_contribution: null,
    opponent_contribution: null,
    likely_causal_decision_ids: [],
    timeline: [],
    explanation: reason,
  };
}

function routeById(graph: RepertoireGraph): ReadonlyMap<string, RepertoireGraphRoute> {
  return new Map(graph.routes.map((route) => [route.route_id, route]));
}

function trajectoryById(report: StrategicTrajectoryReport): ReadonlyMap<string, StrategicTrajectory> {
  return new Map(report.trajectories.map((trajectory) => [trajectory.route_id, trajectory]));
}

function causalityByComparison(
  report: StrategicCausalityReport,
): ReadonlyMap<string, StrategicCausalComparison> {
  return new Map(report.comparisons.map((comparison) => [
    [comparison.cohort_id, comparison.affected_route_id, comparison.mode_id].join(ID_SEPARATOR),
    comparison,
  ]));
}

function nearestComparison(
  distances: StrategicDistanceReport,
  cohortId: string,
  routeId: string,
): StrategicRouteModeDistance | null {
  return distances.comparisons
    .filter((comparison) =>
      comparison.cohort_id === cohortId &&
      comparison.left_route_id === routeId &&
      comparison.state === "available" &&
      comparison.distance !== null
    )
    .sort((left, right) =>
      left.distance! - right.distance! || compareStrings(left.mode_id, right.mode_id)
    )[0] ?? null;
}

function candidates(context: FindingContext): FindingCandidate[] {
  const result: FindingCandidate[] = [];
  const causalByKey = causalityByComparison(context.causality);
  const cohortById = new Map(context.modes.cohorts.map((cohort) => [cohort.cohort_id, cohort]));

  for (const selection of context.modes.selections) {
    const cohort = cohortById.get(selection.cohort_id)!;
    if (selection.state === "excluded") continue;
    if (selection.state === "mixed-profile") {
      const comparison = context.distances.comparisons
        .filter((item) => item.cohort_id === cohort.cohort_id && item.distance !== null)
        .sort((left, right) =>
          right.distance! - left.distance! ||
          compareStrings(left.left_route_id, right.left_route_id) ||
          compareStrings(left.mode_id, right.mode_id)
        )[0] ?? null;
      const causal = comparison
        ? causalByKey.get([cohort.cohort_id, comparison.left_route_id, comparison.mode_id].join(ID_SEPARATOR))
        : null;
      result.push({
        kind: "mixed-profile",
        cohort,
        selectionState: selection.state,
        routeIds: cohort.route_ids,
        modes: cohort.modes,
        comparison,
        causality: causal?.attribution ?? unknownCausality("Several supported modes form the baseline."),
        transpositionallyEquivalent: false,
      });
      continue;
    }
    if (selection.state === "insufficient-evidence") {
      result.push({
        kind: "insufficient-evidence",
        cohort,
        selectionState: selection.state,
        routeIds: cohort.route_ids,
        modes: [],
        comparison: null,
        causality: unknownCausality("Comparable stable evidence is insufficient for causal attribution."),
        transpositionallyEquivalent: false,
      });
      continue;
    }
    for (const routeId of selection.unassigned_route_ids) {
      const comparison = nearestComparison(context.distances, cohort.cohort_id, routeId);
      const causal = comparison
        ? causalByKey.get([cohort.cohort_id, routeId, comparison.mode_id].join(ID_SEPARATOR))
        : null;
      result.push({
        kind: "route-exception",
        cohort,
        selectionState: selection.state,
        routeIds: [routeId],
        modes: cohort.modes,
        comparison,
        causality: causal?.attribution ?? unknownCausality("No supported causal comparison is available."),
        transpositionallyEquivalent: false,
      });
    }
  }

  // A terminal canonical position shared by distinct routes is a genuine move-order equivalence,
  // even when short evidence prevents a strategic cohort from being actionable.
  const cohortByRoute = new Map<string, StrategicCohort>();
  for (const cohort of context.modes.cohorts) {
    for (const routeId of [...cohort.route_ids, ...cohort.excluded_route_ids]) {
      cohortByRoute.set(routeId, cohort);
    }
  }
  for (const unit of context.weights.weighting_units) {
    if (unit.route_ids.length < 2) continue;
    const routeIds = [...unit.route_ids].sort(compareStrings);
    result.push({
      kind: "transposition",
      cohort: cohortByRoute.get(routeIds[0]!) ?? null,
      selectionState: "insufficient-evidence",
      routeIds,
      modes: [],
      comparison: null,
      causality: unknownCausality("The move orders reach the same canonical terminal position."),
      transpositionallyEquivalent: true,
    });
  }
  return result.sort((left, right) =>
    compareStrings(left.cohort?.cohort_id ?? "", right.cohort?.cohort_id ?? "") ||
    compareStrings(left.kind, right.kind) ||
    compareStrings(left.routeIds.join(ID_SEPARATOR), right.routeIds.join(ID_SEPARATOR))
  );
}

function signalValue(snapshot: StrategicSnapshot, featureId: string): readonly JsonValue[] {
  return snapshot.signals
    .filter((signal) => signal.feature_id === featureId &&
      (signal.persistence === "stable" || signal.persistence === "irreversible"))
    .map((signal) => signal.value);
}

function distinctFeatureValues(
  trajectory: StrategicTrajectory | undefined,
  featureId: string,
): JsonValue {
  if (!trajectory) return null;
  const values = trajectory.snapshots.flatMap((snapshot) => signalValue(snapshot, featureId));
  const unique = new Map(values.map((value) => [stableSerialize(value), value]));
  const sorted = [...unique.entries()].sort(([left], [right]) => compareStrings(left, right)).map(([, value]) => value);
  if (sorted.length === 0) return null;
  return sorted.length === 1 ? sorted[0]! : sorted;
}

function dimensions(
  candidate: FindingCandidate,
  trajectories: ReadonlyMap<string, StrategicTrajectory>,
): EvidenceComparisonDimension[] {
  const comparison = candidate.comparison;
  if (!comparison) return [];
  return comparison.feature_contributions.map((contribution) => ({
    dimension_id: `${contribution.family}.${contribution.feature_id}`,
    typical_value: contribution.family === "learning-concepts"
      ? null
      : distinctFeatureValues(trajectories.get(comparison.right_route_id), contribution.feature_id),
    affected_value: contribution.family === "learning-concepts"
      ? null
      : distinctFeatureValues(trajectories.get(comparison.left_route_id), contribution.feature_id),
    contribution: contribution.contribution,
    explanation: `${contribution.feature_id} contributes ${Math.round(contribution.contribution * 100)}% of the normalized distance.`,
  }));
}

function conceptsForRoute(
  dictionary: StrategicConceptDictionary,
  routeId: string | undefined,
): readonly string[] {
  if (!routeId) return [];
  return dictionary.routes.find((route) => route.route_id === routeId)?.concepts
    .map((concept) => concept.concept_id)
    .sort(compareStrings) ?? [];
}

function newConceptIds(candidate: FindingCandidate, concepts: StrategicConceptDictionary): string[] {
  const affectedId = candidate.comparison?.left_route_id ?? candidate.routeIds[0];
  const baselineId = candidate.comparison?.representative_route_id;
  const affected = conceptsForRoute(concepts, affectedId);
  const baseline = new Set(conceptsForRoute(concepts, baselineId));
  return affected.filter((conceptId) => !baseline.has(conceptId));
}

function stableFromPly(candidate: FindingCandidate): number | null {
  const stable = candidate.causality.timeline
    .filter((event) => event.kind === "difference-stable" || event.kind === "first-strategic-difference")
    .map((event) => event.ply)
    .sort((left, right) => left - right)[0];
  return stable ?? null;
}

function temporalPersistence(candidate: FindingCandidate): number {
  if (!candidate.comparison || candidate.comparison.distance === null) return 0;
  const count = candidate.comparison.matched_checkpoint_keys.length;
  return count === 0 ? 0 : round(Math.min(1, count / 2));
}

function classifierConfidence(trajectory: StrategicTrajectory | undefined): number {
  if (!trajectory || trajectory.snapshots.length === 0) return 0;
  return round(trajectory.snapshots.reduce((sum, snapshot) => sum + snapshot.classifier_confidence, 0) /
    trajectory.snapshots.length);
}

function openingAvailable(context: FindingContext, routeIds: readonly string[]): boolean {
  const byRoute = new Map(context.taxonomy.routes.map((route) => [route.route_id, route.taxonomy.state]));
  return routeIds.every((routeId) => byRoute.get(routeId) === "classified");
}

function findingDifference(
  candidate: FindingCandidate,
  concepts: StrategicConceptDictionary,
): StrategicDifference {
  return calculateStrategicDifference({
    distance: candidate.comparison?.distance ?? 0,
    persistence: temporalPersistence(candidate),
    new_concept_count: newConceptIds(candidate, concepts).length,
    stable_from_ply: stableFromPly(candidate),
  });
}

function expectedFrequency(candidate: FindingCandidate, weights: StrategicRouteWeightingReport): number {
  const byRoute = new Map(weights.routes.map((route) => [route.route_id, route.normalized_weight]));
  return round(clamp(candidate.routeIds.reduce((sum, routeId) => sum + (byRoute.get(routeId) ?? 0), 0)));
}

function semanticFindingId(candidate: FindingCandidate): string {
  return semanticId("semantic-finding", [
    candidate.kind,
    candidate.cohort?.cohort_id ?? null,
    [...candidate.routeIds].sort(compareStrings),
  ]);
}

function assessmentForCandidate(
  assessments: readonly StrategicFitRouteAssessmentInput[],
  candidate: FindingCandidate,
): StrategicFitRouteAssessmentInput | undefined {
  const findingIdentity = semanticFindingId(candidate);
  return assessments.find((assessment) =>
    candidate.routeIds.includes(assessment.route_id) &&
    (assessment.semantic_finding_id === undefined || assessment.semantic_finding_id === findingIdentity)
  );
}

function findingAssessment(
  context: FindingContext,
  candidate: FindingCandidate,
  difference: StrategicDifference,
): {
  readonly assessment: StrategicFindingAssessment;
  readonly learningBurden: number;
  readonly confidence: StrategicFinding["confidence"];
} {
  const trajectories = trajectoryById(context.trajectories);
  const affected = trajectories.get(candidate.comparison?.left_route_id ?? candidate.routeIds[0]!);
  const incompleteShare = candidate.routeIds.filter((routeId) => trajectories.get(routeId)?.state !== "complete").length /
    candidate.routeIds.length;
  const persistence = temporalPersistence(candidate);
  const hasTaxonomy = openingAvailable(context, candidate.routeIds);
  const causalityQuality = candidate.causality.controllability === null
    ? 0
    : candidate.causality.timeline.length > 0 ? 1 : 0.6;
  const confidence = calculateFindingConfidence({
    classifier_confidence: classifierConfidence(affected),
    checkpoint_completeness: affected?.evidence_coverage ?? 0,
    effective_sample_size: candidate.cohort?.effective_sample_size ?? 1,
    temporal_persistence: persistence,
    cohort_coherence: candidate.comparison?.distance === null || candidate.comparison === null
      ? 0
      : clamp(1 - candidate.comparison.distance),
    opening_data_quality: hasTaxonomy ? 1 : 0.5,
    causal_attribution_quality: causalityQuality,
    substantial_incomplete_line_share: incompleteShare >= 0.25,
    unresolved_classifier_conflict: candidate.comparison?.state === "incomparable",
    opening_taxonomy_available: hasTaxonomy,
    strong_structural_evidence: (candidate.comparison?.matched_checkpoint_keys.length ?? 0) >= 2,
  });
  const magnitude = scoreStrategicDifferenceMagnitude({
    distance: difference.distance,
    persistence: difference.persistence,
    new_concept_count: difference.new_concept_count,
    stable_from_ply: difference.stable_from_ply,
  }).score;
  const learningBurden = round(clamp((magnitude + difference.new_concept_count / (difference.new_concept_count + 1)) / 2));
  const routeAssessment = assessmentForCandidate(context.options.routeAssessments ?? [], candidate);
  const selectionIsExplicit = candidate.selectionState === "explicit-target";
  const profileConflict = candidate.kind === "route-exception" && (
    selectionIsExplicit ||
    (context.options.profile?.source === "explicit" && context.options.profile.mode === "familiar-plans")
  );
  return {
    learningBurden,
    confidence,
    assessment: assessStrategicFinding({
      confidence,
      difference,
      causality: candidate.causality,
      mode_selection_state: candidate.selectionState,
      conflicts_with_selected_profile: profileConflict,
      introduces_meaningful_additional_learning: difference.new_concept_count > 0 || magnitude >= 1 / 3,
      alternative_state: routeAssessment?.alternative_state ?? "not-assessed",
      intent: {
        matches_declared_objective: routeAssessment?.matches_declared_objective ?? false,
        resolution_state: routeAssessment?.resolution_state ?? null,
      },
      productive_tradeoffs: [],
      blocking_data_quality_issue_ids: context.preflight.issues
        .filter((issue) => issue.severity === "blocking")
        .map((issue) => issue.issue_id),
      transpositionally_equivalent: candidate.transpositionallyEquivalent,
      priority: {
        difference: magnitude,
        expected_frequency: expectedFrequency(candidate, context.weights),
        learning_burden: learningBurden,
        preference_mismatch: profileConflict ? 1 : 0,
        training_actionability: candidate.kind === "transposition" ? 0 : 1,
      },
    }),
  };
}

function affectedIssueIds(
  context: FindingContext,
  routes: readonly RepertoireGraphRoute[],
): string[] {
  return context.preflight.issues
    .filter((issue) =>
      issue.affected_source_paths.length === 0 ||
      routes.some((route) => route.source_san_paths.some((routePath) =>
        issue.affected_source_paths.some((issuePath) =>
          isPathPrefix(issuePath, routePath) || isPathPrefix(routePath, issuePath)
        )
      ))
    )
    .map((issue) => issue.issue_id)
    .sort(compareStrings);
}

function analysisWindow(trajectories: readonly StrategicTrajectory[]): readonly [number, number] | null {
  const plies = trajectories.flatMap((trajectory) => trajectory.snapshots
    .filter((snapshot) => snapshot.checkpoint.comparability === "comparable")
    .map((snapshot) => snapshot.checkpoint.ply));
  return plies.length === 0 ? null : [Math.min(...plies), Math.max(...plies)];
}

function evidence(
  context: FindingContext,
  candidate: FindingCandidate,
  routes: readonly RepertoireGraphRoute[],
): FindingEvidence {
  const trajectoriesByRoute = trajectoryById(context.trajectories);
  const routeTrajectories = candidate.routeIds
    .map((routeId) => trajectoriesByRoute.get(routeId))
    .filter((trajectory): trajectory is StrategicTrajectory => trajectory !== undefined);
  const coverage = routeTrajectories.length === 0
    ? 0
    : routeTrajectories.reduce((sum, trajectory) => sum + trajectory.evidence_coverage, 0) /
      routeTrajectories.length;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_id: candidate.cohort?.cohort_id ?? "cohort:transposition",
    baseline_mode_ids: candidate.modes.map((mode) => mode.mode_id).sort(compareStrings),
    representative_route_ids: candidate.modes
      .map((mode) => mode.representative_route_id)
      .sort(compareStrings),
    dimensions: dimensions(candidate, trajectoriesByRoute),
    comparison_basis: {
      effective_branches: candidate.cohort?.effective_sample_size ?? 1,
      weighted_reference_games: null,
      structural_classification_coverage: round(coverage),
      analysis_window: analysisWindow(routeTrajectories),
      taxonomy_version: context.taxonomy.taxonomy_version,
      profile_mode: (context.options.profile ?? defaultProfile()).mode,
    },
    causality: candidate.causality,
    data_quality_issue_ids: affectedIssueIds(context, routes),
    provenance: mergeSources(
      context.trajectories.provenance,
      context.distances.provenance,
      context.causality.provenance,
    ),
  };
}

function openingScope(context: FindingContext, routeId: string): string {
  const taxonomy = context.taxonomy.routes.find((route) => route.route_id === routeId)?.taxonomy;
  return taxonomy?.path.at(-1)?.label ?? "Unknown opening";
}

function category(classification: StrategicFinding["classification"]): string {
  const values: Readonly<Record<StrategicFinding["classification"], string>> = {
    "genuine-inconsistency": "Avoidable strategic inconsistency",
    "forced-diversity": "Opponent-forced strategic exception",
    "intentional-diversity": "Intentional strategic diversity",
    "productive-diversity": "Productive strategic diversity",
    "mixed-strategic-profile": "Multiple supported strategic modes",
    uncertain: "Incomplete strategic evidence",
    "data-quality-issue": "Strategic data-quality issue",
    "transpositional-equivalence": "Equivalent move orders",
  };
  return values[classification];
}

function explanation(assessment: StrategicFindingAssessment): string {
  return assessment.reasons.map((reason) => reason.replaceAll("-", " ")).join("; ");
}

function baselinePercentage(candidate: FindingCandidate): number {
  if (candidate.modes.length === 0) return 0;
  return round(clamp(Math.max(...candidate.modes.map((mode) => mode.normalized_weight))) * 100);
}

function findingFromCandidate(context: FindingContext, candidate: FindingCandidate): StrategicFinding {
  const routesById = routeById(context.graph);
  const routes = candidate.routeIds.map((routeId) => routesById.get(routeId)!).filter(Boolean);
  const difference = findingDifference(candidate, context.concepts);
  const { assessment, learningBurden, confidence } = findingAssessment(context, candidate, difference);
  const assessmentInput = assessmentForCandidate(context.options.routeAssessments ?? [], candidate);
  const resolutionState = assessmentInput?.resolution_state ?? "unresolved";
  const semanticFindingIdentity = semanticFindingId(candidate);
  const findingId = semanticId("finding", [
    context.options.repertoireRevision,
    candidate.kind,
    candidate.cohort?.cohort_id ?? null,
    [...candidate.routeIds].sort(compareStrings),
  ]);
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    finding_id: findingId,
    semantic_finding_id: semanticFindingIdentity,
    repertoire_revision: context.options.repertoireRevision,
    classification: assessment.classification,
    plain_language_category: category(assessment.classification),
    opening_scope: openingScope(context, candidate.routeIds[0]!),
    affected_line_summary: routes.length === 1
      ? routes[0]!.san_moves.join(" ")
      : `${routes.length} related repertoire routes`,
    explanation: explanation(assessment),
    references: {
      position_ids: [...new Set(routes.flatMap((route) => route.position_ids))].sort(compareStrings),
      decision_ids: [...new Set(routes.flatMap((route) => route.decision_ids))].sort(compareStrings),
      route_ids: [...candidate.routeIds].sort(compareStrings),
      source_san_paths: routes.flatMap((route) => route.source_san_paths.map((path) => [...path])),
    },
    weighted_baseline_percentage: baselinePercentage(candidate),
    expected_frequency: expectedFrequency(candidate, context.weights),
    learning_burden: learningBurden,
    confidence,
    difference,
    objective_quality: objectiveQuality(),
    replacement_priority: assessment.replacement_priority,
    training_priority: assessment.training_priority,
    evidence: evidence(context, candidate, routes),
    resolution_state: resolutionState,
    provisional: false,
    provenance: context.provenance,
  };
}

function reportId(
  options: AnalyzeStrategicFitOptions,
  graph: RepertoireGraph | null,
  profile: StrategicFitProfile,
  blockedPreflight: StrategicFitPreflight | null = null,
): string {
  return semanticId("strategic-fit-report", [
    options.repertoireRevision,
    graph?.graph_id ?? ["blocked", blockedPreflight],
    STRATEGIC_FIT_ANALYSIS_MANIFEST,
    profile,
    analysisIdentity(options),
  ]);
}

function blockedResult(
  options: AnalyzeStrategicFitOptions,
  profile: StrategicFitProfile,
  preflight: StrategicFitPreflight,
): StrategicFitAnalysisResult {
  const sources = preflight.issues.flatMap((issue) => issue.provenance);
  const reportProvenance = provenance(options, mergeSources([profileSource(profile)], sources));
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    report_id: reportId(options, null, profile, preflight),
    repertoire_revision: options.repertoireRevision,
    manifest: STRATEGIC_FIT_ANALYSIS_MANIFEST,
    profile,
    preflight,
    trajectories: [],
    cohorts: [],
    summary: blockedOverview(preflight),
    findings: [],
    finding_page: pageInfo(0, options),
    provenance: reportProvenance,
  };
}

/**
 * Run the complete deterministic Strategic Fit pipeline and return one immutable page projection.
 * Summary counts and report identity are calculated from all findings before paging.
 */
export function analyzeStrategicFit(
  tree: GameTree,
  options: AnalyzeStrategicFitOptions,
): StrategicFitAnalysisResult {
  validateOptions(options);
  const profile = options.profile ?? defaultProfile();
  const runId = options.runId ?? semanticId("strategic-fit-run", [
    options.repertoireRevision,
    STRATEGIC_FIT_ANALYSIS_MANIFEST,
    profile,
    analysisIdentity(options),
  ]);

  const normalized = runPhase(options, runId, 0, () => {
    const preflight = preflightStrategicFit(tree, {
      repertoireColor: options.repertoireColor,
      openingTable: options.openingTable,
    });
    if (preflight.state === "blocked" || options.repertoireColor === null) {
      return { preflight, graph: null } as const;
    }
    const graph = buildRepertoireGraph(tree, options.repertoireColor);
    return { preflight: attachPreflightRouteIds(preflight, graph), graph } as const;
  });
  if (normalized.graph === null) return blockedResult(options, profile, normalized.preflight);
  const graph = normalized.graph;

  const comparable = runPhase(options, runId, 1, () => {
    const taxonomy = buildOpeningTaxonomy(graph, options.openingTable);
    const weights = calculateStrategicRouteWeights(graph, options.weighting);
    const trajectories = buildStrategicTrajectories(graph, {
      ...options.trajectory,
      openingTable: options.openingTable,
    });
    const cohorts = formStrategicCohorts(graph, taxonomy, trajectories, weights, options.cohorts);
    return { taxonomy, weights, trajectories, cohorts };
  });

  const patterns = runPhase(options, runId, 2, () => {
    const concepts = buildStrategicConceptDictionary(comparable.trajectories);
    const modes = detectStrategicModes(
      comparable.cohorts,
      comparable.trajectories,
      comparable.weights,
      options.modes,
    );
    return { concepts, modes };
  });

  const distances = runPhase(options, runId, 3, () =>
    calculateStrategicDistances(
      patterns.modes,
      comparable.trajectories,
      patterns.concepts,
      options.distance,
    )
  );

  const causality = runPhase(options, runId, 4, () =>
    calculateStrategicCausality(graph, comparable.trajectories, distances)
  );

  return runPhase(options, runId, 5, () => {
    const reportProvenance = provenance(options, mergeSources(
      comparable.taxonomy.routes.flatMap((route) => route.taxonomy.state === "unknown"
        ? [{
            source_id: "strategic-fit:opening-taxonomy",
            kind: "opening-taxonomy" as const,
            state: "unavailable" as const,
            version: comparable.taxonomy.taxonomy_version,
            snapshot: null,
            reason: route.taxonomy.provenance.explanation,
          }]
        : []),
      comparable.weights.provenance,
      comparable.trajectories.provenance,
      patterns.concepts.provenance,
      patterns.modes.provenance,
      distances.provenance,
      causality.provenance,
      [profileSource(profile)],
    ));
    const context: FindingContext = {
      options: { ...options, profile },
      graph,
      preflight: normalized.preflight,
      taxonomy: comparable.taxonomy,
      trajectories: comparable.trajectories,
      concepts: patterns.concepts,
      weights: comparable.weights,
      modes: patterns.modes,
      distances,
      causality,
      provenance: reportProvenance,
    };
    for (const assessment of options.routeAssessments ?? []) {
      if (!graph.routes.some((route) => route.route_id === assessment.route_id)) {
        throw new Error(`strategic_fit_analyze_unknown_assessment_route: ${assessment.route_id}`);
      }
    }
    const allFindings = sortStrategicFitFindings(
      candidates(context).map((candidate) => findingFromCandidate(context, candidate)),
      options.sort ?? "replacement-priority",
    );
    const summary = calculateStrategicFitOverview({
      graph,
      weights: comparable.weights,
      modes: patterns.modes,
      concepts: patterns.concepts,
      findings: allFindings,
      training: options.training,
    });
    const findingPage = pageInfo(allFindings.length, options);
    return {
      schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      report_id: reportId(options, graph, profile),
      repertoire_revision: options.repertoireRevision,
      manifest: STRATEGIC_FIT_ANALYSIS_MANIFEST,
      profile,
      preflight: normalized.preflight,
      trajectories: comparable.trajectories.trajectories,
      cohorts: patterns.modes.cohorts,
      summary,
      findings: allFindings.slice(findingPage.offset, findingPage.offset + findingPage.limit),
      finding_page: findingPage,
      provenance: reportProvenance,
    };
  });
}
