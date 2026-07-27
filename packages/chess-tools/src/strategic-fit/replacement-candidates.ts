/**
 * Deterministic Replacement Lab candidate-seed generation.
 *
 * This domain consumes a validated Task 8.2 pivot, the canonical repertoire graph, and optional
 * host-injected opening-database evidence. It performs no network work. Results are seeds for Task
 * 8.5 expansion, never full ReplacementCandidate proposals: the mandatory full-subtree contract in
 * replacement-types.ts remains the only finished-candidate shape.
 */
import { Chess } from "chessops/chess";
import { makeFen, parseFen } from "chessops/fen";
import { makeSan, parseSan } from "chessops/san";
import { makeUci, parseUci } from "chessops/util";

import { positionKey, type Color } from "../congruence.js";
import type { ExplorerDb, NormalizedExplorerFilters } from "../explorer.js";
import { enumerateLegal } from "../pgn.js";
import type {
  RepertoireGraph,
  RepertoireGraphDecision,
  RepertoireGraphPosition,
} from "./graph.js";
import type { ReplacementPivotSelectionResult } from "./replacement-pivot.js";
import {
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  type ReplacementActionablePivotEvidence,
  type ReplacementCandidateSourceKind,
  type ReplacementCandidateSourceProvenance,
  type ReplacementCandidateSourceStatus,
  type ReplacementRequest,
  type StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import type { JsonValue, StrategicFitSourceProvenance } from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const REPLACEMENT_DATABASE_EVIDENCE_STATES = [
  "available",
  "partial",
  "missing",
  "offline",
  "unavailable",
  "stale",
  "rejected",
] as const;
export type ReplacementDatabaseEvidenceState =
  (typeof REPLACEMENT_DATABASE_EVIDENCE_STATES)[number];

export const REPLACEMENT_CANDIDATE_SEED_STATUSES = [
  "ready-for-expansion",
  "partial-generation",
] as const;
export type ReplacementCandidateSeedStatus =
  (typeof REPLACEMENT_CANDIDATE_SEED_STATUSES)[number];

export const REPLACEMENT_CANDIDATE_MEMORY_CLASSES = ["low", "unknown"] as const;
export type ReplacementCandidateMemoryClass =
  (typeof REPLACEMENT_CANDIDATE_MEMORY_CLASSES)[number];

export const REPLACEMENT_DATABASE_ITEM_RESULT_STATUSES = [
  "accepted",
  "illegal",
  "stale",
  "rejected",
  "budget-excluded",
] as const;
export type ReplacementDatabaseItemResultStatus =
  (typeof REPLACEMENT_DATABASE_ITEM_RESULT_STATUSES)[number];

export const REPLACEMENT_DATABASE_ITEM_ERROR_CODES = [
  "illegal-san",
  "illegal-uci",
  "san-uci-mismatch",
  "stale-pivot-position",
  "stale-source",
  "source-unavailable",
  "source-rejected",
  "source-not-requested",
  "database-filter-mismatch",
  "original-pivot-move",
  "maximum-candidates-exceeded",
] as const;
export type ReplacementDatabaseItemErrorCode =
  (typeof REPLACEMENT_DATABASE_ITEM_ERROR_CODES)[number];

export const REPLACEMENT_CANDIDATE_GENERATION_STATUSES = [
  "complete",
  "partial",
  "non-actionable",
  "stale",
  "invalid-request",
] as const;
export type ReplacementCandidateGenerationStatus =
  (typeof REPLACEMENT_CANDIDATE_GENERATION_STATUSES)[number];

export const REPLACEMENT_CANDIDATE_GENERATION_ERROR_CODES = [
  "pivot-not-selected",
  "request-pivot-mismatch",
  "repertoire-color-mismatch",
  "pivot-position-stale",
  "pivot-decision-stale",
  "invalid-maximum-candidates",
] as const;
export type ReplacementCandidateGenerationErrorCode =
  (typeof REPLACEMENT_CANDIDATE_GENERATION_ERROR_CODES)[number];

export interface ReplacementOpeningDatabasePositionEvidence {
  readonly position_id: string;
  readonly position_key: string;
  readonly fen: string;
}

/** Population evidence remains White-POV, matching the explorer transport. */
export interface ReplacementOpeningDatabasePopularity {
  readonly games: number;
  readonly played_pct: number;
  readonly white_pct: number;
  readonly draw_pct: number;
  readonly black_pct: number;
  readonly average_rating: number | null;
}

export interface ReplacementOpeningDatabaseMoveEvidence {
  readonly move_id: string;
  readonly san: string;
  readonly uci: string;
  readonly popularity: ReplacementOpeningDatabasePopularity;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

/** Completed host evidence. Hosts may fetch it; this module only validates and consumes it. */
export interface ReplacementOpeningDatabaseEvidence extends StrategicFitReplacementVersioned {
  readonly evidence_id: string;
  readonly state: ReplacementDatabaseEvidenceState;
  readonly database: ExplorerDb;
  readonly provider: string;
  readonly version: string | null;
  readonly snapshot: string | null;
  readonly filter_key: string;
  readonly filters: NormalizedExplorerFilters;
  readonly position: ReplacementOpeningDatabasePositionEvidence;
  readonly moves: readonly ReplacementOpeningDatabaseMoveEvidence[];
  readonly reason: string | null;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementCandidateSeedExpansion extends StrategicFitReplacementVersioned {
  readonly status: "full-subtree-required";
  readonly full_subtree_required: true;
  readonly required_contract: "ReplacementCandidateSubtree";
  readonly reason: string;
}

export interface ReplacementCandidateSeed extends StrategicFitReplacementVersioned {
  readonly candidate_id: string;
  readonly rank: number;
  readonly status: ReplacementCandidateSeedStatus;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly pivot: ReplacementActionablePivotEvidence;
  readonly san: string;
  readonly uci: string;
  readonly mover_color: Color;
  readonly outcome_position_id: string;
  readonly outcome_position_key: string;
  readonly outcome_fen: string;
  readonly existing_preparation: boolean;
  readonly memory_class: ReplacementCandidateMemoryClass;
  readonly rank_hint:
    | "low-memory-existing-preparation"
    | "database-popularity"
    | "engine-objective-quality";
  readonly maximum_database_popularity: number | null;
  readonly source_kinds: readonly ReplacementCandidateSourceKind[];
  /** Navigation only; candidate identity is pivot plus semantic outcome. */
  readonly source_san_paths: readonly (readonly string[])[];
  readonly database_evidence_ids: readonly string[];
  readonly provenance: readonly ReplacementCandidateSourceProvenance[];
  readonly expansion: ReplacementCandidateSeedExpansion;
}

export interface ReplacementOpeningDatabaseItemResult extends StrategicFitReplacementVersioned {
  readonly evidence_id: string;
  readonly move_id: string;
  readonly item_index: number;
  readonly evidence_state: ReplacementDatabaseEvidenceState;
  readonly status: ReplacementDatabaseItemResultStatus;
  readonly error_code: ReplacementDatabaseItemErrorCode | null;
  readonly explanation: string;
  readonly candidate_id: string | null;
  readonly database: ExplorerDb;
  readonly provider: string;
  readonly database_version: string | null;
  readonly snapshot: string | null;
  readonly filter_key: string;
  readonly filters: NormalizedExplorerFilters;
  readonly position: ReplacementOpeningDatabasePositionEvidence;
  readonly input_san: string;
  readonly input_uci: string;
  readonly canonical_san: string | null;
  readonly canonical_uci: string | null;
  readonly outcome_position_id: string | null;
  readonly outcome_position_key: string | null;
  readonly outcome_fen: string | null;
  readonly popularity: ReplacementOpeningDatabasePopularity;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementCandidateGenerationSourceResult
  extends StrategicFitReplacementVersioned {
  readonly source_id: string;
  readonly kind: "existing-repertoire-transposition" | "move-order-shortcut" | "opening-database";
  readonly status: ReplacementCandidateSourceStatus;
  readonly evidence_state: ReplacementDatabaseEvidenceState | null;
  readonly accepted_item_count: number;
  readonly rejected_item_count: number;
  readonly reason: string | null;
  readonly provenance: readonly ReplacementCandidateSourceProvenance[];
}

export interface GenerateReplacementCandidatesInput {
  readonly request: ReplacementRequest;
  readonly graph: RepertoireGraph;
  readonly pivot_result: ReplacementPivotSelectionResult;
  readonly database_evidence?: readonly ReplacementOpeningDatabaseEvidence[];
}

export interface ReplacementCandidateGenerationResult extends StrategicFitReplacementVersioned {
  readonly status: ReplacementCandidateGenerationStatus;
  readonly error_code: ReplacementCandidateGenerationErrorCode | null;
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
  readonly discovered_candidate_count: number;
  readonly candidates: readonly ReplacementCandidateSeed[];
  readonly database_item_results: readonly ReplacementOpeningDatabaseItemResult[];
  readonly source_results: readonly ReplacementCandidateGenerationSourceResult[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
  readonly source_repertoire_unchanged: true;
  readonly source_graph_unchanged: true;
  readonly pivot_result_unchanged: true;
  readonly database_evidence_unchanged: true;
}

interface RawCandidate {
  readonly san: string;
  readonly uci: string;
  readonly outcomePositionId: string;
  readonly outcomePositionKey: string;
  readonly outcomeFen: string;
  readonly existingPreparation: boolean;
  readonly memoryClass: ReplacementCandidateMemoryClass;
  readonly sourcePaths: readonly (readonly string[])[];
  readonly sources: readonly ReplacementCandidateSourceProvenance[];
  readonly databaseEvidenceIds: readonly string[];
  readonly popularity: number | null;
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

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function sortedPaths(paths: readonly (readonly string[])[]): string[][] {
  const unique = new Map<string, string[]>();
  for (const path of paths) unique.set(path.join(SEPARATOR), [...path]);
  return [...unique.values()].sort((left, right) =>
    compareStrings(left.join(SEPARATOR), right.join(SEPARATOR)) || left.length - right.length
  );
}

function cloneFilters(filters: NormalizedExplorerFilters): NormalizedExplorerFilters {
  return {
    db: filters.db,
    speeds: [...filters.speeds],
    ratings: [...filters.ratings],
    since: filters.since,
    until: filters.until,
    movesLimit: filters.movesLimit,
  };
}

function clonePosition(
  position: ReplacementOpeningDatabasePositionEvidence,
): ReplacementOpeningDatabasePositionEvidence {
  return { ...position };
}

function clonePopularity(
  popularity: ReplacementOpeningDatabasePopularity,
): ReplacementOpeningDatabasePopularity {
  return { ...popularity };
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

function mergeStrategicProvenance(
  sources: readonly StrategicFitSourceProvenance[],
): StrategicFitSourceProvenance[] {
  const unique = new Map<string, StrategicFitSourceProvenance>();
  for (const source of sources) unique.set(provenanceKey(source), { ...source });
  return [...unique.values()].sort((left, right) =>
    compareStrings(provenanceKey(left), provenanceKey(right))
  );
}

function jsonKey(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jsonKey).join(",")}]`;
  const record = value as Readonly<Record<string, JsonValue>>;
  return `{${Object.keys(record).sort(compareStrings).map((key) =>
    `${JSON.stringify(key)}:${jsonKey(record[key]!)}`
  ).join(",")}}`;
}

function candidateSourceKey(source: ReplacementCandidateSourceProvenance): string {
  return [
    source.source_id,
    source.kind,
    source.status,
    source.provider ?? "",
    source.version ?? "",
    source.snapshot ?? "",
    source.reason ?? "",
  ].join(SEPARATOR);
}

function mergeCandidateSources(
  sources: readonly ReplacementCandidateSourceProvenance[],
): ReplacementCandidateSourceProvenance[] {
  const grouped = new Map<string, ReplacementCandidateSourceProvenance[]>();
  for (const source of sources) {
    const key = candidateSourceKey(source);
    grouped.set(key, [...(grouped.get(key) ?? []), source]);
  }
  return [...grouped.entries()].sort(([left], [right]) => compareStrings(left, right))
    .map(([, matches]) => {
      const first = matches[0]!;
      const detailValues = new Map<string, Readonly<Record<string, JsonValue>>>();
      for (const match of matches) detailValues.set(jsonKey(match.details), match.details);
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
          merged_evidence: [...detailValues.entries()].sort(([left], [right]) =>
            compareStrings(left, right)
          ).map(([, details]) => details),
        },
        provenance: mergeStrategicProvenance(matches.flatMap((source) => source.provenance)),
      };
    });
}

function sourceStatus(state: ReplacementDatabaseEvidenceState): ReplacementCandidateSourceStatus {
  if (state === "available") return "available";
  if (state === "partial") return "partial";
  if (state === "stale") return "stale";
  if (state === "rejected") return "rejected";
  return "unavailable";
}

function generationProvenance(input: GenerateReplacementCandidatesInput): StrategicFitSourceProvenance[] {
  return mergeStrategicProvenance([
    ...input.request.provenance,
    ...input.pivot_result.provenance,
    ...(input.database_evidence ?? []).flatMap((evidence) => [
      ...evidence.provenance,
      ...evidence.moves.flatMap((move) => move.provenance),
    ]),
    {
      source_id: "strategic-fit:replacement-candidates",
      kind: "deterministic-core",
      state: "available",
      version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
      snapshot: input.request.repertoire_revision,
      reason: "Framework-free candidate seeds generated without network access.",
    },
  ]);
}

function resultBase(
  input: GenerateReplacementCandidatesInput,
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
    provenance,
    source_repertoire_unchanged: true as const,
    source_graph_unchanged: true as const,
    pivot_result_unchanged: true as const,
    database_evidence_unchanged: true as const,
  };
}

function failureResult(
  input: GenerateReplacementCandidatesInput,
  status: "non-actionable" | "stale" | "invalid-request",
  errorCode: ReplacementCandidateGenerationErrorCode,
  explanation: string,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementCandidateGenerationResult {
  return {
    ...resultBase(input, provenance),
    status,
    error_code: errorCode,
    explanation,
    pivot_id: input.pivot_result.status === "selected" ? input.pivot_result.pivot.pivot_id : null,
    discovered_candidate_count: 0,
    candidates: [],
    database_item_results: [],
    source_results: [],
  };
}

function pivotCompatibilityError(
  input: GenerateReplacementCandidatesInput,
): readonly ["non-actionable" | "stale" | "invalid-request", ReplacementCandidateGenerationErrorCode, string] | null {
  const { request, graph, pivot_result: result } = input;
  if (!Number.isSafeInteger(request.budget.maximum_candidates) || request.budget.maximum_candidates < 0) {
    return ["invalid-request", "invalid-maximum-candidates", "Maximum candidate budget must be a non-negative safe integer."];
  }
  if (result.status !== "selected" || result.pivot.status !== "actionable") {
    return ["non-actionable", "pivot-not-selected", "Candidate generation requires one validated actionable Task 8.2 pivot."];
  }
  if (
    result.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    result.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    result.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION ||
    result.pivot.schema_version !== STRATEGIC_FIT_SCHEMA_VERSION ||
    result.pivot.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    result.pivot.replacement_schema_version !== STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION ||
    result.request_id !== request.request_id ||
    result.report_id !== request.report_id ||
    result.finding_id !== request.finding_id ||
    result.semantic_finding_id !== request.semantic_finding_id ||
    result.cohort_id !== request.cohort_id ||
    result.repertoire_revision !== request.repertoire_revision ||
    result.repertoire_color !== request.repertoire_color ||
    result.selection_kind !== request.pivot_selection.kind ||
    result.pivot.repertoire_color !== request.repertoire_color ||
    result.pivot.owner !== "repertoire"
  ) {
    return ["stale", "request-pivot-mismatch", "Validated pivot result does not match the current replacement request identity."];
  }
  if (graph.repertoire_color !== request.repertoire_color) {
    return ["stale", "repertoire-color-mismatch", "Current repertoire graph color does not match the replacement request."];
  }
  const position = graph.positions.find((candidate) =>
    candidate.position_id === result.pivot.position_id
  );
  let positionIsCurrent = position !== undefined && position.turn === request.repertoire_color;
  if (positionIsCurrent && position) {
    try {
      const parsed = Chess.fromSetup(parseFen(position.fen).unwrap()).unwrap();
      positionIsCurrent = parsed.turn === position.turn &&
        positionKey(makeFen(parsed.toSetup())) === position.position_key &&
        semanticPositionId(position.position_key) === position.position_id;
    } catch {
      positionIsCurrent = false;
    }
  }
  if (!positionIsCurrent) {
    return ["stale", "pivot-position-stale", "Validated pivot position is unavailable or no longer owned by the repertoire player."];
  }
  const decision = graph.decisions.find((candidate) =>
    candidate.decision_id === result.pivot.decision_id
  );
  if (
    !decision ||
    decision.from_position_id !== result.pivot.position_id ||
    decision.to_position_id === result.pivot.position_id ||
    decision.san !== result.pivot.san ||
    decision.uci !== result.pivot.uci ||
    decision.owner !== "repertoire" ||
    decision.mover_color !== request.repertoire_color
  ) {
    return ["stale", "pivot-decision-stale", "Validated pivot decision no longer matches the current semantic graph."];
  }
  return null;
}

function localSource(
  kind: "existing-repertoire-transposition" | "move-order-shortcut",
  request: ReplacementRequest,
  pivot: ReplacementActionablePivotEvidence,
  target: RepertoireGraphPosition,
  decision: RepertoireGraphDecision | undefined,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementCandidateSourceProvenance {
  return {
    ...versioned(),
    source_id: `strategic-fit:local-preparation:${kind}:${target.position_id}`,
    kind,
    status: "available",
    provider: "local-repertoire-graph",
    version: STRATEGIC_FIT_ANALYSIS_VERSION,
    snapshot: request.repertoire_revision,
    reason: kind === "move-order-shortcut"
      ? "Legal move reaches a prepared semantic position through a new move order."
      : "Legal alternative is already represented in current repertoire preparation.",
    position_ids: sortedUnique([pivot.position_id, target.position_id]),
    decision_ids: sortedUnique([
      ...(decision ? [decision.decision_id] : []),
      ...target.incoming_decision_ids,
    ]),
    route_ids: sortedUnique(target.route_ids),
    details: {
      memory_class: "low",
      outcome_position_key: target.position_key,
      incoming_move_order_ids: [...target.incoming_move_order_ids],
      source_san_paths: sortedPaths(target.source_san_paths),
    },
    provenance: mergeStrategicProvenance(provenance),
  };
}

function discoverLocalCandidates(
  request: ReplacementRequest,
  graph: RepertoireGraph,
  pivot: ReplacementActionablePivotEvidence,
  position: RepertoireGraphPosition,
  provenance: readonly StrategicFitSourceProvenance[],
): RawCandidate[] {
  const enabled = new Set(request.candidate_sources);
  if (
    !enabled.has("existing-repertoire-transposition") &&
    !enabled.has("move-order-shortcut")
  ) return [];
  const graphPositions = new Map(graph.positions.map((candidate) => [candidate.position_key, candidate]));
  const decisions = graph.decisions.filter((decision) =>
    decision.from_position_id === pivot.position_id && decision.owner === "repertoire"
  );
  const decisionsByUci = new Map(decisions.map((decision) => [decision.uci, decision]));
  const chess = Chess.fromSetup(parseFen(position.fen).unwrap()).unwrap();
  const candidates: RawCandidate[] = [];
  for (const { move, after } of enumerateLegal(chess)) {
    const san = makeSan(chess, move);
    const uci = makeUci(move);
    if (uci === pivot.uci) continue;
    const outcomeFen = makeFen(after.toSetup());
    const outcomeKey = positionKey(outcomeFen);
    const target = graphPositions.get(outcomeKey);
    if (!target) continue;
    const preparedDecision = decisionsByUci.get(uci);
    const kind = preparedDecision
      ? "existing-repertoire-transposition" as const
      : "move-order-shortcut" as const;
    if (!enabled.has(kind)) continue;
    candidates.push({
      san,
      uci,
      outcomePositionId: target.position_id,
      outcomePositionKey: target.position_key,
      outcomeFen,
      existingPreparation: true,
      memoryClass: "low",
      sourcePaths: sortedPaths([
        ...(preparedDecision?.source_san_paths ?? []),
        ...target.source_san_paths,
      ]),
      sources: [localSource(kind, request, pivot, target, preparedDecision, provenance)],
      databaseEvidenceIds: [],
      popularity: null,
    });
  }
  return candidates;
}

function databaseSource(
  evidence: ReplacementOpeningDatabaseEvidence,
  move: ReplacementOpeningDatabaseMoveEvidence | null,
  status: ReplacementCandidateSourceStatus,
  outcomePositionId: string | null,
): ReplacementCandidateSourceProvenance {
  const evidenceIds = move ? [evidence.evidence_id] : [];
  const moveIds = move ? [move.move_id] : [];
  return {
    ...versioned(),
    source_id: `strategic-fit:opening-database:${evidence.evidence_id}`,
    kind: "opening-database",
    status,
    provider: evidence.provider,
    version: evidence.version,
    snapshot: evidence.snapshot,
    reason: evidence.reason,
    position_ids: sortedUnique([
      evidence.position.position_id,
      ...(outcomePositionId ? [outcomePositionId] : []),
    ]),
    decision_ids: [],
    route_ids: [],
    details: {
      evidence_ids: evidenceIds,
      move_ids: moveIds,
      database: evidence.database,
      filter_key: evidence.filter_key,
      filters: cloneFilters(evidence.filters) as unknown as JsonValue,
      evidence_state: evidence.state,
      popularity: move ? clonePopularity(move.popularity) as unknown as JsonValue : null,
      position: clonePosition(evidence.position) as unknown as JsonValue,
      input_move: move ? { san: move.san, uci: move.uci } : null,
    },
    provenance: mergeStrategicProvenance([
      ...evidence.provenance,
      ...(move?.provenance ?? []),
    ]),
  };
}

function itemResult(
  evidence: ReplacementOpeningDatabaseEvidence,
  move: ReplacementOpeningDatabaseMoveEvidence,
  itemIndex: number,
  status: ReplacementDatabaseItemResultStatus,
  errorCode: ReplacementDatabaseItemErrorCode | null,
  explanation: string,
  canonical: {
    readonly san: string;
    readonly uci: string;
    readonly outcomePositionId: string;
    readonly outcomePositionKey: string;
    readonly outcomeFen: string;
  } | null,
  candidateId: string | null,
): ReplacementOpeningDatabaseItemResult {
  return {
    ...versioned(),
    evidence_id: evidence.evidence_id,
    move_id: move.move_id,
    item_index: itemIndex,
    evidence_state: evidence.state,
    status,
    error_code: errorCode,
    explanation,
    candidate_id: candidateId,
    database: evidence.database,
    provider: evidence.provider,
    database_version: evidence.version,
    snapshot: evidence.snapshot,
    filter_key: evidence.filter_key,
    filters: cloneFilters(evidence.filters),
    position: clonePosition(evidence.position),
    input_san: move.san,
    input_uci: move.uci,
    canonical_san: canonical?.san ?? null,
    canonical_uci: canonical?.uci ?? null,
    outcome_position_id: canonical?.outcomePositionId ?? null,
    outcome_position_key: canonical?.outcomePositionKey ?? null,
    outcome_fen: canonical?.outcomeFen ?? null,
    popularity: clonePopularity(move.popularity),
    provenance: mergeStrategicProvenance([...evidence.provenance, ...move.provenance]),
  };
}

function unavailableItemError(
  state: ReplacementDatabaseEvidenceState,
): readonly [ReplacementDatabaseItemResultStatus, ReplacementDatabaseItemErrorCode, string] | null {
  if (state === "stale") return ["stale", "stale-source", "Opening-database evidence is explicitly stale."];
  if (state === "rejected") return ["rejected", "source-rejected", "Opening-database evidence was rejected by its source boundary."];
  if (state === "missing" || state === "offline" || state === "unavailable") {
    return ["rejected", "source-unavailable", `Opening-database evidence is ${state}.`];
  }
  return null;
}

function validateDatabaseEvidence(
  request: ReplacementRequest,
  graph: RepertoireGraph,
  pivot: ReplacementActionablePivotEvidence,
  pivotPosition: RepertoireGraphPosition,
  evidence: ReplacementOpeningDatabaseEvidence,
): { readonly candidates: RawCandidate[]; readonly items: ReplacementOpeningDatabaseItemResult[] } {
  const candidates: RawCandidate[] = [];
  const items: ReplacementOpeningDatabaseItemResult[] = [];
  const unavailable = unavailableItemError(evidence.state);
  const requested = request.candidate_sources.includes("opening-database");
  let stalePosition = false;
  try {
    stalePosition = evidence.position.position_id !== pivot.position_id ||
      evidence.position.position_key !== pivotPosition.position_key ||
      positionKey(evidence.position.fen) !== pivotPosition.position_key;
  } catch {
    stalePosition = true;
  }
  const filterMismatch = evidence.database !== evidence.filters.db;
  let chess: Chess | null = null;
  try {
    chess = Chess.fromSetup(parseFen(pivotPosition.fen).unwrap()).unwrap();
  } catch {
    stalePosition = true;
  }

  for (const [itemIndex, moveEvidence] of evidence.moves.entries()) {
    if (!requested) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "rejected", "source-not-requested", "Opening-database source is not enabled by this request.", null, null));
      continue;
    }
    if (unavailable) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, ...unavailable, null, null));
      continue;
    }
    if (stalePosition || !chess) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "stale", "stale-pivot-position", "Evidence position does not match the current semantic pivot position.", null, null));
      continue;
    }
    if (filterMismatch) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "rejected", "database-filter-mismatch", "Evidence database and normalized filter database do not match.", null, null));
      continue;
    }
    const sanMove = parseSan(chess, moveEvidence.san);
    if (!sanMove) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "illegal", "illegal-san", "Injected SAN is illegal from the semantic pivot position.", null, null));
      continue;
    }
    const uciMove = parseUci(moveEvidence.uci);
    if (!uciMove) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "illegal", "illegal-uci", "Injected UCI is malformed.", null, null));
      continue;
    }
    const canonicalSan = makeSan(chess, sanMove);
    const canonicalUci = makeUci(sanMove);
    if (canonicalUci !== makeUci(uciMove)) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "illegal", "san-uci-mismatch", "Injected SAN and UCI describe different moves.", null, null));
      continue;
    }
    if (canonicalUci === pivot.uci) {
      items.push(itemResult(evidence, moveEvidence, itemIndex, "rejected", "original-pivot-move", "Injected move repeats the current causal pivot instead of proposing an alternative.", null, null));
      continue;
    }
    const after = chess.clone();
    after.play(sanMove);
    const outcomeFen = makeFen(after.toSetup());
    const outcomeKey = positionKey(outcomeFen);
    const existing = graph.positions.find((position) => position.position_key === outcomeKey);
    const outcomePositionId = existing?.position_id ?? semanticPositionId(outcomeKey);
    const candidateId = `replacement-candidate-seed:${stableHash([
      pivot.position_id,
      outcomeKey,
    ].join(SEPARATOR))}`;
    const canonical = {
      san: canonicalSan,
      uci: canonicalUci,
      outcomePositionId,
      outcomePositionKey: outcomeKey,
      outcomeFen,
    };
    items.push(itemResult(evidence, moveEvidence, itemIndex, "accepted", null, "Injected database move is legal from the semantic pivot position.", canonical, candidateId));
    candidates.push({
      san: canonicalSan,
      uci: canonicalUci,
      outcomePositionId,
      outcomePositionKey: outcomeKey,
      outcomeFen,
      existingPreparation: existing !== undefined,
      memoryClass: existing ? "low" : "unknown",
      sourcePaths: existing?.source_san_paths ?? [],
      sources: [databaseSource(evidence, moveEvidence, sourceStatus(evidence.state), outcomePositionId)],
      databaseEvidenceIds: [evidence.evidence_id],
      popularity: moveEvidence.popularity.played_pct,
    });
  }
  return { candidates, items };
}

function mergeRawCandidates(raw: readonly RawCandidate[]): RawCandidate[] {
  const byOutcome = new Map<string, RawCandidate[]>();
  for (const candidate of raw) {
    byOutcome.set(candidate.outcomePositionKey, [
      ...(byOutcome.get(candidate.outcomePositionKey) ?? []),
      candidate,
    ]);
  }
  return [...byOutcome.values()].map((matches) => {
    const canonical = [...matches].sort((left, right) =>
      compareStrings(left.uci, right.uci) || compareStrings(left.san, right.san)
    )[0]!;
    const popularity = matches.flatMap((candidate) =>
      candidate.popularity === null ? [] : [candidate.popularity]
    );
    return {
      ...canonical,
      existingPreparation: matches.some((candidate) => candidate.existingPreparation),
      memoryClass: (matches.some((candidate) => candidate.memoryClass === "low")
        ? "low"
        : "unknown") as ReplacementCandidateMemoryClass,
      sourcePaths: sortedPaths(matches.flatMap((candidate) => candidate.sourcePaths)),
      sources: mergeCandidateSources(matches.flatMap((candidate) => candidate.sources)),
      databaseEvidenceIds: sortedUnique(matches.flatMap((candidate) => candidate.databaseEvidenceIds)),
      popularity: popularity.length > 0 ? Math.max(...popularity) : null,
    };
  }).sort((left, right) =>
    (left.memoryClass === "low" ? 0 : 1) - (right.memoryClass === "low" ? 0 : 1) ||
    (right.popularity ?? -1) - (left.popularity ?? -1) ||
    compareStrings(left.san, right.san) ||
    compareStrings(left.uci, right.uci) ||
    compareStrings(left.outcomePositionKey, right.outcomePositionKey)
  );
}

function toSeed(
  raw: RawCandidate,
  rank: number,
  request: ReplacementRequest,
  pivot: ReplacementActionablePivotEvidence,
): ReplacementCandidateSeed {
  const sourceKinds = sortedUnique(raw.sources.map((source) => source.kind)) as ReplacementCandidateSourceKind[];
  return {
    ...versioned(),
    candidate_id: `replacement-candidate-seed:${stableHash([
      pivot.position_id,
      raw.outcomePositionKey,
    ].join(SEPARATOR))}`,
    rank,
    status: raw.existingPreparation ? "ready-for-expansion" : "partial-generation",
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    pivot,
    san: raw.san,
    uci: raw.uci,
    mover_color: request.repertoire_color,
    outcome_position_id: raw.outcomePositionId,
    outcome_position_key: raw.outcomePositionKey,
    outcome_fen: raw.outcomeFen,
    existing_preparation: raw.existingPreparation,
    memory_class: raw.memoryClass,
    rank_hint: raw.existingPreparation
      ? "low-memory-existing-preparation"
      : "database-popularity",
    maximum_database_popularity: raw.popularity,
    source_kinds: sourceKinds,
    source_san_paths: sortedPaths(raw.sourcePaths),
    database_evidence_ids: sortedUnique(raw.databaseEvidenceIds),
    provenance: raw.sources.map((source) => ({
      ...source,
      position_ids: [...source.position_ids],
      decision_ids: [...source.decision_ids],
      route_ids: [...source.route_ids],
      provenance: source.provenance.map((item) => ({ ...item })),
    })),
    expansion: {
      ...versioned(),
      status: "full-subtree-required",
      full_subtree_required: true,
      required_contract: "ReplacementCandidateSubtree",
      reason: "Task 8.5 must expand this seed into bounded coverage-aware opponent replies before it can become a ReplacementCandidate.",
    },
  };
}

function sourceResults(
  request: ReplacementRequest,
  discoveredLocal: readonly RawCandidate[],
  keptCandidates: readonly RawCandidate[],
  evidence: readonly ReplacementOpeningDatabaseEvidence[],
  items: readonly ReplacementOpeningDatabaseItemResult[],
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementCandidateGenerationSourceResult[] {
  const results: ReplacementCandidateGenerationSourceResult[] = [];
  for (const kind of ["existing-repertoire-transposition", "move-order-shortcut"] as const) {
    if (!request.candidate_sources.includes(kind)) continue;
    const discovered = discoveredLocal.filter((candidate) =>
      candidate.sources.some((source) => source.kind === kind)
    );
    const matching = keptCandidates.filter((candidate) =>
      candidate.sources.some((source) => source.kind === kind)
    );
    const excluded = discovered.length - matching.length;
    const sources = mergeCandidateSources(discovered.flatMap((candidate) => candidate.sources)
      .filter((source) => source.kind === kind));
    results.push({
      ...versioned(),
      source_id: `strategic-fit:local-preparation:${kind}`,
      kind,
      status: excluded > 0 ? "partial" : "available",
      evidence_state: null,
      accepted_item_count: matching.length,
      rejected_item_count: excluded,
      reason: excluded > 0
        ? `${excluded} legal local candidate${excluded === 1 ? " was" : "s were"} excluded by the request maximum-candidate budget.`
        : discovered.length > 0
          ? null
          : "No legal alternative reaches matching local preparation.",
      provenance: sources.length > 0 ? sources : [{
        ...versioned(),
        source_id: `strategic-fit:local-preparation:${kind}`,
        kind,
        status: "available",
        provider: "local-repertoire-graph",
        version: STRATEGIC_FIT_ANALYSIS_VERSION,
        snapshot: request.repertoire_revision,
        reason: "Local graph was searched deterministically.",
        position_ids: [],
        decision_ids: [],
        route_ids: [],
        details: { candidate_count: 0 },
        provenance: mergeStrategicProvenance(provenance),
      }],
    });
  }
  if (request.candidate_sources.includes("opening-database") && evidence.length === 0) {
    results.push({
      ...versioned(),
      source_id: "strategic-fit:opening-database:missing",
      kind: "opening-database",
      status: "unavailable",
      evidence_state: "missing",
      accepted_item_count: 0,
      rejected_item_count: 0,
      reason: "Opening-database evidence was requested but not injected.",
      provenance: [],
    });
  }
  for (const itemEvidence of [...evidence].sort((left, right) =>
    compareStrings(left.evidence_id, right.evidence_id)
  )) {
    const matching = items.filter((item) => item.evidence_id === itemEvidence.evidence_id);
    const accepted = matching.filter((item) => item.status === "accepted").length;
    results.push({
      ...versioned(),
      source_id: `strategic-fit:opening-database:${itemEvidence.evidence_id}`,
      kind: "opening-database",
      status: sourceStatus(itemEvidence.state),
      evidence_state: itemEvidence.state,
      accepted_item_count: accepted,
      rejected_item_count: matching.length - accepted,
      reason: itemEvidence.reason,
      provenance: [databaseSource(itemEvidence, null, sourceStatus(itemEvidence.state), null)],
    });
  }
  return results.sort((left, right) =>
    compareStrings(left.kind, right.kind) || compareStrings(left.source_id, right.source_id)
  );
}

/** Generate bounded, canonical candidate seeds from local preparation and injected database data. */
export function generateReplacementCandidates(
  input: GenerateReplacementCandidatesInput,
): ReplacementCandidateGenerationResult {
  const provenance = generationProvenance(input);
  const compatibility = pivotCompatibilityError(input);
  if (compatibility) {
    return failureResult(input, compatibility[0], compatibility[1], compatibility[2], provenance);
  }

  const pivot = input.pivot_result.pivot as ReplacementActionablePivotEvidence;
  const pivotPosition = input.graph.positions.find((position) =>
    position.position_id === pivot.position_id
  )!;
  const localProvenance = mergeStrategicProvenance([
    ...input.request.provenance,
    ...input.pivot_result.provenance,
    {
      source_id: "strategic-fit:replacement-candidates:local-preparation",
      kind: "repertoire",
      state: "available",
      version: STRATEGIC_FIT_ANALYSIS_VERSION,
      snapshot: input.request.repertoire_revision,
      reason: "Current canonical repertoire graph supplied local preparation evidence.",
    },
  ]);
  const local = discoverLocalCandidates(
    input.request,
    input.graph,
    pivot,
    pivotPosition,
    localProvenance,
  );
  const databaseCandidates: RawCandidate[] = [];
  const databaseItems: ReplacementOpeningDatabaseItemResult[] = [];
  for (const evidence of input.database_evidence ?? []) {
    const validated = validateDatabaseEvidence(
      input.request,
      input.graph,
      pivot,
      pivotPosition,
      evidence,
    );
    databaseCandidates.push(...validated.candidates);
    databaseItems.push(...validated.items);
  }

  const merged = mergeRawCandidates([...local, ...databaseCandidates]);
  const kept = merged.slice(0, input.request.budget.maximum_candidates);
  const seeds = kept.map((candidate, index) => toSeed(candidate, index + 1, input.request, pivot));
  const keptIds = new Set(seeds.map((candidate) => candidate.candidate_id));
  const finalItems = databaseItems.map((item): ReplacementOpeningDatabaseItemResult => {
    if (item.status !== "accepted" || item.candidate_id === null || keptIds.has(item.candidate_id)) {
      return item;
    }
    return {
      ...item,
      status: "budget-excluded",
      error_code: "maximum-candidates-exceeded",
      explanation: "Legal candidate was excluded by the request maximum-candidate budget.",
      candidate_id: null,
    };
  }).sort((left, right) =>
    compareStrings(left.evidence_id, right.evidence_id) ||
    compareStrings(left.move_id, right.move_id) ||
    left.item_index - right.item_index
  );
  const sources = sourceResults(
    input.request,
    local,
    kept,
    input.database_evidence ?? [],
    finalItems,
    localProvenance,
  );
  const degraded = merged.length > kept.length ||
    sources.some((source) => source.evidence_state !== null && source.evidence_state !== "available") ||
    finalItems.some((item) => item.status !== "accepted");
  return {
    ...resultBase(input, provenance),
    status: degraded ? "partial" : "complete",
    error_code: null,
    explanation: degraded
      ? "Usable candidate seeds retained with explicit partial, unavailable, stale, rejected, illegal, or budget-limited evidence."
      : "Candidate seeds generated deterministically from all requested available sources.",
    pivot_id: pivot.pivot_id,
    discovered_candidate_count: merged.length,
    candidates: seeds,
    database_item_results: finalItems,
    source_results: sources,
  };
}
