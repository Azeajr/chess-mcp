/**
 * Framework-free Task 8.5 candidate-subtree expansion.
 *
 * Hosts inject completed explorer and engine evidence providers. This module owns deterministic
 * scheduling, legality, coverage, transposition, budget, cancellation, and progress semantics; it
 * never performs network, filesystem, Worker, process, MCP, or UI work.
 */
import { Chess } from "chessops/chess";
import { chessgroundDests } from "chessops/compat";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import type { NormalMove, Role } from "chessops/types";
import { makeUci, parseSquare, parseUci } from "chessops/util";

import { assertDefined } from "../assert.js";
import { positionKey, type Color } from "../congruence.js";
import type { RepertoireGraph, RepertoireGraphPosition } from "./graph.js";
import type {
  ReplacementCandidateSourceProvenance,
  ReplacementCandidateSubtree,
  ReplacementCompleteCandidateSubtree,
  ReplacementSubtreeEdge,
  ReplacementSubtreeNode,
  ReplacementSubtreeRoute,
  ReplacementTruncatedCandidateSubtree,
  ReplacementBlockedCandidateSubtree,
  ReplacementUnresolvedRisk,
  StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import { STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION } from "./replacement-types.js";
import type { ReplacementRequest } from "./replacement-types.js";
import type { ReplacementCandidateGenerationResult } from "./replacement-candidates.js";
import type {
  ReplacementEngineAnalysisEvidence,
  ReplacementEngineCacheTrace,
  ReplacementEngineCandidateGenerationResult,
  ReplacementEngineCandidateSeed,
  ReplacementEngineIdentity,
  ReplacementEngineLineEvidence,
  ReplacementEngineProvider,
  ReplacementEngineSourceResult,
  ReplacementEngineItemResult,
} from "./replacement-engine.js";
import { REPLACEMENT_ENGINE_MAX_MULTIPV } from "./replacement-engine.js";
import type { ReplacementPivotSelectionResult } from "./replacement-pivot.js";
import type { JsonValue, StrategicFitSourceProvenance } from "./types.js";
import { STRATEGIC_FIT_SOURCE_KINDS, STRATEGIC_FIT_SOURCE_STATES } from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION, STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";

export const REPLACEMENT_EXPANSION_EVIDENCE_STATES = [
  "available",
  "partial",
  "unavailable",
  "cancelled",
  "stale",
  "malformed",
] as const;
export type ReplacementExpansionEvidenceState =
  (typeof REPLACEMENT_EXPANSION_EVIDENCE_STATES)[number];

export const REPLACEMENT_EXPANSION_ITEM_STATUSES = [
  "complete",
  "truncated",
  "budget-exhausted",
  "unresolved",
  "illegal",
  "malformed",
  "unavailable",
  "cancelled",
  "stale",
] as const;
export type ReplacementExpansionItemStatus = (typeof REPLACEMENT_EXPANSION_ITEM_STATUSES)[number];

export const REPLACEMENT_EXPANSION_ITEM_ERROR_CODES = [
  "illegal-san",
  "illegal-uci",
  "san-uci-mismatch",
  "malformed-pv",
  "malformed-popularity",
  "malformed-evidence",
  "stale-position",
  "stale-request",
  "provider-unavailable",
  "provider-cancelled",
  "subtree-node-budget-exhausted",
  "engine-position-budget-exhausted",
  "explorer-query-budget-exhausted",
  "strategic-horizon-unresolved",
  "reply-policy-excluded",
  "popularity-filtered",
  "no-legal-continuation",
  "transposition-unresolved",
] as const;
export type ReplacementExpansionItemErrorCode =
  (typeof REPLACEMENT_EXPANSION_ITEM_ERROR_CODES)[number];

export const REPLACEMENT_EXPANSION_RESULT_STATUSES = [
  "complete",
  "partial",
  "unavailable",
  "cancelled",
  "stale",
  "invalid-request",
] as const;
export type ReplacementExpansionResultStatus =
  (typeof REPLACEMENT_EXPANSION_RESULT_STATUSES)[number];

export const REPLACEMENT_EXPANSION_RESULT_ERROR_CODES = [
  "pivot-not-selected",
  "request-pivot-mismatch",
  "candidate-generation-mismatch",
  "engine-generation-mismatch",
  "repertoire-color-mismatch",
  "pivot-position-stale",
  "pivot-decision-stale",
  "invalid-maximum-candidates",
  "invalid-subtree-node-budget",
  "invalid-engine-position-budget",
  "invalid-explorer-query-budget",
  "invalid-engine-depth",
  "invalid-engine-multipv",
  "invalid-strategic-horizon",
  "invalid-popularity-threshold",
  "invalid-reply-policy",
] as const;
export type ReplacementExpansionResultErrorCode =
  (typeof REPLACEMENT_EXPANSION_RESULT_ERROR_CODES)[number];

export const REPLACEMENT_EXPANSION_PROGRESS_STATES = ["running", "completed", "cancelled"] as const;
export type ReplacementExpansionProgressState =
  (typeof REPLACEMENT_EXPANSION_PROGRESS_STATES)[number];

export const REPLACEMENT_EXPANSION_OMISSION_REASONS = [
  "popularity-filtered",
  "reply-policy-excluded",
  "subtree-node-budget-exhausted",
  "engine-position-budget-exhausted",
  "explorer-query-budget-exhausted",
  "provider-unavailable",
  "provider-cancelled",
  "illegal-evidence",
  "malformed-evidence",
  "strategic-horizon-unresolved",
  "no-legal-continuation",
  "transposition-unresolved",
] as const;
export type ReplacementExpansionOmissionReason =
  (typeof REPLACEMENT_EXPANSION_OMISSION_REASONS)[number];

export const REPLACEMENT_EXPANSION_RISK_KINDS = [
  "incomplete-expansion",
  "unresolved-forcing-reply",
  "engine-unverified",
  "transposition-uncertain",
  "stale-source",
] as const;
export type ReplacementExpansionRiskKind = (typeof REPLACEMENT_EXPANSION_RISK_KINDS)[number];

export interface ReplacementExpansionPositionEvidence {
  readonly position_id: string;
  readonly position_key: string;
  readonly fen: string;
  readonly ply: number;
}

export interface ReplacementExplorerReplyEvidence {
  readonly move_id: string;
  readonly san: string;
  readonly uci: string;
  /** Fraction in [0, 1], never a percentage. */
  readonly played_probability: number;
  readonly games: number;
  /** Optional UCI PV beginning with this reply. */
  readonly pv: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Completed host evidence; domain code revalidates every field and move. */
export interface ReplacementExplorerExpansionEvidence extends StrategicFitReplacementVersioned {
  readonly evidence_id: string;
  readonly state: ReplacementExpansionEvidenceState;
  readonly provider: string;
  readonly provider_version: string | null;
  readonly snapshot: string | null;
  readonly position: ReplacementExpansionPositionEvidence;
  readonly replies: readonly ReplacementExplorerReplyEvidence[];
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementExplorerExpansionRequest {
  readonly request_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly position: ReplacementExpansionPositionEvidence;
  readonly minimum_reply_popularity: number;
}

export interface ReplacementExplorerExpansionProvider {
  readonly provider: string;
  readonly version: string | null;
  readonly snapshot: string | null;
  query(
    request: ReplacementExplorerExpansionRequest,
    signal?: AbortSignal,
  ): Promise<ReplacementExplorerExpansionEvidence | null>;
}

export interface ReplacementExpansionProgress extends StrategicFitReplacementVersioned {
  readonly request_id: string;
  readonly state: ReplacementExpansionProgressState;
  readonly completed_units: number;
  readonly total_units: number;
  readonly completed_candidates: number;
  readonly total_candidates: number;
  readonly visited_positions: number;
  readonly engine_positions_scheduled: number;
  readonly explorer_queries_scheduled: number;
}

export interface ReplacementExpansionEvidenceItemResult extends StrategicFitReplacementVersioned {
  readonly provider_kind: "explorer" | "engine";
  readonly evidence_id: string | null;
  readonly item_id: string | null;
  readonly item_index: number;
  readonly position: ReplacementExpansionPositionEvidence;
  readonly status: ReplacementExpansionItemStatus;
  readonly error_code: ReplacementExpansionItemErrorCode | null;
  readonly explanation: string;
  readonly input_san: string | null;
  readonly input_uci: string | null;
  readonly input_pv: readonly string[];
  readonly canonical_san: string | null;
  readonly canonical_uci: string | null;
  readonly canonical_pv_san: readonly string[];
  readonly important: boolean;
  readonly forcing: boolean;
  readonly included: boolean;
  readonly played_probability: number | null;
  readonly white_pov_evaluation_cp: number | null;
  readonly white_pov_mate_in: number | null;
  readonly repertoire_pov_evaluation_cp: number | null;
  readonly repertoire_pov_mate_in: number | null;
  readonly engine: ReplacementEngineIdentity | null;
  readonly cache: ReplacementEngineCacheTrace | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementExpansionSourceResult extends StrategicFitReplacementVersioned {
  readonly source_id: string;
  readonly provider_kind: "explorer" | "engine";
  readonly state: ReplacementExpansionEvidenceState;
  readonly provider: string;
  readonly version: string | null;
  readonly snapshot: string | null;
  readonly position: ReplacementExpansionPositionEvidence;
  readonly requested_depth: number | null;
  readonly requested_multipv: number | null;
  readonly reached_depth: number | null;
  readonly accepted_item_count: number;
  readonly rejected_item_count: number;
  readonly reason: string | null;
  readonly engine: ReplacementEngineIdentity | null;
  readonly cache: ReplacementEngineCacheTrace | null;
  readonly evidence:
    | ReplacementExplorerExpansionEvidence
    | ReplacementEngineAnalysisEvidence
    | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementExpansionOmission extends StrategicFitReplacementVersioned {
  readonly omission_id: string;
  readonly position_id: string;
  readonly decision_id: string | null;
  readonly san: string | null;
  readonly uci: string | null;
  readonly important: boolean;
  readonly forcing: boolean;
  readonly played_probability: number | null;
  readonly reason: ReplacementExpansionOmissionReason;
  readonly explanation: string;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface ReplacementCandidateExpansionBase extends StrategicFitReplacementVersioned {
  readonly candidate_id: string;
  readonly rank: number;
  readonly seed: ReplacementEngineCandidateSeed;
  readonly evidence_item_results: readonly ReplacementExpansionEvidenceItemResult[];
  readonly source_results: readonly ReplacementExpansionSourceResult[];
  readonly omissions: readonly ReplacementExpansionOmission[];
  readonly unresolved_risks: readonly ReplacementUnresolvedRisk[];
}

export interface ReplacementCompleteCandidateExpansion extends ReplacementCandidateExpansionBase {
  readonly status: "complete";
  readonly subtree: ReplacementCompleteCandidateSubtree;
}

export interface ReplacementIncompleteCandidateExpansion extends ReplacementCandidateExpansionBase {
  readonly status: Exclude<ReplacementExpansionItemStatus, "complete">;
  readonly subtree:
    | ReplacementTruncatedCandidateSubtree
    | ReplacementBlockedCandidateSubtree
    | null;
}

/** Task 8.5 output. It intentionally cannot satisfy the Task 8.6+ `ReplacementCandidate`. */
export type ReplacementCandidateExpansion =
  | ReplacementCompleteCandidateExpansion
  | ReplacementIncompleteCandidateExpansion;

export interface ExpandReplacementCandidatesInput {
  readonly request: ReplacementRequest;
  readonly graph: RepertoireGraph;
  readonly pivot_result: ReplacementPivotSelectionResult;
  readonly candidate_generation: ReplacementCandidateGenerationResult;
  readonly engine_generation: ReplacementEngineCandidateGenerationResult;
  readonly explorer_provider?: ReplacementExplorerExpansionProvider | null;
  readonly engine_provider?: ReplacementEngineProvider | null;
  readonly engine_cache_evidence?: readonly ReplacementEngineAnalysisEvidence[];
  readonly signal?: AbortSignal;
  readonly shouldCancel?: () => boolean;
  readonly onProgress?: (progress: ReplacementExpansionProgress) => void;
}

export interface ReplacementCandidateExpansionResult extends StrategicFitReplacementVersioned {
  readonly status: ReplacementExpansionResultStatus;
  readonly error_code: ReplacementExpansionResultErrorCode | null;
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
  readonly maximum_subtree_nodes_per_candidate: number;
  readonly maximum_engine_positions: number;
  readonly maximum_explorer_queries: number;
  readonly strategic_horizon_ply: number;
  readonly minimum_reply_popularity: number;
  readonly include_all_forcing_replies: boolean;
  readonly discovered_candidate_count: number;
  readonly expanded_candidate_count: number;
  readonly engine_positions_scheduled: number;
  readonly explorer_queries_scheduled: number;
  readonly visited_position_count: number;
  readonly candidates: readonly ReplacementCandidateExpansion[];
  readonly source_results: readonly ReplacementExpansionSourceResult[];
  readonly evidence_item_results: readonly ReplacementExpansionEvidenceItemResult[];
  readonly omissions: readonly ReplacementExpansionOmission[];
  readonly unresolved_risks: readonly ReplacementUnresolvedRisk[];
  readonly task_8_4_engine_item_results: readonly ReplacementEngineItemResult[];
  readonly task_8_4_source_results: readonly ReplacementEngineSourceResult[];
  readonly task_8_4_cache_write: ReplacementEngineAnalysisEvidence | null;
  readonly engine_cache_writes: readonly ReplacementEngineAnalysisEvidence[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
  readonly source_repertoire_unchanged: true;
  readonly source_graph_unchanged: true;
  readonly pivot_result_unchanged: true;
  readonly candidate_generation_unchanged: true;
  readonly engine_generation_unchanged: true;
  readonly providers_unchanged: true;
  readonly cache_inputs_unchanged: true;
  readonly evidence_unchanged: true;
}

interface LegalMove {
  readonly move: NormalMove;
  readonly san: string;
  readonly uci: string;
  readonly after: Chess;
  readonly forcing: boolean;
}

interface ValidExplorerReply {
  readonly move: LegalMove;
  readonly evidence: ReplacementExplorerReplyEvidence;
  readonly itemIndex: number;
  readonly important: boolean;
  readonly canonicalPvSan: readonly string[];
}

interface RouteWork {
  readonly position: Chess;
  readonly positionEvidence: ReplacementExpansionPositionEvidence;
  readonly nodeId: string;
  readonly nodeIds: readonly string[];
  readonly edgeIds: readonly string[];
  readonly expectedFrequency: number | null;
}

const SEPARATOR = "\u001f";
const PROMOTIONS: readonly Role[] = ["queen", "rook", "bishop", "knight"];

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

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeClone<T>(value: T): T | null {
  try {
    return cloneJson(value);
  } catch {
    return null;
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

// JSON.stringify's lib.d.ts signature claims `string`, but it really returns `undefined` for
// undefined/function/symbol values — this annotation reflects the true runtime type.
function stringifyOrUndefined(value: unknown): string | undefined {
  return JSON.stringify(value);
}

function jsonKey(value: unknown): string {
  try {
    return stringifyOrUndefined(value) ?? "";
  } catch {
    return "";
  }
}

function provenanceKey(source: StrategicFitSourceProvenance): string {
  return [
    source.source_id,
    source.kind,
    source.state,
    source.version ?? "",
    source.snapshot ?? "",
    source.reason ?? "",
  ].join(SEPARATOR);
}

const SOURCE_KINDS = new Set<string>(STRATEGIC_FIT_SOURCE_KINDS);
const SOURCE_STATES = new Set<string>(STRATEGIC_FIT_SOURCE_STATES);

function validProvenance(source: unknown): source is StrategicFitSourceProvenance {
  return (
    isRecord(source) &&
    typeof source.source_id === "string" &&
    source.source_id.length > 0 &&
    typeof source.kind === "string" &&
    SOURCE_KINDS.has(source.kind) &&
    typeof source.state === "string" &&
    SOURCE_STATES.has(source.state) &&
    (source.version === null || typeof source.version === "string") &&
    (source.snapshot === null || typeof source.snapshot === "string") &&
    (source.reason === null || typeof source.reason === "string")
  );
}

function mergeProvenance(sources: readonly unknown[]): StrategicFitSourceProvenance[] {
  const unique = new Map<string, StrategicFitSourceProvenance>();
  for (const source of sources) {
    if (!validProvenance(source)) continue;
    const cloned = safeClone(source);
    if (cloned) unique.set(provenanceKey(cloned), cloned);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, source]) => source);
}

function sortedPaths(paths: readonly (readonly string[])[]): string[][] {
  return paths
    .map((path) => [...path])
    .sort(
      (left, right) =>
        compareStrings(left.join(SEPARATOR), right.join(SEPARATOR)) || left.length - right.length,
    );
}

function finiteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function currentPosition(fen: string): Chess | null {
  try {
    return Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  } catch {
    return null;
  }
}

function semanticPositionId(key: string): string {
  return `position:${stableHash(key)}`;
}

function positionEvidence(position: Chess, ply: number): ReplacementExpansionPositionEvidence {
  const fen = makeFen(position.toSetup());
  const key = positionKey(fen);
  return { position_id: semanticPositionId(key), position_key: key, fen, ply };
}

function legalMoves(position: Chess): LegalMove[] {
  const moves: LegalMove[] = [];
  for (const [origin, destinations] of chessgroundDests(position)) {
    const from = parseSquare(origin);
    const piece = position.board.get(from);
    for (const destination of destinations) {
      const to = parseSquare(destination);
      const promotion = piece?.role === "pawn" && (to >> 3 === 0 || to >> 3 === 7);
      const roles = promotion ? PROMOTIONS : ([null] as const);
      for (const role of roles) {
        const move: NormalMove = role === null ? { from, to } : { from, to, promotion: role };
        if (!position.isLegal(move)) continue;
        const san = makeSan(position, move);
        const uci = makeUci(move);
        const after = position.clone();
        after.play(move);
        const forcing =
          san.includes("x") || san.includes("+") || san.includes("#") || san.includes("=");
        moves.push({ move, san, uci, after, forcing });
      }
    }
  }
  return moves.sort(
    (left, right) => compareStrings(left.uci, right.uci) || compareStrings(left.san, right.san),
  );
}

function validateMove(
  position: Chess,
  san: unknown,
  uci: unknown,
): {
  readonly move: LegalMove | null;
  readonly error: ReplacementExpansionItemErrorCode | null;
} {
  if (typeof san !== "string" || san.length === 0) return { move: null, error: "illegal-san" };
  if (typeof uci !== "string" || parseUci(uci) === undefined)
    return { move: null, error: "illegal-uci" };
  const parsed = parseSan(position, san);
  if (!parsed || !position.isLegal(parsed)) return { move: null, error: "illegal-san" };
  const canonicalUci = makeUci(parsed);
  if (canonicalUci !== uci) return { move: null, error: "san-uci-mismatch" };
  const after = position.clone();
  after.play(parsed);
  const canonicalSan = makeSan(position, parsed);
  return {
    move: {
      move: parsed as NormalMove,
      san: canonicalSan,
      uci: canonicalUci,
      after,
      forcing:
        canonicalSan.includes("x") ||
        canonicalSan.includes("+") ||
        canonicalSan.includes("#") ||
        canonicalSan.includes("="),
    },
    error: null,
  };
}

function validatePv(
  position: Chess,
  pv: unknown,
  requiredFirstUci?: string,
): readonly string[] | null {
  if (!Array.isArray(pv) || pv.some((uci) => typeof uci !== "string")) return null;
  if (requiredFirstUci !== undefined && pv[0] !== requiredFirstUci) return null;
  const current = position.clone();
  const sans: string[] = [];
  for (const uci of pv) {
    const move = parseUci(uci as string);
    if (!move || !current.isLegal(move)) return null;
    sans.push(makeSan(current, move));
    current.play(move);
  }
  return sans;
}

function aborted(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}

type CompatibilityFailure = readonly [
  ReplacementExpansionResultStatus,
  ReplacementExpansionResultErrorCode,
  string,
];

function sameVersions(value: {
  readonly schema_version?: unknown;
  readonly analysis_version?: unknown;
  readonly replacement_schema_version?: unknown;
}): boolean {
  return (
    value.schema_version === STRATEGIC_FIT_SCHEMA_VERSION &&
    value.analysis_version === STRATEGIC_FIT_ANALYSIS_VERSION &&
    value.replacement_schema_version === STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION
  );
}

function sameRequestIdentity(
  value: {
    readonly request_id: string;
    readonly report_id: string;
    readonly finding_id: string;
    readonly semantic_finding_id: string;
    readonly cohort_id: string;
    readonly repertoire_revision: string;
    readonly repertoire_color: Color;
  },
  request: ExpandReplacementCandidatesInput["request"],
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

function compatibilityError(input: ExpandReplacementCandidatesInput): CompatibilityFailure | null {
  const {
    request,
    graph,
    pivot_result: pivotResult,
    candidate_generation: generation,
    engine_generation: engineGeneration,
  } = input;
  if (!sameVersions(request)) {
    return ["stale", "request-pivot-mismatch", "Replacement request schema versions are stale."];
  }
  if (!finiteInteger(request.budget.maximum_candidates) || request.budget.maximum_candidates < 0) {
    return [
      "invalid-request",
      "invalid-maximum-candidates",
      "Maximum candidates must be a non-negative safe integer.",
    ];
  }
  if (
    !finiteInteger(request.budget.maximum_subtree_nodes_per_candidate) ||
    request.budget.maximum_subtree_nodes_per_candidate < 2
  ) {
    return [
      "invalid-request",
      "invalid-subtree-node-budget",
      "Subtree-node budget must be a safe integer of at least two.",
    ];
  }
  if (
    !finiteInteger(request.budget.maximum_engine_positions) ||
    request.budget.maximum_engine_positions < 0
  ) {
    return [
      "invalid-request",
      "invalid-engine-position-budget",
      "Engine-position budget must be a non-negative safe integer.",
    ];
  }
  if (
    !finiteInteger(request.budget.maximum_explorer_queries) ||
    request.budget.maximum_explorer_queries < 0
  ) {
    return [
      "invalid-request",
      "invalid-explorer-query-budget",
      "Explorer-query budget must be a non-negative safe integer.",
    ];
  }
  if (
    !finiteInteger(request.budget.engine_depth) ||
    request.budget.engine_depth < 1 ||
    request.budget.engine_depth > 30
  ) {
    return [
      "invalid-request",
      "invalid-engine-depth",
      "Engine depth must be a safe integer from 1 through 30.",
    ];
  }
  if (
    !finiteInteger(request.budget.engine_multipv) ||
    request.budget.engine_multipv < 1 ||
    request.budget.engine_multipv > REPLACEMENT_ENGINE_MAX_MULTIPV
  ) {
    return [
      "invalid-request",
      "invalid-engine-multipv",
      `Engine MultiPV must be from 1 through ${REPLACEMENT_ENGINE_MAX_MULTIPV}.`,
    ];
  }
  if (
    !finiteInteger(request.budget.strategic_horizon_ply) ||
    request.budget.strategic_horizon_ply < 1
  ) {
    return [
      "invalid-request",
      "invalid-strategic-horizon",
      "Strategic horizon must be a positive safe-integer ply.",
    ];
  }
  if (
    !finiteNonNegative(request.budget.minimum_reply_popularity) ||
    request.budget.minimum_reply_popularity > 1
  ) {
    return [
      "invalid-request",
      "invalid-popularity-threshold",
      "Minimum reply popularity must be a fraction from zero through one.",
    ];
  }
  if (typeof request.budget.include_all_forcing_replies !== "boolean") {
    return ["invalid-request", "invalid-reply-policy", "Forcing-reply policy must be boolean."];
  }
  // pivot.status/owner are typed as single literals because every construction path sets them
  // that way, but this function revalidates a pivot result that may have crossed a request
  // boundary, so recheck them as real values rather than trust the type.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (pivotResult.status !== "selected" || pivotResult.pivot.status !== "actionable") {
    return [
      "stale",
      "pivot-not-selected",
      "Expansion requires one current validated actionable Task 8.2 pivot.",
    ];
  }
  const pivot = pivotResult.pivot;
  if (
    !sameVersions(pivotResult) ||
    !sameRequestIdentity(pivotResult, request) ||
    pivot.repertoire_color !== request.repertoire_color ||
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    pivot.owner !== "repertoire"
  ) {
    return [
      "stale",
      "request-pivot-mismatch",
      "Validated pivot does not match current request identity.",
    ];
  }
  if (graph.repertoire_color !== request.repertoire_color) {
    return ["stale", "repertoire-color-mismatch", "Current graph color does not match request."];
  }
  const graphPosition = graph.positions.find(
    (position) => position.position_id === pivot.position_id,
  );
  const current = graphPosition ? currentPosition(graphPosition.fen) : null;
  if (
    !graphPosition ||
    !current ||
    graphPosition.turn !== request.repertoire_color ||
    positionKey(makeFen(current.toSetup())) !== graphPosition.position_key ||
    current.turn !== graphPosition.turn
  ) {
    return [
      "stale",
      "pivot-position-stale",
      "Semantic pivot position is stale or no longer repertoire-owned.",
    ];
  }
  const graphDecision = graph.decisions.find(
    (decision) => decision.decision_id === pivot.decision_id,
  );
  if (
    graphDecision?.from_position_id !== pivot.position_id ||
    graphDecision.san !== pivot.san ||
    graphDecision.uci !== pivot.uci ||
    graphDecision.owner !== "repertoire" ||
    graphDecision.mover_color !== request.repertoire_color
  ) {
    return [
      "stale",
      "pivot-decision-stale",
      "Semantic pivot decision no longer matches current graph.",
    ];
  }
  if (
    !sameVersions(generation) ||
    !sameRequestIdentity(generation, request) ||
    generation.pivot_id !== pivot.pivot_id ||
    (generation.status !== "complete" && generation.status !== "partial")
  ) {
    return ["stale", "candidate-generation-mismatch", "Task 8.3 result is stale or incompatible."];
  }
  if (
    !sameVersions(engineGeneration) ||
    !sameRequestIdentity(engineGeneration, request) ||
    engineGeneration.pivot_id !== pivot.pivot_id ||
    engineGeneration.maximum_candidates !== request.budget.maximum_candidates ||
    engineGeneration.maximum_engine_positions !== request.budget.maximum_engine_positions ||
    engineGeneration.requested_engine_depth !== request.budget.engine_depth ||
    engineGeneration.requested_engine_multipv !== request.budget.engine_multipv ||
    engineGeneration.candidates.length > request.budget.maximum_candidates ||
    engineGeneration.status === "stale" ||
    engineGeneration.status === "non-actionable" ||
    engineGeneration.status === "invalid-request"
  ) {
    return [
      "stale",
      "engine-generation-mismatch",
      "Task 8.4 engine-enriched seed result is stale or incompatible.",
    ];
  }
  const seenIds = new Set<string>();
  for (const seed of engineGeneration.candidates) {
    if (
      !sameVersions(seed) ||
      !sameRequestIdentity(seed, request) ||
      seed.pivot.pivot_id !== pivot.pivot_id ||
      seed.mover_color !== request.repertoire_color ||
      // These fields are typed as single literals because every construction path sets them that
      // way, but this loop revalidates Task 8.4 seeds that may have crossed a boundary — see the
      // matching note earlier in this function.
      /* eslint-disable @typescript-eslint/no-unnecessary-condition */
      seed.expansion.status !== "full-subtree-required" ||
      !seed.expansion.full_subtree_required ||
      seed.expansion.required_contract !== "ReplacementCandidateSubtree" ||
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      seenIds.has(seed.candidate_id)
    ) {
      return [
        "stale",
        "engine-generation-mismatch",
        "Task 8.4 contains an incompatible candidate seed.",
      ];
    }
    seenIds.add(seed.candidate_id);
    const validated = validateMove(current, seed.san, seed.uci);
    if (
      !validated.move ||
      positionKey(makeFen(validated.move.after.toSetup())) !== seed.outcome_position_key ||
      semanticPositionId(seed.outcome_position_key) !== seed.outcome_position_id ||
      positionKey(seed.outcome_fen) !== seed.outcome_position_key
    ) {
      return [
        "stale",
        "engine-generation-mismatch",
        "Task 8.4 candidate outcome is illegal or stale.",
      ];
    }
  }
  return null;
}

function resultBase(input: ExpandReplacementCandidatesInput) {
  const request = input.request;
  return {
    ...versioned(),
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    pivot_id: input.pivot_result.status === "selected" ? input.pivot_result.pivot.pivot_id : null,
    maximum_candidates: request.budget.maximum_candidates,
    maximum_subtree_nodes_per_candidate: request.budget.maximum_subtree_nodes_per_candidate,
    maximum_engine_positions: request.budget.maximum_engine_positions,
    maximum_explorer_queries: request.budget.maximum_explorer_queries,
    strategic_horizon_ply: request.budget.strategic_horizon_ply,
    minimum_reply_popularity: request.budget.minimum_reply_popularity,
    include_all_forcing_replies: request.budget.include_all_forcing_replies,
    task_8_4_engine_item_results: safeClone(input.engine_generation.engine_item_results) ?? [],
    task_8_4_source_results: safeClone(input.engine_generation.source_results) ?? [],
    task_8_4_cache_write: safeClone(input.engine_generation.cache_write),
    source_repertoire_unchanged: true as const,
    source_graph_unchanged: true as const,
    pivot_result_unchanged: true as const,
    candidate_generation_unchanged: true as const,
    engine_generation_unchanged: true as const,
    providers_unchanged: true as const,
    cache_inputs_unchanged: true as const,
    evidence_unchanged: true as const,
  };
}

function failureResult(
  input: ExpandReplacementCandidatesInput,
  status: ReplacementExpansionResultStatus,
  errorCode: ReplacementExpansionResultErrorCode | null,
  explanation: string,
): ReplacementCandidateExpansionResult {
  return {
    ...resultBase(input),
    status,
    error_code: errorCode,
    explanation,
    discovered_candidate_count: input.engine_generation.candidates.length,
    expanded_candidate_count: 0,
    engine_positions_scheduled: 0,
    explorer_queries_scheduled: 0,
    visited_position_count: 0,
    candidates: [],
    source_results: [],
    evidence_item_results: [],
    omissions: [],
    unresolved_risks: [],
    engine_cache_writes: [],
    provenance: mergeProvenance([
      ...input.request.provenance,
      ...input.pivot_result.provenance,
      ...input.candidate_generation.provenance,
      ...input.engine_generation.provenance,
    ]),
  };
}

interface ProgressTracker {
  completedUnits: number;
  completedCandidates: number;
  visitedPositions: number;
  engineScheduled: number;
  explorerScheduled: number;
  readonly totalCandidates: number;
  readonly totalUnits: number;
}

function emitProgress(
  input: ExpandReplacementCandidatesInput,
  tracker: ProgressTracker,
  state: ReplacementExpansionProgressState,
): void {
  try {
    input.onProgress?.({
      ...versioned(),
      request_id: input.request.request_id,
      state,
      completed_units: tracker.completedUnits,
      total_units: tracker.totalUnits,
      completed_candidates: tracker.completedCandidates,
      total_candidates: tracker.totalCandidates,
      visited_positions: tracker.visitedPositions,
      engine_positions_scheduled: tracker.engineScheduled,
      explorer_queries_scheduled: tracker.explorerScheduled,
    });
  } catch {
    // Progress observers cannot change deterministic domain results.
  }
}

function cancelled(input: ExpandReplacementCandidatesInput): boolean {
  try {
    return input.signal?.aborted === true || input.shouldCancel?.() === true;
  } catch {
    return true;
  }
}

function advance(input: ExpandReplacementCandidatesInput, tracker: ProgressTracker): void {
  tracker.completedUnits = Math.min(tracker.totalUnits, tracker.completedUnits + 1);
  emitProgress(input, tracker, "running");
}

function candidateProvenanceKey(source: ReplacementCandidateSourceProvenance): string {
  return [
    source.source_id,
    source.kind,
    source.status,
    source.provider ?? "",
    source.version ?? "",
    source.snapshot ?? "",
    source.reason ?? "",
    jsonKey(source.details),
  ].join(SEPARATOR);
}

function mergeCandidateProvenance(
  sources: readonly ReplacementCandidateSourceProvenance[],
): ReplacementCandidateSourceProvenance[] {
  const unique = new Map<string, ReplacementCandidateSourceProvenance>();
  for (const source of sources) {
    const cloned = safeClone(source);
    if (cloned) unique.set(candidateProvenanceKey(cloned), cloned);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([, source]) => source);
}

function expansionCandidateSource(
  kind: "opening-database" | "engine-multipv",
  state: ReplacementExpansionEvidenceState,
  provider: string,
  version: string | null,
  snapshot: string | null,
  position: ReplacementExpansionPositionEvidence,
  reason: string | null,
  details: Readonly<Record<string, JsonValue>>,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementCandidateSourceProvenance {
  const status =
    state === "available"
      ? ("available" as const)
      : state === "partial" || state === "malformed"
        ? ("partial" as const)
        : state === "cancelled"
          ? ("cancelled" as const)
          : state === "stale"
            ? ("stale" as const)
            : ("unavailable" as const);
  return {
    ...versioned(),
    source_id: `strategic-fit:replacement-expand:${kind}:${stableHash(
      [provider, version ?? "", snapshot ?? "", position.position_key].join(SEPARATOR),
    )}`,
    kind,
    status,
    provider,
    version,
    snapshot,
    reason,
    position_ids: [position.position_id],
    decision_ids: [],
    route_ids: [],
    details,
    provenance: mergeProvenance(provenance),
  };
}

function risk(
  candidateId: string,
  kind: ReplacementExpansionRiskKind,
  explanation: string,
  positionIds: readonly string[],
  routeIds: readonly string[],
  provenance: readonly StrategicFitSourceProvenance[],
  blocking = false,
): ReplacementUnresolvedRisk {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    risk_id: `replacement-risk:${stableHash(
      [
        candidateId,
        kind,
        explanation,
        ...sortedUnique(positionIds),
        ...sortedUnique(routeIds),
      ].join(SEPARATOR),
    )}`,
    kind,
    status: blocking ? "blocking" : "open",
    explanation,
    affected_position_ids: sortedUnique(positionIds),
    affected_route_ids: sortedUnique(routeIds),
    provenance: mergeProvenance(provenance),
  };
}

function omission(
  candidateId: string,
  position: ReplacementExpansionPositionEvidence,
  move: LegalMove | null,
  important: boolean,
  forcing: boolean,
  probability: number | null,
  reason: ReplacementExpansionOmissionReason,
  explanation: string,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementExpansionOmission {
  return {
    ...versioned(),
    omission_id: `replacement-omission:${stableHash(
      [candidateId, position.position_key, move?.uci ?? "unknown", reason].join(SEPARATOR),
    )}`,
    position_id: position.position_id,
    decision_id: move
      ? decisionId(position.position_id, move.uci, positionKey(makeFen(move.after.toSetup())))
      : null,
    san: move?.san ?? null,
    uci: move?.uci ?? null,
    important,
    forcing,
    played_probability: probability,
    reason,
    explanation,
    provenance: mergeProvenance(provenance),
  };
}

function decisionId(fromPositionId: string, uci: string, toPositionKey: string): string {
  return `decision:${stableHash([fromPositionId, uci, semanticPositionId(toPositionKey)].join(SEPARATOR))}`;
}

function validEngineIdentity(value: unknown): value is ReplacementEngineIdentity {
  return (
    isRecord(value) &&
    typeof value.engine_id === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "string" &&
    typeof value.configuration_id === "string" &&
    isRecord(value.configuration) &&
    typeof value.analysis_schema_version === "string" &&
    safeClone(value.configuration) !== null
  );
}

function engineIdentityKey(identity: ReplacementEngineIdentity): string {
  return [
    identity.engine_id,
    identity.name,
    identity.version,
    identity.configuration_id,
    jsonKey(identity.configuration),
    identity.analysis_schema_version,
  ].join(SEPARATOR);
}

function cachePositionIdentity(position: ReplacementExpansionPositionEvidence): string {
  const halfmove = Number(position.fen.split(" ")[4]);
  return Number.isFinite(halfmove) && halfmove >= 50 ? position.fen : position.position_key;
}

function expansionCacheKey(
  position: ReplacementExpansionPositionEvidence,
  identity: ReplacementEngineIdentity,
): string {
  return `replacement-expand-engine:${stableHash(
    [cachePositionIdentity(position), engineIdentityKey(identity)].join(SEPARATOR),
  )}`;
}

function cacheTrace(
  status: ReplacementEngineCacheTrace["status"],
  position: ReplacementExpansionPositionEvidence,
  identity: ReplacementEngineIdentity,
  depth: number,
  multipv: number,
  evidence: ReplacementEngineAnalysisEvidence | null = null,
): ReplacementEngineCacheTrace {
  return {
    status,
    cache_key: expansionCacheKey(position, identity),
    requested_depth: depth,
    requested_multipv: multipv,
    served_depth: evidence?.reached_depth ?? null,
    served_multipv: evidence?.requested_multipv ?? null,
    evidence_id: evidence?.evidence_id ?? null,
  };
}

function providerState(state: unknown): ReplacementExpansionEvidenceState {
  return REPLACEMENT_EXPANSION_EVIDENCE_STATES.includes(state as ReplacementExpansionEvidenceState)
    ? (state as ReplacementExpansionEvidenceState)
    : "malformed";
}

function strategicSource(
  providerKind: "explorer" | "engine",
  state: ReplacementExpansionEvidenceState,
  provider: string,
  version: string | null,
  snapshot: string | null,
  position: ReplacementExpansionPositionEvidence,
  reason: string | null,
): StrategicFitSourceProvenance {
  return {
    source_id: `strategic-fit:replacement-expand:${providerKind}:${stableHash(
      [provider, version ?? "", snapshot ?? "", position.position_key].join(SEPARATOR),
    )}`,
    kind: providerKind === "engine" ? "engine" : "opening-explorer",
    state:
      state === "available" ? "available" : state === "unavailable" ? "unavailable" : "partial",
    version,
    snapshot,
    reason,
  };
}

function evidenceItem(
  providerKind: "explorer" | "engine",
  position: ReplacementExpansionPositionEvidence,
  overrides: Partial<ReplacementExpansionEvidenceItemResult>,
): ReplacementExpansionEvidenceItemResult {
  return {
    ...versioned(),
    provider_kind: providerKind,
    evidence_id: null,
    item_id: null,
    item_index: 0,
    position: cloneJson(position),
    status: "unavailable",
    error_code: "provider-unavailable",
    explanation: `${providerKind} evidence is unavailable.`,
    input_san: null,
    input_uci: null,
    input_pv: [],
    canonical_san: null,
    canonical_uci: null,
    canonical_pv_san: [],
    important: false,
    forcing: false,
    included: false,
    played_probability: null,
    white_pov_evaluation_cp: null,
    white_pov_mate_in: null,
    repertoire_pov_evaluation_cp: null,
    repertoire_pov_mate_in: null,
    engine: null,
    cache: null,
    provenance: [],
    ...overrides,
  };
}

function expansionSource(
  providerKind: "explorer" | "engine",
  position: ReplacementExpansionPositionEvidence,
  overrides: Partial<ReplacementExpansionSourceResult>,
): ReplacementExpansionSourceResult {
  return {
    ...versioned(),
    source_id: `strategic-fit:replacement-expand:${providerKind}:${position.position_id}`,
    provider_kind: providerKind,
    state: "unavailable",
    provider: "unavailable",
    version: null,
    snapshot: null,
    position: cloneJson(position),
    requested_depth: null,
    requested_multipv: null,
    reached_depth: null,
    accepted_item_count: 0,
    rejected_item_count: 0,
    reason: `${providerKind} provider is unavailable.`,
    engine: null,
    cache: null,
    evidence: null,
    provenance: [],
    ...overrides,
  };
}

interface ExplorerQueryResult {
  readonly state: ReplacementExpansionEvidenceState;
  readonly replies: readonly ValidExplorerReply[];
  readonly items: readonly ReplacementExpansionEvidenceItemResult[];
  readonly source: ReplacementExpansionSourceResult;
  readonly candidateSource: ReplacementCandidateSourceProvenance;
}

async function queryExplorer(
  input: ExpandReplacementCandidatesInput,
  position: Chess,
  evidencePosition: ReplacementExpansionPositionEvidence,
): Promise<ExplorerQueryResult> {
  const provider = input.explorer_provider;
  let providerName = "unavailable";
  let providerVersion: string | null = null;
  let providerSnapshot: string | null = null;
  try {
    if (provider) {
      providerName = provider.provider;
      providerVersion = provider.version;
      providerSnapshot = provider.snapshot;
    }
  } catch {
    providerName = "malformed";
  }
  const unavailable = (
    state: ReplacementExpansionEvidenceState,
    explanation: string,
    error: ReplacementExpansionItemErrorCode,
  ): ExplorerQueryResult => {
    const provenance = [
      strategicSource(
        "explorer",
        state,
        providerName,
        providerVersion,
        providerSnapshot,
        evidencePosition,
        explanation,
      ),
    ];
    const item = evidenceItem("explorer", evidencePosition, {
      status:
        state === "cancelled"
          ? "cancelled"
          : state === "stale"
            ? "stale"
            : state === "malformed"
              ? "malformed"
              : "unavailable",
      error_code: error,
      explanation,
      provenance,
    });
    return {
      state,
      replies: [],
      items: [item],
      source: expansionSource("explorer", evidencePosition, {
        state,
        provider: providerName,
        version: providerVersion,
        snapshot: providerSnapshot,
        rejected_item_count: 1,
        reason: explanation,
        provenance,
      }),
      candidateSource: expansionCandidateSource(
        "opening-database",
        state,
        providerName,
        providerVersion,
        providerSnapshot,
        evidencePosition,
        explanation,
        { expansion: true, evidence_state: state },
        provenance,
      ),
    };
  };
  if (!provider || providerName.length === 0) {
    return unavailable(
      "unavailable",
      "Explorer provider is unavailable; common-reply coverage is unresolved.",
      "provider-unavailable",
    );
  }
  if (cancelled(input)) {
    return unavailable(
      "cancelled",
      "Explorer expansion was cancelled before scheduling.",
      "provider-cancelled",
    );
  }
  let evidence: ReplacementExplorerExpansionEvidence | null = null;
  try {
    evidence = await provider.query(
      {
        request_id: input.request.request_id,
        repertoire_revision: input.request.repertoire_revision,
        repertoire_color: input.request.repertoire_color,
        position: cloneJson(evidencePosition),
        minimum_reply_popularity: input.request.budget.minimum_reply_popularity,
      },
      input.signal,
    );
  } catch (error) {
    return unavailable(
      cancelled(input) || aborted(error) ? "cancelled" : "unavailable",
      cancelled(input) || aborted(error)
        ? "Explorer expansion was cancelled during query."
        : "Explorer provider failed; common-reply coverage is unresolved.",
      cancelled(input) || aborted(error) ? "provider-cancelled" : "provider-unavailable",
    );
  }
  if (cancelled(input)) {
    return unavailable(
      "cancelled",
      "Explorer expansion was cancelled after query; no new work was scheduled.",
      "provider-cancelled",
    );
  }
  if (!evidence) {
    return unavailable(
      "unavailable",
      "Explorer returned no evidence; common-reply coverage is unresolved.",
      "provider-unavailable",
    );
  }
  const clone = safeClone(evidence);
  if (
    !clone ||
    !isRecord(evidence) ||
    typeof evidence.evidence_id !== "string" ||
    typeof evidence.provider !== "string" ||
    !isRecord(evidence.position) ||
    !Array.isArray(evidence.replies) ||
    !Array.isArray(evidence.provenance) ||
    !evidence.provenance.every(validProvenance)
  ) {
    return unavailable("malformed", "Explorer evidence header is malformed.", "malformed-evidence");
  }
  const state = providerState(evidence.state);
  const stale =
    !sameVersions(evidence) ||
    evidence.provider !== providerName ||
    evidence.provider_version !== providerVersion ||
    evidence.snapshot !== providerSnapshot ||
    evidence.position.position_id !== evidencePosition.position_id ||
    evidence.position.position_key !== evidencePosition.position_key ||
    evidence.position.ply !== evidencePosition.ply ||
    (() => {
      try {
        return positionKey(evidence.position.fen) !== evidencePosition.position_key;
      } catch {
        return true;
      }
    })();
  if (stale)
    return unavailable(
      "stale",
      "Explorer evidence position, provider, or schema identity is stale.",
      "stale-position",
    );
  if (state !== "available" && state !== "partial") {
    return unavailable(
      state,
      evidence.reason ?? `Explorer evidence is ${state}.`,
      state === "cancelled"
        ? "provider-cancelled"
        : state === "stale"
          ? "stale-position"
          : state === "malformed"
            ? "malformed-evidence"
            : "provider-unavailable",
    );
  }
  const items: ReplacementExpansionEvidenceItemResult[] = [];
  const replies: ValidExplorerReply[] = [];
  const evidenceProvenance = mergeProvenance([
    ...evidence.provenance,
    strategicSource(
      "explorer",
      state,
      providerName,
      providerVersion,
      providerSnapshot,
      evidencePosition,
      evidence.reason,
    ),
  ]);
  for (const [itemIndex, raw] of evidence.replies.entries()) {
    const rawRecord = isRecord(raw);
    const moveId = rawRecord && typeof raw.move_id === "string" ? raw.move_id : null;
    const inputSan = rawRecord && typeof raw.san === "string" ? raw.san : null;
    const inputUci = rawRecord && typeof raw.uci === "string" ? raw.uci : null;
    const inputPv =
      rawRecord && Array.isArray(raw.pv) && raw.pv.every((value) => typeof value === "string")
        ? (raw.pv)
        : [];
    const popularityValid =
      rawRecord &&
      finiteNonNegative(raw.played_probability) &&
      raw.played_probability <= 1 &&
      finiteInteger(raw.games) &&
      raw.games >= 0;
    const provenanceValid =
      rawRecord && Array.isArray(raw.provenance) && raw.provenance.every(validProvenance);
    const validated = validateMove(position, inputSan, inputUci);
    const pvSan =
      validated.move && rawRecord
        ? Array.isArray(raw.pv) && raw.pv.length === 0
          ? []
          : validatePv(position, raw.pv, validated.move.uci)
        : null;
    let status: ReplacementExpansionItemStatus = "complete";
    let error: ReplacementExpansionItemErrorCode | null = null;
    if (!rawRecord || !moveId || !provenanceValid) {
      status = "malformed";
      error = "malformed-evidence";
    } else if (!popularityValid) {
      status = "malformed";
      error = "malformed-popularity";
    } else if (!validated.move) {
      status = "illegal";
      error = validated.error;
    } else if (pvSan === null) {
      status = "malformed";
      error = "malformed-pv";
    }
    const playedProbability = popularityValid ? (raw.played_probability as number) : null;
    const important =
      playedProbability !== null &&
      playedProbability >= input.request.budget.minimum_reply_popularity;
    const provenance =
      rawRecord && Array.isArray(raw.provenance)
        ? mergeProvenance([
            ...evidenceProvenance,
            ...(raw.provenance as StrategicFitSourceProvenance[]),
          ])
        : evidenceProvenance;
    items.push(
      evidenceItem("explorer", evidencePosition, {
        evidence_id: evidence.evidence_id,
        item_id: moveId,
        item_index: itemIndex,
        status,
        error_code: error,
        explanation:
          status === "complete"
            ? "Explorer reply is legal and semantically current."
            : `Explorer reply is ${status}: ${error ?? "unknown"}.`,
        input_san: inputSan,
        input_uci: inputUci,
        input_pv: [...inputPv],
        canonical_san: validated.move?.san ?? null,
        canonical_uci: validated.move?.uci ?? null,
        canonical_pv_san: pvSan ? [...pvSan] : [],
        important,
        forcing: validated.move?.forcing ?? false,
        included: false,
        played_probability: playedProbability,
        provenance,
      }),
    );
    if (status === "complete" && validated.move && rawRecord && popularityValid && pvSan) {
      replies.push({
        move: validated.move,
        evidence: raw as unknown as ReplacementExplorerReplyEvidence,
        itemIndex,
        important,
        canonicalPvSan: pvSan,
      });
    }
  }
  const replyGroups = new Map<string, ValidExplorerReply[]>();
  for (const reply of replies) {
    replyGroups.set(reply.move.uci, [...(replyGroups.get(reply.move.uci) ?? []), reply]);
  }
  const deduplicatedReplies: ValidExplorerReply[] = [];
  for (const [, matches] of [...replyGroups.entries()].sort(([left], [right]) =>
    compareStrings(left, right),
  )) {
    const orderedMatches = [...matches].sort(
      (left, right) =>
        compareStrings(left.evidence.move_id, right.evidence.move_id) ||
        right.evidence.played_probability - left.evidence.played_probability,
    );
    const first = orderedMatches[0];
    if (!first) continue;
    deduplicatedReplies.push(first);
    for (const duplicate of orderedMatches.slice(1)) {
      items[duplicate.itemIndex] = {
        ...assertDefined(items[duplicate.itemIndex]),
        status: "malformed",
        error_code: "malformed-evidence",
        explanation:
          "Explorer evidence duplicates a canonical reply; only the deterministic canonical item is usable.",
        included: false,
      };
    }
  }
  const canonicalItems = [...items]
    .sort(
      (left, right) =>
        compareStrings(
          left.canonical_uci ?? left.input_uci ?? "",
          right.canonical_uci ?? right.input_uci ?? "",
        ) ||
        compareStrings(left.item_id ?? "", right.item_id ?? "") ||
        compareStrings(left.status, right.status),
    )
    .map((item, itemIndex) => ({ ...item, item_index: itemIndex }));
  const canonicalItemIndexes = new Map(
    canonicalItems.map((item) => [
      [item.item_id ?? "", item.canonical_uci ?? item.input_uci ?? ""].join(SEPARATOR),
      item.item_index,
    ]),
  );
  const ordered = deduplicatedReplies
    .map((item) => ({
      ...item,
      itemIndex:
        canonicalItemIndexes.get([item.evidence.move_id, item.move.uci].join(SEPARATOR)) ??
        item.itemIndex,
    }))
    .sort(
      (left, right) =>
        Number(right.important) - Number(left.important) ||
        Number(right.move.forcing) - Number(left.move.forcing) ||
        right.evidence.played_probability - left.evidence.played_probability ||
        compareStrings(left.move.uci, right.move.uci) ||
        compareStrings(left.evidence.move_id, right.evidence.move_id),
    );
  const source = expansionSource("explorer", evidencePosition, {
    source_id: `strategic-fit:replacement-expand:explorer:${evidence.evidence_id}`,
    state,
    provider: providerName,
    version: providerVersion,
    snapshot: providerSnapshot,
    accepted_item_count: canonicalItems.filter((item) => item.status === "complete").length,
    rejected_item_count: canonicalItems.filter((item) => item.status !== "complete").length,
    reason: evidence.reason,
    evidence: {
      ...clone,
      replies: [...clone.replies].sort((left, right) => {
        const leftRecord = isRecord(left);
        const rightRecord = isRecord(right);
        return (
          compareStrings(
            leftRecord && typeof left.uci === "string" ? left.uci : "",
            rightRecord && typeof right.uci === "string" ? right.uci : "",
          ) ||
          compareStrings(
            leftRecord && typeof left.move_id === "string" ? left.move_id : jsonKey(left),
            rightRecord && typeof right.move_id === "string" ? right.move_id : jsonKey(right),
          )
        );
      }),
    },
    provenance: evidenceProvenance,
  });
  return {
    state,
    replies: ordered,
    items: canonicalItems,
    source,
    candidateSource: expansionCandidateSource(
      "opening-database",
      state,
      providerName,
      providerVersion,
      providerSnapshot,
      evidencePosition,
      evidence.reason,
      { expansion: true, evidence_id: evidence.evidence_id },
      evidenceProvenance,
    ),
  };
}

interface EngineQueryResult {
  readonly state: ReplacementExpansionEvidenceState;
  readonly move: LegalMove | null;
  readonly items: readonly ReplacementExpansionEvidenceItemResult[];
  readonly source: ReplacementExpansionSourceResult;
  readonly candidateSource: ReplacementCandidateSourceProvenance;
  readonly cacheWrite: ReplacementEngineAnalysisEvidence | null;
  readonly providerScheduled: boolean;
}

function compatibleExpansionCache(
  entries: readonly ReplacementEngineAnalysisEvidence[],
  position: ReplacementExpansionPositionEvidence,
  identity: ReplacementEngineIdentity,
  depth: number,
  multipv: number,
): ReplacementEngineAnalysisEvidence | null {
  const compatible = entries
    .filter((entry) => {
      if (
        !isRecord(entry) ||
        !sameVersions(entry) ||
        entry.state !== "available" ||
        !validEngineIdentity(entry.engine) ||
        engineIdentityKey(entry.engine) !== engineIdentityKey(identity) ||
        !isRecord(entry.position) ||
        entry.position.position_id !== position.position_id ||
        entry.position.position_key !== position.position_key ||
        cachePositionIdentity({ ...position, fen: entry.position.fen }) !==
          cachePositionIdentity(position) ||
        !finiteInteger(entry.reached_depth) ||
        entry.reached_depth < depth ||
        !finiteInteger(entry.requested_multipv) ||
        entry.requested_multipv < multipv ||
        !Array.isArray(entry.lines)
      )
        return false;
      const ranks = new Set<number>();
      const requestedRanks = new Set<number>();
      const chess = currentPosition(position.fen);
      if (!chess) return false;
      for (const raw of entry.lines) {
        if (
          !isRecord(raw) ||
          !finiteInteger(raw.multipv_rank) ||
          raw.multipv_rank < 1 ||
          ranks.has(raw.multipv_rank) ||
          !finiteInteger(raw.depth) ||
          raw.depth < depth ||
          typeof raw.uci !== "string" ||
          !(
            (finiteInteger(raw.white_pov_evaluation_cp) && raw.white_pov_mate_in === null) ||
            (raw.white_pov_evaluation_cp === null &&
              finiteInteger(raw.white_pov_mate_in) &&
              raw.white_pov_mate_in !== 0)
          ) ||
          validatePv(chess, raw.pv, raw.uci) === null
        )
          return false;
        ranks.add(raw.multipv_rank);
        if (raw.multipv_rank <= multipv) requestedRanks.add(raw.multipv_rank);
      }
      return requestedRanks.size === multipv;
    })
    .sort(
      (left, right) =>
        assertDefined(left.reached_depth) - assertDefined(right.reached_depth) ||
        left.requested_multipv - right.requested_multipv ||
        compareStrings(left.evidence_id, right.evidence_id),
    );
  return safeClone(compatible[0] ?? null);
}

function sortedEngineLines(lines: readonly unknown[]): ReplacementEngineLineEvidence[] {
  return [...lines].sort((left, right) => {
    const leftRecord = isRecord(left);
    const rightRecord = isRecord(right);
    const leftRank =
      leftRecord && finiteInteger(left.multipv_rank) ? left.multipv_rank : Number.MAX_SAFE_INTEGER;
    const rightRank =
      rightRecord && finiteInteger(right.multipv_rank)
        ? right.multipv_rank
        : Number.MAX_SAFE_INTEGER;
    return (
      leftRank - rightRank ||
      compareStrings(
        leftRecord && typeof left.line_id === "string" ? left.line_id : jsonKey(left),
        rightRecord && typeof right.line_id === "string" ? right.line_id : jsonKey(right),
      )
    );
  }) as ReplacementEngineLineEvidence[];
}

async function queryEngine(
  input: ExpandReplacementCandidatesInput,
  position: Chess,
  evidencePosition: ReplacementExpansionPositionEvidence,
  allowProviderSchedule: boolean,
): Promise<EngineQueryResult> {
  const provider = input.engine_provider;
  const unavailableIdentity: ReplacementEngineIdentity = {
    engine_id: "engine:unavailable",
    name: "unavailable",
    version: "unavailable",
    configuration_id: "unavailable",
    configuration: {},
    analysis_schema_version: "unavailable",
  };
  let identity = unavailableIdentity;
  let identityValid = false;
  try {
    if (provider && validEngineIdentity(provider.identity)) {
      identity = cloneJson(provider.identity);
      identityValid = true;
    }
  } catch {
    identityValid = false;
  }
  let trace = cacheTrace(
    "not-configured",
    evidencePosition,
    identity,
    input.request.budget.engine_depth,
    input.request.budget.engine_multipv,
  );
  let providerScheduled = false;
  const unavailable = (
    state: ReplacementExpansionEvidenceState,
    explanation: string,
    error: ReplacementExpansionItemErrorCode,
    evidence: ReplacementEngineAnalysisEvidence | null = null,
  ): EngineQueryResult => {
    const provenance = mergeProvenance([
      ...(evidence?.provenance ?? []),
      strategicSource(
        "engine",
        state,
        identity.name,
        identity.version,
        evidence?.evidence_id ?? null,
        evidencePosition,
        explanation,
      ),
    ]);
    const item = evidenceItem("engine", evidencePosition, {
      evidence_id: evidence?.evidence_id ?? null,
      status:
        state === "cancelled"
          ? "cancelled"
          : state === "stale"
            ? "stale"
            : state === "malformed"
              ? "malformed"
              : "unavailable",
      error_code: error,
      explanation,
      engine: cloneJson(identity),
      cache: cloneJson(trace),
      provenance,
    });
    return {
      state,
      move: null,
      items: [item],
      source: expansionSource("engine", evidencePosition, {
        state,
        provider: identity.name,
        version: identity.version,
        snapshot: evidence?.evidence_id ?? null,
        requested_depth: input.request.budget.engine_depth,
        requested_multipv: input.request.budget.engine_multipv,
        reached_depth: evidence?.reached_depth ?? null,
        rejected_item_count: 1,
        reason: explanation,
        engine: cloneJson(identity),
        cache: cloneJson(trace),
        evidence: safeClone(evidence),
        provenance,
      }),
      candidateSource: expansionCandidateSource(
        "engine-multipv",
        state,
        identity.name,
        identity.version,
        evidence?.evidence_id ?? null,
        evidencePosition,
        explanation,
        {
          expansion: true,
          cache: trace.status,
          engine_configuration: cloneJson(identity.configuration),
        },
        provenance,
      ),
      cacheWrite: null,
      providerScheduled,
    };
  };
  if (!provider)
    return unavailable(
      "unavailable",
      "Engine provider is unavailable; continuation is unresolved.",
      "provider-unavailable",
    );
  if (!identityValid)
    return unavailable(
      "malformed",
      "Engine provider identity or configuration is malformed.",
      "malformed-evidence",
    );
  const cacheEntries = input.engine_cache_evidence ?? [];
  const cached = compatibleExpansionCache(
    cacheEntries,
    evidencePosition,
    identity,
    input.request.budget.engine_depth,
    input.request.budget.engine_multipv,
  );
  let evidence = cached;
  if (cached) {
    trace = cacheTrace(
      "hit",
      evidencePosition,
      identity,
      input.request.budget.engine_depth,
      input.request.budget.engine_multipv,
      cached,
    );
  } else {
    trace = cacheTrace(
      cacheEntries.length > 0 ? "miss" : "not-configured",
      evidencePosition,
      identity,
      input.request.budget.engine_depth,
      input.request.budget.engine_multipv,
    );
    if (!allowProviderSchedule) {
      return unavailable(
        "partial",
        "Engine-position budget exhausted before provider analysis; no compatible cache entry was available.",
        "engine-position-budget-exhausted",
      );
    }
    if (cancelled(input))
      return unavailable(
        "cancelled",
        "Engine expansion was cancelled before scheduling.",
        "provider-cancelled",
      );
    providerScheduled = true;
    try {
      evidence = await provider.analyse(
        {
          request_id: input.request.request_id,
          repertoire_revision: input.request.repertoire_revision,
          repertoire_color: input.request.repertoire_color,
          position: {
            position_id: evidencePosition.position_id,
            position_key: evidencePosition.position_key,
            fen: evidencePosition.fen,
          },
          depth: input.request.budget.engine_depth,
          multipv: input.request.budget.engine_multipv,
        },
        input.signal,
      );
    } catch (error) {
      return unavailable(
        cancelled(input) || aborted(error) ? "cancelled" : "unavailable",
        cancelled(input) || aborted(error)
          ? "Engine expansion was cancelled during analysis."
          : "Engine provider failed; continuation is unresolved.",
        cancelled(input) || aborted(error) ? "provider-cancelled" : "provider-unavailable",
      );
    }
  }
  if (cancelled(input)) {
    return unavailable(
      "cancelled",
      "Engine expansion was cancelled after analysis; no new work was scheduled.",
      "provider-cancelled",
      evidence,
    );
  }
  if (!evidence)
    return unavailable(
      "unavailable",
      "Engine returned no evidence; continuation is unresolved.",
      "provider-unavailable",
    );
  const clonedEvidence = safeClone(evidence);
  if (
    !clonedEvidence ||
    !isRecord(evidence) ||
    typeof evidence.evidence_id !== "string" ||
    !validEngineIdentity(evidence.engine) ||
    !isRecord(evidence.position) ||
    !Array.isArray(evidence.lines) ||
    !Array.isArray(evidence.provenance) ||
    !evidence.provenance.every(validProvenance) ||
    !finiteInteger(evidence.requested_depth) ||
    !finiteInteger(evidence.requested_multipv) ||
    (evidence.reached_depth !== null && !finiteInteger(evidence.reached_depth)) ||
    (evidence.reason !== null && typeof evidence.reason !== "string")
  ) {
    return unavailable(
      "malformed",
      "Engine evidence header is malformed.",
      "malformed-evidence",
      evidence,
    );
  }
  const positionStale =
    evidence.position.position_id !== evidencePosition.position_id ||
    evidence.position.position_key !== evidencePosition.position_key ||
    cachePositionIdentity({ ...evidencePosition, fen: evidence.position.fen }) !==
      cachePositionIdentity(evidencePosition) ||
    (() => {
      try {
        return positionKey(evidence.position.fen) !== evidencePosition.position_key;
      } catch {
        return true;
      }
    })();
  const requestStale =
    evidence.requested_depth < input.request.budget.engine_depth ||
    evidence.requested_multipv < input.request.budget.engine_multipv;
  const identityStale =
    engineIdentityKey(evidence.engine) !== engineIdentityKey(identity) || !sameVersions(evidence);
  if (positionStale || requestStale || identityStale) {
    return unavailable(
      "stale",
      "Engine evidence position, request, identity, or schema is stale.",
      positionStale ? "stale-position" : "stale-request",
      evidence,
    );
  }
  const rawState = evidence.state;
  if (rawState !== "available" && rawState !== "partial") {
    const terminalState: ReplacementExpansionEvidenceState =
      rawState === "cancelled"
        ? "cancelled"
        : rawState === "stale"
          ? "stale"
          : rawState === "unavailable"
            ? "unavailable"
            : "partial";
    return unavailable(
      terminalState,
      evidence.reason ?? `Engine evidence is ${rawState}.`,
      terminalState === "cancelled"
        ? "provider-cancelled"
        : terminalState === "stale"
          ? "stale-position"
          : "provider-unavailable",
      evidence,
    );
  }
  const state: ReplacementExpansionEvidenceState = rawState;
  const items: ReplacementExpansionEvidenceItemResult[] = [];
  const valid: {
    readonly move: LegalMove;
    readonly rank: number;
    readonly depth: number;
    readonly id: string;
    readonly itemIndex: number;
  }[] = [];
  const baseProvenance = mergeProvenance([
    ...evidence.provenance,
    strategicSource(
      "engine",
      state,
      identity.name,
      identity.version,
      evidence.evidence_id,
      evidencePosition,
      evidence.reason,
    ),
  ]);
  for (const [itemIndex, line] of evidence.lines.entries()) {
    const record = isRecord(line);
    const lineId = record && typeof line.line_id === "string" ? line.line_id : null;
    const uci = record && typeof line.uci === "string" ? line.uci : null;
    const pv =
      record && Array.isArray(line.pv) && line.pv.every((value) => typeof value === "string")
        ? (line.pv)
        : [];
    const rank = record && finiteInteger(line.multipv_rank) ? line.multipv_rank : null;
    const depth = record && finiteInteger(line.depth) ? line.depth : null;
    const cpValid =
      record && finiteInteger(line.white_pov_evaluation_cp) && line.white_pov_mate_in === null;
    const mateValid =
      record &&
      line.white_pov_evaluation_cp === null &&
      finiteInteger(line.white_pov_mate_in) &&
      line.white_pov_mate_in !== 0;
    const provenanceValid =
      record && Array.isArray(line.provenance) && line.provenance.every(validProvenance);
    const parsed = uci ? parseUci(uci) : undefined;
    const moveValid = parsed && position.isLegal(parsed);
    const canonicalPv = uci ? validatePv(position, record ? line.pv : null, uci) : null;
    let status: ReplacementExpansionItemStatus = "complete";
    let error: ReplacementExpansionItemErrorCode | null = null;
    if (
      !record ||
      !lineId ||
      !provenanceValid ||
      rank === null ||
      depth === null ||
      rank < 1 ||
      depth < 1 ||
      (!cpValid && !mateValid)
    ) {
      status = "malformed";
      error = "malformed-evidence";
    } else if (!uci || !parsed || !moveValid) {
      status = "illegal";
      error = "illegal-uci";
    } else if (!canonicalPv) {
      status = "malformed";
      error = "malformed-pv";
    } else if (depth < input.request.budget.engine_depth) {
      status = "stale";
      error = "stale-request";
    }
    let legal: LegalMove | null = null;
    if (status === "complete" && parsed && rank !== null && depth !== null && lineId !== null) {
      const after = position.clone();
      const san = makeSan(position, parsed);
      after.play(parsed);
      legal = {
        move: parsed as NormalMove,
        san,
        uci: makeUci(parsed),
        after,
        forcing: san.includes("x") || san.includes("+") || san.includes("#") || san.includes("="),
      };
      valid.push({ move: legal, rank, depth, id: lineId, itemIndex });
    }
    const whiteCp = cpValid ? (line.white_pov_evaluation_cp as number) : null;
    const whiteMate = mateValid ? (line.white_pov_mate_in as number) : null;
    const sign = input.request.repertoire_color === "white" ? 1 : -1;
    const provenance =
      record && Array.isArray(line.provenance)
        ? mergeProvenance([
            ...baseProvenance,
            ...(line.provenance as StrategicFitSourceProvenance[]),
          ])
        : baseProvenance;
    items.push(
      evidenceItem("engine", evidencePosition, {
        evidence_id: evidence.evidence_id,
        item_id: lineId,
        item_index: itemIndex,
        status,
        error_code: error,
        explanation:
          status === "complete"
            ? "Engine continuation is legal from its semantic position."
            : `Engine continuation is ${status}: ${error ?? "unknown"}.`,
        input_uci: uci,
        input_pv: [...pv],
        canonical_san: legal?.san ?? null,
        canonical_uci: legal?.uci ?? null,
        canonical_pv_san: canonicalPv ? [...canonicalPv] : [],
        forcing: legal?.forcing ?? false,
        included: false,
        white_pov_evaluation_cp: whiteCp,
        white_pov_mate_in: whiteMate,
        repertoire_pov_evaluation_cp: whiteCp === null ? null : whiteCp * sign,
        repertoire_pov_mate_in: whiteMate === null ? null : whiteMate * sign,
        engine: cloneJson(identity),
        cache: cloneJson(trace),
        provenance,
      }),
    );
  }
  const validByRank = new Map<number, typeof valid>();
  for (const line of valid)
    validByRank.set(line.rank, [...(validByRank.get(line.rank) ?? []), line]);
  const canonicalValid: typeof valid = [];
  for (const [, matches] of [...validByRank.entries()].sort(([left], [right]) => left - right)) {
    const orderedMatches = [...matches].sort(
      (left, right) =>
        right.depth - left.depth ||
        compareStrings(left.move.uci, right.move.uci) ||
        compareStrings(left.id, right.id),
    );
    const first = orderedMatches[0];
    if (!first) continue;
    canonicalValid.push(first);
    for (const duplicate of orderedMatches.slice(1)) {
      items[duplicate.itemIndex] = {
        ...assertDefined(items[duplicate.itemIndex]),
        status: "malformed",
        error_code: "malformed-evidence",
        explanation:
          "Engine evidence duplicates a MultiPV rank; only the deterministic canonical line is usable.",
        included: false,
      };
    }
  }
  const requestedValid = canonicalValid.filter(
    (line) => line.rank <= input.request.budget.engine_multipv,
  );
  const chosen =
    requestedValid.sort(
      (left, right) =>
        left.rank - right.rank ||
        right.depth - left.depth ||
        compareStrings(left.move.uci, right.move.uci) ||
        compareStrings(left.id, right.id),
    )[0] ?? null;
  const finalItems = items
    .map((item) => ({
      ...item,
      included: chosen !== null && item.item_index === chosen.itemIndex,
    }))
    .sort(
      (left, right) =>
        Number(right.included) - Number(left.included) ||
        compareStrings(
          left.canonical_uci ?? left.input_uci ?? "",
          right.canonical_uci ?? right.input_uci ?? "",
        ) ||
        compareStrings(left.item_id ?? "", right.item_id ?? "") ||
        compareStrings(left.status, right.status),
    )
    .map((item, itemIndex) => ({ ...item, item_index: itemIndex }));
  const requestedRanks = new Set(requestedValid.map((line) => line.rank));
  const reachedSufficient =
    finiteInteger(evidence.reached_depth) &&
    evidence.reached_depth >= input.request.budget.engine_depth;
  const completeRequestedRanks = requestedRanks.size === input.request.budget.engine_multipv;
  const finalState =
    state === "partial" ||
    !chosen ||
    !reachedSufficient ||
    !completeRequestedRanks ||
    finalItems.some((item) => item.status !== "complete")
      ? ("partial" as const)
      : ("available" as const);
  const source = expansionSource("engine", evidencePosition, {
    source_id: `strategic-fit:replacement-expand:engine:${evidence.evidence_id}`,
    state: finalState,
    provider: identity.name,
    version: identity.version,
    snapshot: evidence.evidence_id,
    requested_depth: input.request.budget.engine_depth,
    requested_multipv: input.request.budget.engine_multipv,
    reached_depth: evidence.reached_depth,
    accepted_item_count: finalItems.filter((item) => item.status === "complete").length,
    rejected_item_count: finalItems.filter((item) => item.status !== "complete").length,
    reason:
      evidence.reason ??
      (!chosen
        ? "No legal engine continuation was available."
        : !reachedSufficient || !completeRequestedRanks
          ? "Engine evidence did not reach requested depth and complete MultiPV rank coverage."
          : null),
    engine: cloneJson(identity),
    cache: cloneJson(trace),
    evidence: {
      ...clonedEvidence,
      lines: sortedEngineLines(clonedEvidence.lines),
    },
    provenance: baseProvenance,
  });
  const completeRanks = new Set(
    canonicalValid
      .filter(
        (line) =>
          line.depth >= input.request.budget.engine_depth &&
          line.rank <= input.request.budget.engine_multipv,
      )
      .map((line) => line.rank),
  );
  const cacheWrite =
    !cached &&
    finalState === "available" &&
    finiteInteger(evidence.reached_depth) &&
    evidence.reached_depth >= input.request.budget.engine_depth &&
    completeRanks.size === input.request.budget.engine_multipv
      ? {
          ...clonedEvidence,
          lines: sortedEngineLines(clonedEvidence.lines),
        }
      : null;
  return {
    state: finalState,
    move: chosen?.move ?? null,
    items: finalItems,
    source,
    candidateSource: expansionCandidateSource(
      "engine-multipv",
      finalState,
      identity.name,
      identity.version,
      evidence.evidence_id,
      evidencePosition,
      source.reason,
      {
        expansion: true,
        cache: trace.status,
        engine_configuration: cloneJson(identity.configuration),
        requested_depth: input.request.budget.engine_depth,
        requested_multipv: input.request.budget.engine_multipv,
        reached_depth: evidence.reached_depth,
      },
      baseProvenance,
    ),
    cacheWrite,
    providerScheduled,
  };
}

interface MutableNode {
  readonly analysis_version: string;
  readonly node_id: string;
  kind: ReplacementSubtreeNode["kind"];
  readonly position_id: string;
  readonly fen: string;
  readonly ply: number;
  readonly outgoing_edge_ids: string[];
  readonly source_san_paths: readonly (readonly string[])[];
  transposition_target_position_id: string | null;
}

interface ExpansionCounters {
  readonly sourceResults: ReplacementExpansionSourceResult[];
  readonly evidenceItems: ReplacementExpansionEvidenceItemResult[];
  readonly cacheWrites: ReplacementEngineAnalysisEvidence[];
}

function nodeId(candidateId: string, edgeIds: readonly string[]): string {
  return `replacement-node:${stableHash([candidateId, ...edgeIds].join(SEPARATOR))}`;
}

function edgeId(candidateId: string, edgeIds: readonly string[], uci: string): string {
  return `replacement-edge:${stableHash([candidateId, ...edgeIds, uci].join(SEPARATOR))}`;
}

function routeId(candidateId: string, edgeIds: readonly string[]): string {
  return `replacement-route:${stableHash([candidateId, ...edgeIds].join(SEPARATOR))}`;
}

function graphTransposition(
  byKey: ReadonlyMap<string, RepertoireGraphPosition>,
  position: ReplacementExpansionPositionEvidence,
): RepertoireGraphPosition | null {
  return byKey.get(position.position_key) ?? null;
}

function sourcePaths(seed: ReplacementEngineCandidateSeed): string[][] {
  return sortedPaths(
    seed.source_san_paths.length > 0 ? seed.source_san_paths : seed.pivot.source_san_paths,
  );
}

function subtreeValid(
  subtree: ReplacementCandidateSubtree,
  repertoireColor: "white" | "black",
): boolean {
  if (subtree.nodes.length < 2 || subtree.edges.length < 1 || subtree.routes.length < 1)
    return false;
  const nodes = new Map(subtree.nodes.map((node) => [node.node_id, node]));
  const edges = new Map(subtree.edges.map((edge) => [edge.edge_id, edge]));
  if (
    nodes.size !== subtree.nodes.length ||
    edges.size !== subtree.edges.length ||
    !nodes.has(subtree.root_node_id) ||
    nodes.get(subtree.root_node_id)?.kind !== "root" ||
    nodes.get(subtree.root_node_id)?.position_id !== subtree.root_position_id
  )
    return false;
  for (const node of subtree.nodes) {
    const chess = currentPosition(node.fen);
    if (!chess || semanticPositionId(positionKey(makeFen(chess.toSetup()))) !== node.position_id)
      return false;
    const actualOutgoing = subtree.edges
      .filter((edge) => edge.from_node_id === node.node_id)
      .map((edge) => edge.edge_id)
      .sort(compareStrings);
    if (
      new Set(node.outgoing_edge_ids).size !== node.outgoing_edge_ids.length ||
      node.outgoing_edge_ids.some((id) => edges.get(id)?.from_node_id !== node.node_id) ||
      jsonKey([...node.outgoing_edge_ids].sort(compareStrings)) !== jsonKey(actualOutgoing)
    )
      return false;
  }
  for (const edge of subtree.edges) {
    const from = nodes.get(edge.from_node_id);
    const to = nodes.get(edge.to_node_id);
    if (!from || !to) return false;
    const chess = currentPosition(from.fen);
    if (!chess) return false;
    const validated = validateMove(chess, edge.san, edge.uci);
    if (
      !validated.move ||
      positionKey(makeFen(validated.move.after.toSetup())) !== positionKey(to.fen) ||
      edge.decision_id !== decisionId(from.position_id, edge.uci, positionKey(to.fen)) ||
      to.ply !== from.ply + 1 ||
      edge.mover_color !== chess.turn ||
      edge.owner !== (chess.turn === repertoireColor ? "repertoire" : "opponent") ||
      edge.forcing !== validated.move.forcing
    )
      return false;
  }
  for (const route of subtree.routes) {
    if (
      route.node_ids.length !== route.edge_ids.length + 1 ||
      route.node_ids[0] !== subtree.root_node_id ||
      route.node_ids.at(-1) !== route.terminal_node_id ||
      route.node_ids.some((id) => !nodes.has(id)) ||
      route.edge_ids.some((id) => !edges.has(id))
    )
      return false;
    for (let index = 0; index < route.edge_ids.length; index++) {
      const routeEdgeId = route.edge_ids[index];
      const edge = routeEdgeId === undefined ? undefined : edges.get(routeEdgeId);
      if (
        !edge ||
        edge.from_node_id !== route.node_ids[index] ||
        edge.to_node_id !== route.node_ids[index + 1]
      )
        return false;
    }
  }
  if (
    subtree.covered_important_reply_count > subtree.important_reply_count ||
    subtree.covered_forcing_reply_count > subtree.forcing_reply_count
  )
    return false;
  if (subtree.status === "complete") {
    // These fields are typed as fixed/non-null for the "complete" variant because every
    // construction path sets them that way, but this function revalidates a subtree that may
    // have crossed a checkpoint/cache boundary — see the matching note earlier in this file.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (subtree.truncation_reasons.length !== 0 || subtree.completion === null) return false;
    if (
      subtree.completion.kind === "expanded-opponent-replies" &&
      subtree.completion.opponent_reply_edge_ids.length === 0
    )
      return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  else if (subtree.completion !== null || subtree.truncation_reasons.length === 0) return false;
  return true;
}

function makeNode(
  id: string,
  kind: ReplacementSubtreeNode["kind"],
  position: ReplacementExpansionPositionEvidence,
  paths: readonly (readonly string[])[],
): MutableNode {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    node_id: id,
    kind,
    position_id: position.position_id,
    fen: position.fen,
    ply: position.ply,
    outgoing_edge_ids: [],
    source_san_paths: sortedPaths(paths),
    transposition_target_position_id: null,
  };
}

function makeEdge(
  seed: ReplacementEngineCandidateSeed,
  from: MutableNode,
  to: MutableNode,
  move: LegalMove,
  id: string,
  probability: number | null,
): ReplacementSubtreeEdge {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    edge_id: id,
    from_node_id: from.node_id,
    to_node_id: to.node_id,
    decision_id: decisionId(from.position_id, move.uci, positionKey(to.fen)),
    san: move.san,
    uci: move.uci,
    mover_color: move.after.turn === "white" ? "black" : "white",
    owner: move.after.turn === seed.repertoire_color ? "opponent" : "repertoire",
    forcing: move.forcing,
    expected_opponent_frequency: probability,
    source_san_paths: sourcePaths(seed),
    annotation_text: [],
  };
}

function sortedExpansionItems(
  items: readonly ReplacementExpansionEvidenceItemResult[],
): ReplacementExpansionEvidenceItemResult[] {
  return [...items].sort(
    (left, right) =>
      left.position.ply - right.position.ply ||
      compareStrings(left.position.position_key, right.position.position_key) ||
      compareStrings(left.provider_kind, right.provider_kind) ||
      compareStrings(
        left.canonical_uci ?? left.input_uci ?? "",
        right.canonical_uci ?? right.input_uci ?? "",
      ) ||
      compareStrings(left.item_id ?? "", right.item_id ?? "") ||
      left.item_index - right.item_index,
  );
}

function sortedSources(
  sources: readonly ReplacementExpansionSourceResult[],
): ReplacementExpansionSourceResult[] {
  return [...sources].sort(
    (left, right) =>
      left.position.ply - right.position.ply ||
      compareStrings(left.position.position_key, right.position.position_key) ||
      compareStrings(left.provider_kind, right.provider_kind) ||
      compareStrings(left.source_id, right.source_id),
  );
}

function sortedOmissions(
  omissions: readonly ReplacementExpansionOmission[],
): ReplacementExpansionOmission[] {
  return [...omissions].sort(
    (left, right) =>
      compareStrings(left.position_id, right.position_id) ||
      Number(right.important) - Number(left.important) ||
      Number(right.forcing) - Number(left.forcing) ||
      (right.played_probability ?? -1) - (left.played_probability ?? -1) ||
      compareStrings(left.uci ?? "", right.uci ?? "") ||
      compareStrings(left.reason, right.reason),
  );
}

async function expandCandidate(
  input: ExpandReplacementCandidatesInput,
  seed: ReplacementEngineCandidateSeed,
  graphPositions: ReadonlyMap<string, RepertoireGraphPosition>,
  tracker: ProgressTracker,
  global: ExpansionCounters,
): Promise<ReplacementCandidateExpansion> {
  const paths = sourcePaths(seed);
  const pivotPosition = assertDefined(
    input.graph.positions.find((position) => position.position_id === seed.pivot.position_id),
  );
  const rootChess = assertDefined(currentPosition(pivotPosition.fen));
  const rootEvidence: ReplacementExpansionPositionEvidence = {
    position_id: pivotPosition.position_id,
    position_key: pivotPosition.position_key,
    fen: pivotPosition.fen,
    ply: seed.pivot.ply - 1,
  };
  const seedMove = assertDefined(validateMove(rootChess, seed.san, seed.uci).move);
  const outcomeEvidence: ReplacementExpansionPositionEvidence = {
    position_id: seed.outcome_position_id,
    position_key: seed.outcome_position_key,
    fen: seed.outcome_fen,
    ply: seed.pivot.ply,
  };
  const rootId = nodeId(seed.candidate_id, []);
  const firstEdgeId = edgeId(seed.candidate_id, [], seedMove.uci);
  const outcomeId = nodeId(seed.candidate_id, [firstEdgeId]);
  const rootNode = makeNode(rootId, "root", rootEvidence, paths);
  const nodes: MutableNode[] = [rootNode];
  const outcomeNode = makeNode(outcomeId, "repertoire-decision", outcomeEvidence, paths);
  nodes.push(outcomeNode);
  const edges: ReplacementSubtreeEdge[] = [];
  const firstEdge = makeEdge(seed, rootNode, outcomeNode, seedMove, firstEdgeId, null);
  rootNode.outgoing_edge_ids.push(firstEdgeId);
  edges.push(firstEdge);
  const routes: ReplacementSubtreeRoute[] = [];
  const queue: RouteWork[] = [
    {
      position: seedMove.after,
      positionEvidence: outcomeEvidence,
      nodeId: outcomeId,
      nodeIds: [rootId, outcomeId],
      edgeIds: [firstEdgeId],
      expectedFrequency: 1,
    },
  ];
  const items: ReplacementExpansionEvidenceItemResult[] = [];
  const sources: ReplacementExpansionSourceResult[] = [];
  const omissions: ReplacementExpansionOmission[] = [];
  const risks: ReplacementUnresolvedRisk[] = [];
  const candidateSources: ReplacementCandidateSourceProvenance[] = [...seed.provenance];
  const opponentReplyEdgeIds: string[] = [];
  const truncationReasons = new Set<string>();
  let importantReplyCount = 0;
  let coveredImportantReplyCount = 0;
  let forcingReplyCount = 0;
  let coveredForcingReplyCount = 0;
  let immediateCompletion: ReplacementCompleteCandidateSubtree["completion"] | null = null;
  let candidateStatus: ReplacementExpansionItemStatus = "complete";

  const finishRoute = (
    work: RouteWork,
    termination: ReplacementSubtreeRoute["termination"],
  ): string => {
    const id = routeId(seed.candidate_id, work.edgeIds);
    if (!routes.some((route) => route.route_id === id)) {
      routes.push({
        analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
        route_id: id,
        node_ids: [...work.nodeIds],
        edge_ids: [...work.edgeIds],
        terminal_node_id: work.nodeId,
        termination,
        expected_opponent_frequency: work.expectedFrequency,
      });
    }
    return id;
  };

  const markTruncated = (
    status: ReplacementExpansionItemStatus,
    reason: string,
    riskKind: ReplacementExpansionRiskKind,
    explanation: string,
    positionIds: readonly string[],
  ): void => {
    if (
      candidateStatus === "complete" ||
      candidateStatus === "truncated" ||
      (candidateStatus === "unresolved" && status === "budget-exhausted")
    )
      candidateStatus = status;
    truncationReasons.add(reason);
    risks.push(
      risk(
        seed.candidate_id,
        riskKind,
        explanation,
        positionIds,
        [],
        mergeProvenance([...input.request.provenance, ...seed.objective_quality.provenance]),
      ),
    );
  };

  const resolveChild = (parent: RouteWork, child: RouteWork, childNode: MutableNode): void => {
    const existing = graphTransposition(graphPositions, child.positionEvidence);
    if (existing) {
      childNode.kind = "transposition";
      childNode.transposition_target_position_id = existing.position_id;
      finishRoute(child, "existing-preparation");
      return;
    }
    if (child.position.isEnd()) {
      childNode.kind = "terminal";
      finishRoute(child, "terminal-position");
      return;
    }
    if (child.positionEvidence.ply >= input.request.budget.strategic_horizon_ply) {
      finishRoute(child, "strategic-horizon");
      return;
    }
    if (
      child.nodeIds.slice(0, -1).some((id) => {
        const node = nodes.find((candidate) => candidate.node_id === id);
        return node ? positionKey(node.fen) === child.positionEvidence.position_key : false;
      })
    ) {
      const route = finishRoute(child, "unresolved-reply");
      omissions.push(
        omission(
          seed.candidate_id,
          child.positionEvidence,
          null,
          false,
          false,
          null,
          "transposition-unresolved",
          "Generated continuation repeats inside the candidate subtree without joining existing preparation.",
          input.request.provenance,
        ),
      );
      markTruncated(
        "unresolved",
        "transposition-unresolved",
        "transposition-uncertain",
        "Internal repetition could not be joined to current preparation.",
        [child.positionEvidence.position_id],
      );
      void parent;
      void route;
      return;
    }
    queue.push(child);
  };

  const immediate = graphTransposition(graphPositions, outcomeEvidence);
  if (immediate) {
    outcomeNode.kind = "transposition";
    outcomeNode.transposition_target_position_id = immediate.position_id;
    finishRoute(assertDefined(queue.shift()), "existing-preparation");
    immediateCompletion = {
      kind: "immediate-transposition",
      target_position_id: immediate.position_id,
    };
  } else if (seedMove.after.isEnd()) {
    outcomeNode.kind = "terminal";
    finishRoute(assertDefined(queue.shift()), "terminal-position");
    immediateCompletion = { kind: "terminal-position", terminal_node_id: outcomeId };
  }

  while (queue.length > 0) {
    const work = assertDefined(queue.shift());
    tracker.visitedPositions++;
    advance(input, tracker);
    if (cancelled(input)) {
      finishRoute(work, "unresolved-reply");
      omissions.push(
        omission(
          seed.candidate_id,
          work.positionEvidence,
          null,
          false,
          false,
          null,
          "provider-cancelled",
          "Expansion cancelled before this position could be scheduled.",
          input.request.provenance,
        ),
      );
      markTruncated(
        "cancelled",
        "cancelled",
        "incomplete-expansion",
        "Cancellation stopped candidate expansion and all new provider scheduling.",
        [work.positionEvidence.position_id],
      );
      while (queue.length > 0) finishRoute(assertDefined(queue.shift()), "unresolved-reply");
      break;
    }
    if (work.positionEvidence.ply >= input.request.budget.strategic_horizon_ply) {
      finishRoute(work, "strategic-horizon");
      continue;
    }
    const parentNode = assertDefined(nodes.find((node) => node.node_id === work.nodeId));
    if (work.position.turn !== input.request.repertoire_color) {
      const allLegal = legalMoves(work.position);
      const forcingMoves = allLegal.filter((move) => move.forcing);
      forcingReplyCount += forcingMoves.length;
      let explorer: ExplorerQueryResult;
      if (
        input.explorer_provider &&
        tracker.explorerScheduled >= input.request.budget.maximum_explorer_queries
      ) {
        const explanation =
          "Explorer-query budget exhausted before common replies could be resolved.";
        const provenance = [
          strategicSource(
            "explorer",
            "partial",
            "budget",
            null,
            null,
            work.positionEvidence,
            explanation,
          ),
        ];
        explorer = {
          state: "partial",
          replies: [],
          items: [
            evidenceItem("explorer", work.positionEvidence, {
              status: "budget-exhausted",
              error_code: "explorer-query-budget-exhausted",
              explanation,
              provenance,
            }),
          ],
          source: expansionSource("explorer", work.positionEvidence, {
            state: "partial",
            provider: "budget",
            rejected_item_count: 1,
            reason: explanation,
            provenance,
          }),
          candidateSource: expansionCandidateSource(
            "opening-database",
            "partial",
            "budget",
            null,
            null,
            work.positionEvidence,
            explanation,
            { expansion: true, budget_exhausted: true },
            provenance,
          ),
        };
      } else {
        if (input.explorer_provider) tracker.explorerScheduled++;
        explorer = await queryExplorer(input, work.position, work.positionEvidence);
        advance(input, tracker);
      }
      sources.push(explorer.source);
      items.push(...explorer.items);
      global.sourceResults.push(explorer.source);
      global.evidenceItems.push(...explorer.items);
      candidateSources.push(explorer.candidateSource);
      const explorerByUci = new Map(explorer.replies.map((reply) => [reply.move.uci, reply]));
      const selected = new Map<
        string,
        {
          move: LegalMove;
          important: boolean;
          probability: number | null;
          itemIndex: number | null;
          provenance: readonly StrategicFitSourceProvenance[];
        }
      >();
      for (const reply of explorer.replies) {
        if (reply.important) importantReplyCount++;
        const include =
          reply.important ||
          (reply.move.forcing && input.request.budget.include_all_forcing_replies);
        if (include) {
          selected.set(reply.move.uci, {
            move: reply.move,
            important: reply.important,
            probability: reply.evidence.played_probability,
            itemIndex: reply.itemIndex,
            provenance: reply.evidence.provenance,
          });
        } else {
          const reason = reply.move.forcing ? "reply-policy-excluded" : "popularity-filtered";
          omissions.push(
            omission(
              seed.candidate_id,
              work.positionEvidence,
              reply.move,
              reply.important,
              reply.move.forcing,
              reply.evidence.played_probability,
              reason,
              reply.move.forcing
                ? "Forcing reply was excluded by configured reply policy."
                : "Legal reply fell below configured popularity threshold.",
              reply.evidence.provenance,
            ),
          );
        }
      }
      for (const forcingMove of forcingMoves) {
        if (input.request.budget.include_all_forcing_replies) {
          const explorerReply = explorerByUci.get(forcingMove.uci);
          selected.set(
            forcingMove.uci,
            selected.get(forcingMove.uci) ?? {
              move: forcingMove,
              important: explorerReply?.important ?? false,
              probability: explorerReply?.evidence.played_probability ?? null,
              itemIndex: explorerReply?.itemIndex ?? null,
              provenance: explorerReply?.evidence.provenance ?? explorer.source.provenance,
            },
          );
        } else if (!explorerByUci.has(forcingMove.uci)) {
          omissions.push(
            omission(
              seed.candidate_id,
              work.positionEvidence,
              forcingMove,
              false,
              true,
              null,
              "reply-policy-excluded",
              "Forcing reply was excluded by configured reply policy.",
              explorer.source.provenance,
            ),
          );
        }
      }
      if (explorer.state !== "available" && explorer.state !== "partial") {
        omissions.push(
          omission(
            seed.candidate_id,
            work.positionEvidence,
            null,
            true,
            false,
            null,
            explorer.state === "cancelled" ? "provider-cancelled" : "provider-unavailable",
            "Common replies are unknown because explorer evidence is unavailable.",
            explorer.source.provenance,
          ),
        );
        markTruncated(
          explorer.state === "cancelled" ? "cancelled" : "unavailable",
          `explorer-${explorer.state}`,
          "incomplete-expansion",
          "Important opponent-reply coverage is unresolved without current explorer evidence.",
          [work.positionEvidence.position_id],
        );
      } else if (explorer.state === "partial") {
        omissions.push(
          omission(
            seed.candidate_id,
            work.positionEvidence,
            null,
            true,
            false,
            null,
            "provider-unavailable",
            "Explorer evidence is partial, so additional common replies may be unknown.",
            explorer.source.provenance,
          ),
        );
        markTruncated(
          "truncated",
          "partial-explorer-evidence",
          "incomplete-expansion",
          "Partial explorer evidence cannot prove complete common-reply coverage.",
          [work.positionEvidence.position_id],
        );
      } else if (
        explorer.items.some(
          (item) =>
            item.status === "illegal" || item.status === "malformed" || item.status === "stale",
        )
      ) {
        markTruncated(
          "truncated",
          "invalid-explorer-evidence",
          "incomplete-expansion",
          "Invalid explorer items were retained and could not count toward coverage.",
          [work.positionEvidence.position_id],
        );
      }
      if (
        tracker.explorerScheduled >= input.request.budget.maximum_explorer_queries &&
        explorer.items.some((item) => item.error_code === "explorer-query-budget-exhausted")
      ) {
        omissions.push(
          omission(
            seed.candidate_id,
            work.positionEvidence,
            null,
            true,
            false,
            null,
            "explorer-query-budget-exhausted",
            "Explorer-query budget exhausted before common replies could be proven complete.",
            explorer.source.provenance,
          ),
        );
        markTruncated(
          "budget-exhausted",
          "explorer-query-budget-exhausted",
          "incomplete-expansion",
          "Explorer-query budget prevented complete common-reply coverage.",
          [work.positionEvidence.position_id],
        );
      }
      if (!input.request.budget.include_all_forcing_replies && forcingMoves.length > 0) {
        markTruncated(
          "unresolved",
          "forcing-reply-policy",
          "unresolved-forcing-reply",
          "Configured reply policy omitted legal forcing replies explicitly.",
          [work.positionEvidence.position_id],
        );
      }
      const orderedSelected = [...selected.values()].sort(
        (left, right) =>
          Number(right.important) - Number(left.important) ||
          Number(right.move.forcing) - Number(left.move.forcing) ||
          (right.probability ?? -1) - (left.probability ?? -1) ||
          compareStrings(left.move.uci, right.move.uci),
      );
      if (orderedSelected.length === 0) {
        const id = finishRoute(work, "unresolved-reply");
        omissions.push(
          omission(
            seed.candidate_id,
            work.positionEvidence,
            null,
            true,
            forcingMoves.length > 0,
            null,
            explorer.state === "cancelled" ? "provider-cancelled" : "provider-unavailable",
            "No covered opponent reply could be expanded from this nonterminal position.",
            explorer.source.provenance,
          ),
        );
        markTruncated(
          explorer.state === "cancelled" ? "cancelled" : "unresolved",
          "opponent-replies-unresolved",
          forcingMoves.length > 0 ? "unresolved-forcing-reply" : "incomplete-expansion",
          "Opponent-reply coverage remains unresolved.",
          [work.positionEvidence.position_id],
        );
        void id;
        continue;
      }
      for (const selectedReply of orderedSelected) {
        if (nodes.length >= input.request.budget.maximum_subtree_nodes_per_candidate) {
          omissions.push(
            omission(
              seed.candidate_id,
              work.positionEvidence,
              selectedReply.move,
              selectedReply.important,
              selectedReply.move.forcing,
              selectedReply.probability,
              "subtree-node-budget-exhausted",
              "Subtree-node budget omitted this required reply.",
              selectedReply.provenance,
            ),
          );
          markTruncated(
            "budget-exhausted",
            "subtree-node-budget-exhausted",
            selectedReply.move.forcing ? "unresolved-forcing-reply" : "incomplete-expansion",
            "Subtree-node budget prevented full reply expansion.",
            [work.positionEvidence.position_id],
          );
          continue;
        }
        const id = edgeId(seed.candidate_id, work.edgeIds, selectedReply.move.uci);
        const childEvidence = positionEvidence(
          selectedReply.move.after,
          work.positionEvidence.ply + 1,
        );
        const childId = nodeId(seed.candidate_id, [...work.edgeIds, id]);
        const childNode = makeNode(childId, "opponent-reply", childEvidence, paths);
        nodes.push(childNode);
        const edge = makeEdge(
          seed,
          parentNode,
          childNode,
          selectedReply.move,
          id,
          selectedReply.probability,
        );
        parentNode.outgoing_edge_ids.push(id);
        edges.push(edge);
        opponentReplyEdgeIds.push(id);
        if (selectedReply.important) coveredImportantReplyCount++;
        if (selectedReply.move.forcing) coveredForcingReplyCount++;
        if (selectedReply.itemIndex !== null) {
          const index = items.findIndex(
            (item) =>
              item.provider_kind === "explorer" &&
              item.position.position_key === work.positionEvidence.position_key &&
              item.item_index === selectedReply.itemIndex,
          );
          if (index >= 0) items[index] = { ...assertDefined(items[index]), included: true };
        }
        const frequency =
          work.expectedFrequency === null || selectedReply.probability === null
            ? null
            : work.expectedFrequency * selectedReply.probability;
        resolveChild(
          work,
          {
            position: selectedReply.move.after,
            positionEvidence: childEvidence,
            nodeId: childId,
            nodeIds: [...work.nodeIds, childId],
            edgeIds: [...work.edgeIds, id],
            expectedFrequency: frequency,
          },
          childNode,
        );
      }
      if (parentNode.outgoing_edge_ids.length === 0) finishRoute(work, "budget-exhausted");
    } else {
      const engine = await queryEngine(
        input,
        work.position,
        work.positionEvidence,
        tracker.engineScheduled < input.request.budget.maximum_engine_positions,
      );
      if (engine.providerScheduled) tracker.engineScheduled++;
      advance(input, tracker);
      sources.push(engine.source);
      items.push(...engine.items);
      global.sourceResults.push(engine.source);
      global.evidenceItems.push(...engine.items);
      candidateSources.push(engine.candidateSource);
      if (engine.cacheWrite) {
        global.cacheWrites.push(engine.cacheWrite);
      }
      if (engine.state === "partial" && engine.move) {
        markTruncated(
          "truncated",
          "partial-engine-evidence",
          "engine-unverified",
          "Partial engine evidence supplied a legal continuation but not complete requested verification.",
          [work.positionEvidence.position_id],
        );
      }
      if (!engine.move) {
        const engineBudgetExhausted = engine.items.some(
          (item) => item.error_code === "engine-position-budget-exhausted",
        );
        const termination = engineBudgetExhausted ? "budget-exhausted" : "unresolved-reply";
        finishRoute(work, termination);
        const reason: ReplacementExpansionOmissionReason = engineBudgetExhausted
          ? "engine-position-budget-exhausted"
          : engine.state === "cancelled"
            ? "provider-cancelled"
            : engine.state === "unavailable"
              ? "provider-unavailable"
              : engine.state === "stale"
                ? "malformed-evidence"
                : "no-legal-continuation";
        omissions.push(
          omission(
            seed.candidate_id,
            work.positionEvidence,
            null,
            false,
            false,
            null,
            reason,
            "No current legal engine continuation was available.",
            engine.source.provenance,
          ),
        );
        markTruncated(
          engineBudgetExhausted
            ? "budget-exhausted"
            : engine.state === "cancelled"
              ? "cancelled"
              : engine.state === "unavailable"
                ? "unavailable"
                : "unresolved",
          `engine-${engine.state}`,
          "engine-unverified",
          "Repertoire continuation remains unverified by current legal engine evidence.",
          [work.positionEvidence.position_id],
        );
        continue;
      }
      if (nodes.length >= input.request.budget.maximum_subtree_nodes_per_candidate) {
        finishRoute(work, "budget-exhausted");
        omissions.push(
          omission(
            seed.candidate_id,
            work.positionEvidence,
            engine.move,
            false,
            engine.move.forcing,
            null,
            "subtree-node-budget-exhausted",
            "Subtree-node budget omitted legal engine continuation.",
            engine.source.provenance,
          ),
        );
        markTruncated(
          "budget-exhausted",
          "subtree-node-budget-exhausted",
          "incomplete-expansion",
          "Subtree-node budget prevented continuation to strategic horizon.",
          [work.positionEvidence.position_id],
        );
        continue;
      }
      const id = edgeId(seed.candidate_id, work.edgeIds, engine.move.uci);
      const childEvidence = positionEvidence(engine.move.after, work.positionEvidence.ply + 1);
      const childId = nodeId(seed.candidate_id, [...work.edgeIds, id]);
      const childNode = makeNode(childId, "repertoire-decision", childEvidence, paths);
      nodes.push(childNode);
      const edge = makeEdge(seed, parentNode, childNode, engine.move, id, null);
      parentNode.outgoing_edge_ids.push(id);
      edges.push(edge);
      resolveChild(
        work,
        {
          position: engine.move.after,
          positionEvidence: childEvidence,
          nodeId: childId,
          nodeIds: [...work.nodeIds, childId],
          edgeIds: [...work.edgeIds, id],
          expectedFrequency: work.expectedFrequency,
        },
        childNode,
      );
    }
  }

  const finalNodes = nodes
    .map(
      (node): ReplacementSubtreeNode => ({
        analysis_version: node.analysis_version,
        node_id: node.node_id,
        kind: node.kind,
        position_id: node.position_id,
        fen: node.fen,
        ply: node.ply,
        outgoing_edge_ids: sortedUnique(node.outgoing_edge_ids),
        source_san_paths: sortedPaths(node.source_san_paths),
        transposition_target_position_id: node.transposition_target_position_id,
      }),
    )
    .sort((left, right) => left.ply - right.ply || compareStrings(left.node_id, right.node_id));
  const finalEdges = [...edges].sort(
    (left, right) =>
      assertDefined(nodes.find((node) => node.node_id === left.from_node_id)).ply -
        assertDefined(nodes.find((node) => node.node_id === right.from_node_id)).ply ||
      compareStrings(left.from_node_id, right.from_node_id) ||
      compareStrings(left.uci, right.uci),
  );
  const finalRoutes = [...routes].sort(
    (left, right) =>
      compareStrings(left.edge_ids.join(SEPARATOR), right.edge_ids.join(SEPARATOR)) ||
      compareStrings(left.route_id, right.route_id),
  );
  const finalRisks = [...new Map(risks.map((item) => [item.risk_id, item])).values()].sort(
    (left, right) => compareStrings(left.risk_id, right.risk_id),
  );
  const finalOmissions = sortedOmissions(omissions);
  // TS proves candidateStatus is always "complete" by this point given the closure's actual call
  // sites and control flow, but the check documents the real completion contract and stays in
  // case that control flow changes.
  const complete =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    candidateStatus === "complete" &&
    truncationReasons.size === 0 &&
    coveredImportantReplyCount === importantReplyCount &&
    coveredForcingReplyCount === forcingReplyCount &&
    finalRoutes.length > 0 &&
    finalRoutes.every(
      (route) =>
        route.termination === "strategic-horizon" ||
        route.termination === "existing-preparation" ||
        route.termination === "terminal-position",
    ) &&
    (immediateCompletion !== null || opponentReplyEdgeIds.length > 0);
  const subtreeBase = {
    ...versioned(),
    subtree_id: `replacement-subtree:${stableHash(
      [seed.candidate_id, ...finalEdges.map((edge) => edge.edge_id)].join(SEPARATOR),
    )}`,
    root_position_id: rootEvidence.position_id,
    root_node_id: rootId,
    nodes: finalNodes as [
      ReplacementSubtreeNode,
      ReplacementSubtreeNode,
      ...ReplacementSubtreeNode[],
    ],
    edges: finalEdges as [ReplacementSubtreeEdge, ...ReplacementSubtreeEdge[]],
    routes: finalRoutes as [ReplacementSubtreeRoute, ...ReplacementSubtreeRoute[]],
    strategic_horizon_ply: input.request.budget.strategic_horizon_ply,
    important_reply_count: importantReplyCount,
    covered_important_reply_count: coveredImportantReplyCount,
    forcing_reply_count: forcingReplyCount,
    covered_forcing_reply_count: coveredForcingReplyCount,
    unresolved_risk_ids: finalRisks.map((item) => item.risk_id),
    provenance: mergeCandidateProvenance(candidateSources),
  };
  let subtree: ReplacementCandidateSubtree;
  if (complete) {
    const completion = immediateCompletion ?? {
      kind: "expanded-opponent-replies" as const,
      opponent_reply_edge_ids: sortedUnique(opponentReplyEdgeIds) as [string, ...string[]],
      comparable_strategic_horizon_reached: true as const,
    };
    subtree = { ...subtreeBase, status: "complete", completion, truncation_reasons: [] };
  } else {
    const reasons = [...truncationReasons].sort(compareStrings);
    if (reasons.length === 0) reasons.push("strategic-horizon-unresolved");
    subtree = {
      ...subtreeBase,
      status: "truncated",
      completion: null,
      truncation_reasons: reasons as [string, ...string[]],
    };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- see the note above `complete`
    if (candidateStatus === "complete") candidateStatus = "truncated";
  }
  if (!subtreeValid(subtree, seed.repertoire_color)) {
    return {
      ...versioned(),
      candidate_id: seed.candidate_id,
      rank: seed.rank,
      seed: cloneJson(seed),
      status: "malformed",
      subtree: null,
      evidence_item_results: sortedExpansionItems(items),
      source_results: sortedSources(sources),
      omissions: finalOmissions,
      unresolved_risks: [
        ...finalRisks,
        risk(
          seed.candidate_id,
          "incomplete-expansion",
          "Constructed subtree failed runtime invariants and was withheld.",
          finalNodes.map((node) => node.position_id),
          finalRoutes.map((route) => route.route_id),
          input.request.provenance,
          true,
        ),
      ],
    };
  }
  const common = {
    ...versioned(),
    candidate_id: seed.candidate_id,
    rank: seed.rank,
    seed: cloneJson(seed),
    subtree,
    evidence_item_results: sortedExpansionItems(items),
    source_results: sortedSources(sources),
    omissions: finalOmissions,
    unresolved_risks: finalRisks,
  };
  if (subtree.status === "complete") return { ...common, status: "complete", subtree };
  return {
    ...common,
    status: candidateStatus === "complete" ? "truncated" : candidateStatus,
    subtree,
  };
}

/**
 * Expand only current Task 8.4 engine-enriched seeds into bounded coverage-aware subtrees.
 * Every provider failure, malformed item, stale identity, budget stop, and cancellation is data.
 */
export async function expandReplacementCandidates(
  input: ExpandReplacementCandidatesInput,
): Promise<ReplacementCandidateExpansionResult> {
  try {
    const compatibility = compatibilityError(input);
    if (compatibility)
      return failureResult(input, compatibility[0], compatibility[1], compatibility[2]);
    if (input.engine_generation.status === "cancelled" || cancelled(input)) {
      const tracker: ProgressTracker = {
        completedUnits: 0,
        completedCandidates: 0,
        visitedPositions: 0,
        engineScheduled: input.engine_generation.engine_positions_scheduled,
        explorerScheduled: 0,
        totalCandidates: input.engine_generation.candidates.length,
        totalUnits: Math.max(1, input.engine_generation.candidates.length),
      };
      emitProgress(input, tracker, "cancelled");
      return failureResult(
        input,
        "cancelled",
        null,
        "Expansion cancelled before scheduling; current Task 8.4 evidence remains inspectable.",
      );
    }
    if (
      input.engine_generation.engine_positions_scheduled >
      input.request.budget.maximum_engine_positions
    ) {
      return failureResult(
        input,
        "stale",
        "engine-generation-mismatch",
        "Task 8.4 already exceeds current global engine-position budget.",
      );
    }
    const seeds = [...input.engine_generation.candidates]
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          compareStrings(left.outcome_position_key, right.outcome_position_key) ||
          compareStrings(left.uci, right.uci) ||
          compareStrings(left.candidate_id, right.candidate_id),
      )
      .slice(0, input.request.budget.maximum_candidates);
    const tracker: ProgressTracker = {
      completedUnits: 0,
      completedCandidates: 0,
      visitedPositions: 0,
      engineScheduled: input.engine_generation.engine_positions_scheduled,
      explorerScheduled: 0,
      totalCandidates: seeds.length,
      totalUnits: Math.max(
        1,
        seeds.length * input.request.budget.maximum_subtree_nodes_per_candidate +
          input.request.budget.maximum_engine_positions +
          input.request.budget.maximum_explorer_queries,
      ),
    };
    emitProgress(input, tracker, "running");
    const graphPositions = new Map(
      input.graph.positions.map((position) => [position.position_key, position]),
    );
    const global: ExpansionCounters = { sourceResults: [], evidenceItems: [], cacheWrites: [] };
    const candidates: ReplacementCandidateExpansion[] = [];
    for (const seed of seeds) {
      if (cancelled(input)) break;
      candidates.push(await expandCandidate(input, seed, graphPositions, tracker, global));
      tracker.completedCandidates++;
      advance(input, tracker);
      if (cancelled(input)) break;
    }
    const wasCancelled =
      cancelled(input) || candidates.some((candidate) => candidate.status === "cancelled");
    emitProgress(input, tracker, wasCancelled ? "cancelled" : "completed");
    const sources = sortedSources(candidates.flatMap((candidate) => candidate.source_results));
    const evidenceItems = sortedExpansionItems(
      candidates.flatMap((candidate) => candidate.evidence_item_results),
    );
    const omissions = sortedOmissions(candidates.flatMap((candidate) => candidate.omissions));
    const unresolvedRisks = [
      ...new Map(
        candidates
          .flatMap((candidate) => candidate.unresolved_risks)
          .map((item) => [item.risk_id, item]),
      ).values(),
    ].sort((left, right) => compareStrings(left.risk_id, right.risk_id));
    const cacheWrites = [
      ...new Map(global.cacheWrites.map((entry) => [entry.evidence_id, entry])).values(),
    ].sort((left, right) => compareStrings(left.evidence_id, right.evidence_id));
    const candidateBudgetExcluded =
      input.engine_generation.discovered_candidate_count > seeds.length;
    const allComplete =
      !candidateBudgetExcluded &&
      candidates.length === seeds.length &&
      candidates.every((candidate) => candidate.status === "complete");
    const allUnavailable =
      candidates.length > 0 && candidates.every((candidate) => candidate.status === "unavailable");
    const status: ReplacementExpansionResultStatus = wasCancelled
      ? "cancelled"
      : allComplete
        ? "complete"
        : allUnavailable
          ? "unavailable"
          : "partial";
    const provenance = mergeProvenance([
      ...input.request.provenance,
      ...input.pivot_result.provenance,
      ...input.candidate_generation.provenance,
      ...input.engine_generation.provenance,
      ...sources.flatMap((source) => source.provenance),
      {
        source_id: "strategic-fit:replacement-expand",
        kind: "deterministic-core",
        state: status === "complete" ? "available" : "partial",
        version: STRATEGIC_FIT_ANALYSIS_VERSION,
        snapshot: input.request.repertoire_revision,
        reason:
          status === "complete"
            ? null
            : "Expansion retains explicit provider, budget, cancellation, legality, and coverage limitations.",
      },
    ]);
    return {
      ...resultBase(input),
      status,
      error_code: null,
      explanation:
        status === "complete"
          ? "All current viable Task 8.4 seeds expanded into bounded legal coverage-aware subtrees."
          : status === "cancelled"
            ? "Expansion cancelled; completed evidence and explicit incomplete subtrees were retained."
            : status === "unavailable"
              ? "Providers were unavailable; usable seed and partial subtree evidence was retained explicitly."
              : "Expansion retained explicit truncation, budget, malformed, unavailable, or unresolved results.",
      discovered_candidate_count: input.engine_generation.discovered_candidate_count,
      expanded_candidate_count: candidates.filter((candidate) => candidate.status === "complete")
        .length,
      engine_positions_scheduled: tracker.engineScheduled,
      explorer_queries_scheduled: tracker.explorerScheduled,
      visited_position_count: tracker.visitedPositions,
      candidates,
      source_results: sources,
      evidence_item_results: evidenceItems,
      omissions,
      unresolved_risks: unresolvedRisks,
      engine_cache_writes: cacheWrites,
      provenance,
    };
  } catch {
    return failureResult(
      input,
      "invalid-request",
      "engine-generation-mismatch",
      "Expansion input or injected evidence was malformed and could not be inspected safely.",
    );
  }
}
