/**
 * Framework-free Replacement Lab engine candidate generation.
 *
 * Hosts inject completed MultiPV analysis through ReplacementEngineProvider. This module validates
 * every UCI/PV from the semantic pivot, preserves White-POV transport, calculates separately named
 * repertoire-POV quality, and merges engine alternatives into Task 8.3 candidate seeds by canonical
 * outcome. Results remain expansion-required seeds; Task 8.5 alone may build full candidate subtrees.
 */
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

import { positionKey, type Color } from "../congruence.js";
import type { RepertoireGraph, RepertoireGraphPosition } from "./graph.js";
import type {
  ReplacementCandidateGenerationResult,
  ReplacementCandidateSeed,
} from "./replacement-candidates.js";
import type { ReplacementPivotSelectionResult } from "./replacement-pivot.js";
import {
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  type ReplacementActionablePivotEvidence,
  type ReplacementCandidateSourceKind,
  type ReplacementCandidateSourceProvenance,
  type ReplacementCandidateSourceStatus,
  type ReplacementObjectiveQuality,
  type ReplacementRepertoirePovVerdict,
  type ReplacementRequest,
  type StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import type { JsonValue, StrategicFitSourceProvenance } from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const REPLACEMENT_ENGINE_EVIDENCE_STATES = [
  "available",
  "partial",
  "unavailable",
  "cancelled",
  "stale",
  "rejected",
  "unverified",
] as const;
export type ReplacementEngineEvidenceState =
  (typeof REPLACEMENT_ENGINE_EVIDENCE_STATES)[number];

/** Matches the bounded MultiPV capability of the current engine hosts. */
export const REPLACEMENT_ENGINE_MAX_MULTIPV = 10;

export const REPLACEMENT_ENGINE_ITEM_STATUSES = [
  "accepted",
  "partial",
  "illegal",
  "malformed-pv",
  "unavailable",
  "cancelled",
  "stale",
  "rejected",
  "unverified",
  "budget-excluded",
] as const;
export type ReplacementEngineItemStatus = (typeof REPLACEMENT_ENGINE_ITEM_STATUSES)[number];

export const REPLACEMENT_ENGINE_ITEM_ERROR_CODES = [
  "illegal-uci",
  "malformed-pv",
  "malformed-evaluation",
  "stale-engine-position",
  "stale-engine-request",
  "engine-version-mismatch",
  "engine-identity-mismatch",
  "engine-unavailable",
  "engine-cancelled",
  "engine-rejected",
  "engine-unverified",
  "engine-source-not-requested",
  "original-pivot-move",
  "outside-evaluation-tolerance",
  "forced-mate-against-repertoire",
  "duplicate-multipv-rank",
  "canonical-outcome-rejected",
  "multipv-budget-exceeded",
  "maximum-engine-positions-exceeded",
  "maximum-candidates-exceeded",
] as const;
export type ReplacementEngineItemErrorCode =
  (typeof REPLACEMENT_ENGINE_ITEM_ERROR_CODES)[number];

export const REPLACEMENT_ENGINE_RESULT_STATUSES = [
  "complete",
  "partial",
  "unavailable",
  "cancelled",
  "stale",
  "rejected",
  "unverified",
  "non-actionable",
  "invalid-request",
] as const;
export type ReplacementEngineResultStatus =
  (typeof REPLACEMENT_ENGINE_RESULT_STATUSES)[number];

export const REPLACEMENT_ENGINE_RESULT_ERROR_CODES = [
  "pivot-not-selected",
  "request-pivot-mismatch",
  "candidate-generation-mismatch",
  "repertoire-color-mismatch",
  "pivot-position-stale",
  "pivot-decision-stale",
  "invalid-engine-depth",
  "invalid-engine-multipv",
  "invalid-evaluation-tolerance",
  "invalid-engine-position-budget",
  "invalid-maximum-candidates",
] as const;
export type ReplacementEngineResultErrorCode =
  (typeof REPLACEMENT_ENGINE_RESULT_ERROR_CODES)[number];

export const REPLACEMENT_ENGINE_CACHE_STATUSES = [
  "hit",
  "miss",
  "not-configured",
  "bypassed",
] as const;
export type ReplacementEngineCacheStatus =
  (typeof REPLACEMENT_ENGINE_CACHE_STATUSES)[number];

export interface ReplacementEngineIdentity {
  readonly engine_id: string;
  readonly name: string;
  readonly version: string;
  readonly configuration_id: string;
  readonly configuration: Readonly<Record<string, JsonValue>>;
  readonly analysis_schema_version: string;
}

export interface ReplacementEnginePositionEvidence {
  readonly position_id: string;
  readonly position_key: string;
  readonly fen: string;
}

/** Optional inspectable observations. Missing values must stay null. */
export interface ReplacementEngineDynamicObservations {
  readonly tactical_volatility: number | null;
  readonly evaluation_sensitivity_cp: number | null;
  readonly forcing_move_count: number | null;
  readonly observed_move_count: number | null;
  readonly king_safety_risk: number | null;
}

/** One raw MultiPV line. cp/mate are explicitly White-POV transport values. */
export interface ReplacementEngineLineEvidence {
  readonly line_id: string;
  readonly multipv_rank: number;
  readonly uci: string;
  readonly pv: readonly string[];
  readonly white_pov_evaluation_cp: number | null;
  readonly white_pov_mate_in: number | null;
  readonly depth: number;
  readonly observations: ReplacementEngineDynamicObservations;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Provider output and cache input. Domain code treats this object as immutable. */
export interface ReplacementEngineAnalysisEvidence extends StrategicFitReplacementVersioned {
  readonly evidence_id: string;
  readonly state: ReplacementEngineEvidenceState;
  readonly engine: ReplacementEngineIdentity;
  readonly position: ReplacementEnginePositionEvidence;
  readonly requested_depth: number;
  readonly requested_multipv: number;
  readonly reached_depth: number | null;
  readonly lines: readonly ReplacementEngineLineEvidence[];
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementEngineProviderRequest {
  readonly request_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly position: ReplacementEnginePositionEvidence;
  readonly depth: number;
  readonly multipv: number;
}

/** Host boundary. Browser/Node adapters may wrap their current engine without entering this domain. */
export interface ReplacementEngineProvider {
  readonly identity: ReplacementEngineIdentity;
  analyse(
    request: ReplacementEngineProviderRequest,
    signal?: AbortSignal,
  ): Promise<ReplacementEngineAnalysisEvidence | null>;
}

export interface ReplacementEngineCacheTrace {
  readonly status: ReplacementEngineCacheStatus;
  readonly cache_key: string;
  readonly requested_depth: number;
  readonly requested_multipv: number;
  readonly served_depth: number | null;
  readonly served_multipv: number | null;
  readonly evidence_id: string | null;
}

export interface ReplacementEngineItemResult extends StrategicFitReplacementVersioned {
  readonly evidence_id: string | null;
  readonly line_id: string | null;
  readonly item_index: number;
  readonly evidence_state: ReplacementEngineEvidenceState;
  readonly status: ReplacementEngineItemStatus;
  readonly error_code: ReplacementEngineItemErrorCode | null;
  readonly explanation: string;
  readonly candidate_id: string | null;
  readonly engine: ReplacementEngineIdentity;
  readonly position: ReplacementEnginePositionEvidence;
  readonly requested_depth: number;
  readonly requested_multipv: number;
  readonly reached_depth: number | null;
  readonly multipv_rank: number | null;
  readonly input_uci: string | null;
  readonly input_pv: readonly string[];
  readonly canonical_san: string | null;
  readonly canonical_uci: string | null;
  readonly canonical_pv_san: readonly string[];
  readonly outcome_position_id: string | null;
  readonly outcome_position_key: string | null;
  readonly outcome_fen: string | null;
  readonly white_pov_evaluation_cp: number | null;
  readonly white_pov_mate_in: number | null;
  readonly objective_quality: ReplacementObjectiveQuality | null;
  readonly observations: ReplacementEngineDynamicObservations | null;
  readonly cache: ReplacementEngineCacheTrace;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementEngineSourceResult extends StrategicFitReplacementVersioned {
  readonly source_id: string;
  readonly kind: "engine-multipv";
  readonly status: ReplacementCandidateSourceStatus;
  readonly evidence_state: ReplacementEngineEvidenceState;
  readonly accepted_item_count: number;
  readonly partial_item_count: number;
  readonly rejected_item_count: number;
  readonly reason: string | null;
  readonly engine: ReplacementEngineIdentity;
  readonly position: ReplacementEnginePositionEvidence;
  readonly requested_depth: number;
  readonly requested_multipv: number;
  readonly reached_depth: number | null;
  readonly cache: ReplacementEngineCacheTrace;
  readonly provenance: readonly ReplacementCandidateSourceProvenance[];
}

export interface ReplacementEngineCandidateSeed extends ReplacementCandidateSeed {
  readonly objective_quality: ReplacementObjectiveQuality;
  readonly engine_evidence_ids: readonly string[];
}

export interface GenerateReplacementEngineCandidatesInput {
  readonly request: ReplacementRequest;
  readonly graph: RepertoireGraph;
  readonly pivot_result: ReplacementPivotSelectionResult;
  readonly candidate_generation: ReplacementCandidateGenerationResult;
  readonly provider?: ReplacementEngineProvider | null;
  /** Read-only compatible cache evidence. Returned cache_write may be stored by a host. */
  readonly cache_evidence?: readonly ReplacementEngineAnalysisEvidence[];
  readonly signal?: AbortSignal;
  readonly shouldCancel?: () => boolean;
}

export interface ReplacementEngineCandidateGenerationResult
  extends StrategicFitReplacementVersioned {
  readonly status: ReplacementEngineResultStatus;
  readonly error_code: ReplacementEngineResultErrorCode | null;
  readonly explanation: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly pivot_id: string | null;
  readonly maximum_candidates: number;
  readonly maximum_engine_positions: number;
  readonly requested_engine_depth: number;
  readonly requested_engine_multipv: number;
  readonly engine_positions_scheduled: number;
  readonly discovered_candidate_count: number;
  readonly candidates: readonly ReplacementEngineCandidateSeed[];
  readonly engine_item_results: readonly ReplacementEngineItemResult[];
  readonly source_results: readonly ReplacementEngineSourceResult[];
  readonly cache_write: ReplacementEngineAnalysisEvidence | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
  readonly source_repertoire_unchanged: true;
  readonly source_graph_unchanged: true;
  readonly pivot_result_unchanged: true;
  readonly candidate_generation_unchanged: true;
  readonly engine_evidence_unchanged: true;
  readonly cache_inputs_unchanged: true;
}

interface ValidatedLine {
  readonly line: ReplacementEngineLineEvidence;
  readonly itemIndex: number;
  readonly san: string;
  readonly uci: string;
  readonly pvSan: readonly string[];
  readonly outcomePositionId: string;
  readonly outcomePositionKey: string;
  readonly outcomeFen: string;
  readonly repertoireCp: number | null;
  readonly repertoireMate: number | null;
  readonly source: ReplacementCandidateSourceProvenance;
}

const SEPARATOR = "\u001f";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function candidateId(pivotPositionId: string, outcomePositionKey: string): string {
  return `replacement-candidate-seed:${stableHash([
    pivotPositionId,
    outcomePositionKey,
  ].join(SEPARATOR))}`;
}

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function jsonKey(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonKey).join(",")}]`;
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record).sort(compareStrings).map((key) =>
    `${JSON.stringify(key)}:${jsonKey(record[key]!)}`
  ).join(",")}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStrategicProvenance(value: unknown): StrategicFitSourceProvenance[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((source) => {
    if (!isRecord(source) || typeof source.source_id !== "string" ||
      typeof source.kind !== "string" || typeof source.state !== "string") return [];
    try {
      return [cloneJson(source) as unknown as StrategicFitSourceProvenance];
    } catch {
      return [];
    }
  });
}

function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      return keys.length === value.length + 1 && keys.every((key) =>
        key === "length" || (typeof key === "string" && /^\d+$/.test(key) &&
          String(Number(key)) === key && Number(key) < value.length &&
          isJsonValue(value[Number(key)], ancestors))
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) =>
      typeof key === "string" && isJsonValue((value as Readonly<Record<string, unknown>>)[key], ancestors)
    );
  } catch {
    return false;
  } finally {
    ancestors.delete(value);
  }
}

function validEngineIdentity(value: unknown): value is ReplacementEngineIdentity {
  return isRecord(value) && typeof value.engine_id === "string" &&
    typeof value.name === "string" && typeof value.version === "string" &&
    typeof value.configuration_id === "string" && isRecord(value.configuration) &&
    typeof value.analysis_schema_version === "string" && isJsonValue(value.configuration);
}

function validPositionEvidence(value: unknown): value is ReplacementEnginePositionEvidence {
  return isRecord(value) && typeof value.position_id === "string" &&
    typeof value.position_key === "string" && typeof value.fen === "string";
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function provenanceKey(source: StrategicFitSourceProvenance): string {
  return [source.source_id, source.kind, source.state, source.version ?? "", source.snapshot ?? "", source.reason ?? ""].join(SEPARATOR);
}

function mergeStrategicProvenance(
  sources: readonly StrategicFitSourceProvenance[],
): StrategicFitSourceProvenance[] {
  const unique = new Map<string, StrategicFitSourceProvenance>();
  for (const source of sources) unique.set(provenanceKey(source), cloneJson(source));
  return [...unique.values()].sort((left, right) =>
    compareStrings(provenanceKey(left), provenanceKey(right))
  );
}

function candidateSourceKey(source: ReplacementCandidateSourceProvenance): string {
  return [source.source_id, source.kind, source.status, source.provider ?? "", source.version ?? "", source.snapshot ?? "", source.reason ?? ""].join(SEPARATOR);
}

function mergeCandidateSources(
  sources: readonly ReplacementCandidateSourceProvenance[],
): ReplacementCandidateSourceProvenance[] {
  const groups = new Map<string, ReplacementCandidateSourceProvenance[]>();
  for (const source of sources) {
    const key = candidateSourceKey(source);
    groups.set(key, [...(groups.get(key) ?? []), source]);
  }
  return [...groups.entries()].sort(([left], [right]) => compareStrings(left, right))
    .map(([, matches]) => {
      const first = matches[0]!;
      const details = new Map<string, Readonly<Record<string, JsonValue>>>();
      for (const match of matches) details.set(jsonKey(match.details), cloneJson(match.details));
      return {
        ...versioned(),
        source_id: first.source_id,
        kind: first.kind,
        status: first.status,
        provider: first.provider,
        version: first.version,
        snapshot: first.snapshot,
        reason: first.reason,
        position_ids: sortedUnique(matches.flatMap((source) => source.position_ids)),
        decision_ids: sortedUnique(matches.flatMap((source) => source.decision_ids)),
        route_ids: sortedUnique(matches.flatMap((source) => source.route_ids)),
        details: {
          merged_evidence: [...details.entries()].sort(([left], [right]) =>
            compareStrings(left, right)
          ).map(([, value]) => value),
        },
        provenance: mergeStrategicProvenance(matches.flatMap((source) => source.provenance)),
      };
    });
}

function identityKey(identity: ReplacementEngineIdentity): string {
  return [
    identity.engine_id,
    identity.name,
    identity.version,
    identity.configuration_id,
    jsonKey(identity.configuration),
    identity.analysis_schema_version,
  ].join(SEPARATOR);
}

function cacheKey(
  position: ReplacementEnginePositionEvidence,
  identity: ReplacementEngineIdentity,
): string {
  return `replacement-engine:${stableHash([cachePositionIdentity(position), identityKey(identity)].join(SEPARATOR))}`;
}

function cachePositionIdentity(position: ReplacementEnginePositionEvidence): string {
  const fields = position.fen.split(" ");
  const halfmove = Number(fields[4]);
  return Number.isFinite(halfmove) && halfmove >= 50 ? position.fen : position.position_key;
}

function sameIdentity(left: ReplacementEngineIdentity, right: ReplacementEngineIdentity): boolean {
  return identityKey(left) === identityKey(right);
}

function cacheTrace(
  status: ReplacementEngineCacheStatus,
  position: ReplacementEnginePositionEvidence,
  identity: ReplacementEngineIdentity,
  depth: number,
  multipv: number,
  evidence: ReplacementEngineAnalysisEvidence | null = null,
): ReplacementEngineCacheTrace {
  return {
    status,
    cache_key: cacheKey(position, identity),
    requested_depth: depth,
    requested_multipv: multipv,
    served_depth: evidence?.reached_depth ?? null,
    served_multipv: evidence?.requested_multipv ?? null,
    evidence_id: evidence?.evidence_id ?? null,
  };
}

function compatibleCacheEvidence(
  entries: readonly ReplacementEngineAnalysisEvidence[],
  position: ReplacementEnginePositionEvidence,
  identity: ReplacementEngineIdentity,
  depth: number,
  multipv: number,
): ReplacementEngineAnalysisEvidence | null {
  const compatible = entries.filter((entry) => {
    if (!isRecord(entry) || !validPositionEvidence(entry.position) ||
      !validEngineIdentity(entry.engine) || typeof entry.evidence_id !== "string") return false;
    return entry.schema_version === STRATEGIC_FIT_SCHEMA_VERSION &&
      entry.analysis_version === STRATEGIC_FIT_ANALYSIS_VERSION &&
      entry.replacement_schema_version === STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION &&
      entry.state === "available" &&
      entry.position.position_id === position.position_id &&
      entry.position.position_key === position.position_key &&
      safePositionKey(entry.position.fen) === position.position_key &&
      cachePositionIdentity(entry.position) === cachePositionIdentity(position) &&
      sameIdentity(entry.engine, identity) &&
      entry.reached_depth !== null && finiteInteger(entry.reached_depth) && entry.reached_depth >= depth &&
      finiteInteger(entry.requested_multipv) && entry.requested_multipv >= multipv &&
      cacheProvidesRequestedLines(entry, position, depth, multipv);
  }).sort((left, right) =>
    (left.reached_depth! - right.reached_depth!) ||
    (left.requested_multipv - right.requested_multipv) ||
    compareStrings(left.evidence_id, right.evidence_id)
  );
  for (const entry of compatible) {
    try {
      return cloneJson(entry);
    } catch {
      // Malformed persisted evidence is a cache miss, never a generation failure.
    }
  }
  return null;
}

function cacheProvidesRequestedLines(
  evidence: ReplacementEngineAnalysisEvidence,
  position: ReplacementEnginePositionEvidence,
  depth: number,
  multipv: number,
): boolean {
  if (!Array.isArray(evidence.lines)) return false;
  const byRank = new Map<number, ReplacementEngineLineEvidence>();
  for (const rawLine of evidence.lines) {
    if (!isRecord(rawLine)) return false;
    const line = rawLine as unknown as ReplacementEngineLineEvidence;
    if (!finiteInteger(line.multipv_rank) || line.multipv_rank < 1 ||
      line.multipv_rank > multipv) continue;
    if (byRank.has(line.multipv_rank) || !finiteInteger(line.depth) || line.depth < depth ||
      !validEvaluation(line)) return false;
    try {
      if (!validatePv(position.fen, line)) return false;
    } catch {
      return false;
    }
    byRank.set(line.multipv_rank, line);
  }
  return byRank.size === multipv;
}

function safePositionKey(fen: string): string | null {
  try {
    return positionKey(fen);
  } catch {
    return null;
  }
}

function pivotPosition(
  graph: RepertoireGraph,
  pivot: ReplacementActionablePivotEvidence,
): RepertoireGraphPosition | null {
  return graph.positions.find((position) => position.position_id === pivot.position_id) ?? null;
}

function compatibilityError(
  input: GenerateReplacementEngineCandidatesInput,
): readonly [ReplacementEngineResultStatus, ReplacementEngineResultErrorCode, string] | null {
  const { request, graph, pivot_result: pivotResult, candidate_generation: generation } = input;
  if (!Number.isSafeInteger(request.budget.maximum_candidates) || request.budget.maximum_candidates < 0) {
    return ["invalid-request", "invalid-maximum-candidates", "Maximum candidate budget must be a non-negative safe integer."];
  }
  if (!Number.isSafeInteger(request.budget.maximum_engine_positions) || request.budget.maximum_engine_positions < 0) {
    return ["invalid-request", "invalid-engine-position-budget", "Maximum engine-position budget must be a non-negative safe integer."];
  }
  if (!Number.isSafeInteger(request.budget.engine_depth) || request.budget.engine_depth < 1 || request.budget.engine_depth > 30) {
    return ["invalid-request", "invalid-engine-depth", "Engine depth must be a safe integer from 1 through 30."];
  }
  if (!Number.isSafeInteger(request.budget.engine_multipv) || request.budget.engine_multipv < 1 ||
    request.budget.engine_multipv > REPLACEMENT_ENGINE_MAX_MULTIPV) {
    return ["invalid-request", "invalid-engine-multipv", `Engine MultiPV must be a safe integer from 1 through ${REPLACEMENT_ENGINE_MAX_MULTIPV}.`];
  }
  if (request.maximum_repertoire_pov_loss_from_best_cp !== null &&
    !finiteNonNegative(request.maximum_repertoire_pov_loss_from_best_cp)) {
    return ["invalid-request", "invalid-evaluation-tolerance", "Maximum repertoire-POV loss must be null or a finite non-negative number."];
  }
  if (pivotResult.status !== "selected" || pivotResult.pivot.status !== "actionable") {
    return ["non-actionable", "pivot-not-selected", "Engine generation requires one validated actionable Task 8.2 pivot."];
  }
  const pivot = pivotResult.pivot;
  if (
    pivotResult.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    pivotResult.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    pivotResult.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION ||
    pivotResult.request_id !== request.request_id ||
    pivotResult.report_id !== request.report_id ||
    pivotResult.finding_id !== request.finding_id ||
    pivotResult.semantic_finding_id !== request.semantic_finding_id ||
    pivotResult.cohort_id !== request.cohort_id ||
    pivotResult.repertoire_revision !== request.repertoire_revision ||
    pivotResult.repertoire_color !== request.repertoire_color ||
    pivot.repertoire_color !== request.repertoire_color ||
    pivot.owner !== "repertoire"
  ) {
    return ["stale", "request-pivot-mismatch", "Validated pivot result does not match the current replacement request identity."];
  }
  if (graph.repertoire_color !== request.repertoire_color) {
    return ["stale", "repertoire-color-mismatch", "Current repertoire graph color does not match the request."];
  }
  const position = pivotPosition(graph, pivot);
  let current = position !== null && position.turn === request.repertoire_color;
  if (current && position) {
    try {
      const parsed = Chess.fromSetup(parseFen(position.fen).unwrap()).unwrap();
      current = parsed.turn === position.turn &&
        positionKey(makeFen(parsed.toSetup())) === position.position_key;
    } catch {
      current = false;
    }
  }
  if (!current || !position) {
    return ["stale", "pivot-position-stale", "Semantic pivot position is stale or no longer repertoire-owned."];
  }
  const decision = graph.decisions.find((candidate) => candidate.decision_id === pivot.decision_id);
  if (
    !decision || decision.from_position_id !== pivot.position_id || decision.san !== pivot.san ||
    decision.uci !== pivot.uci || decision.owner !== "repertoire" ||
    decision.mover_color !== request.repertoire_color
  ) {
    return ["stale", "pivot-decision-stale", "Semantic pivot decision no longer matches the current graph."];
  }
  if (
    generation.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    generation.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    generation.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION ||
    generation.request_id !== request.request_id || generation.report_id !== request.report_id ||
    generation.finding_id !== request.finding_id ||
    generation.semantic_finding_id !== request.semantic_finding_id ||
    generation.cohort_id !== request.cohort_id ||
    generation.repertoire_revision !== request.repertoire_revision ||
    generation.repertoire_color !== request.repertoire_color || generation.pivot_id !== pivot.pivot_id ||
    (generation.status !== "complete" && generation.status !== "partial") ||
    generation.candidates.some((candidate) =>
      candidate.request_id !== request.request_id ||
      candidate.repertoire_revision !== request.repertoire_revision ||
      candidate.repertoire_color !== request.repertoire_color ||
      candidate.pivot.pivot_id !== pivot.pivot_id ||
      safePositionKey(candidate.outcome_fen) !== candidate.outcome_position_key
    )
  ) {
    return ["stale", "candidate-generation-mismatch", "Task 8.3 candidate generation is stale or incompatible with the current request and pivot."];
  }
  return null;
}

function sourceStatus(state: ReplacementEngineEvidenceState): ReplacementCandidateSourceStatus {
  if (state === "available") return "available";
  if (state === "partial" || state === "unverified") return "partial";
  if (state === "stale") return "stale";
  if (state === "rejected") return "rejected";
  if (state === "cancelled") return "cancelled";
  return "unavailable";
}

function unavailableQuality(
  request: ReplacementRequest,
  reason: string,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementObjectiveQuality {
  return {
    ...versioned(),
    state: "unavailable",
    white_pov_evaluation_cp: null,
    white_pov_mate_in: null,
    white_pov_best_evaluation_cp: null,
    white_pov_best_mate_in: null,
    repertoire_pov_evaluation_cp: null,
    repertoire_pov_mate_in: null,
    repertoire_pov_loss_from_best_cp: null,
    repertoire_pov_verdict: "unverified",
    engine_depth: null,
    engine_multipv: null,
    evaluation_uncertainty_cp: null,
    tactical_volatility: null,
    evaluation_sensitivity_cp: null,
    forcing_density: null,
    king_safety_risk: null,
    viable_move_width: null,
    database_performance: null,
    theoretical_status: null,
    reason,
    provenance: mergeStrategicProvenance([...request.provenance, ...provenance]),
  };
}

function finiteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validEvaluation(line: ReplacementEngineLineEvidence): boolean {
  const cp = line.white_pov_evaluation_cp;
  const mate = line.white_pov_mate_in;
  return ((finiteInteger(cp) && mate === null) || (cp === null && finiteInteger(mate) && mate !== 0));
}

function normalizeObservations(
  observations: unknown,
): ReplacementEngineDynamicObservations {
  const values = isRecord(observations) ? observations : {};
  return {
    tactical_volatility: finiteNonNegative(values.tactical_volatility)
      ? values.tactical_volatility : null,
    evaluation_sensitivity_cp: finiteNonNegative(values.evaluation_sensitivity_cp)
      ? values.evaluation_sensitivity_cp : null,
    forcing_move_count: finiteInteger(values.forcing_move_count) && values.forcing_move_count >= 0
      ? values.forcing_move_count : null,
    observed_move_count: finiteInteger(values.observed_move_count) && values.observed_move_count > 0
      ? values.observed_move_count : null,
    king_safety_risk: finiteNonNegative(values.king_safety_risk)
      ? values.king_safety_risk : null,
  };
}

function validatePv(
  fen: string,
  line: ReplacementEngineLineEvidence,
): { san: string; uci: string; pvSan: string[]; outcomeFen: string } | null {
  if (!Array.isArray(line.pv) || line.pv.length === 0 ||
    line.pv.some((move) => typeof move !== "string") || line.pv[0] !== line.uci) return null;
  const position = Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const pvSan: string[] = [];
  let firstSan = "";
  let firstUci = "";
  let outcomeFen = "";
  for (const [index, raw] of line.pv.entries()) {
    const move = parseUci(raw);
    if (!move || !position.isLegal(move)) return null;
    const san = makeSan(position, move);
    const uci = makeUci(move);
    if (index === 0) {
      firstSan = san;
      firstUci = uci;
    }
    position.play(move);
    if (index === 0) outcomeFen = makeFen(position.toSetup());
    pvSan.push(san);
  }
  return { san: firstSan, uci: firstUci, pvSan, outcomeFen };
}

function scoreForColor(
  line: ReplacementEngineLineEvidence,
  color: Color,
): { cp: number | null; mate: number | null } {
  const sign = color === "white" ? 1 : -1;
  return {
    cp: line.white_pov_evaluation_cp === null ? null : sign * line.white_pov_evaluation_cp,
    mate: line.white_pov_mate_in === null ? null : sign * line.white_pov_mate_in,
  };
}

/** Positive means left is objectively better from repertoire POV. */
function compareScores(
  left: { cp: number | null; mate: number | null },
  right: { cp: number | null; mate: number | null },
): number {
  if (left.mate !== null) {
    if (right.mate === null) return left.mate > 0 ? 1 : -1;
    if (left.mate > 0 && right.mate < 0) return 1;
    if (left.mate < 0 && right.mate > 0) return -1;
    if (left.mate > 0) return right.mate - left.mate;
    return Math.abs(left.mate) - Math.abs(right.mate);
  }
  if (right.mate !== null) return right.mate > 0 ? -1 : 1;
  return (left.cp ?? 0) - (right.cp ?? 0);
}

function verdict(
  score: { cp: number | null; mate: number | null },
  best: { cp: number | null; mate: number | null },
  tolerance: number | null,
): { verdict: ReplacementRepertoirePovVerdict; loss: number | null; viable: boolean } {
  if (score.mate !== null) {
    return score.mate > 0
      ? { verdict: "forced-mate-for-repertoire", loss: null, viable: true }
      : { verdict: "forced-mate-against-repertoire", loss: null, viable: false };
  }
  if (best.mate !== null && best.mate > 0) {
    return { verdict: "outside-tolerance", loss: null, viable: false };
  }
  if (score.cp === null || best.cp === null || tolerance === null) {
    return { verdict: "unverified", loss: null, viable: tolerance === null };
  }
  const loss = Math.max(0, best.cp - score.cp);
  return loss <= tolerance
    ? { verdict: "within-tolerance", loss, viable: true }
    : { verdict: "outside-tolerance", loss, viable: false };
}

function engineSource(
  evidence: ReplacementEngineAnalysisEvidence,
  line: ReplacementEngineLineEvidence | null,
  status: ReplacementCandidateSourceStatus,
  position: ReplacementEnginePositionEvidence,
  trace: ReplacementEngineCacheTrace,
  reason: string | null,
  outcomePositionId: string | null,
): ReplacementCandidateSourceProvenance {
  return {
    ...versioned(),
    source_id: `strategic-fit:engine-multipv:${evidence.evidence_id}`,
    kind: "engine-multipv",
    status,
    provider: evidence.engine.name,
    version: evidence.engine.version,
    snapshot: evidence.evidence_id,
    reason,
    position_ids: sortedUnique([position.position_id, ...(outcomePositionId ? [outcomePositionId] : [])]),
    decision_ids: [],
    route_ids: [],
    details: {
      evidence_id: evidence.evidence_id,
      evidence_state: evidence.state,
      engine: cloneJson(evidence.engine) as unknown as JsonValue,
      requested_depth: evidence.requested_depth,
      requested_multipv: evidence.requested_multipv,
      reached_depth: evidence.reached_depth,
      position: cloneJson(evidence.position) as unknown as JsonValue,
      move: line ? ({
        line_id: line.line_id,
        multipv_rank: line.multipv_rank,
        uci: line.uci,
        pv: Array.isArray(line.pv) ? line.pv.filter((move): move is string => typeof move === "string") : [],
        white_pov_evaluation_cp: line.white_pov_evaluation_cp,
        white_pov_mate_in: line.white_pov_mate_in,
        depth: line.depth,
        observations: normalizeObservations(line.observations),
      } as unknown as JsonValue) : null,
      cache: cloneJson(trace) as unknown as JsonValue,
    },
    provenance: mergeStrategicProvenance([
      ...safeStrategicProvenance(evidence.provenance),
      ...safeStrategicProvenance(line?.provenance),
    ]),
  };
}

function qualityForLine(
  request: ReplacementRequest,
  evidence: ReplacementEngineAnalysisEvidence,
  line: ValidatedLine,
  best: ValidatedLine,
  validLines: readonly ValidatedLine[],
): ReplacementObjectiveQuality {
  const assessment = verdict(
    { cp: line.repertoireCp, mate: line.repertoireMate },
    { cp: best.repertoireCp, mate: best.repertoireMate },
    request.maximum_repertoire_pov_loss_from_best_cp,
  );
  const observations = normalizeObservations(line.line.observations);
  const cpValues = validLines.flatMap((candidate) =>
    candidate.repertoireCp === null ? [] : [candidate.repertoireCp]
  );
  const uncertainty = cpValues.length >= 2 ? Math.max(...cpValues) - Math.min(...cpValues) : null;
  const forcingDensity = observations.forcing_move_count !== null && observations.observed_move_count !== null
    ? observations.forcing_move_count / observations.observed_move_count
    : null;
  const tolerance = request.maximum_repertoire_pov_loss_from_best_cp;
  const viableOutcomes = tolerance === null ? null : new Set(validLines.filter((candidate) =>
    verdict(
      { cp: candidate.repertoireCp, mate: candidate.repertoireMate },
      { cp: best.repertoireCp, mate: best.repertoireMate },
      tolerance,
    ).viable
  ).map((candidate) => candidate.outcomePositionKey)).size;
  const dynamicComplete = observations.tactical_volatility !== null &&
    observations.evaluation_sensitivity_cp !== null && forcingDensity !== null &&
    observations.king_safety_risk !== null && viableOutcomes !== null && uncertainty !== null;
  const partial = evidence.state === "partial" || evidence.reached_depth === null ||
    evidence.reached_depth < request.budget.engine_depth || line.line.depth < request.budget.engine_depth ||
    !dynamicComplete;
  return {
    ...versioned(),
    state: partial ? "partial" : "available",
    white_pov_evaluation_cp: line.line.white_pov_evaluation_cp,
    white_pov_mate_in: line.line.white_pov_mate_in,
    white_pov_best_evaluation_cp: best.line.white_pov_evaluation_cp,
    white_pov_best_mate_in: best.line.white_pov_mate_in,
    repertoire_pov_evaluation_cp: line.repertoireCp,
    repertoire_pov_mate_in: line.repertoireMate,
    repertoire_pov_loss_from_best_cp: assessment.loss,
    repertoire_pov_verdict: assessment.verdict,
    engine_depth: line.line.depth,
    engine_multipv: evidence.requested_multipv,
    evaluation_uncertainty_cp: uncertainty,
    tactical_volatility: observations.tactical_volatility,
    evaluation_sensitivity_cp: observations.evaluation_sensitivity_cp,
    forcing_density: forcingDensity,
    king_safety_risk: observations.king_safety_risk,
    viable_move_width: viableOutcomes,
    database_performance: null,
    theoretical_status: null,
    reason: partial ? "Objective quality is based on partial or incomplete inspectable engine observations." : null,
    provenance: mergeStrategicProvenance([
      ...safeStrategicProvenance(evidence.provenance),
      ...safeStrategicProvenance(line.line.provenance),
    ]),
  };
}

function syntheticItem(
  request: ReplacementRequest,
  identity: ReplacementEngineIdentity,
  position: ReplacementEnginePositionEvidence,
  trace: ReplacementEngineCacheTrace,
  state: ReplacementEngineEvidenceState,
  status: ReplacementEngineItemStatus,
  errorCode: ReplacementEngineItemErrorCode,
  explanation: string,
  evidence: ReplacementEngineAnalysisEvidence | null = null,
): ReplacementEngineItemResult {
  return {
    ...versioned(),
    evidence_id: evidence?.evidence_id ?? null,
    line_id: null,
    item_index: 0,
    evidence_state: state,
    status,
    error_code: errorCode,
    explanation,
    candidate_id: null,
    engine: cloneJson(identity),
    position: cloneJson(position),
    requested_depth: request.budget.engine_depth,
    requested_multipv: request.budget.engine_multipv,
    reached_depth: evidence?.reached_depth ?? null,
    multipv_rank: null,
    input_uci: null,
    input_pv: [],
    canonical_san: null,
    canonical_uci: null,
    canonical_pv_san: [],
    outcome_position_id: null,
    outcome_position_key: null,
    outcome_fen: null,
    white_pov_evaluation_cp: null,
    white_pov_mate_in: null,
    objective_quality: null,
    observations: null,
    cache: cloneJson(trace),
    provenance: mergeStrategicProvenance(evidence
      ? safeStrategicProvenance(evidence.provenance)
      : request.provenance),
  };
}

function resultBase(
  input: GenerateReplacementEngineCandidatesInput,
  provenance: readonly StrategicFitSourceProvenance[],
) {
  const { request } = input;
  return {
    ...versioned(),
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    maximum_candidates: request.budget.maximum_candidates,
    maximum_engine_positions: request.budget.maximum_engine_positions,
    requested_engine_depth: request.budget.engine_depth,
    requested_engine_multipv: request.budget.engine_multipv,
    provenance,
    source_repertoire_unchanged: true as const,
    source_graph_unchanged: true as const,
    pivot_result_unchanged: true as const,
    candidate_generation_unchanged: true as const,
    engine_evidence_unchanged: true as const,
    cache_inputs_unchanged: true as const,
  };
}

function cloneSeed(
  seed: ReplacementCandidateSeed,
  quality: ReplacementObjectiveQuality,
  engineEvidenceIds: readonly string[],
  additionalSources: readonly ReplacementCandidateSourceProvenance[],
): ReplacementEngineCandidateSeed {
  const provenance = mergeCandidateSources([...seed.provenance, ...additionalSources]);
  return {
    ...cloneJson(seed),
    objective_quality: cloneJson(quality),
    engine_evidence_ids: sortedUnique(engineEvidenceIds),
    source_kinds: sortedUnique(provenance.map((source) => source.kind)) as ReplacementCandidateSourceKind[],
    provenance,
  };
}

function failureResult(
  input: GenerateReplacementEngineCandidatesInput,
  status: ReplacementEngineResultStatus,
  errorCode: ReplacementEngineResultErrorCode,
  explanation: string,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementEngineCandidateGenerationResult {
  return {
    ...resultBase(input, provenance),
    status,
    error_code: errorCode,
    explanation,
    pivot_id: input.pivot_result.status === "selected" ? input.pivot_result.pivot.pivot_id : null,
    engine_positions_scheduled: 0,
    discovered_candidate_count: input.candidate_generation.candidates.length,
    candidates: [],
    engine_item_results: [],
    source_results: [],
    cache_write: null,
  };
}

function genericSource(
  request: ReplacementRequest,
  identity: ReplacementEngineIdentity,
  position: ReplacementEnginePositionEvidence,
  trace: ReplacementEngineCacheTrace,
  state: ReplacementEngineEvidenceState,
  reason: string,
  evidence: ReplacementEngineAnalysisEvidence | null,
): ReplacementCandidateSourceProvenance {
  const placeholder: ReplacementEngineAnalysisEvidence = evidence ?? {
    ...versioned(),
    evidence_id: `engine-evidence:${state}:${stableHash([request.request_id, position.position_key, identityKey(identity)].join(SEPARATOR))}`,
    state,
    engine: cloneJson(identity),
    position: cloneJson(position),
    requested_depth: request.budget.engine_depth,
    requested_multipv: request.budget.engine_multipv,
    reached_depth: null,
    lines: [],
    reason,
    provenance: request.provenance.map((item) => cloneJson(item)),
  };
  return engineSource(placeholder, null, sourceStatus(state), position, trace, reason, null);
}

function sourceResult(
  request: ReplacementRequest,
  identity: ReplacementEngineIdentity,
  position: ReplacementEnginePositionEvidence,
  trace: ReplacementEngineCacheTrace,
  state: ReplacementEngineEvidenceState,
  reason: string | null,
  items: readonly ReplacementEngineItemResult[],
  sources: readonly ReplacementCandidateSourceProvenance[],
  evidence: ReplacementEngineAnalysisEvidence | null,
): ReplacementEngineSourceResult {
  return {
    ...versioned(),
    source_id: evidence ? `strategic-fit:engine-multipv:${evidence.evidence_id}` : "strategic-fit:engine-multipv",
    kind: "engine-multipv",
    status: sourceStatus(state),
    evidence_state: state,
    accepted_item_count: items.filter((item) => item.status === "accepted").length,
    partial_item_count: items.filter((item) => item.status === "partial").length,
    rejected_item_count: items.filter((item) => item.status !== "accepted" && item.status !== "partial").length,
    reason,
    engine: cloneJson(identity),
    position: cloneJson(position),
    requested_depth: request.budget.engine_depth,
    requested_multipv: request.budget.engine_multipv,
    reached_depth: evidence?.reached_depth ?? null,
    cache: cloneJson(trace),
    provenance: mergeCandidateSources(sources),
  };
}

function nonEngineResult(
  input: GenerateReplacementEngineCandidatesInput,
  identity: ReplacementEngineIdentity,
  position: ReplacementEnginePositionEvidence,
  state: ReplacementEngineEvidenceState,
  status: ReplacementEngineResultStatus,
  itemStatus: ReplacementEngineItemStatus,
  itemError: ReplacementEngineItemErrorCode,
  explanation: string,
  trace: ReplacementEngineCacheTrace,
  scheduled: number,
  evidence: ReplacementEngineAnalysisEvidence | null = null,
): ReplacementEngineCandidateGenerationResult {
  const provenance = mergeStrategicProvenance([
    ...input.request.provenance,
    ...input.pivot_result.provenance,
    ...input.candidate_generation.provenance,
    ...safeStrategicProvenance(evidence?.provenance),
  ]);
  const item = syntheticItem(input.request, identity, position, trace, state, itemStatus, itemError, explanation, evidence);
  const source = genericSource(input.request, identity, position, trace, state, explanation, evidence);
  const quality = unavailableQuality(
    input.request,
    explanation,
    safeStrategicProvenance(evidence?.provenance),
  );
  const candidates = input.candidate_generation.candidates.map((seed) =>
    cloneSeed(seed, quality, evidence ? [evidence.evidence_id] : [], [source])
  );
  return {
    ...resultBase(input, provenance),
    status,
    error_code: null,
    explanation,
    pivot_id: input.pivot_result.status === "selected" ? input.pivot_result.pivot.pivot_id : null,
    engine_positions_scheduled: scheduled,
    discovered_candidate_count: candidates.length,
    candidates,
    engine_item_results: [item],
    source_results: [sourceResult(input.request, identity, position, trace, state, explanation, [item], [source], evidence)],
    cache_write: null,
  };
}

function aborted(error: unknown): boolean {
  return (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError");
}

/** Generate and merge bounded engine candidates without constructing Task 8.5 subtrees. */
export async function generateReplacementEngineCandidates(
  input: GenerateReplacementEngineCandidatesInput,
): Promise<ReplacementEngineCandidateGenerationResult> {
  const initialProvenance = mergeStrategicProvenance([
    ...input.request.provenance,
    ...input.pivot_result.provenance,
    ...input.candidate_generation.provenance,
  ]);
  const compatibility = compatibilityError(input);
  if (compatibility) {
    return failureResult(input, compatibility[0], compatibility[1], compatibility[2], initialProvenance);
  }

  const pivot = input.pivot_result.pivot as ReplacementActionablePivotEvidence;
  const graphPosition = pivotPosition(input.graph, pivot)!;
  const position: ReplacementEnginePositionEvidence = {
    position_id: graphPosition.position_id,
    position_key: graphPosition.position_key,
    fen: graphPosition.fen,
  };
  const unavailableIdentity: ReplacementEngineIdentity = {
    engine_id: "engine:unavailable",
    name: "unavailable",
    version: "unavailable",
    configuration_id: "unavailable",
    configuration: {},
    analysis_schema_version: "unavailable",
  };
  let providerIdentity: ReplacementEngineIdentity | null = null;
  let providerIdentityMalformed = false;
  if (input.provider) {
    try {
      const proposedIdentity = input.provider.identity;
      if (validEngineIdentity(proposedIdentity)) providerIdentity = proposedIdentity;
      else providerIdentityMalformed = true;
    } catch {
      providerIdentityMalformed = true;
    }
  }
  const fallbackIdentity = providerIdentity ?? unavailableIdentity;
  const cacheEntries = input.cache_evidence ?? [];
  let trace = cacheTrace(
    cacheEntries.length > 0 ? "miss" : "not-configured",
    position,
    fallbackIdentity,
    input.request.budget.engine_depth,
    input.request.budget.engine_multipv,
  );

  if (!input.request.candidate_sources.includes("engine-multipv")) {
    trace = cacheTrace("bypassed", position, fallbackIdentity, input.request.budget.engine_depth, input.request.budget.engine_multipv);
    return nonEngineResult(input, fallbackIdentity, position, "unverified", "unverified", "unverified", "engine-source-not-requested", "Engine MultiPV was not requested; retained Task 8.3 candidates remain objectively unverified.", trace, 0);
  }
  if (input.request.budget.maximum_engine_positions === 0) {
    trace = cacheTrace("bypassed", position, fallbackIdentity, input.request.budget.engine_depth, input.request.budget.engine_multipv);
    return nonEngineResult(input, fallbackIdentity, position, "rejected", "partial", "budget-excluded", "maximum-engine-positions-exceeded", "Engine position budget is zero; retained Task 8.3 candidates remain objectively unverified.", trace, 0);
  }
  if (input.signal?.aborted || input.shouldCancel?.()) {
    trace = cacheTrace("bypassed", position, fallbackIdentity, input.request.budget.engine_depth, input.request.budget.engine_multipv);
    return nonEngineResult(input, fallbackIdentity, position, "cancelled", "cancelled", "cancelled", "engine-cancelled", "Engine candidate generation was cancelled before scheduling.", trace, 0);
  }
  if (!input.provider) {
    return nonEngineResult(input, fallbackIdentity, position, "unavailable", "unavailable", "unavailable", "engine-unavailable", "Engine provider is unavailable; retained Task 8.3 candidates remain objectively unverified.", trace, 0);
  }
  if (providerIdentityMalformed || !providerIdentity) {
    return nonEngineResult(input, fallbackIdentity, position, "rejected", "rejected", "rejected", "engine-identity-mismatch", "Engine provider identity/configuration is malformed; retained Task 8.3 candidates remain objectively unverified.", trace, 0);
  }

  const identity = providerIdentity;
  const cached = compatibleCacheEvidence(
    cacheEntries,
    position,
    identity,
    input.request.budget.engine_depth,
    input.request.budget.engine_multipv,
  );
  let evidence: ReplacementEngineAnalysisEvidence | null = cached;
  let scheduled = 0;
  if (cached) {
    trace = cacheTrace("hit", position, identity, input.request.budget.engine_depth, input.request.budget.engine_multipv, cached);
  } else {
    trace = cacheTrace(cacheEntries.length > 0 ? "miss" : "not-configured", position, identity, input.request.budget.engine_depth, input.request.budget.engine_multipv);
    if (input.signal?.aborted || input.shouldCancel?.()) {
      return nonEngineResult(input, identity, position, "cancelled", "cancelled", "cancelled", "engine-cancelled", "Engine candidate generation was cancelled before scheduling.", trace, 0);
    }
    scheduled = 1;
    try {
      evidence = await input.provider.analyse({
        request_id: input.request.request_id,
        repertoire_revision: input.request.repertoire_revision,
        repertoire_color: input.request.repertoire_color,
        position: cloneJson(position),
        depth: input.request.budget.engine_depth,
        multipv: input.request.budget.engine_multipv,
      }, input.signal);
    } catch (error) {
      const cancelled = input.signal?.aborted || input.shouldCancel?.() || aborted(error);
      return nonEngineResult(input, identity, position, cancelled ? "cancelled" : "unavailable", cancelled ? "cancelled" : "unavailable", cancelled ? "cancelled" : "unavailable", cancelled ? "engine-cancelled" : "engine-unavailable", cancelled ? "Engine candidate generation was cancelled during analysis." : "Engine provider failed; retained Task 8.3 candidates remain objectively unverified.", trace, scheduled);
    }
  }
  if (input.signal?.aborted || input.shouldCancel?.()) {
    return nonEngineResult(input, identity, position, "cancelled", "cancelled", "cancelled", "engine-cancelled", "Engine candidate generation was cancelled; no further work was scheduled.", trace, scheduled, evidence);
  }
  if (!evidence) {
    return nonEngineResult(input, identity, position, "unavailable", "unavailable", "unavailable", "engine-unavailable", "Engine returned no analysis; retained Task 8.3 candidates remain objectively unverified.", trace, scheduled);
  }
  if (!isRecord(evidence) || !validPositionEvidence(evidence.position) ||
    !validEngineIdentity(evidence.engine) ||
    typeof evidence.evidence_id !== "string" || !Array.isArray(evidence.lines) ||
    !REPLACEMENT_ENGINE_EVIDENCE_STATES.includes(evidence.state as ReplacementEngineEvidenceState) ||
    (evidence.reason !== null && typeof evidence.reason !== "string") ||
    !finiteInteger(evidence.requested_depth) || !finiteInteger(evidence.requested_multipv) ||
    (evidence.reached_depth !== null && !finiteInteger(evidence.reached_depth))) {
    return nonEngineResult(
      input,
      identity,
      position,
      "rejected",
      "rejected",
      "rejected",
      "malformed-evaluation",
      "Engine evidence header is malformed and cannot be inspected safely.",
      trace,
      scheduled,
    );
  }

  let untouchedEvidence: ReplacementEngineAnalysisEvidence | null = null;
  try {
    untouchedEvidence = cloneJson(evidence);
  } catch {
    // Retain inspectable items, but never cache evidence that is not JSON-safe.
  }
  const evidencePositionStale = evidence.position.position_id !== position.position_id ||
    evidence.position.position_key !== position.position_key ||
    cachePositionIdentity(evidence.position) !== cachePositionIdentity(position) ||
    (() => { try { return positionKey(evidence.position.fen) !== position.position_key; } catch { return true; } })();
  const requestStale = evidence.requested_depth < input.request.budget.engine_depth ||
    evidence.requested_multipv < input.request.budget.engine_multipv;
  const identityMismatch = !sameIdentity(evidence.engine, identity);
  const versionMismatch = evidence.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    evidence.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    evidence.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION;
  const terminalState = evidencePositionStale ? "stale" as const
    : requestStale ? "stale" as const
    : versionMismatch ? "rejected" as const
    : identityMismatch ? "rejected" as const
    : evidence.state;
  if (terminalState !== "available" && terminalState !== "partial") {
    const status: ReplacementEngineItemStatus = terminalState === "cancelled" ? "cancelled"
      : terminalState === "stale" ? "stale"
      : terminalState === "unavailable" ? "unavailable"
      : terminalState === "unverified" ? "unverified" : "rejected";
    const error: ReplacementEngineItemErrorCode = evidencePositionStale ? "stale-engine-position"
      : requestStale ? "stale-engine-request"
      : versionMismatch ? "engine-version-mismatch"
      : identityMismatch ? "engine-identity-mismatch"
      : terminalState === "cancelled" ? "engine-cancelled"
      : terminalState === "unavailable" ? "engine-unavailable"
      : terminalState === "unverified" ? "engine-unverified" : "engine-rejected";
    const resultStatus: ReplacementEngineResultStatus = terminalState === "cancelled" ? "cancelled"
      : terminalState === "stale" ? "stale"
      : terminalState === "unavailable" ? "unavailable"
      : terminalState === "unverified" ? "unverified" : "rejected";
    const explanation = evidencePositionStale
      ? "Engine evidence position is stale relative to the semantic pivot."
      : requestStale
        ? "Engine evidence does not satisfy requested depth and MultiPV identity."
        : versionMismatch
          ? "Engine evidence schema versions do not match the current Strategic Fit contracts."
        : identityMismatch
          ? "Engine evidence identity/configuration does not match the invoked provider."
          : evidence.reason ?? `Engine evidence is ${terminalState}.`;
    return nonEngineResult(input, identity, position, terminalState, resultStatus, status, error, explanation, trace, scheduled, evidence);
  }
  if (!Array.isArray(evidence.lines) || evidence.lines.length === 0) {
    return nonEngineResult(
      input,
      identity,
      position,
      "partial",
      "partial",
      "unavailable",
      "engine-unavailable",
      "Engine returned no MultiPV lines for a nonterminal semantic pivot; retained Task 8.3 candidates remain objectively unverified.",
      trace,
      scheduled,
      evidence,
    );
  }

  const preliminaryItems: ReplacementEngineItemResult[] = [];
  const validated: ValidatedLine[] = [];
  const evidenceProvenance = safeStrategicProvenance(evidence.provenance);
  const rankCounts = new Map<number, number>();
  for (const rawLine of evidence.lines) {
    if (!isRecord(rawLine) || !finiteInteger(rawLine.multipv_rank) ||
      rawLine.multipv_rank < 1 || rawLine.multipv_rank > input.request.budget.engine_multipv) continue;
    rankCounts.set(rawLine.multipv_rank, (rankCounts.get(rawLine.multipv_rank) ?? 0) + 1);
  }
  for (const [itemIndex, rawLine] of evidence.lines.entries()) {
    if (!isRecord(rawLine)) {
      preliminaryItems.push({
        ...syntheticItem(
          input.request,
          identity,
          position,
          trace,
          evidence.state,
          "rejected",
          "malformed-evaluation",
          "Engine line is not a structured MultiPV record.",
          evidence,
        ),
        evidence_id: evidence.evidence_id,
        item_index: itemIndex,
      });
      continue;
    }
    const line = rawLine as unknown as ReplacementEngineLineEvidence;
    const rawPv = Array.isArray(line.pv)
      ? line.pv.filter((move: unknown): move is string => typeof move === "string")
      : [];
    const rawObservations = normalizeObservations(line.observations);
    const common = {
      ...versioned(),
      evidence_id: evidence.evidence_id,
      line_id: typeof line.line_id === "string" ? line.line_id : null,
      item_index: itemIndex,
      evidence_state: evidence.state,
      candidate_id: null,
      engine: cloneJson(evidence.engine),
      position: cloneJson(evidence.position),
      requested_depth: input.request.budget.engine_depth,
      requested_multipv: input.request.budget.engine_multipv,
      reached_depth: evidence.reached_depth,
      multipv_rank: finiteInteger(line.multipv_rank) ? line.multipv_rank : null,
      input_uci: typeof line.uci === "string" ? line.uci : null,
      input_pv: rawPv,
      white_pov_evaluation_cp: finiteInteger(line.white_pov_evaluation_cp) ? line.white_pov_evaluation_cp : null,
      white_pov_mate_in: finiteInteger(line.white_pov_mate_in) ? line.white_pov_mate_in : null,
      observations: rawObservations,
      cache: cloneJson(trace),
      provenance: mergeStrategicProvenance([
        ...evidenceProvenance,
        ...safeStrategicProvenance(line.provenance),
      ]),
    };
    const emptyCanonical = {
      canonical_san: null,
      canonical_uci: null,
      canonical_pv_san: [] as readonly string[],
      outcome_position_id: null,
      outcome_position_key: null,
      outcome_fen: null,
      objective_quality: null,
    };
    if (!finiteInteger(line.multipv_rank) || line.multipv_rank < 1 || line.multipv_rank > input.request.budget.engine_multipv) {
      if (trace.status === "hit" && finiteInteger(line.multipv_rank) && line.multipv_rank > input.request.budget.engine_multipv) {
        continue;
      }
      preliminaryItems.push({ ...common, ...emptyCanonical, status: "budget-excluded", error_code: "multipv-budget-exceeded", explanation: "Engine line exceeds requested MultiPV budget." });
      continue;
    }
    if ((rankCounts.get(line.multipv_rank) ?? 0) > 1) {
      preliminaryItems.push({ ...common, ...emptyCanonical, status: "rejected", error_code: "duplicate-multipv-rank", explanation: "Engine evidence contains a duplicate requested MultiPV rank." });
      continue;
    }
    if (typeof line.line_id !== "string" || typeof line.uci !== "string") {
      preliminaryItems.push({ ...common, ...emptyCanonical, status: "rejected", error_code: "malformed-evaluation", explanation: "Engine line identity and root UCI must be strings." });
      continue;
    }
    if (!parseUci(line.uci)) {
      preliminaryItems.push({ ...common, ...emptyCanonical, status: "illegal", error_code: "illegal-uci", explanation: "Engine root UCI is malformed." });
      continue;
    }
    if (!validEvaluation(line) || !finiteInteger(line.depth) || line.depth < 1) {
      preliminaryItems.push({ ...common, ...emptyCanonical, status: "rejected", error_code: "malformed-evaluation", explanation: "Engine line must contain one valid White-POV cp or mate value and a positive depth." });
      continue;
    }
    const pv = validatePv(position.fen, line);
    if (!pv) {
      preliminaryItems.push({ ...common, ...emptyCanonical, status: "malformed-pv", error_code: "malformed-pv", explanation: "Engine PV is empty, mismatched, malformed, or illegal from the semantic pivot position." });
      continue;
    }
    const outcomeKey = positionKey(pv.outcomeFen);
    const outcomePositionId = input.graph.positions.find((candidate) =>
      candidate.position_key === outcomeKey
    )?.position_id ?? semanticPositionId(outcomeKey);
    const repertoire = scoreForColor(line, input.request.repertoire_color);
    const source = engineSource(evidence, line, evidence.state === "partial" || line.depth < input.request.budget.engine_depth ? "partial" : "available", position, trace, evidence.reason, outcomePositionId);
    validated.push({
      line,
      itemIndex,
      san: pv.san,
      uci: pv.uci,
      pvSan: pv.pvSan,
      outcomePositionId,
      outcomePositionKey: outcomeKey,
      outcomeFen: pv.outcomeFen,
      repertoireCp: repertoire.cp,
      repertoireMate: repertoire.mate,
      source,
    });
  }

  const canonicalByOutcome = new Map<string, ValidatedLine>();
  for (const line of validated) {
    const current = canonicalByOutcome.get(line.outcomePositionKey);
    if (!current || compareScores(
      { cp: line.repertoireCp, mate: line.repertoireMate },
      { cp: current.repertoireCp, mate: current.repertoireMate },
    ) < 0 || (compareScores(
      { cp: line.repertoireCp, mate: line.repertoireMate },
      { cp: current.repertoireCp, mate: current.repertoireMate },
    ) === 0 && (
      line.line.depth > current.line.depth ||
      (line.line.depth === current.line.depth && (
        compareStrings(line.uci, current.uci) < 0 ||
        (line.uci === current.uci && compareStrings(line.line.line_id, current.line.line_id) < 0)
      ))
    ))) canonicalByOutcome.set(line.outcomePositionKey, line);
  }
  const canonicalLines = [...canonicalByOutcome.values()];
  const best = canonicalLines.sort((left, right) =>
    -compareScores(
      { cp: left.repertoireCp, mate: left.repertoireMate },
      { cp: right.repertoireCp, mate: right.repertoireMate },
    ) || left.line.multipv_rank - right.line.multipv_rank ||
    compareStrings(left.uci, right.uci) || compareStrings(left.line.line_id, right.line.line_id)
  )[0] ?? null;
  const qualities = new Map<string, ReplacementObjectiveQuality>();
  const sourcesByOutcome = new Map<string, ReplacementCandidateSourceProvenance[]>();
  const evidenceIdsByOutcome = new Map<string, string[]>();
  const acceptedByOutcome = new Map<string, ValidatedLine[]>();
  const validatedItems: ReplacementEngineItemResult[] = [];

  for (const line of validated.sort((left, right) =>
    compareStrings(left.outcomePositionKey, right.outcomePositionKey) ||
    compareStrings(left.uci, right.uci) || left.line.multipv_rank - right.line.multipv_rank ||
    compareStrings(left.line.line_id, right.line.line_id)
  )) {
    const quality = best ? qualityForLine(input.request, evidence, line, best, canonicalLines) : unavailableQuality(input.request, "No valid engine best line was available.", evidenceProvenance);
    const canonical = canonicalByOutcome.get(line.outcomePositionKey)!;
    const assessment = best ? verdict(
      { cp: line.repertoireCp, mate: line.repertoireMate },
      { cp: best.repertoireCp, mate: best.repertoireMate },
      input.request.maximum_repertoire_pov_loss_from_best_cp,
    ) : { verdict: "unverified" as const, loss: null, viable: false };
    const canonicalAssessment = best ? verdict(
      { cp: canonical.repertoireCp, mate: canonical.repertoireMate },
      { cp: best.repertoireCp, mate: best.repertoireMate },
      input.request.maximum_repertoire_pov_loss_from_best_cp,
    ) : { verdict: "unverified" as const, loss: null, viable: false };
    const original = line.uci === pivot.uci;
    const matchingExisting = input.candidate_generation.candidates.some((candidate) =>
      candidate.outcome_position_key === line.outcomePositionKey
    );
    const status: ReplacementEngineItemStatus = original ? "rejected"
      : !assessment.viable ? "rejected"
      : !canonicalAssessment.viable && !matchingExisting ? "budget-excluded"
      : quality.state === "partial" ? "partial" : "accepted";
    const errorCode: ReplacementEngineItemErrorCode | null = original ? "original-pivot-move"
      : assessment.verdict === "forced-mate-against-repertoire" ? "forced-mate-against-repertoire"
      : !assessment.viable ? "outside-evaluation-tolerance"
      : !canonicalAssessment.viable && !matchingExisting ? "canonical-outcome-rejected" : null;
    const id = candidateId(pivot.position_id, line.outcomePositionKey);
    const linkedCandidateId = !original && (canonicalAssessment.viable || matchingExisting) ? id : null;
    const source = status === "accepted" || status === "partial"
      ? line.source
      : { ...line.source, status: "rejected" as const, reason: errorCode ?? evidence.reason };
    if (canonical === line) qualities.set(line.outcomePositionKey, quality);
    sourcesByOutcome.set(line.outcomePositionKey, [
      ...(sourcesByOutcome.get(line.outcomePositionKey) ?? []), source,
    ]);
    evidenceIdsByOutcome.set(line.outcomePositionKey, [
      ...(evidenceIdsByOutcome.get(line.outcomePositionKey) ?? []), evidence.evidence_id,
    ]);
    validatedItems.push({
      ...versioned(),
      evidence_id: evidence.evidence_id,
      line_id: line.line.line_id,
      item_index: line.itemIndex,
      evidence_state: evidence.state,
      status,
      error_code: errorCode,
      explanation: original
        ? "Engine move repeats the current causal pivot instead of proposing an alternative."
        : assessment.viable && canonicalAssessment.viable
          ? "Engine move is legal and objectively viable from repertoire POV."
          : assessment.viable
            ? "Engine line is individually viable, but conflicting evidence rejects its canonical outcome from engine-only candidates."
          : assessment.verdict === "forced-mate-against-repertoire"
            ? "Engine move permits forced mate against the repertoire."
            : "Engine move exceeds configured repertoire-POV evaluation tolerance.",
      candidate_id: linkedCandidateId,
      engine: cloneJson(evidence.engine),
      position: cloneJson(evidence.position),
      requested_depth: input.request.budget.engine_depth,
      requested_multipv: input.request.budget.engine_multipv,
      reached_depth: evidence.reached_depth,
      multipv_rank: line.line.multipv_rank,
      input_uci: line.line.uci,
      input_pv: [...line.line.pv],
      canonical_san: line.san,
      canonical_uci: line.uci,
      canonical_pv_san: [...line.pvSan],
      outcome_position_id: line.outcomePositionId,
      outcome_position_key: line.outcomePositionKey,
      outcome_fen: line.outcomeFen,
      white_pov_evaluation_cp: line.line.white_pov_evaluation_cp,
      white_pov_mate_in: line.line.white_pov_mate_in,
      objective_quality: quality,
      observations: normalizeObservations(line.line.observations),
      cache: cloneJson(trace),
      provenance: mergeStrategicProvenance([
        ...evidenceProvenance,
        ...safeStrategicProvenance(line.line.provenance),
      ]),
    });
  }

  for (const [outcomeKey, canonical] of canonicalByOutcome) {
    if (!best || canonical.uci === pivot.uci) continue;
    const assessment = verdict(
      { cp: canonical.repertoireCp, mate: canonical.repertoireMate },
      { cp: best.repertoireCp, mate: best.repertoireMate },
      input.request.maximum_repertoire_pov_loss_from_best_cp,
    );
    if (assessment.viable) acceptedByOutcome.set(outcomeKey, [canonical]);
  }

  const generic = genericSource(input.request, identity, position, trace, evidence.state, evidence.reason ?? "Engine MultiPV analysis completed.", evidence);
  const unavailable = unavailableQuality(input.request, "No matching usable engine line verifies this Task 8.3 candidate.", evidenceProvenance);
  const combined = new Map<string, ReplacementEngineCandidateSeed>();
  const existingOrder = new Map<string, number>();
  for (const seed of input.candidate_generation.candidates) {
    existingOrder.set(seed.candidate_id, seed.rank);
    combined.set(seed.outcome_position_key, cloneSeed(
      seed,
      qualities.get(seed.outcome_position_key) ?? unavailable,
      evidenceIdsByOutcome.get(seed.outcome_position_key) ?? [evidence.evidence_id],
      sourcesByOutcome.get(seed.outcome_position_key) ?? [generic],
    ));
  }
  for (const [outcomeKey, lines] of acceptedByOutcome) {
    if (combined.has(outcomeKey)) continue;
    const canonical = [...lines].sort((left, right) =>
      compareStrings(left.uci, right.uci) || compareStrings(left.san, right.san) ||
      left.line.multipv_rank - right.line.multipv_rank || compareStrings(left.line.line_id, right.line.line_id)
    )[0]!;
    combined.set(outcomeKey, {
      ...versioned(),
      candidate_id: candidateId(pivot.position_id, outcomeKey),
      rank: 0,
      status: "partial-generation",
      request_id: input.request.request_id,
      report_id: input.request.report_id,
      finding_id: input.request.finding_id,
      semantic_finding_id: input.request.semantic_finding_id,
      cohort_id: input.request.cohort_id,
      repertoire_revision: input.request.repertoire_revision,
      repertoire_color: input.request.repertoire_color,
      pivot: cloneJson(pivot),
      san: canonical.san,
      uci: canonical.uci,
      mover_color: input.request.repertoire_color,
      outcome_position_id: canonical.outcomePositionId,
      outcome_position_key: canonical.outcomePositionKey,
      outcome_fen: canonical.outcomeFen,
      existing_preparation: false,
      memory_class: "unknown",
      rank_hint: "engine-objective-quality",
      maximum_database_popularity: null,
      source_kinds: ["engine-multipv"],
      source_san_paths: pivot.source_san_paths.map((path) => [...path]),
      database_evidence_ids: [],
      provenance: mergeCandidateSources(sourcesByOutcome.get(outcomeKey) ?? [canonical.source]),
      expansion: {
        ...versioned(),
        status: "full-subtree-required",
        full_subtree_required: true,
        required_contract: "ReplacementCandidateSubtree",
        reason: "Task 8.5 must expand this engine seed into bounded coverage-aware opponent replies before it can become a ReplacementCandidate.",
      },
      objective_quality: cloneJson(qualities.get(outcomeKey)!),
      engine_evidence_ids: sortedUnique(evidenceIdsByOutcome.get(outcomeKey) ?? [evidence.evidence_id]),
    });
  }

  const ordered = [...combined.values()].sort((left, right) => {
    const leftExisting = existingOrder.get(left.candidate_id);
    const rightExisting = existingOrder.get(right.candidate_id);
    if (leftExisting !== undefined || rightExisting !== undefined) {
      if (leftExisting === undefined) return 1;
      if (rightExisting === undefined) return -1;
      return leftExisting - rightExisting;
    }
    return compareStrings(left.outcome_position_key, right.outcome_position_key) ||
      compareStrings(left.uci, right.uci) || compareStrings(left.san, right.san);
  });
  const kept = ordered.slice(0, input.request.budget.maximum_candidates)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const keptIds = new Set(kept.map((candidate) => candidate.candidate_id));
  const allItems = [...preliminaryItems, ...validatedItems].map((item): ReplacementEngineItemResult => {
    if ((item.status !== "accepted" && item.status !== "partial") || item.candidate_id === null || keptIds.has(item.candidate_id)) return item;
    return {
      ...item,
      status: "budget-excluded",
      error_code: "maximum-candidates-exceeded",
      explanation: "Legal engine candidate was excluded after canonical deduplication by the request maximum-candidate budget.",
      candidate_id: null,
    };
  }).sort((left, right) =>
    compareStrings(left.outcome_position_key ?? "", right.outcome_position_key ?? "") ||
    compareStrings(left.canonical_uci ?? left.input_uci ?? "", right.canonical_uci ?? right.input_uci ?? "") ||
    compareStrings(left.line_id ?? "", right.line_id ?? "") || left.item_index - right.item_index
  );
  const allSources = mergeCandidateSources([
    generic,
    ...[...sourcesByOutcome.values()].flat(),
  ]);
  const partial = evidence.state === "partial" || evidence.reached_depth === null ||
    evidence.reached_depth < input.request.budget.engine_depth ||
    ordered.length > kept.length || allItems.some((item) => item.status !== "accepted");
  const resultProvenance = mergeStrategicProvenance([
    ...initialProvenance,
    ...evidenceProvenance,
    ...evidence.lines.flatMap((line) => isRecord(line)
      ? safeStrategicProvenance((line as unknown as ReplacementEngineLineEvidence).provenance)
      : []),
    {
      source_id: "strategic-fit:replacement-engine",
      kind: "engine",
      state: partial ? "partial" : "available",
      version: evidence.engine.version,
      snapshot: evidence.evidence_id,
      reason: partial ? "Engine candidates retained with explicit partial or rejected evidence." : null,
    },
  ]);
  const cacheWrite = cached || !untouchedEvidence || preliminaryItems.length > 0 ||
    evidence.state === "cancelled" || evidence.state === "unavailable" ||
    evidence.state === "stale" || evidence.state === "rejected" ||
    evidence.state === "unverified"
    ? null
    : {
      ...cloneJson(untouchedEvidence),
      lines: [...untouchedEvidence.lines].sort((left, right) =>
        left.multipv_rank - right.multipv_rank || compareStrings(left.line_id, right.line_id)
      ).map((line) => cloneJson(line)),
    };
  return {
    ...resultBase(input, resultProvenance),
    status: partial ? "partial" : "complete",
    error_code: null,
    explanation: partial
      ? "Usable Task 8.3 and engine candidate seeds retained with explicit partial, illegal, malformed, rejected, or budget-limited engine evidence."
      : "Engine candidate seeds generated, validated, canonically merged, and bounded deterministically.",
    pivot_id: pivot.pivot_id,
    engine_positions_scheduled: scheduled,
    discovered_candidate_count: ordered.length,
    candidates: kept,
    engine_item_results: allItems,
    source_results: [sourceResult(input.request, identity, position, trace, evidence.state, evidence.reason, allItems, allSources, evidence)],
    cache_write: cacheWrite,
  };
}
