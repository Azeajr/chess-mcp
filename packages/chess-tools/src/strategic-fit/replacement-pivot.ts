/**
 * Deterministic Replacement Lab pivot selection and user-line validation.
 *
 * Selection starts from finding-specific causal evidence, then checks that each semantic decision
 * still belongs to the current cohort graph and is owned by the repertoire player. SAN paths are
 * retained only for navigation. This module reads the graph and evidence without mutating either.
 */
import type { Color } from "../congruence.js";
import { validateLine } from "../validate.js";
import { assertDefined } from "../assert.js";
import type { StrategicComparableCohort } from "./cohorts.js";
import type { RepertoireGraph, RepertoireGraphDecision } from "./graph.js";
import {
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  type ReplacementActionablePivotEvidence,
  type ReplacementCausalPivotEvidence,
  type ReplacementNonActionablePivotEvidence,
  type ReplacementRequest,
  type ReplacementSharedPivotEvidence,
  type StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import type {
  CausalAttribution,
  EvidenceComparisonDimension,
  SemanticReferences,
  StrategicFinding,
  StrategicFitProvenance,
  StrategicFitSourceProvenance,
} from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION, STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";

export const REPLACEMENT_PIVOT_RESULT_STATUSES = [
  "selected",
  "alternatives-required",
  "non-actionable",
] as const;
export type ReplacementPivotResultStatus = (typeof REPLACEMENT_PIVOT_RESULT_STATUSES)[number];

export const REPLACEMENT_PIVOT_NON_ACTIONABLE_REASONS = [
  "request-finding-mismatch",
  "request-cohort-mismatch",
  "repertoire-revision-mismatch",
  "repertoire-color-mismatch",
  "finding-evidence-cohort-mismatch",
  "finding-routes-stale",
  "opponent-controlled",
  "unknown-causality",
  "no-supported-causal-pivot",
  "unknown-user-selected-decision",
  "stale-user-selected-decision",
  "user-selected-decision-not-repertoire-owned",
] as const;
export type ReplacementPivotNonActionableReason =
  (typeof REPLACEMENT_PIVOT_NON_ACTIONABLE_REASONS)[number];

export const REPLACEMENT_USER_CANDIDATE_LINE_STATUSES = ["valid", "illegal", "stale"] as const;
export type ReplacementUserCandidateLineStatus =
  (typeof REPLACEMENT_USER_CANDIDATE_LINE_STATUSES)[number];

export const REPLACEMENT_USER_CANDIDATE_LINE_ERROR_CODES = [
  "empty-line",
  "illegal-san",
  "pivot-selection-required",
  "pivot-unavailable",
] as const;
export type ReplacementUserCandidateLineErrorCode =
  (typeof REPLACEMENT_USER_CANDIDATE_LINE_ERROR_CODES)[number];

interface ReplacementUserCandidateLineResultBase extends StrategicFitReplacementVersioned {
  readonly candidate_index: number;
  readonly input_san_line: readonly string[];
  readonly pivot_position_id: string | null;
}

export interface ReplacementValidUserCandidateLineResult extends ReplacementUserCandidateLineResultBase {
  readonly status: "valid";
  readonly canonical_san_line: readonly [string, ...string[]];
  readonly first_move_uci: string;
  readonly final_fen: string;
  readonly illegal_san_index: null;
  readonly error_code: null;
  readonly explanation: string;
}

export interface ReplacementIllegalUserCandidateLineResult extends ReplacementUserCandidateLineResultBase {
  readonly status: "illegal";
  readonly canonical_san_line: readonly string[];
  readonly first_move_uci: string | null;
  readonly final_fen: null;
  readonly illegal_san_index: number;
  readonly error_code: "empty-line" | "illegal-san";
  readonly explanation: string;
}

export interface ReplacementStaleUserCandidateLineResult extends ReplacementUserCandidateLineResultBase {
  readonly status: "stale";
  readonly canonical_san_line: readonly [];
  readonly first_move_uci: null;
  readonly final_fen: null;
  readonly illegal_san_index: null;
  readonly error_code: "pivot-selection-required" | "pivot-unavailable";
  readonly explanation: string;
}

export type ReplacementUserCandidateLineResult =
  | ReplacementValidUserCandidateLineResult
  | ReplacementIllegalUserCandidateLineResult
  | ReplacementStaleUserCandidateLineResult;

/** Minimal finding projection accepted by the selector; a full StrategicFinding is assignable. */
export interface ReplacementPivotFindingEvidence {
  readonly finding_id: StrategicFinding["finding_id"];
  readonly semantic_finding_id: StrategicFinding["semantic_finding_id"];
  readonly repertoire_revision: StrategicFinding["repertoire_revision"];
  readonly references: SemanticReferences;
  readonly evidence: {
    readonly cohort_id: string;
    readonly dimensions: readonly Pick<EvidenceComparisonDimension, "dimension_id">[];
    readonly causality: CausalAttribution;
    readonly provenance: readonly StrategicFitSourceProvenance[];
  };
  readonly provenance: Pick<StrategicFitProvenance, "repertoire_revision" | "sources">;
}

/** Minimal cohort projection accepted by the selector; a full StrategicComparableCohort is assignable. */
export type ReplacementPivotCohortEvidence = Pick<
  StrategicComparableCohort,
  "cohort_id" | "route_ids" | "route_weights" | "transposition_position_ids" | "provenance"
>;

export interface SelectReplacementPivotInput {
  readonly request: ReplacementRequest;
  readonly graph: RepertoireGraph;
  readonly finding: ReplacementPivotFindingEvidence;
  readonly cohort: ReplacementPivotCohortEvidence;
}

interface ReplacementPivotSelectionResultBase extends StrategicFitReplacementVersioned {
  readonly status: ReplacementPivotResultStatus;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly selection_kind: ReplacementRequest["pivot_selection"]["kind"];
  readonly source_repertoire_unchanged: true;
  readonly candidate_line_results: readonly ReplacementUserCandidateLineResult[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface ReplacementPivotSelectedResult extends ReplacementPivotSelectionResultBase {
  readonly status: "selected";
  readonly pivot: ReplacementActionablePivotEvidence;
  readonly alternative_pivots: readonly ReplacementActionablePivotEvidence[];
  readonly non_actionable_reason: null;
}

export interface ReplacementPivotAlternativesResult extends ReplacementPivotSelectionResultBase {
  readonly status: "alternatives-required";
  readonly pivot: ReplacementSharedPivotEvidence;
  readonly alternative_pivots: readonly [
    ReplacementActionablePivotEvidence,
    ...ReplacementActionablePivotEvidence[],
  ];
  readonly non_actionable_reason: null;
}

export interface ReplacementPivotNonActionableResult extends ReplacementPivotSelectionResultBase {
  readonly status: "non-actionable";
  readonly pivot: ReplacementNonActionablePivotEvidence;
  readonly alternative_pivots: readonly [];
  readonly non_actionable_reason: ReplacementPivotNonActionableReason;
}

export type ReplacementPivotSelectionResult =
  | ReplacementPivotSelectedResult
  | ReplacementPivotAlternativesResult
  | ReplacementPivotNonActionableResult;

interface PivotCandidate {
  readonly decision: RepertoireGraphDecision;
  readonly supportingRouteIds: readonly string[];
  readonly unsupportedRouteIds: readonly string[];
  readonly sourceSanPaths: readonly (readonly string[])[];
  readonly cohortWeight: number;
  readonly causalEventCount: number;
}

const ID_SEPARATOR = "\u001f";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
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

function mergeProvenance(
  request: ReplacementRequest,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
): StrategicFitSourceProvenance[] {
  const core: StrategicFitSourceProvenance = {
    source_id: "strategic-fit:replacement-pivot",
    kind: "deterministic-core",
    state: "available",
    version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
    snapshot: request.repertoire_revision,
    reason: null,
  };
  const seen = new Set<string>();
  return [
    ...request.provenance,
    ...finding.evidence.provenance,
    ...finding.provenance.sources,
    ...cohort.provenance,
    core,
  ]
    .filter((source) => {
      const key = [
        source.source_id,
        source.kind,
        source.state,
        source.version,
        source.snapshot,
        source.reason,
      ].join(ID_SEPARATOR);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => compareStrings(left.source_id, right.source_id));
}

function sourcePaths(pathsToCopy: readonly (readonly string[])[]): string[][] {
  const paths = new Map<string, string[]>();
  for (const path of pathsToCopy) {
    paths.set(path.join(ID_SEPARATOR), [...path]);
  }
  return [...paths.values()].sort(
    (left, right) =>
      compareStrings(left.join(ID_SEPARATOR), right.join(ID_SEPARATOR)) ||
      left.length - right.length,
  );
}

function isPathPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((san, index) => san === path[index]);
}

function currentFindingPaths(
  graph: RepertoireGraph,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
): string[][] {
  const findingRoutes = new Set(finding.references.route_ids);
  const cohortRoutes = new Set(cohort.route_ids);
  return sourcePaths(
    graph.routes
      .filter((route) => findingRoutes.has(route.route_id) && cohortRoutes.has(route.route_id))
      .flatMap((route) => route.source_san_paths),
  );
}

function affectedFeatures(finding: ReplacementPivotFindingEvidence): string[] {
  return sortedUnique(finding.evidence.dimensions.map((dimension) => dimension.dimension_id));
}

function causalDecisionIds(finding: ReplacementPivotFindingEvidence): string[] {
  return sortedUnique([
    ...finding.evidence.causality.likely_causal_decision_ids,
    ...finding.evidence.causality.timeline.flatMap((event) =>
      event.kind === "player-decision" && event.decision_id ? [event.decision_id] : [],
    ),
  ]);
}

function pivotCandidates(
  graph: RepertoireGraph,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
  repertoireColor: Color,
): PivotCandidate[] {
  const affectedRouteIds = sortedUnique(finding.references.route_ids);
  const affectedRoutes = new Set(affectedRouteIds);
  const cohortRoutes = new Set(cohort.route_ids);
  const findingDecisions = new Set(finding.references.decision_ids);
  const weights = new Map(
    cohort.route_weights.map((route) => [route.route_id, route.normalized_weight]),
  );
  const eventCounts = new Map<string, number>();
  for (const event of finding.evidence.causality.timeline) {
    if (event.kind !== "player-decision" || !event.decision_id) continue;
    eventCounts.set(event.decision_id, (eventCounts.get(event.decision_id) ?? 0) + 1);
  }
  const decisions = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));
  const routes = new Map(graph.routes.map((route) => [route.route_id, route]));
  return causalDecisionIds(finding)
    .flatMap((decisionId): PivotCandidate[] => {
      const decision = decisions.get(decisionId);
      if (
        decision?.owner !== "repertoire" ||
        decision.mover_color !== repertoireColor ||
        !findingDecisions.has(decisionId)
      )
        return [];
      const supportingRouteIds = decision.route_ids
        .filter((routeId) => affectedRoutes.has(routeId) && cohortRoutes.has(routeId))
        .sort(compareStrings);
      if (supportingRouteIds.length === 0) return [];
      const support = new Set(supportingRouteIds);
      const supportingNavigationPaths = supportingRouteIds.flatMap(
        (routeId) => routes.get(routeId)?.source_san_paths ?? [],
      );
      const decisionPaths = decision.source_san_paths.filter((decisionPath) =>
        supportingNavigationPaths.some((routePath) => isPathPrefix(decisionPath, routePath)),
      );
      return [
        {
          decision,
          supportingRouteIds,
          unsupportedRouteIds: affectedRouteIds.filter((routeId) => !support.has(routeId)),
          sourceSanPaths: sourcePaths(
            decisionPaths.length > 0 ? decisionPaths : supportingNavigationPaths,
          ),
          cohortWeight: supportingRouteIds.reduce(
            (sum, routeId) => sum + (weights.get(routeId) ?? 0),
            0,
          ),
          causalEventCount: eventCounts.get(decisionId) ?? 0,
        },
      ];
    })
    .sort(
      (left, right) =>
        left.unsupportedRouteIds.length - right.unsupportedRouteIds.length ||
        right.causalEventCount - left.causalEventCount ||
        right.cohortWeight - left.cohortWeight ||
        Math.min(...left.decision.plies) - Math.min(...right.decision.plies) ||
        compareStrings(left.decision.decision_id, right.decision.decision_id),
    );
}

function baseEvidence(
  request: ReplacementRequest,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
  navigationPaths: readonly (readonly string[])[],
  provenance: readonly StrategicFitSourceProvenance[],
) {
  const causality = finding.evidence.causality;
  return {
    ...versioned(),
    repertoire_color: request.repertoire_color,
    controllability: causality.controllability,
    control_label: causality.label,
    player_contribution: causality.player_contribution,
    opponent_contribution: causality.opponent_contribution,
    causal_event_ids: sortedUnique(causality.timeline.map((event) => event.event_id)),
    affected_feature_ids: affectedFeatures(finding),
    transposition_position_ids: sortedUnique(
      cohort.transposition_position_ids.filter((positionId) =>
        finding.references.position_ids.includes(positionId),
      ),
    ),
    source_san_paths: sourcePaths(navigationPaths),
    provenance,
  } as const;
}

function actionableEvidence(
  candidate: PivotCandidate,
  alternatives: readonly PivotCandidate[],
  request: ReplacementRequest,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementActionablePivotEvidence {
  const decision = candidate.decision;
  const supported = candidate.supportingRouteIds.length;
  const total = finding.references.route_ids.length;
  return {
    ...baseEvidence(request, finding, cohort, candidate.sourceSanPaths, provenance),
    pivot_id: `replacement-pivot:${stableHash(decision.decision_id)}`,
    status: "actionable",
    owner: "repertoire",
    decision_id: decision.decision_id,
    position_id: decision.from_position_id,
    ply: Math.min(...decision.plies),
    san: decision.san,
    uci: decision.uci,
    alternative_decision_ids: alternatives
      .map((item) => item.decision.decision_id)
      .filter((decisionId) => decisionId !== decision.decision_id),
    explanation: `Repertoire-owned semantic decision supports ${supported}/${total} affected routes (${Math.round(candidate.cohortWeight * 100)}% cohort weight).`,
  };
}

function sharedEvidence(
  candidates: readonly PivotCandidate[],
  request: ReplacementRequest,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
  navigationPaths: readonly (readonly string[])[],
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementSharedPivotEvidence {
  const decisions = candidates.map((candidate) => candidate.decision);
  const decisionIds = decisions.map((decision) => decision.decision_id).sort(compareStrings);
  return {
    ...baseEvidence(request, finding, cohort, navigationPaths, provenance),
    pivot_id: `replacement-pivot:shared:${stableHash(decisionIds.join(ID_SEPARATOR))}`,
    status: "shared",
    owner: null,
    decision_id: null,
    position_id: null,
    ply: null,
    san: null,
    uci: null,
    alternative_decision_ids: decisionIds,
    explanation:
      finding.references.route_ids.length > 1 &&
      candidates.some((candidate) => candidate.unsupportedRouteIds.length > 0)
        ? "Finding spans several semantic routes without one supported causal pivot; explicit pivot selection is required."
        : "Shared or interacting causal evidence supports several repertoire-owned pivots; explicit pivot selection is required.",
  };
}

function nonActionableEvidence(
  reason: ReplacementPivotNonActionableReason,
  request: ReplacementRequest,
  finding: ReplacementPivotFindingEvidence,
  cohort: ReplacementPivotCohortEvidence,
  navigationPaths: readonly (readonly string[])[],
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementNonActionablePivotEvidence {
  return {
    ...baseEvidence(request, finding, cohort, navigationPaths, provenance),
    pivot_id: `replacement-pivot:non-actionable:${stableHash(
      [request.request_id, reason].join(ID_SEPARATOR),
    )}`,
    status: "non-actionable",
    owner: null,
    decision_id: null,
    position_id: null,
    ply: null,
    san: null,
    uci: null,
    alternative_decision_ids: [],
    explanation: `No actionable causal pivot: ${reason.replaceAll("-", " ")}.`,
  };
}

function staleCandidateLines(
  request: ReplacementRequest,
  code: ReplacementStaleUserCandidateLineResult["error_code"],
): ReplacementStaleUserCandidateLineResult[] {
  return request.user_candidate_san_lines.map((line, candidateIndex) => ({
    ...versioned(),
    candidate_index: candidateIndex,
    input_san_line: [...line],
    pivot_position_id: null,
    status: "stale",
    canonical_san_line: [],
    first_move_uci: null,
    final_fen: null,
    illegal_san_index: null,
    error_code: code,
    explanation:
      code === "pivot-selection-required"
        ? "Candidate line cannot be validated until one semantic pivot is selected."
        : "Candidate line cannot be validated because its pivot is unavailable in current evidence.",
  }));
}

function validateCandidateLines(
  request: ReplacementRequest,
  graph: RepertoireGraph,
  pivot: ReplacementActionablePivotEvidence,
): ReplacementUserCandidateLineResult[] {
  const position = graph.positions.find((candidate) => candidate.position_id === pivot.position_id);
  if (!position) return staleCandidateLines(request, "pivot-unavailable");
  return request.user_candidate_san_lines.map(
    (line, candidateIndex): ReplacementUserCandidateLineResult => {
      if (line.length === 0) {
        return {
          ...versioned(),
          candidate_index: candidateIndex,
          input_san_line: [],
          pivot_position_id: pivot.position_id,
          status: "illegal",
          canonical_san_line: [],
          first_move_uci: null,
          final_fen: null,
          illegal_san_index: 0,
          error_code: "empty-line",
          explanation: "Candidate SAN line must contain at least one move.",
        };
      }
      try {
        const validation = validateLine(position.fen, line);
        if (
          validation.ok &&
          validation.canonical.length > 0 &&
          validation.firstUci &&
          validation.finalFen
        ) {
          return {
            ...versioned(),
            candidate_index: candidateIndex,
            input_san_line: [...line],
            pivot_position_id: pivot.position_id,
            status: "valid",
            canonical_san_line: validation.canonical as [string, ...string[]],
            first_move_uci: validation.firstUci,
            final_fen: validation.finalFen,
            illegal_san_index: null,
            error_code: null,
            explanation: "Candidate SAN line is legal from the selected semantic pivot position.",
          };
        }
        return {
          ...versioned(),
          candidate_index: candidateIndex,
          input_san_line: [...line],
          pivot_position_id: pivot.position_id,
          status: "illegal",
          canonical_san_line: validation.canonical,
          first_move_uci: validation.firstUci ?? null,
          final_fen: null,
          illegal_san_index: validation.badIndex ?? validation.canonical.length,
          error_code: "illegal-san",
          explanation: `Candidate SAN is illegal at index ${validation.badIndex ?? validation.canonical.length}.`,
        };
      } catch {
        return {
          ...versioned(),
          candidate_index: candidateIndex,
          input_san_line: [...line],
          pivot_position_id: pivot.position_id,
          status: "stale",
          canonical_san_line: [],
          first_move_uci: null,
          final_fen: null,
          illegal_san_index: null,
          error_code: "pivot-unavailable",
          explanation: "Current pivot position cannot validate this candidate line.",
        };
      }
    },
  );
}

function resultBase(
  request: ReplacementRequest,
  provenance: readonly StrategicFitSourceProvenance[],
) {
  return {
    ...versioned(),
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    selection_kind: request.pivot_selection.kind,
    source_repertoire_unchanged: true as const,
    provenance,
  };
}

function incompatibleReason(
  input: SelectReplacementPivotInput,
): ReplacementPivotNonActionableReason | null {
  const { request, graph, finding, cohort } = input;
  if (
    request.finding_id !== finding.finding_id ||
    request.semantic_finding_id !== finding.semantic_finding_id
  )
    return "request-finding-mismatch";
  if (request.cohort_id !== cohort.cohort_id) return "request-cohort-mismatch";
  if (
    request.repertoire_revision !== finding.repertoire_revision ||
    request.repertoire_revision !== finding.provenance.repertoire_revision
  )
    return "repertoire-revision-mismatch";
  if (request.repertoire_color !== graph.repertoire_color) return "repertoire-color-mismatch";
  if (finding.evidence.cohort_id !== cohort.cohort_id) return "finding-evidence-cohort-mismatch";
  const graphRoutes = new Set(graph.routes.map((route) => route.route_id));
  const cohortRoutes = new Set(cohort.route_ids);
  if (
    finding.references.route_ids.length === 0 ||
    finding.references.route_ids.some(
      (routeId) => !graphRoutes.has(routeId) || !cohortRoutes.has(routeId),
    )
  )
    return "finding-routes-stale";
  return null;
}

function nonActionableResult(
  input: SelectReplacementPivotInput,
  reason: ReplacementPivotNonActionableReason,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementPivotNonActionableResult {
  const navigationPaths = currentFindingPaths(input.graph, input.finding, input.cohort);
  return {
    ...resultBase(input.request, provenance),
    status: "non-actionable",
    pivot: nonActionableEvidence(
      reason,
      input.request,
      input.finding,
      input.cohort,
      navigationPaths,
      provenance,
    ),
    alternative_pivots: [],
    non_actionable_reason: reason,
    candidate_line_results: staleCandidateLines(input.request, "pivot-unavailable"),
  };
}

/** Select or validate one causal repertoire pivot and validate every supplied SAN line per item. */
export function selectReplacementPivot(
  input: SelectReplacementPivotInput,
): ReplacementPivotSelectionResult {
  const { request, graph, finding, cohort } = input;
  const provenance = mergeProvenance(request, finding, cohort);
  const navigationPaths = currentFindingPaths(graph, finding, cohort);
  const incompatible = incompatibleReason(input);
  if (incompatible) return nonActionableResult(input, incompatible, provenance);

  const causality = finding.evidence.causality;
  const candidates = pivotCandidates(graph, finding, cohort, request.repertoire_color);

  if (request.pivot_selection.kind === "user-selected") {
    const selectedDecision = graph.decisions.find(
      (decision) => decision.decision_id === request.pivot_selection.decision_id,
    );
    if (!selectedDecision) {
      return nonActionableResult(input, "unknown-user-selected-decision", provenance);
    }
    if (
      selectedDecision.owner !== "repertoire" ||
      selectedDecision.mover_color !== request.repertoire_color
    ) {
      return nonActionableResult(input, "user-selected-decision-not-repertoire-owned", provenance);
    }
    const selected = candidates.find(
      (candidate) => candidate.decision.decision_id === selectedDecision.decision_id,
    );
    if (!selected) return nonActionableResult(input, "stale-user-selected-decision", provenance);
    const alternatives = candidates.filter((candidate) => candidate !== selected);
    const pivot = actionableEvidence(selected, alternatives, request, finding, cohort, provenance);
    return {
      ...resultBase(request, provenance),
      status: "selected",
      pivot,
      alternative_pivots: alternatives.map((candidate) =>
        actionableEvidence(candidate, candidates, request, finding, cohort, provenance),
      ),
      non_actionable_reason: null,
      candidate_line_results: validateCandidateLines(request, graph, pivot),
    };
  }

  if (causality.label === "mostly-opponent-forced") {
    return nonActionableResult(input, "opponent-controlled", provenance);
  }
  if (causality.label === "unknown" || causality.controllability === null) {
    return nonActionableResult(input, "unknown-causality", provenance);
  }
  if (candidates.length === 0) {
    return nonActionableResult(input, "no-supported-causal-pivot", provenance);
  }

  const coversEveryAffectedRoute = assertDefined(candidates[0]).unsupportedRouteIds.length === 0;
  if (
    causality.label === "shared-or-uncertain" ||
    candidates.length > 1 ||
    !coversEveryAffectedRoute
  ) {
    const alternativePivots = candidates.map((candidate) =>
      actionableEvidence(candidate, candidates, request, finding, cohort, provenance),
    ) as [ReplacementActionablePivotEvidence, ...ReplacementActionablePivotEvidence[]];
    return {
      ...resultBase(request, provenance),
      status: "alternatives-required",
      pivot: sharedEvidence(candidates, request, finding, cohort, navigationPaths, provenance),
      alternative_pivots: alternativePivots,
      non_actionable_reason: null,
      candidate_line_results: staleCandidateLines(request, "pivot-selection-required"),
    };
  }

  const pivot = actionableEvidence(assertDefined(candidates[0]), [], request, finding, cohort, provenance);
  return {
    ...resultBase(request, provenance),
    status: "selected",
    pivot,
    alternative_pivots: [],
    non_actionable_reason: null,
    candidate_line_results: validateCandidateLines(request, graph, pivot),
  };
}

/** Compile-time compatibility marker for consumers that accept the Task 8.1 pivot union. */
export function asReplacementCausalPivotEvidence(
  result: ReplacementPivotSelectionResult,
): ReplacementCausalPivotEvidence {
  return result.pivot;
}
