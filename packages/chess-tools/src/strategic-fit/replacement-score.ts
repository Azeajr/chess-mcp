/**
 * Framework-free Task 8.6 replacement trajectory scoring and Pareto assessment.
 *
 * Only current Task 8.5 expansions enter this boundary. Complete subtrees are projected onto one
 * canonical prefix and any prepared transposition continuations before the existing trajectory,
 * concept, distance, and route-weight semantics are reused. Incomplete expansions remain visible
 * but unscored. This module does not simulate edits, build change sets, or mutate source evidence.
 */
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { parseUci } from "chessops/util";

import { positionKey, type Color } from "../congruence.js";
import {
  buildStrategicConceptDictionary,
  computeStrategicConceptOverlap,
  type StrategicConceptDictionary,
  type StrategicRouteConcepts,
} from "./concepts.js";
import { computeStrategicTrajectoryDistance } from "./distance.js";
import type {
  RepertoireGraph,
  RepertoireGraphDecision,
  RepertoireGraphMoveOrder,
  RepertoireGraphPosition,
  RepertoireGraphRoute,
  RepertoireGraphTranspositionLink,
} from "./graph.js";
import type { StrategicPopularityCollection } from "./popularity.js";
import type {
  ReplacementCandidateExpansion,
  ReplacementCandidateExpansionResult,
  ReplacementCompleteCandidateExpansion,
} from "./replacement-expand.js";
import type {
  ReplacementObjectiveQuality,
  ReplacementParetoAssessment,
  ReplacementParetoAxis,
  ReplacementRequest,
  ReplacementScoreState,
  ReplacementStrategicScore,
  ReplacementStrategicScoreAxis,
  ReplacementStrategicScoreContribution,
  StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import {
  REPLACEMENT_PARETO_AXES,
  REPLACEMENT_STRATEGIC_SCORE_AXES,
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
} from "./replacement-types.js";
import { buildStrategicTrajectories, type StrategicTrajectoryReport } from "./trajectory.js";
import type {
  StrategicCohort,
  StrategicFitMetrics,
  StrategicFitProfile,
  StrategicFitSourceProvenance,
  StrategicTrajectory,
} from "./types.js";
import { STRATEGIC_SIGNAL_FAMILIES } from "./types.js";
import type { StrategicTrainingMetricEvidence } from "./metrics.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION, STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";
import { calculateStrategicRouteWeights, type StrategicRouteWeightingReport } from "./weights.js";

export const REPLACEMENT_SCORING_RESULT_STATUSES = [
  "complete",
  "partial",
  "unavailable",
  "stale",
  "invalid-request",
] as const;
export type ReplacementScoringResultStatus = (typeof REPLACEMENT_SCORING_RESULT_STATUSES)[number];

export const REPLACEMENT_SCORING_ERROR_CODES = [
  "request-expansion-mismatch",
  "expansion-not-current",
  "graph-context-mismatch",
  "cohort-context-mismatch",
  "trajectory-context-mismatch",
  "concept-context-mismatch",
  "invalid-training-evidence",
  "invalid-profile",
  "malformed-expansion",
] as const;
export type ReplacementScoringErrorCode = (typeof REPLACEMENT_SCORING_ERROR_CODES)[number];

export interface ScoreReplacementCandidatesInput {
  readonly request: ReplacementRequest;
  readonly graph: RepertoireGraph;
  readonly cohort: StrategicCohort;
  readonly trajectories: StrategicTrajectoryReport;
  readonly concepts: StrategicConceptDictionary;
  readonly metrics: StrategicFitMetrics;
  readonly training?: StrategicTrainingMetricEvidence | null;
  readonly popularity?: StrategicPopularityCollection | null;
  readonly expansion: ReplacementCandidateExpansionResult;
}

export interface ReplacementScoringContext extends StrategicFitReplacementVersioned {
  readonly profile: StrategicFitProfile;
  readonly graph: RepertoireGraph;
  readonly cohort: StrategicCohort;
  readonly trajectories: StrategicTrajectoryReport;
  readonly concepts: StrategicConceptDictionary;
  readonly metrics: StrategicFitMetrics;
  readonly training: StrategicTrainingMetricEvidence | null;
  readonly popularity: StrategicPopularityCollection | null;
}

export interface ReplacementScoredCandidate extends StrategicFitReplacementVersioned {
  readonly candidate_id: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly state: ReplacementScoreState;
  readonly reason: string | null;
  /** Full Task 8.5 value, including its Task 8.3 seed, Task 8.4 evidence, and Task 8.5 subtree. */
  readonly expansion: ReplacementCandidateExpansion;
  readonly objective_quality: ReplacementObjectiveQuality;
  readonly strategic_score: ReplacementStrategicScore;
  readonly pareto: ReplacementParetoAssessment;
  readonly trajectory_report: StrategicTrajectoryReport | null;
  readonly concept_dictionary: StrategicConceptDictionary | null;
  readonly route_weighting: StrategicRouteWeightingReport | null;
}

export interface ReplacementCandidateScoringResult extends StrategicFitReplacementVersioned {
  readonly status: ReplacementScoringResultStatus;
  readonly error_code: ReplacementScoringErrorCode | null;
  readonly explanation: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly pivot_id: string | null;
  readonly candidates: readonly ReplacementScoredCandidate[];
  readonly pareto_candidate_ids: readonly string[];
  readonly dominated_candidate_ids: readonly string[];
  readonly unscored_candidate_ids: readonly string[];
  readonly context: ReplacementScoringContext;
  readonly expansion: ReplacementCandidateExpansionResult;
  readonly provenance: readonly StrategicFitSourceProvenance[];
  readonly source_graph_unchanged: true;
  readonly source_context_unchanged: true;
  readonly expansion_unchanged: true;
  readonly inputs_unchanged: true;
}

interface CompatibilityFailure {
  readonly status: Extract<ReplacementScoringResultStatus, "stale" | "invalid-request">;
  readonly error: ReplacementScoringErrorCode;
  readonly explanation: string;
}

interface CandidateRouteEvidence {
  readonly route_id: string;
  readonly expected_frequency: number | null;
}

interface CandidateProjection {
  readonly graph: RepertoireGraph;
  readonly routeEvidence: readonly CandidateRouteEvidence[];
  readonly frequencyState: ReplacementScoreState;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface AxisValue {
  readonly state: ReplacementScoreState;
  readonly raw: number | null;
  readonly normalized: number | null;
  readonly unit: string;
  readonly higherIsBetter: boolean;
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface CandidateCalculation {
  readonly scored: ReplacementScoredCandidate;
  readonly paretoValues: ReadonlyMap<ReplacementParetoAxis, AxisValue>;
}

const SEPARATOR = "\u001f";
const EPSILON = 1e-9;

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:replacement-score",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  snapshot: null,
  reason: null,
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

/** Thrown when a projection invariant that upstream validation should already guarantee doesn't
 *  hold — caught at the projection boundary and treated as an unprojectable candidate, never
 *  a crash. */
class ProjectionInvariantError extends Error {}

function assertDefined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new ProjectionInvariantError();
  return value;
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function semanticPositionId(key: string): string {
  return `position:${stableHash(key)}`;
}

function semanticDecisionId(fromPositionId: string, uci: string, toPositionKey: string): string {
  return `decision:${stableHash([fromPositionId, uci, semanticPositionId(toPositionKey)].join(SEPARATOR))}`;
}

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort(compareStrings)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function sortedJson<T>(values: readonly T[]): T[] {
  return values
    .map(cloneJson)
    .sort((left, right) => compareStrings(stableJson(left), stableJson(right)));
}

function canonicalProvenanceFields<T>(value: T): T {
  if (Array.isArray(value)) return value.map(canonicalProvenanceFields) as T;
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const canonical: unknown = canonicalProvenanceFields(item);
    result[key] =
      key === "provenance" && Array.isArray(canonical)
        ? [...(canonical as unknown[])].sort((left, right) =>
            compareStrings(stableJson(left), stableJson(right)),
          )
        : canonical;
  }
  return result as T;
}

function canonicalSetLikeFields<T>(value: T, field: string | null = null): T {
  if (Array.isArray(value)) {
    const items: unknown[] = (value as unknown[]).map((item) => canonicalSetLikeFields(item));
    const ordered =
      field === "source_san_paths" ||
      field === "annotation_text" ||
      field === "source_kinds" ||
      (field?.endsWith("_ids") === true && field !== "node_ids" && field !== "edge_ids")
        ? [...items].sort((left, right) => compareStrings(stableJson(left), stableJson(right)))
        : items;
    return ordered as T;
  }
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, canonicalSetLikeFields(item, key)]),
  ) as T;
}

function sortedPaths(values: readonly (readonly string[])[]): string[][] {
  return values
    .map((path) => [...path])
    .sort(
      (left, right) =>
        compareStrings(left.join(SEPARATOR), right.join(SEPARATOR)) || left.length - right.length,
    );
}

function canonicalGraph(value: RepertoireGraph): RepertoireGraph {
  const graph = cloneJson(value);
  return {
    ...graph,
    positions: graph.positions
      .map((position) => ({
        ...position,
        source_san_paths: sortedPaths(position.source_san_paths),
        incoming_move_order_ids: sortedUnique(position.incoming_move_order_ids),
        incoming_decision_ids: sortedUnique(position.incoming_decision_ids),
        outgoing_decision_ids: sortedUnique(position.outgoing_decision_ids),
        route_ids: sortedUnique(position.route_ids),
      }))
      .sort((left, right) => compareStrings(left.position_id, right.position_id)),
    decisions: graph.decisions
      .map((decision) => ({
        ...decision,
        plies: [...decision.plies].sort((left, right) => left - right),
        source_san_paths: sortedPaths(decision.source_san_paths),
        route_ids: sortedUnique(decision.route_ids),
      }))
      .sort((left, right) => compareStrings(left.decision_id, right.decision_id)),
    move_orders: graph.move_orders
      .map((moveOrder) => ({
        ...moveOrder,
        source_san_paths: sortedPaths(moveOrder.source_san_paths),
        route_ids: sortedUnique(moveOrder.route_ids),
      }))
      .sort((left, right) => compareStrings(left.move_order_id, right.move_order_id)),
    routes: graph.routes
      .map((route) => ({
        ...route,
        source_san_paths: sortedPaths(route.source_san_paths),
      }))
      .sort((left, right) => compareStrings(left.route_id, right.route_id)),
    transposition_links: graph.transposition_links
      .map((link) => ({
        ...link,
        incoming_move_order_ids: sortedUnique(link.incoming_move_order_ids),
        incoming_decision_ids: sortedUnique(link.incoming_decision_ids),
        route_ids: sortedUnique(link.route_ids),
        source_san_paths: sortedPaths(link.source_san_paths),
      }))
      .sort((left, right) => compareStrings(left.transposition_id, right.transposition_id)),
  };
}

function canonicalCohort(value: StrategicCohort): StrategicCohort {
  const cohort = cloneJson(value);
  return {
    ...cohort,
    opening_scope_ids: sortedUnique(cohort.opening_scope_ids),
    decision_scope_ids: sortedUnique(cohort.decision_scope_ids),
    route_ids: sortedUnique(cohort.route_ids),
    excluded_route_ids: sortedUnique(cohort.excluded_route_ids),
    route_weights: [...cohort.route_weights].sort((left, right) =>
      compareStrings(left.route_id, right.route_id),
    ),
    modes: cohort.modes
      .map((mode) => ({
        ...mode,
        supporting_route_ids: sortedUnique(mode.supporting_route_ids),
        concept_ids: sortedUnique(mode.concept_ids),
        provenance: sortedJson(mode.provenance),
      }))
      .sort((left, right) => compareStrings(left.mode_id, right.mode_id)),
    override_ids: sortedUnique(cohort.override_ids),
    provenance: sortedJson(cohort.provenance),
  };
}

function canonicalTrajectories(value: StrategicTrajectoryReport): StrategicTrajectoryReport {
  const report = cloneJson(value);
  return {
    ...report,
    configured_plies: [...report.configured_plies].sort((left, right) => left - right),
    trajectories: report.trajectories
      .map((trajectory) => ({
        ...trajectory,
        stable_signal_ids: sortedUnique(trajectory.stable_signal_ids),
        transient_signal_ids: sortedUnique(trajectory.transient_signal_ids),
        provenance: sortedJson(trajectory.provenance),
        snapshots: trajectory.snapshots.map((snapshot) => ({
          ...snapshot,
          signals: sortedJson(snapshot.signals),
          provenance: sortedJson(snapshot.provenance),
        })),
        missing_checkpoints: sortedJson(trajectory.missing_checkpoints),
      }))
      .sort((left, right) => compareStrings(left.route_id, right.route_id)),
    provenance: sortedJson(report.provenance),
  };
}

function canonicalConcepts(value: StrategicConceptDictionary): StrategicConceptDictionary {
  const dictionary = cloneJson(value);
  return {
    ...dictionary,
    routes: dictionary.routes
      .map((route) => ({
        ...route,
        concepts: route.concepts
          .map((concept) => ({
            ...concept,
            evidence: sortedJson(concept.evidence),
            provenance: sortedJson(concept.provenance),
          }))
          .sort((left, right) => compareStrings(left.concept_id, right.concept_id)),
        provenance: sortedJson(route.provenance),
      }))
      .sort((left, right) => compareStrings(left.route_id, right.route_id)),
    labels: [...dictionary.labels].sort(
      (left, right) =>
        compareStrings(left.concept_id, right.concept_id) ||
        compareStrings(left.locale, right.locale),
    ),
    provenance: sortedJson(dictionary.provenance),
  };
}

function canonicalTraining(
  value: StrategicTrainingMetricEvidence | null | undefined,
): StrategicTrainingMetricEvidence | null {
  if (!value) return null;
  const training = cloneJson(value);
  return {
    ...training,
    concept_mastery: training.concept_mastery
      .map((item) => ({
        ...item,
        provenance: item.provenance === undefined ? undefined : sortedJson(item.provenance),
      }))
      .sort((left, right) => compareStrings(left.concept_id, right.concept_id)),
    provenance: training.provenance === undefined ? undefined : sortedJson(training.provenance),
  };
}

function canonicalPopularity(
  value: StrategicPopularityCollection | null | undefined,
): StrategicPopularityCollection | null {
  if (!value) return null;
  const popularity = cloneJson(value);
  return {
    ...popularity,
    decision_weights: sortedJson(popularity.decision_weights),
    weighting: {
      ...popularity.weighting,
      route_weights:
        popularity.weighting.route_weights === undefined
          ? undefined
          : sortedJson(popularity.weighting.route_weights),
      decision_weights:
        popularity.weighting.decision_weights === undefined
          ? undefined
          : sortedJson(popularity.weighting.decision_weights),
      provenance:
        popularity.weighting.provenance === undefined
          ? undefined
          : sortedJson(popularity.weighting.provenance),
    },
    provenance: sortedJson(popularity.provenance),
  };
}

function canonicalProfile(value: StrategicFitProfile): StrategicFitProfile {
  const profile = cloneJson(value);
  return {
    ...profile,
    preferences: {
      ...profile.preferences,
      preferred_concept_ids: sortedUnique(profile.preferences.preferred_concept_ids),
      avoided_concept_ids: sortedUnique(profile.preferences.avoided_concept_ids),
      preferred_tactical_character: sortedUnique(profile.preferences.preferred_tactical_character),
    },
  };
}

function canonicalMetrics(value: StrategicFitMetrics): StrategicFitMetrics {
  const metrics = canonicalProvenanceFields(cloneJson(value));
  const centrality = metrics.concept_centrality.value;
  return {
    ...metrics,
    concept_centrality: {
      ...metrics.concept_centrality,
      value:
        centrality === null
          ? null
          : centrality
              .map((item) => ({
                ...item,
                cohort_ids: sortedUnique(item.cohort_ids),
              }))
              .sort((left, right) => compareStrings(left.concept_id, right.concept_id)),
    },
  };
}

function canonicalCandidateExpansion<T extends ReplacementCandidateExpansion>(value: T): T {
  const candidate = canonicalSetLikeFields(canonicalProvenanceFields(cloneJson(value)));
  const subtree =
    candidate.subtree === null
      ? null
      : {
          ...candidate.subtree,
          nodes: [...candidate.subtree.nodes].sort(
            (left, right) => left.ply - right.ply || compareStrings(left.node_id, right.node_id),
          ) as unknown as typeof candidate.subtree.nodes,
          edges: [...candidate.subtree.edges].sort(
            (left, right) =>
              compareStrings(left.from_node_id, right.from_node_id) ||
              compareStrings(left.edge_id, right.edge_id),
          ) as unknown as typeof candidate.subtree.edges,
          routes: [...candidate.subtree.routes].sort((left, right) =>
            compareStrings(left.route_id, right.route_id),
          ) as unknown as typeof candidate.subtree.routes,
          provenance: sortedJson(candidate.subtree.provenance),
        };
  return {
    ...candidate,
    seed: {
      ...candidate.seed,
      provenance: sortedJson(candidate.seed.provenance),
    },
    evidence_item_results: sortedJson(candidate.evidence_item_results),
    source_results: sortedJson(candidate.source_results),
    omissions: sortedJson(candidate.omissions),
    unresolved_risks: sortedJson(candidate.unresolved_risks),
    subtree,
  };
}

function canonicalExpansionResult(
  value: ReplacementCandidateExpansionResult,
): ReplacementCandidateExpansionResult {
  const result = canonicalSetLikeFields(canonicalProvenanceFields(cloneJson(value)));
  return {
    ...result,
    candidates: result.candidates
      .map(canonicalCandidateExpansion)
      .sort((left, right) => compareStrings(left.candidate_id, right.candidate_id)),
    source_results: sortedJson(result.source_results),
    evidence_item_results: sortedJson(result.evidence_item_results),
    omissions: sortedJson(result.omissions),
    unresolved_risks: sortedJson(result.unresolved_risks),
    task_8_4_engine_item_results: sortedJson(result.task_8_4_engine_item_results),
    task_8_4_source_results: sortedJson(result.task_8_4_source_results),
    engine_cache_writes: sortedJson(result.engine_cache_writes),
    provenance: sortedJson(result.provenance),
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function mergeProvenance(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const values = new Map<string, StrategicFitSourceProvenance>();
  for (const source of groups.flat()) {
    const key = [
      source.source_id,
      source.kind,
      source.state,
      source.version ?? "",
      source.snapshot ?? "",
      source.reason ?? "",
    ].join(SEPARATOR);
    if (!values.has(key)) values.set(key, cloneJson(source));
  }
  return [...values.values()].sort(
    (left, right) =>
      compareStrings(left.source_id, right.source_id) ||
      compareStrings(left.kind, right.kind) ||
      compareStrings(left.state, right.state) ||
      compareStrings(left.version ?? "", right.version ?? "") ||
      compareStrings(left.snapshot ?? "", right.snapshot ?? "") ||
      compareStrings(left.reason ?? "", right.reason ?? ""),
  );
}

function candidateProvenance(
  expansion: ReplacementCandidateExpansion,
): StrategicFitSourceProvenance[] {
  return mergeProvenance(
    [CORE_PROVENANCE],
    expansion.seed.objective_quality.provenance,
    ...expansion.seed.provenance.map((source) => source.provenance),
    ...(expansion.subtree?.provenance.map((source) => source.provenance) ?? []),
    ...expansion.evidence_item_results.map((item) => item.provenance),
    ...expansion.source_results.map((source) => source.provenance),
    ...expansion.unresolved_risks.map((risk) => risk.provenance),
  );
}

function sameVersions(value: {
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly replacement_schema_version: string;
}): boolean {
  return (
    value.schema_version === STRATEGIC_FIT_SCHEMA_VERSION &&
    value.analysis_version === STRATEGIC_FIT_ANALYSIS_VERSION &&
    value.replacement_schema_version === STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION
  );
}

function sameIdentity(
  value: Pick<
    ReplacementCandidateExpansionResult,
    | "request_id"
    | "report_id"
    | "finding_id"
    | "semantic_finding_id"
    | "cohort_id"
    | "repertoire_revision"
    | "repertoire_color"
  >,
  request: ReplacementRequest,
): boolean {
  return (
    value.request_id === request.request_id &&
    value.report_id === request.report_id &&
    value.finding_id === request.finding_id &&
    value.semantic_finding_id === request.semantic_finding_id &&
    value.cohort_id === request.cohort_id &&
    value.repertoire_revision === request.repertoire_revision &&
    value.repertoire_color === request.repertoire_color
  );
}

function validNumericUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validUnit(value: unknown): value is number | null {
  return value === null || validNumericUnit(value);
}

function validUniqueStrings(values: readonly string[]): boolean {
  return (
    values.every((value) => typeof value === "string" && value.length > 0) &&
    new Set(values).size === values.length
  );
}

function validProfile(profile: StrategicFitProfile): boolean {
  const preferences = profile.preferences;
  if (
    profile.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    (preferences.maximum_engine_loss_cp !== null &&
      (typeof preferences.maximum_engine_loss_cp !== "number" ||
        !Number.isFinite(preferences.maximum_engine_loss_cp) ||
        preferences.maximum_engine_loss_cp < 0)) ||
    !validNumericUnit(preferences.opponent_popularity_importance) ||
    !validNumericUnit(preferences.personal_game_frequency_importance) ||
    !validNumericUnit(preferences.manual_weight_importance) ||
    !validNumericUnit(preferences.additional_memorization_tolerance) ||
    !validUnit(preferences.minimum_opponent_coverage) ||
    !validUniqueStrings(preferences.preferred_concept_ids) ||
    !validUniqueStrings(preferences.avoided_concept_ids) ||
    !validUniqueStrings(preferences.preferred_tactical_character)
  )
    return false;
  const weights = preferences.feature_family_weights;
  const keys = Object.keys(weights).sort(compareStrings);
  if (
    keys.length !== STRATEGIC_SIGNAL_FAMILIES.length ||
    !keys.every((key) => (STRATEGIC_SIGNAL_FAMILIES as readonly string[]).includes(key))
  )
    return false;
  return (
    STRATEGIC_SIGNAL_FAMILIES.some((family) => weights[family] > 0) &&
    STRATEGIC_SIGNAL_FAMILIES.every(
      (family) =>
        typeof weights[family] === "number" &&
        Number.isFinite(weights[family]) &&
        weights[family] >= 0,
    )
  );
}

function validTrainingEvidence(
  training: StrategicTrainingMetricEvidence | null | undefined,
): boolean {
  if (!training) return true;
  const ids = new Set<string>();
  for (const item of training.concept_mastery) {
    if (
      typeof item.concept_id !== "string" ||
      item.concept_id.length === 0 ||
      ids.has(item.concept_id) ||
      typeof item.mastery !== "number" ||
      !Number.isFinite(item.mastery) ||
      item.mastery < 0 ||
      item.mastery > 1
    )
      return false;
    ids.add(item.concept_id);
  }
  return true;
}

function currentChess(fen: string): Chess | null {
  try {
    return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return null;
  }
}

function validCandidateIdentity(
  expansion: ReplacementCandidateExpansion,
  request: ReplacementRequest,
  graph: RepertoireGraph,
  expectedPivotId: string,
): boolean {
  const seed = expansion.seed;
  if (
    !sameVersions(expansion) ||
    !sameVersions(seed) ||
    !sameVersions(seed.pivot) ||
    expansion.candidate_id !== seed.candidate_id ||
    expansion.rank !== seed.rank ||
    seed.request_id !== request.request_id ||
    seed.report_id !== request.report_id ||
    seed.finding_id !== request.finding_id ||
    seed.semantic_finding_id !== request.semantic_finding_id ||
    seed.cohort_id !== request.cohort_id ||
    seed.repertoire_revision !== request.repertoire_revision ||
    seed.repertoire_color !== request.repertoire_color ||
    seed.mover_color !== request.repertoire_color ||
    seed.pivot.pivot_id !== expectedPivotId ||
    seed.pivot.repertoire_color !== request.repertoire_color ||
    // These fields are typed as single literals because every construction path sets them that
    // way — but this function's job is revalidating an expansion that may have crossed a
    // checkpoint/cache boundary, so recheck them as real values rather than trust the type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    seed.pivot.status !== "actionable" ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    seed.pivot.owner !== "repertoire"
  )
    return false;
  const pivotPosition = graph.positions.find(
    (position) => position.position_id === seed.pivot.position_id,
  );
  const pivotDecision = graph.decisions.find(
    (decision) => decision.decision_id === seed.pivot.decision_id,
  );
  const chess = pivotPosition ? currentChess(pivotPosition.fen) : null;
  const move = parseUci(seed.uci);
  if (
    !pivotPosition ||
    !pivotDecision ||
    !chess ||
    !move ||
    !chess.isLegal(move) ||
    pivotPosition.turn !== request.repertoire_color ||
    pivotDecision.owner !== "repertoire" ||
    pivotDecision.mover_color !== request.repertoire_color ||
    pivotDecision.from_position_id !== pivotPosition.position_id ||
    makeSan(chess, move) !== seed.san
  )
    return false;
  chess.play(move);
  const outcomeFen = makeFen(chess.toSetup());
  const outcomeKey = positionKey(outcomeFen);
  return (
    positionKey(seed.outcome_fen) === outcomeKey &&
    seed.outcome_position_key === outcomeKey &&
    seed.outcome_position_id === semanticPositionId(outcomeKey)
  );
}

function validCompleteExpansion(
  expansion: ReplacementCompleteCandidateExpansion,
  request: ReplacementRequest,
  graph: RepertoireGraph,
  expectedPivotId: string,
  expectedHorizonPly: number,
): boolean {
  if (
    !validCandidateIdentity(expansion, request, graph, expectedPivotId) ||
    !sameVersions(expansion.subtree) ||
    expansion.subtree.root_position_id !== expansion.seed.pivot.position_id ||
    expansion.subtree.strategic_horizon_ply !== expectedHorizonPly ||
    // Revalidating a boundary-crossed value against its claimed shape, not internal construction —
    // see the matching note in validCandidateIdentity above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    expansion.subtree.status !== "complete" ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    expansion.subtree.completion === null ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    expansion.subtree.truncation_reasons.length !== 0 ||
    expansion.subtree.nodes.length < 2 ||
    expansion.subtree.edges.length < 1 ||
    expansion.subtree.routes.length < 1
  )
    return false;
  const pivotPosition = graph.positions.find(
    (position) => position.position_id === expansion.seed.pivot.position_id,
  );
  const pivotDecision = graph.decisions.find(
    (decision) => decision.decision_id === expansion.seed.pivot.decision_id,
  );
  if (
    !pivotPosition ||
    !pivotDecision ||
    pivotPosition.turn !== request.repertoire_color ||
    pivotDecision.owner !== "repertoire" ||
    pivotDecision.mover_color !== request.repertoire_color ||
    pivotDecision.from_position_id !== pivotPosition.position_id
  )
    return false;
  const nodes = new Map(expansion.subtree.nodes.map((node) => [node.node_id, node]));
  const edges = new Map(expansion.subtree.edges.map((edge) => [edge.edge_id, edge]));
  const root = nodes.get(expansion.subtree.root_node_id);
  if (
    nodes.size !== expansion.subtree.nodes.length ||
    edges.size !== expansion.subtree.edges.length ||
    root?.position_id !== expansion.seed.pivot.position_id ||
    root.kind !== "root"
  )
    return false;
  const rootEdges = expansion.subtree.edges.filter((edge) => edge.from_node_id === root.node_id);
  const candidateOutcomeKey = positionKey(expansion.seed.outcome_fen);
  const rootEdge = rootEdges[0];
  if (
    rootEdges.length !== 1 ||
    rootEdge?.san !== expansion.seed.san ||
    rootEdge.uci !== expansion.seed.uci ||
    rootEdge.mover_color !== expansion.seed.mover_color ||
    nodes.get(rootEdge.to_node_id)?.position_id !== expansion.seed.outcome_position_id ||
    expansion.seed.outcome_position_key !== candidateOutcomeKey
  )
    return false;
  const positionKeys = new Map<string, string>();
  for (const node of expansion.subtree.nodes) {
    const chess = currentChess(node.fen);
    if (!chess || node.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION) return false;
    const key = positionKey(makeFen(chess.toSetup()));
    if (
      node.position_id !== semanticPositionId(key) ||
      (node.transposition_target_position_id !== null &&
        node.transposition_target_position_id !== node.position_id)
    )
      return false;
    const existing = positionKeys.get(node.position_id);
    if (existing !== undefined && existing !== key) return false;
    positionKeys.set(node.position_id, key);
    const outgoing = expansion.subtree.edges
      .filter((edge) => edge.from_node_id === node.node_id)
      .map((edge) => edge.edge_id)
      .sort(compareStrings);
    if (
      JSON.stringify(outgoing) !== JSON.stringify([...node.outgoing_edge_ids].sort(compareStrings))
    )
      return false;
  }
  for (const edge of expansion.subtree.edges) {
    const from = nodes.get(edge.from_node_id);
    const to = nodes.get(edge.to_node_id);
    if (
      !from ||
      !to ||
      edge.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
      to.ply !== from.ply + 1
    )
      return false;
    const chess = currentChess(from.fen);
    const move = parseUci(edge.uci);
    if (
      !chess ||
      !move ||
      !chess.isLegal(move) ||
      chess.turn !== edge.mover_color ||
      edge.owner !== (chess.turn === request.repertoire_color ? "repertoire" : "opponent") ||
      makeSan(chess, move) !== edge.san ||
      !validUnit(edge.expected_opponent_frequency)
    )
      return false;
    chess.play(move);
    const toKey = positionKey(makeFen(chess.toSetup()));
    if (
      toKey !== positionKey(to.fen) ||
      edge.decision_id !== semanticDecisionId(from.position_id, edge.uci, toKey)
    )
      return false;
  }
  const routeIds = new Set<string>();
  for (const route of expansion.subtree.routes) {
    if (
      route.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
      routeIds.has(route.route_id) ||
      route.node_ids.length !== route.edge_ids.length + 1 ||
      route.node_ids[0] !== expansion.subtree.root_node_id ||
      route.node_ids.at(-1) !== route.terminal_node_id ||
      !validUnit(route.expected_opponent_frequency)
    )
      return false;
    for (let index = 0; index < route.edge_ids.length; index++) {
      const edgeId = route.edge_ids[index];
      const edge = edgeId === undefined ? undefined : edges.get(edgeId);
      if (
        !edge ||
        edge.from_node_id !== route.node_ids[index] ||
        edge.to_node_id !== route.node_ids[index + 1]
      )
        return false;
    }
    const terminal = nodes.get(route.terminal_node_id);
    if (!terminal) return false;
    if (route.termination === "existing-preparation") {
      const target =
        terminal.transposition_target_position_id === null
          ? null
          : graph.positions.find(
              (position) => position.position_id === terminal.transposition_target_position_id,
            );
      if (!target || positionKey(target.fen) !== positionKey(terminal.fen)) return false;
    } else if (route.termination === "strategic-horizon") {
      if (terminal.ply !== expansion.subtree.strategic_horizon_ply) return false;
    } else if (route.termination === "terminal-position") {
      if (!currentChess(terminal.fen)?.isEnd()) return false;
    } else {
      return false;
    }
    routeIds.add(route.route_id);
  }
  if (
    expansion.subtree.important_reply_count < 0 ||
    expansion.subtree.forcing_reply_count < 0 ||
    expansion.subtree.covered_important_reply_count < 0 ||
    expansion.subtree.covered_forcing_reply_count < 0 ||
    expansion.subtree.covered_important_reply_count > expansion.subtree.important_reply_count ||
    expansion.subtree.covered_forcing_reply_count > expansion.subtree.forcing_reply_count ||
    expansion.subtree.covered_important_reply_count !== expansion.subtree.important_reply_count ||
    expansion.subtree.covered_forcing_reply_count !== expansion.subtree.forcing_reply_count ||
    expansion.subtree.unresolved_risk_ids.some(
      (riskId) => !expansion.unresolved_risks.some((risk) => risk.risk_id === riskId),
    )
  )
    return false;
  const completion = expansion.subtree.completion;
  if (completion.kind === "immediate-transposition") {
    if (
      !graph.positions.some((position) => position.position_id === completion.target_position_id) ||
      !expansion.subtree.routes.every((route) => {
        const terminal = nodes.get(route.terminal_node_id);
        return (
          terminal !== undefined &&
          route.termination === "existing-preparation" &&
          terminal.transposition_target_position_id === completion.target_position_id
        );
      })
    )
      return false;
  } else if (completion.kind === "terminal-position") {
    const terminal = nodes.get(completion.terminal_node_id);
    if (
      !terminal ||
      !currentChess(terminal.fen)?.isEnd() ||
      !expansion.subtree.routes.every((route) => route.termination === "terminal-position")
    )
      return false;
  } else {
    const replyIds = new Set(completion.opponent_reply_edge_ids);
    if (
      replyIds.size !== completion.opponent_reply_edge_ids.length ||
      replyIds.size === 0 ||
      [...replyIds].some((edgeId) => edges.get(edgeId)?.owner !== "opponent")
    )
      return false;
  }
  return true;
}

function compatibilityFailure(input: ScoreReplacementCandidatesInput): CompatibilityFailure | null {
  const { request, graph, cohort, trajectories, concepts, expansion } = input;
  if (!sameVersions(request) || !validProfile(request.profile)) {
    return {
      status: "invalid-request",
      error: "invalid-profile",
      explanation: "Replacement profile or contract version is invalid.",
    };
  }
  if (!validTrainingEvidence(input.training)) {
    return {
      status: "invalid-request",
      error: "invalid-training-evidence",
      explanation: "Training mastery evidence contains duplicate concepts or non-unit values.",
    };
  }
  if (!sameVersions(expansion) || !sameIdentity(expansion, request)) {
    return {
      status: "stale",
      error: "request-expansion-mismatch",
      explanation: "Task 8.5 expansion does not match the current replacement request.",
    };
  }
  if (
    (expansion.status !== "complete" && expansion.status !== "partial") ||
    expansion.error_code !== null ||
    expansion.pivot_id === null ||
    expansion.maximum_candidates !== request.budget.maximum_candidates ||
    expansion.maximum_subtree_nodes_per_candidate !==
      request.budget.maximum_subtree_nodes_per_candidate ||
    expansion.maximum_engine_positions !== request.budget.maximum_engine_positions ||
    expansion.maximum_explorer_queries !== request.budget.maximum_explorer_queries ||
    expansion.strategic_horizon_ply !== request.budget.strategic_horizon_ply ||
    expansion.minimum_reply_popularity !== request.budget.minimum_reply_popularity ||
    expansion.include_all_forcing_replies !== request.budget.include_all_forcing_replies ||
    // These "unchanged" flags are typed `true` because every construction path sets them that
    // way, but this function revalidates an expansion crossing a checkpoint/cache boundary — see
    // the matching note in validCandidateIdentity above.
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    !expansion.source_repertoire_unchanged ||
    !expansion.source_graph_unchanged ||
    !expansion.pivot_result_unchanged ||
    !expansion.candidate_generation_unchanged ||
    !expansion.engine_generation_unchanged ||
    !expansion.providers_unchanged ||
    !expansion.cache_inputs_unchanged ||
    !expansion.evidence_unchanged
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
  ) {
    return {
      status: "stale",
      error: "expansion-not-current",
      explanation: "Only a current validated complete or partial Task 8.5 result can be scored.",
    };
  }
  if (
    graph.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    graph.repertoire_color !== request.repertoire_color
  ) {
    return {
      status: "stale",
      error: "graph-context-mismatch",
      explanation: "Scoring graph is stale or has the wrong repertoire owner.",
    };
  }
  if (
    cohort.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    cohort.cohort_id !== request.cohort_id ||
    cohort.route_ids.some((routeId) => !graph.routes.some((route) => route.route_id === routeId))
  ) {
    return {
      status: "stale",
      error: "cohort-context-mismatch",
      explanation: "Scoring cohort is stale or incompatible with the current graph.",
    };
  }
  const graphRouteIds = graph.routes.map((route) => route.route_id).sort(compareStrings);
  if (
    trajectories.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    trajectories.graph_id !== graph.graph_id ||
    JSON.stringify(
      trajectories.trajectories.map((trajectory) => trajectory.route_id).sort(compareStrings),
    ) !== JSON.stringify(graphRouteIds)
  ) {
    return {
      status: "stale",
      error: "trajectory-context-mismatch",
      explanation: "Canonical trajectory context does not cover the current graph.",
    };
  }
  if (
    concepts.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    concepts.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    concepts.graph_id !== graph.graph_id ||
    JSON.stringify(concepts.routes.map((route) => route.route_id).sort(compareStrings)) !==
      JSON.stringify(graphRouteIds)
  ) {
    return {
      status: "stale",
      error: "concept-context-mismatch",
      explanation: "Canonical concept context does not cover the current graph.",
    };
  }
  const ids = new Set<string>();
  for (const candidate of expansion.candidates) {
    if (
      ids.has(candidate.candidate_id) ||
      !validCandidateIdentity(candidate, request, graph, expansion.pivot_id)
    ) {
      return {
        status: "stale",
        error: "malformed-expansion",
        explanation: "Task 8.5 candidates contain duplicate or stale identities.",
      };
    }
    ids.add(candidate.candidate_id);
    if (
      candidate.status === "complete" &&
      !validCompleteExpansion(
        candidate,
        request,
        graph,
        expansion.pivot_id,
        expansion.strategic_horizon_ply,
      )
    ) {
      return {
        status: "stale",
        error: "malformed-expansion",
        explanation: "A complete Task 8.5 candidate failed subtree or identity validation.",
      };
    }
    if (
      candidate.status !== "complete" &&
      (candidate as { readonly subtree?: { readonly status?: string } }).subtree?.status ===
        "complete"
    ) {
      return {
        status: "stale",
        error: "malformed-expansion",
        explanation: "An incomplete Task 8.5 candidate cannot carry a complete subtree.",
      };
    }
  }
  return null;
}

function prefixRoute(
  graph: RepertoireGraph,
  cohort: StrategicCohort,
  expansion: ReplacementCompleteCandidateExpansion,
): { route: RepertoireGraphRoute; pivotIndex: number } | null {
  const pivot = expansion.seed.pivot;
  const candidates = cohort.route_ids
    .flatMap((routeId) => {
      const route = graph.routes.find((item) => item.route_id === routeId);
      if (!route) return [];
      const exact = pivot.ply - 1;
      if (
        route.position_ids[exact] === pivot.position_id &&
        route.decision_ids[exact] === pivot.decision_id
      ) {
        return [{ route, pivotIndex: exact }];
      }
      const indexes = route.position_ids.flatMap((positionId, index) =>
        positionId === pivot.position_id && route.decision_ids[index] === pivot.decision_id
          ? [index]
          : [],
      );
      return indexes.map((pivotIndex) => ({ route, pivotIndex }));
    })
    .sort(
      (left, right) =>
        left.pivotIndex - right.pivotIndex ||
        compareStrings(left.route.route_id, right.route.route_id),
    );
  return candidates[0] ?? null;
}

interface RawProjectedRoute {
  readonly positionIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly sanMoves: readonly string[];
  readonly uciMoves: readonly string[];
  readonly expectedFrequency: number | null;
  readonly sourcePaths: readonly (readonly string[])[];
}

function transpositionContinuations(
  graph: RepertoireGraph,
  cohort: StrategicCohort,
  targetPositionId: string,
): readonly { route: RepertoireGraphRoute; index: number; factor: number | null }[] {
  const weights = new Map(
    cohort.route_weights.map((item) => [item.route_id, item.normalized_weight]),
  );
  const matches = graph.routes
    .flatMap((route) =>
      route.position_ids.flatMap((positionId, index) =>
        positionId === targetPositionId
          ? [{ route, index, weight: weights.get(route.route_id) ?? null }]
          : [],
      ),
    )
    .sort(
      (left, right) =>
        compareStrings(left.route.route_id, right.route.route_id) || left.index - right.index,
    );
  const knownTotal = matches.reduce((sum, item) => sum + (item.weight ?? 0), 0);
  return matches.map((item) => ({
    route: item.route,
    index: item.index,
    factor: item.weight === null || knownTotal <= EPSILON ? null : item.weight / knownTotal,
  }));
}

function projectedRoutes(
  graph: RepertoireGraph,
  cohort: StrategicCohort,
  expansion: ReplacementCompleteCandidateExpansion,
): readonly RawProjectedRoute[] | null {
  const prefix = prefixRoute(graph, cohort, expansion);
  if (!prefix) return null;
  const subtree = expansion.subtree;
  const nodeById = new Map(subtree.nodes.map((node) => [node.node_id, node]));
  const edgeById = new Map(subtree.edges.map((edge) => [edge.edge_id, edge]));
  const basePositions = prefix.route.position_ids.slice(0, prefix.pivotIndex + 1);
  const baseDecisions = prefix.route.decision_ids.slice(0, prefix.pivotIndex);
  const baseSan = prefix.route.san_moves.slice(0, prefix.pivotIndex);
  const baseUci = prefix.route.uci_moves.slice(0, prefix.pivotIndex);
  const raw: RawProjectedRoute[] = [];
  for (const subtreeRoute of [...subtree.routes].sort((left, right) =>
    compareStrings(left.route_id, right.route_id),
  )) {
    const routeNodes = subtreeRoute.node_ids.flatMap((id) => {
      const node = nodeById.get(id);
      return node ? [node] : [];
    });
    const routeEdges = subtreeRoute.edge_ids.flatMap((id) => {
      const edge = edgeById.get(id);
      return edge ? [edge] : [];
    });
    if (
      routeNodes.length !== subtreeRoute.node_ids.length ||
      routeEdges.length !== subtreeRoute.edge_ids.length
    )
      continue;
    const positionIds = [...basePositions, ...routeNodes.slice(1).map((node) => node.position_id)];
    const decisionIds = [...baseDecisions, ...routeEdges.map((edge) => edge.decision_id)];
    const sanMoves = [...baseSan, ...routeEdges.map((edge) => edge.san)];
    const uciMoves = [...baseUci, ...routeEdges.map((edge) => edge.uci)];
    const terminal = routeNodes.at(-1);
    if (!terminal) continue;
    const continuations =
      subtreeRoute.termination === "existing-preparation" &&
      terminal.transposition_target_position_id
        ? transpositionContinuations(graph, cohort, terminal.transposition_target_position_id)
        : [];
    if (continuations.length === 0) {
      raw.push({
        positionIds,
        decisionIds,
        sanMoves,
        uciMoves,
        expectedFrequency: subtreeRoute.expected_opponent_frequency,
        sourcePaths: terminal.source_san_paths,
      });
      continue;
    }
    for (const continuation of continuations) {
      const maximumAdditional = Math.max(
        0,
        subtree.strategic_horizon_ply - (positionIds.length - 1),
      );
      const suffixDecisionIds = continuation.route.decision_ids.slice(
        continuation.index,
        continuation.index + maximumAdditional,
      );
      const suffixPositionIds = continuation.route.position_ids.slice(
        continuation.index + 1,
        continuation.index + 1 + maximumAdditional,
      );
      const suffixSan = continuation.route.san_moves.slice(
        continuation.index,
        continuation.index + maximumAdditional,
      );
      const suffixUci = continuation.route.uci_moves.slice(
        continuation.index,
        continuation.index + maximumAdditional,
      );
      raw.push({
        positionIds: [...positionIds, ...suffixPositionIds],
        decisionIds: [...decisionIds, ...suffixDecisionIds],
        sanMoves: [...sanMoves, ...suffixSan],
        uciMoves: [...uciMoves, ...suffixUci],
        expectedFrequency:
          subtreeRoute.expected_opponent_frequency === null || continuation.factor === null
            ? null
            : subtreeRoute.expected_opponent_frequency * continuation.factor,
        sourcePaths: [...terminal.source_san_paths, ...continuation.route.source_san_paths],
      });
    }
  }
  const deduplicated = new Map<string, RawProjectedRoute[]>();
  for (const route of raw) {
    const key = [...route.positionIds, "decisions", ...route.decisionIds].join(SEPARATOR);
    const values = deduplicated.get(key) ?? [];
    values.push(route);
    deduplicated.set(key, values);
  }
  return [...deduplicated.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .flatMap(([, values]) => {
      const first = values[0];
      if (!first) return [];
      const known = values
        .map((value) => value.expectedFrequency)
        .filter((value): value is number => value !== null);
      return [
        {
          ...first,
          expectedFrequency:
            known.length === values.length
              ? round(known.reduce((sum, value) => sum + value, 0) / known.length)
              : null,
          sourcePaths: values.flatMap((value) => value.sourcePaths),
        },
      ];
    });
}

function projectCandidate(
  source: RepertoireGraph,
  cohort: StrategicCohort,
  expansion: ReplacementCompleteCandidateExpansion,
): CandidateProjection | null {
  const rawRoutes = projectedRoutes(source, cohort, expansion);
  if (!rawRoutes || rawRoutes.length === 0) return null;
  try {
    return projectCandidateFromRoutes(source, expansion, rawRoutes);
  } catch (err) {
    if (err instanceof ProjectionInvariantError) return null;
    throw err;
  }
}

function projectCandidateFromRoutes(
  source: RepertoireGraph,
  expansion: ReplacementCompleteCandidateExpansion,
  rawRoutes: readonly RawProjectedRoute[],
): CandidateProjection {
  const graphId = `replacement-score-graph:${stableHash(
    [
      source.graph_id,
      expansion.candidate_id,
      expansion.subtree.subtree_id,
      ...rawRoutes.flatMap((route) => [...route.positionIds, ...route.decisionIds]),
    ].join(SEPARATOR),
  )}`;
  const routeIds = rawRoutes.map(
    (route) =>
      `replacement-score-route:${stableHash(
        [expansion.candidate_id, ...route.positionIds, ...route.decisionIds].join(SEPARATOR),
      )}`,
  );
  const subtreeNodes = new Map(expansion.subtree.nodes.map((node) => [node.position_id, node]));
  const sourcePositions = new Map(
    source.positions.map((position) => [position.position_id, position]),
  );
  const sourceDecisions = new Map(
    source.decisions.map((decision) => [decision.decision_id, decision]),
  );
  const positionRouteIds = new Map<string, Set<string>>();
  const incomingDecisions = new Map<string, Set<string>>();
  const outgoingDecisions = new Map<string, Set<string>>();
  const incomingMoveOrders = new Map<string, Set<string>>();
  const decisionRoutes = new Map<string, Set<string>>();
  const decisionPlies = new Map<string, Set<number>>();
  const moveOrders: RepertoireGraphMoveOrder[] = [];
  const routes: RepertoireGraphRoute[] = [];
  rawRoutes.forEach((raw, routeIndex) => {
    const routeId = routeIds[routeIndex];
    if (routeId === undefined) return;
    const moveOrderIds: string[] = [];
    raw.positionIds.forEach((positionId) => {
      const ids = positionRouteIds.get(positionId) ?? new Set<string>();
      ids.add(routeId);
      positionRouteIds.set(positionId, ids);
    });
    raw.decisionIds.forEach((decisionId, index) => {
      const from = raw.positionIds[index];
      const to = raw.positionIds[index + 1];
      if (from === undefined || to === undefined) return;
      const orderId = `replacement-score-move-order:${stableHash(
        [routeId, ...raw.decisionIds.slice(0, index + 1)].join(SEPARATOR),
      )}`;
      moveOrderIds.push(orderId);
      moveOrders.push({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        move_order_id: orderId,
        position_id: to,
        ply: index + 1,
        san_moves: raw.sanMoves.slice(0, index + 1),
        uci_moves: raw.uciMoves.slice(0, index + 1),
        decision_ids: raw.decisionIds.slice(0, index + 1),
        source_san_paths: raw.sourcePaths.map((path) => [...path]),
        route_ids: [routeId],
      });
      const incoming = incomingDecisions.get(to) ?? new Set<string>();
      incoming.add(decisionId);
      incomingDecisions.set(to, incoming);
      const outgoing = outgoingDecisions.get(from) ?? new Set<string>();
      outgoing.add(decisionId);
      outgoingDecisions.set(from, outgoing);
      const orders = incomingMoveOrders.get(to) ?? new Set<string>();
      orders.add(orderId);
      incomingMoveOrders.set(to, orders);
      const routeSet = decisionRoutes.get(decisionId) ?? new Set<string>();
      routeSet.add(routeId);
      decisionRoutes.set(decisionId, routeSet);
      const plies = decisionPlies.get(decisionId) ?? new Set<number>();
      plies.add(index + 1);
      decisionPlies.set(decisionId, plies);
    });
    routes.push({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      route_id: routeId,
      repertoire_color: source.repertoire_color,
      san_moves: [...raw.sanMoves],
      uci_moves: [...raw.uciMoves],
      position_ids: [...raw.positionIds],
      decision_ids: [...raw.decisionIds],
      move_order_ids: moveOrderIds,
      terminal_position_id: assertDefined(raw.positionIds.at(-1)),
      source_san_paths: raw.sourcePaths.map((path) => [...path]),
      source_route_count: 1,
    });
  });
  const positionIds = sortedUnique(rawRoutes.flatMap((route) => route.positionIds));
  const positions: RepertoireGraphPosition[] = positionIds.map((positionId) => {
    const sourcePosition = sourcePositions.get(positionId);
    const subtreeNode = subtreeNodes.get(positionId);
    const fen = sourcePosition?.fen ?? assertDefined(subtreeNode).fen;
    const chess = assertDefined(currentChess(fen));
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      position_id: positionId,
      position_key: positionKey(makeFen(chess.toSetup())),
      fen,
      turn: chess.turn,
      source_san_paths: (
        sourcePosition?.source_san_paths ??
        subtreeNode?.source_san_paths ??
        []
      ).map((path) => [...path]),
      incoming_move_order_ids: [...(incomingMoveOrders.get(positionId) ?? [])].sort(compareStrings),
      incoming_decision_ids: [...(incomingDecisions.get(positionId) ?? [])].sort(compareStrings),
      outgoing_decision_ids: [...(outgoingDecisions.get(positionId) ?? [])].sort(compareStrings),
      route_ids: [...(positionRouteIds.get(positionId) ?? [])].sort(compareStrings),
    };
  });
  const subtreeEdges = new Map(expansion.subtree.edges.map((edge) => [edge.decision_id, edge]));
  const decisionIds = sortedUnique(rawRoutes.flatMap((route) => route.decisionIds));
  const decisions: RepertoireGraphDecision[] = decisionIds.map((decisionId) => {
    const sourceDecision = sourceDecisions.get(decisionId);
    const subtreeEdge = subtreeEdges.get(decisionId);
    const firstRoute = assertDefined(
      rawRoutes.find((route) => route.decisionIds.includes(decisionId)),
    );
    const index = firstRoute.decisionIds.indexOf(decisionId);
    return {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      decision_id: decisionId,
      from_position_id: assertDefined(firstRoute.positionIds[index]),
      to_position_id: assertDefined(firstRoute.positionIds[index + 1]),
      san: sourceDecision?.san ?? assertDefined(subtreeEdge).san,
      uci: sourceDecision?.uci ?? assertDefined(subtreeEdge).uci,
      mover_color: sourceDecision?.mover_color ?? assertDefined(subtreeEdge).mover_color,
      owner: sourceDecision?.owner ?? assertDefined(subtreeEdge).owner,
      plies: [...(decisionPlies.get(decisionId) ?? [])].sort((left, right) => left - right),
      source_san_paths: (
        sourceDecision?.source_san_paths ??
        subtreeEdge?.source_san_paths ??
        []
      ).map((path) => [...path]),
      route_ids: [...(decisionRoutes.get(decisionId) ?? [])].sort(compareStrings),
    };
  });
  const transpositionLinks: RepertoireGraphTranspositionLink[] = positions
    .filter((position) => position.incoming_move_order_ids.length > 1)
    .map((position) => ({
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      transposition_id: `replacement-score-transposition:${stableHash(position.position_id)}`,
      position_id: position.position_id,
      incoming_move_order_ids: position.incoming_move_order_ids,
      incoming_decision_ids: position.incoming_decision_ids,
      route_ids: position.route_ids,
      source_san_paths: position.source_san_paths,
    }));
  const graph: RepertoireGraph = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    graph_id: graphId,
    repertoire_color: source.repertoire_color,
    root_position_id: assertDefined(assertDefined(routes[0]).position_ids[0]),
    positions,
    decisions,
    move_orders: moveOrders.sort(
      (left, right) =>
        left.ply - right.ply || compareStrings(left.move_order_id, right.move_order_id),
    ),
    routes: routes.sort((left, right) => compareStrings(left.route_id, right.route_id)),
    transposition_links: transpositionLinks.sort((left, right) =>
      compareStrings(left.transposition_id, right.transposition_id),
    ),
    source_route_count: routes.length,
  };
  const expected = new Map(
    routeIds.map((routeId, index) => [routeId, assertDefined(rawRoutes[index]).expectedFrequency]),
  );
  const knownCount = rawRoutes.filter((route) => route.expectedFrequency !== null).length;
  return {
    graph,
    routeEvidence: graph.routes.map((route) => {
      const expectedFrequency = expected.get(route.route_id);
      if (expectedFrequency === undefined) throw new ProjectionInvariantError();
      return { route_id: route.route_id, expected_frequency: expectedFrequency };
    }),
    frequencyState:
      knownCount === 0 ? "unavailable" : knownCount === rawRoutes.length ? "available" : "partial",
    provenance: mergeProvenance([CORE_PROVENANCE], candidateProvenance(expansion)),
  };
}

function sourceForProfile(profile: StrategicFitProfile): StrategicFitSourceProvenance {
  return {
    source_id: "strategic-fit:replacement-score:profile",
    kind: "user-profile",
    state: "available",
    version: profile.schema_version,
    snapshot: JSON.stringify({
      mode: profile.mode,
      source: profile.source,
      provisional: profile.provisional,
      preferences: profile.preferences,
    }),
    reason:
      "Replacement scoring uses request-bound family weights and canonical concept intent. Source coefficients are already reflected in the supplied cohort/Task 8.5 frequencies; free-form tactical labels remain visible but are not mapped to invented classifier facts.",
  };
}

function weightedValue(
  values: readonly { readonly routeId: string; readonly value: number }[],
  weighting: StrategicRouteWeightingReport,
): number | null {
  const byRoute = new Map(values.map((item) => [item.routeId, item.value]));
  let total = 0;
  let covered = 0;
  for (const route of weighting.routes) {
    const value = byRoute.get(route.route_id);
    if (value === undefined || route.normalized_weight <= 0) continue;
    total += route.normalized_weight * value;
    covered += route.normalized_weight;
  }
  return covered <= EPSILON ? null : round(total / covered);
}

function weightedCandidateValue(
  values: readonly { readonly routeId: string; readonly value: number }[],
  projection: CandidateProjection,
  weighting: StrategicRouteWeightingReport | null,
): number | null {
  if (weighting) return weightedValue(values, weighting);
  const byRoute = new Map(values.map((item) => [item.routeId, item.value]));
  let total = 0;
  let covered = 0;
  for (const route of projection.routeEvidence) {
    const value = byRoute.get(route.route_id);
    if (value === undefined || route.expected_frequency === null) continue;
    total += route.expected_frequency * value;
    covered += route.expected_frequency;
  }
  return covered <= EPSILON ? null : round(total / covered);
}

function modeContext(
  cohort: StrategicCohort,
  trajectories: StrategicTrajectoryReport,
  concepts: StrategicConceptDictionary,
): readonly {
  readonly trajectory: StrategicTrajectory;
  readonly concepts: StrategicRouteConcepts;
}[] {
  const trajectoryByRoute = new Map(
    trajectories.trajectories.map((trajectory) => [trajectory.route_id, trajectory]),
  );
  const conceptRoutesById = new Map(concepts.routes.map((route) => [route.route_id, route]));
  return cohort.modes
    .flatMap((mode) => {
      const trajectory = trajectoryByRoute.get(mode.representative_route_id);
      const routeConcepts = conceptRoutesById.get(mode.representative_route_id);
      return trajectory && routeConcepts ? [{ trajectory, concepts: routeConcepts }] : [];
    })
    .sort((left, right) => compareStrings(left.trajectory.route_id, right.trajectory.route_id));
}

function fitForRoutes(
  trajectories: readonly StrategicTrajectory[],
  concepts: readonly StrategicRouteConcepts[],
  modes: ReturnType<typeof modeContext>,
  profile: StrategicFitProfile,
): {
  readonly values: readonly { routeId: string; value: number }[];
  readonly incomplete: boolean;
  readonly provenance: readonly StrategicFitSourceProvenance[];
} {
  const conceptByRoute = new Map(concepts.map((route) => [route.route_id, route]));
  const values: { routeId: string; value: number }[] = [];
  let incomplete = false;
  const provenance: (readonly StrategicFitSourceProvenance[])[] = [[sourceForProfile(profile)]];
  for (const trajectory of trajectories) {
    const routeConcepts = conceptByRoute.get(trajectory.route_id);
    if (!routeConcepts) {
      incomplete = true;
      continue;
    }
    const distances = modes.map((mode) =>
      computeStrategicTrajectoryDistance(
        trajectory,
        mode.trajectory,
        routeConcepts,
        mode.concepts,
        { feature_family_weights: profile.preferences.feature_family_weights },
      ),
    );
    provenance.push(...distances.map((distance) => distance.provenance));
    const available = distances.flatMap((distance) =>
      distance.distance === null ? [] : [distance.distance],
    );
    if (available.length === 0) {
      incomplete = true;
      continue;
    }
    const modeFit = 1 - Math.min(...available);
    const candidateConceptIds = new Set(
      routeConcepts.concepts.map((concept) => concept.concept_id),
    );
    const preferred = profile.preferences.preferred_concept_ids;
    const avoided = profile.preferences.avoided_concept_ids;
    const avoidedMatch = avoided.some((conceptId) => candidateConceptIds.has(conceptId));
    const intentFit = avoidedMatch
      ? 0
      : preferred.length > 0
        ? preferred.filter((conceptId) => candidateConceptIds.has(conceptId)).length /
          preferred.length
        : avoided.length > 0
          ? 1
          : null;
    // Confirmed semantic concept intent precedes an inferred cohort mode; it is never blended with
    // an arbitrary coefficient. Without explicit concept intent, canonical mode distance controls.
    values.push({ routeId: trajectory.route_id, value: round(intentFit ?? modeFit) });
    if (available.length !== distances.length) incomplete = true;
  }
  return { values, incomplete, provenance: mergeProvenance(...provenance) };
}

function baselineFit(
  input: ScoreReplacementCandidatesInput,
  modes: ReturnType<typeof modeContext>,
): number | null {
  const routeIds = new Set(input.cohort.route_ids);
  const trajectories = input.trajectories.trajectories.filter((trajectory) =>
    routeIds.has(trajectory.route_id),
  );
  const concepts = input.concepts.routes.filter((route) => routeIds.has(route.route_id));
  const fit = fitForRoutes(trajectories, concepts, modes, input.request.profile);
  const weights = new Map(
    input.cohort.route_weights.map((route) => [route.route_id, route.normalized_weight]),
  );
  let total = 0;
  let covered = 0;
  for (const item of fit.values) {
    const weight = weights.get(item.routeId);
    if (weight === undefined) continue;
    total += item.value * weight;
    covered += weight;
  }
  return covered <= EPSILON ? null : round(total / covered);
}

function axis(
  state: ReplacementScoreState,
  raw: number | null,
  normalized: number | null,
  unit: string,
  higherIsBetter: boolean,
  reason: string | null,
  provenance: readonly StrategicFitSourceProvenance[],
): AxisValue {
  return {
    state,
    raw,
    normalized,
    unit,
    higherIsBetter,
    reason,
    provenance: mergeProvenance([CORE_PROVENANCE], provenance),
  };
}

function conceptsByRoute(
  dictionary: StrategicConceptDictionary,
): ReadonlyMap<string, StrategicRouteConcepts> {
  return new Map(dictionary.routes.map((route) => [route.route_id, route]));
}

function coverageValue(expansion: ReplacementCompleteCandidateExpansion): AxisValue {
  const edges = new Map(expansion.subtree.edges.map((edge) => [edge.edge_id, edge]));
  const groups = new Map<string, (number | null)[]>();
  for (const route of expansion.subtree.routes) {
    const identity = route.edge_ids
      .flatMap((edgeId) => {
        const edge = edges.get(edgeId);
        return edge ? [edge.decision_id] : [];
      })
      .join(SEPARATOR);
    const values = groups.get(identity) ?? [];
    values.push(route.expected_opponent_frequency);
    groups.set(identity, values);
  }
  const knownGroups = [...groups.values()].flatMap((values) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length === values.length
      ? [known.reduce((sum, value) => sum + value, 0) / known.length]
      : [];
  });
  if (knownGroups.length === 0) {
    return axis(
      "unavailable",
      null,
      null,
      "fraction",
      true,
      "Expected coverage is unavailable because no complete route has population frequency evidence.",
      candidateProvenance(expansion),
    );
  }
  const coverage = clamp(knownGroups.reduce((sum, value) => sum + value, 0));
  const complete = knownGroups.length === groups.size;
  return axis(
    complete ? "available" : "partial",
    round(coverage),
    round(coverage),
    "fraction",
    true,
    complete
      ? "Exact semantic decision-route aliases collapse while distinct convergent routes retain their expected-game probability mass."
      : "Known canonical terminal-position coverage is retained; missing frequencies are not counted as zero.",
    candidateProvenance(expansion),
  );
}

function objectiveValue(quality: ReplacementObjectiveQuality): AxisValue {
  let normalized: number | null = null;
  let raw: number | null = quality.repertoire_pov_loss_from_best_cp;
  let unit = "centipawns";
  if (raw !== null) normalized = 1 - clamp(raw / 300);
  else if (quality.repertoire_pov_verdict === "forced-mate-for-repertoire") {
    raw = 1;
    normalized = 1;
    unit = "mate-verdict";
  } else if (quality.repertoire_pov_verdict === "forced-mate-against-repertoire") {
    raw = -1;
    normalized = 0;
    unit = "mate-verdict";
  }
  const state = normalized === null ? "unavailable" : quality.state;
  return axis(
    state,
    raw,
    normalized === null ? null : round(normalized),
    unit,
    false,
    normalized === null
      ? "Objective quality lacks a comparable repertoire-POV loss or mate verdict."
      : "Objective quality remains an independent repertoire-POV Pareto axis; White-POV transport is unchanged.",
    quality.provenance,
  );
}

function aggregateState(values: readonly AxisValue[]): ReplacementScoreState {
  if (values.every((value) => value.state === "available")) return "available";
  if (values.some((value) => value.state !== "unavailable")) return "partial";
  return "unavailable";
}

function contribution(
  axisId: ReplacementStrategicScoreAxis,
  value: AxisValue,
): ReplacementStrategicScoreContribution {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    axis: axisId,
    state: value.state,
    normalized_score: value.normalized,
    raw_value: value.raw,
    unit: value.unit,
    higher_is_better: value.higherIsBetter,
    reason: value.reason,
    provenance: value.provenance,
  };
}

function emptyStrategicScore(
  input: ScoreReplacementCandidatesInput,
  expansion: ReplacementCandidateExpansion,
  reason: string,
): ReplacementStrategicScore {
  const provenance = candidateProvenance(expansion);
  const values = new Map<ReplacementStrategicScoreAxis, AxisValue>(
    REPLACEMENT_STRATEGIC_SCORE_AXES.map((axisId) => [
      axisId,
      axis(
        "unavailable",
        null,
        null,
        axisId === "new-concepts" || axisId === "theory-size" ? "count" : "score",
        ![
          "memorization-burden",
          "new-concepts",
          "theory-size",
          "homogenization-cost",
          "training-cost",
        ].includes(axisId),
        reason,
        provenance,
      ),
    ]),
  );
  return {
    ...versioned(),
    state: "unavailable",
    cohort_id: input.request.cohort_id,
    trajectory_ids: [],
    strategic_fit_score: null,
    strategic_fit_delta: null,
    strategic_familiarity: null,
    memorization_burden: null,
    expected_opponent_coverage: null,
    new_concept_ids: [],
    theory_nodes_before: null,
    theory_nodes_after: null,
    theory_nodes_added: null,
    theory_nodes_removed: null,
    popularity: null,
    homogenization_cost: null,
    training_cost: null,
    transposition_position_ids: [],
    contributions: REPLACEMENT_STRATEGIC_SCORE_AXES.map((axisId) =>
      contribution(axisId, assertDefined(values.get(axisId))),
    ),
    provenance,
  };
}

function unscoredCandidate(
  input: ScoreReplacementCandidatesInput,
  expansion: ReplacementCandidateExpansion,
  reason: string,
): CandidateCalculation {
  const strategicScore = emptyStrategicScore(input, expansion, reason);
  const objective = canonicalProvenanceFields(cloneJson(expansion.seed.objective_quality));
  const scored: ReplacementScoredCandidate = {
    ...versioned(),
    candidate_id: expansion.candidate_id,
    request_id: input.request.request_id,
    report_id: input.request.report_id,
    finding_id: input.request.finding_id,
    semantic_finding_id: input.request.semantic_finding_id,
    cohort_id: input.request.cohort_id,
    repertoire_revision: input.request.repertoire_revision,
    repertoire_color: input.request.repertoire_color,
    state: "unavailable",
    reason,
    expansion: canonicalCandidateExpansion(expansion),
    objective_quality: objective,
    strategic_score: strategicScore,
    pareto: {
      ...versioned(),
      status: "unscored",
      axis_ids: [],
      dominated_by_candidate_ids: [],
      reason,
    },
    trajectory_report: null,
    concept_dictionary: null,
    route_weighting: null,
  };
  const paretoValues = new Map<ReplacementParetoAxis, AxisValue>();
  paretoValues.set("objective-quality", objectiveValue(objective));
  for (const item of strategicScore.contributions) {
    paretoValues.set(
      item.axis,
      axis(
        item.state,
        item.raw_value,
        item.normalized_score,
        item.unit,
        item.higher_is_better,
        item.reason,
        item.provenance,
      ),
    );
  }
  return { scored, paretoValues };
}

function scoreCompleteCandidate(
  input: ScoreReplacementCandidatesInput,
  expansion: ReplacementCompleteCandidateExpansion,
  modes: ReturnType<typeof modeContext>,
  baseline: number | null,
): CandidateCalculation {
  const projection = projectCandidate(input.graph, input.cohort, expansion);
  if (!projection)
    return unscoredCandidate(
      input,
      expansion,
      "Complete subtree cannot be joined to a current cohort route and remains explicitly unscored.",
    );
  const trajectoryReport = buildStrategicTrajectories(projection.graph, {
    configuredPlies: input.trajectories.configured_plies,
  });
  const conceptDictionary = buildStrategicConceptDictionary(trajectoryReport);
  let routeWeighting: StrategicRouteWeightingReport | null = null;
  if (projection.frequencyState === "available") {
    const baseWeights = calculateStrategicRouteWeights(projection.graph);
    const expectedByRoute = new Map(
      projection.routeEvidence.map((route) => [route.route_id, route.expected_frequency]),
    );
    routeWeighting = calculateStrategicRouteWeights(projection.graph, {
      mode: "manual",
      route_weights: projection.graph.routes.map((route) => {
        const probability = assertDefined(
          baseWeights.routes.find((item) => item.route_id === route.route_id),
        ).opponent_probability;
        return {
          route_id: route.route_id,
          weight:
            assertDefined(expectedByRoute.get(route.route_id)) / Math.max(probability, EPSILON),
          provenance: projection.provenance,
        };
      }),
      provenance: projection.provenance,
    });
  }
  const provenance = mergeProvenance(
    [CORE_PROVENANCE, sourceForProfile(input.request.profile)],
    candidateProvenance(expansion),
    trajectoryReport.provenance,
    conceptDictionary.provenance,
    routeWeighting?.provenance ?? [],
    input.cohort.provenance,
    input.metrics.homogenization_cost.provenance,
    input.training?.provenance ?? [],
    input.popularity?.provenance ?? [],
  );
  const fit = fitForRoutes(
    trajectoryReport.trajectories,
    conceptDictionary.routes,
    modes,
    input.request.profile,
  );
  const fitScore = weightedCandidateValue(fit.values, projection, routeWeighting);
  const fitState: ReplacementScoreState =
    fitScore === null
      ? "unavailable"
      : fit.incomplete || projection.frequencyState !== "available"
        ? "partial"
        : "available";
  const fitAxis = axis(
    fitState,
    fitScore,
    fitScore,
    "score",
    true,
    fitScore === null
      ? "No candidate trajectory shares supported canonical evidence with a cohort mode."
      : fitState === "available"
        ? "Expected-frequency weighted distance spans every candidate continuation and supported cohort mode; configured preferred/avoided concept IDs explicitly precede inferred mode fit."
        : "Fit uses supported candidate continuations only; missing checkpoints or frequencies are not zero-filled.",
    mergeProvenance(provenance, fit.provenance),
  );

  const candidateConcepts = conceptsByRoute(conceptDictionary);
  const familiarityValues: { routeId: string; value: number }[] = [];
  let familiarityMissing = false;
  for (const trajectory of trajectoryReport.trajectories) {
    const routeConcepts = candidateConcepts.get(trajectory.route_id);
    if (!routeConcepts) {
      familiarityMissing = true;
      continue;
    }
    const overlaps = modes.map(
      (mode) => computeStrategicConceptOverlap(routeConcepts, mode.concepts).overlap,
    );
    if (overlaps.length === 0) familiarityMissing = true;
    else familiarityValues.push({ routeId: trajectory.route_id, value: Math.max(...overlaps) });
    if (
      trajectory.state === "incomplete" ||
      trajectory.state === "unsupported" ||
      modes.some(
        (mode) => mode.trajectory.state === "incomplete" || mode.trajectory.state === "unsupported",
      )
    ) {
      familiarityMissing = true;
    }
  }
  const familiarity = weightedCandidateValue(familiarityValues, projection, routeWeighting);
  const familiarityState: ReplacementScoreState =
    familiarity === null
      ? "unavailable"
      : familiarityMissing || projection.frequencyState !== "available"
        ? "partial"
        : "available";
  const familiarityAxis = axis(
    familiarityState,
    familiarity,
    familiarity,
    "fraction",
    true,
    familiarity === null
      ? "Strategic familiarity requires supported concepts on candidate and cohort-mode trajectories."
      : familiarityState === "available"
        ? "Canonical concept overlap is expected-frequency weighted across complete continuations."
        : "Known concept overlap is retained; unsupported concepts or route frequencies are not treated as unfamiliarity.",
    provenance,
  );

  const modeConceptIds = new Set(
    modes.flatMap((mode) => mode.concepts.concepts.map((concept) => concept.concept_id)),
  );
  const routeNewConcepts = new Map<string, readonly string[]>();
  for (const route of conceptDictionary.routes) {
    routeNewConcepts.set(
      route.route_id,
      sortedUnique(
        route.concepts
          .map((concept) => concept.concept_id)
          .filter((conceptId) => !modeConceptIds.has(conceptId)),
      ),
    );
  }
  const newConceptIds = sortedUnique([...routeNewConcepts.values()].flat());
  const conceptState: ReplacementScoreState =
    trajectoryReport.trajectories.length === 0
      ? "unavailable"
      : trajectoryReport.trajectories.some(
            (trajectory) => trajectory.state === "incomplete" || trajectory.state === "unsupported",
          )
        ? "partial"
        : "available";
  const newConceptAxis = axis(
    conceptState,
    conceptState === "unavailable" ? null : newConceptIds.length,
    conceptState === "unavailable" ? null : round(1 / (1 + newConceptIds.length)),
    "count",
    false,
    conceptState === "unavailable"
      ? "No candidate trajectory exists from which to classify concepts."
      : conceptState === "available"
        ? "New concepts are canonical IDs absent from every supported cohort mode; an empty classified set is a real zero."
        : "Known new concepts are retained, but incomplete candidate trajectories keep absence from masquerading as complete evidence.",
    provenance,
  );

  const sourcePositions = new Set(input.graph.positions.map((position) => position.position_id));
  const candidatePositions = sortedUnique(
    expansion.subtree.nodes.map(
      (node) => node.transposition_target_position_id ?? node.position_id,
    ),
  );
  const addedPositions = candidatePositions.filter(
    (positionId) => !sourcePositions.has(positionId),
  );
  const theoryAxis = axis(
    "available",
    addedPositions.length,
    round(1 / (1 + addedPositions.length)),
    "positions",
    false,
    "Theory size counts unique semantic positions added by the candidate; navigation nodes and transpositions are deduplicated.",
    provenance,
  );

  const sensitivity = 1 - input.request.profile.preferences.additional_memorization_tolerance;
  const expectedNewConceptCount = weightedCandidateValue(
    [...routeNewConcepts.entries()].map(([routeId, concepts]) => ({
      routeId,
      value: concepts.length,
    })),
    projection,
    routeWeighting,
  );
  const memorizationRaw =
    expectedNewConceptCount === null || conceptState === "unavailable"
      ? null
      : round(expectedNewConceptCount + addedPositions.length * sensitivity);
  const memorizationState: ReplacementScoreState =
    memorizationRaw === null
      ? "unavailable"
      : conceptState === "partial" || projection.frequencyState !== "available"
        ? "partial"
        : "available";
  const memorizationAxis = axis(
    memorizationState,
    memorizationRaw,
    memorizationRaw === null ? null : round(1 / (1 + memorizationRaw)),
    "burden-points",
    false,
    memorizationRaw === null
      ? "Memorization burden requires supported route concepts and expected-frequency evidence."
      : `Expected new concepts plus unique theory positions use ${round(sensitivity)} profile memorization sensitivity.`,
    provenance,
  );

  const coverageAxis = coverageValue(expansion);
  const popularityRaw = expansion.seed.maximum_database_popularity;
  const popularityAxis = axis(
    popularityRaw === null ? "unavailable" : "available",
    popularityRaw,
    popularityRaw,
    "fraction",
    true,
    popularityRaw === null
      ? "Candidate-root popularity is unavailable; it is not inferred from rank or source presence."
      : "Popularity is retained from validated Task 8.3 population evidence for the semantic candidate outcome.",
    mergeProvenance(provenance, ...expansion.seed.provenance.map((source) => source.provenance)),
  );

  const objectiveAxis = objectiveValue(expansion.seed.objective_quality);
  const homogenizationAvailable =
    objectiveAxis.normalized !== null &&
    objectiveAxis.state === "available" &&
    coverageAxis.normalized !== null &&
    coverageAxis.state === "available" &&
    popularityAxis.normalized !== null &&
    popularityAxis.state === "available";
  const homogenizationRaw = homogenizationAvailable
    ? round(
        (1 -
          objectiveAxis.normalized +
          (1 - coverageAxis.normalized) +
          (1 - popularityAxis.normalized)) /
          3,
      )
    : null;
  const homogenizationAxis = axis(
    homogenizationRaw === null ? "unavailable" : "available",
    homogenizationRaw,
    homogenizationRaw === null ? null : round(1 - homogenizationRaw),
    "cost",
    false,
    homogenizationRaw === null
      ? "Homogenization cost requires complete objective-loss, expected-coverage, and popularity evidence; missing components are not zero-filled."
      : "Inspectably averages normalized objective loss, uncovered expected frequency, and popularity sacrifice without selecting a best candidate.",
    mergeProvenance(
      provenance,
      objectiveAxis.provenance,
      coverageAxis.provenance,
      popularityAxis.provenance,
    ),
  );

  const mastery = new Map(
    (input.training?.concept_mastery ?? []).map((item) => [item.concept_id, item]),
  );
  const trainingValues: { routeId: string; value: number }[] = [];
  let trainingMissing = false;
  for (const [routeId, concepts] of routeNewConcepts) {
    if (concepts.length === 0) {
      trainingValues.push({ routeId, value: 0 });
      continue;
    }
    const known = concepts.flatMap((conceptId) => {
      const value = mastery.get(conceptId);
      return value ? [value.mastery] : [];
    });
    if (known.length === 0) trainingMissing = true;
    else {
      if (known.length !== concepts.length) trainingMissing = true;
      trainingValues.push({
        routeId,
        value: (known.reduce((sum, value) => sum + (1 - value), 0) / known.length) * sensitivity,
      });
    }
  }
  const trainingCost = weightedCandidateValue(trainingValues, projection, routeWeighting);
  const trainingState: ReplacementScoreState =
    trainingCost === null
      ? "unavailable"
      : trainingMissing || projection.frequencyState !== "available"
        ? "partial"
        : "available";
  const trainingAxis = axis(
    trainingState,
    trainingCost,
    trainingCost === null ? null : round(1 - clamp(trainingCost)),
    "cost",
    false,
    trainingCost === null
      ? "Training cost requires calibrated mastery for at least one supported new concept; untrained is not failed."
      : trainingState === "available"
        ? `Expected-frequency weighted unmastered concept share uses ${round(sensitivity)} profile memorization sensitivity.`
        : "Known training burden is retained; missing mastery or route frequency is not treated as zero mastery.",
    mergeProvenance(
      provenance,
      input.training?.provenance ?? [],
      ...(input.training?.concept_mastery ?? []).map((item) => item.provenance ?? []),
    ),
  );

  const values = new Map<ReplacementStrategicScoreAxis, AxisValue>([
    ["strategic-fit", fitAxis],
    ["strategic-familiarity", familiarityAxis],
    ["memorization-burden", memorizationAxis],
    ["expected-coverage", coverageAxis],
    ["new-concepts", newConceptAxis],
    ["theory-size", theoryAxis],
    ["popularity", popularityAxis],
    ["homogenization-cost", homogenizationAxis],
    ["training-cost", trainingAxis],
  ]);
  const contributions = REPLACEMENT_STRATEGIC_SCORE_AXES.map((axisId) =>
    contribution(axisId, assertDefined(values.get(axisId))),
  );
  const scoreState = aggregateState([...values.values()]);
  const strategicScore: ReplacementStrategicScore = {
    ...versioned(),
    state: scoreState,
    cohort_id: input.request.cohort_id,
    trajectory_ids: trajectoryReport.trajectories
      .map((trajectory) => trajectory.trajectory_id)
      .sort(compareStrings),
    strategic_fit_score: fitScore,
    strategic_fit_delta: fitScore === null || baseline === null ? null : round(fitScore - baseline),
    strategic_familiarity: familiarity,
    memorization_burden: memorizationRaw,
    expected_opponent_coverage: coverageAxis.raw,
    new_concept_ids: newConceptIds,
    theory_nodes_before: input.graph.positions.length,
    theory_nodes_after: input.graph.positions.length + addedPositions.length,
    theory_nodes_added: addedPositions.length,
    theory_nodes_removed: 0,
    popularity: popularityRaw,
    homogenization_cost: homogenizationRaw,
    training_cost: trainingCost,
    transposition_position_ids: sortedUnique(
      expansion.subtree.nodes.flatMap((node) =>
        node.transposition_target_position_id ? [node.transposition_target_position_id] : [],
      ),
    ),
    contributions,
    provenance,
  };
  const scored: ReplacementScoredCandidate = {
    ...versioned(),
    candidate_id: expansion.candidate_id,
    request_id: input.request.request_id,
    report_id: input.request.report_id,
    finding_id: input.request.finding_id,
    semantic_finding_id: input.request.semantic_finding_id,
    cohort_id: input.request.cohort_id,
    repertoire_revision: input.request.repertoire_revision,
    repertoire_color: input.request.repertoire_color,
    state: scoreState,
    reason:
      scoreState === "available"
        ? null
        : "Candidate retains partial or unavailable axis evidence; inspect contribution states and reasons.",
    expansion: canonicalCandidateExpansion(expansion),
    objective_quality: canonicalProvenanceFields(cloneJson(expansion.seed.objective_quality)),
    strategic_score: strategicScore,
    pareto: {
      ...versioned(),
      status: "unscored",
      axis_ids: [],
      dominated_by_candidate_ids: [],
      reason: "Pareto assessment pending complete candidate-set comparison.",
    },
    trajectory_report: trajectoryReport,
    concept_dictionary: conceptDictionary,
    route_weighting: routeWeighting,
  };
  const paretoValues = new Map<ReplacementParetoAxis, AxisValue>();
  paretoValues.set("objective-quality", objectiveAxis);
  for (const [axisId, value] of values) paretoValues.set(axisId, value);
  return { scored, paretoValues };
}

function dominates(
  left: CandidateCalculation,
  right: CandidateCalculation,
  axes: readonly ReplacementParetoAxis[],
): boolean {
  let better = false;
  for (const axisId of axes) {
    // dominates() is only called with candidates from assessPareto's `eligible` set, which
    // already guarantees every active axis has a non-null normalized value for every candidate.
    const leftValue = assertDefined(left.paretoValues.get(axisId)).normalized;
    const rightValue = assertDefined(right.paretoValues.get(axisId)).normalized;
    if (leftValue === null || rightValue === null) throw new ProjectionInvariantError();
    if (leftValue + EPSILON < rightValue) return false;
    if (leftValue > rightValue + EPSILON) better = true;
  }
  return better;
}

function assessPareto(calculations: readonly CandidateCalculation[]): ReplacementScoredCandidate[] {
  const complete = calculations.filter(
    (candidate) => candidate.scored.expansion.status === "complete",
  );
  const activeAxes = REPLACEMENT_PARETO_AXES.filter((axisId) => {
    const values = complete.map((candidate) => assertDefined(candidate.paretoValues.get(axisId)));
    return values.some((value) => value.state === "available" && value.normalized !== null);
  });
  const eligible = calculations.filter(
    (candidate) =>
      candidate.scored.expansion.status === "complete" &&
      activeAxes.length > 0 &&
      activeAxes.every((axisId) => {
        const value = candidate.paretoValues.get(axisId);
        return value?.normalized !== null && value?.state === "available";
      }),
  );
  return calculations
    .map((candidate) => {
      let pareto: ReplacementParetoAssessment;
      if (!eligible.includes(candidate)) {
        const missing = REPLACEMENT_PARETO_AXES.filter((axisId) => {
          const value = candidate.paretoValues.get(axisId);
          return (
            value?.normalized === null ||
            value?.state === "unavailable" ||
            value?.state === "partial"
          );
        });
        pareto = {
          ...versioned(),
          status: "unscored",
          axis_ids: activeAxes,
          dominated_by_candidate_ids: [],
          reason:
            candidate.scored.expansion.status !== "complete"
              ? "Incomplete Task 8.5 expansion cannot enter the Pareto frontier."
              : activeAxes.length === 0
                ? "No available Pareto axis is comparable across candidates."
                : `Candidate lacks comparable evidence for Pareto axes: ${missing.join(", ")}. Partial or missing evidence never improves or dominates.`,
        };
      } else {
        const dominators = eligible
          .filter((other) => other !== candidate && dominates(other, candidate, activeAxes))
          .map((other) => other.scored.candidate_id)
          .sort(compareStrings);
        pareto = {
          ...versioned(),
          status: dominators.length > 0 ? "dominated" : "pareto-optimal",
          axis_ids: activeAxes,
          dominated_by_candidate_ids: dominators,
          reason:
            dominators.length > 0
              ? "Every listed candidate is no worse on every fully available active Pareto axis and strictly better on at least one; partial axes are excluded."
              : "No candidate dominates this tradeoff on fully available active axes; partial axes are excluded and no single best candidate is inferred.",
        };
      }
      return { ...candidate.scored, pareto };
    })
    .sort((left, right) => compareStrings(left.candidate_id, right.candidate_id));
}

function context(input: ScoreReplacementCandidatesInput): ReplacementScoringContext {
  return {
    ...versioned(),
    profile: canonicalProfile(input.request.profile),
    graph: canonicalGraph(input.graph),
    cohort: canonicalCohort(input.cohort),
    trajectories: canonicalTrajectories(input.trajectories),
    concepts: canonicalConcepts(input.concepts),
    metrics: canonicalMetrics(input.metrics),
    training: canonicalTraining(input.training),
    popularity: canonicalPopularity(input.popularity),
  };
}

function baseResult(
  input: ScoreReplacementCandidatesInput,
  status: ReplacementScoringResultStatus,
  error: ReplacementScoringErrorCode | null,
  explanation: string,
  candidates: readonly ReplacementScoredCandidate[],
): ReplacementCandidateScoringResult {
  const ordered = [...candidates].sort((left, right) =>
    compareStrings(left.candidate_id, right.candidate_id),
  );
  return {
    ...versioned(),
    status,
    error_code: error,
    explanation,
    request_id: input.request.request_id,
    report_id: input.request.report_id,
    finding_id: input.request.finding_id,
    semantic_finding_id: input.request.semantic_finding_id,
    cohort_id: input.request.cohort_id,
    repertoire_revision: input.request.repertoire_revision,
    repertoire_color: input.request.repertoire_color,
    pivot_id: input.expansion.pivot_id,
    candidates: ordered,
    pareto_candidate_ids: ordered
      .filter((candidate) => candidate.pareto.status === "pareto-optimal")
      .map((candidate) => candidate.candidate_id),
    dominated_candidate_ids: ordered
      .filter((candidate) => candidate.pareto.status === "dominated")
      .map((candidate) => candidate.candidate_id),
    unscored_candidate_ids: ordered
      .filter((candidate) => candidate.pareto.status === "unscored")
      .map((candidate) => candidate.candidate_id),
    context: context(input),
    expansion: canonicalExpansionResult(input.expansion),
    provenance: mergeProvenance(
      [CORE_PROVENANCE, sourceForProfile(input.request.profile)],
      input.request.provenance,
      input.cohort.provenance,
      input.trajectories.provenance,
      input.concepts.provenance,
      input.expansion.provenance,
      input.training?.provenance ?? [],
      input.popularity?.provenance ?? [],
      ...ordered.map((candidate) => candidate.strategic_score.provenance),
    ),
    source_graph_unchanged: true,
    source_context_unchanged: true,
    expansion_unchanged: true,
    inputs_unchanged: true,
  };
}

/** Score complete Task 8.5 candidate trajectories and retain every incomplete or dominated entry. */
export function scoreReplacementCandidates(
  input: ScoreReplacementCandidatesInput,
): ReplacementCandidateScoringResult {
  const failure = compatibilityFailure(input);
  if (failure) return baseResult(input, failure.status, failure.error, failure.explanation, []);
  const modes = modeContext(input.cohort, input.trajectories, input.concepts);
  const baseline = baselineFit(input, modes);
  const calculations = [...input.expansion.candidates]
    .sort((left, right) => compareStrings(left.candidate_id, right.candidate_id))
    .map(
      (candidate): CandidateCalculation =>
        candidate.status === "complete"
          ? scoreCompleteCandidate(input, candidate, modes, baseline)
          : unscoredCandidate(
              input,
              candidate,
              `Task 8.5 expansion status ${candidate.status} is not complete; partial, truncated, blocked, cancelled, stale, illegal, or unavailable work cannot masquerade as scored.`,
            ),
    );
  const candidates = assessPareto(calculations);
  const status: ReplacementScoringResultStatus =
    candidates.length === 0
      ? "unavailable"
      : input.expansion.status === "complete" &&
          candidates.every((candidate) => candidate.state === "available")
        ? "complete"
        : "partial";
  return baseResult(
    input,
    status,
    null,
    status === "complete"
      ? "Every complete Task 8.5 candidate trajectory was scored and Pareto-assessed."
      : "Usable complete candidates were scored; incomplete expansions or missing axis evidence remain explicit.",
    candidates,
  );
}
