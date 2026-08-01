/**
 * Framework-free Task 8.7 replacement safety simulation.
 *
 * Current Task 8.6 results are recomputed from their retained Task 8.3-8.6 evidence before any
 * candidate enters this boundary. Candidate routes are then applied only to a structural GameTree
 * clone. This module reports safety evidence; it does not create Task 8.8 operations, change sets,
 * archive payloads, staged edits, or an applied tree.
 */
import type { Color } from "../congruence.js";
import type { GameTree } from "../pgn.js";
import { buildRepertoireGraph, type RepertoireGraph } from "./graph.js";
import { calculateStrategicFamiliarityAdjustedCoverage } from "./metrics.js";
import { buildStrategicConceptDictionary } from "./concepts.js";
import { buildStrategicTrajectories } from "./trajectory.js";
import { calculateStrategicRouteWeights } from "./weights.js";
import type { ReplacementCompleteCandidateExpansion } from "./replacement-expand.js";
import {
  scoreReplacementCandidates,
  type ReplacementCandidateScoringResult,
  type ReplacementScoredCandidate,
} from "./replacement-score.js";
import {
  STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  type ReplacementCoverageEffectState,
  type ReplacementCoverageEffects,
  type ReplacementCoverageReplyEffect,
  type ReplacementMetricEffect,
  type ReplacementRequest,
  type ReplacementSafetyCheck,
  type StrategicFitReplacementVersioned,
} from "./replacement-types.js";
import {
  type StrategicFitMetric,
  type StrategicFitMetricId,
  type StrategicFitSourceProvenance,
} from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_VERSION, STRATEGIC_FIT_SCHEMA_VERSION } from "./version.js";
import { assertDefined } from "../assert.js";

export const REPLACEMENT_SAFETY_ACTIONS = ["add-alternative", "replace"] as const;
export type ReplacementSafetyAction = (typeof REPLACEMENT_SAFETY_ACTIONS)[number];

export const REPLACEMENT_SAFETY_ACTION_LABELS = {
  "add-alternative": "Add alternative",
  replace: "Replace existing line",
} as const satisfies Readonly<Record<ReplacementSafetyAction, string>>;
export type ReplacementSafetyActionLabel =
  (typeof REPLACEMENT_SAFETY_ACTION_LABELS)[ReplacementSafetyAction];

export const REPLACEMENT_SAFETY_CANDIDATE_STATUSES = [
  "safe",
  "partial",
  "blocked",
  "unavailable",
] as const;
export type ReplacementSafetyCandidateStatus =
  (typeof REPLACEMENT_SAFETY_CANDIDATE_STATUSES)[number];

export const REPLACEMENT_SAFETY_RESULT_STATUSES = [
  "complete",
  "partial",
  "blocked",
  "unavailable",
  "stale",
  "invalid-request",
] as const;
export type ReplacementSafetyResultStatus = (typeof REPLACEMENT_SAFETY_RESULT_STATUSES)[number];

export const REPLACEMENT_SAFETY_ERROR_CODES = [
  "request-scoring-mismatch",
  "scoring-not-current",
  "source-graph-mismatch",
  "duplicate-candidate-action",
  "unknown-candidate",
  "invalid-candidate-action",
  "prune-not-confirmed",
  "candidate-unscored",
  "candidate-expansion-incomplete",
  "candidate-identity-mismatch",
  "simulation-failed",
  "required-reply-uncovered",
  "objective-safety-blocked",
] as const;
export type ReplacementSafetyErrorCode = (typeof REPLACEMENT_SAFETY_ERROR_CODES)[number];

export type ReplacementSafetyCandidateAction =
  | {
      readonly candidate_id: string;
      readonly action: "add-alternative";
    }
  | {
      readonly candidate_id: string;
      readonly action: "replace";
      /** Pruning is never inferred or selected by default. */
      readonly prune_explicitly_confirmed: true;
    };

export interface SimulateReplacementSafetyInput {
  readonly source_tree: GameTree;
  readonly request: ReplacementRequest;
  readonly scoring: ReplacementCandidateScoringResult;
  /** Unlisted candidates use the non-pruning `Add alternative` action. */
  readonly candidate_actions?: readonly ReplacementSafetyCandidateAction[];
}

export interface ReplacementCandidateSafetySimulation extends StrategicFitReplacementVersioned {
  readonly candidate_id: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly pivot_id: string | null;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly action: ReplacementSafetyAction;
  readonly action_label: ReplacementSafetyActionLabel;
  readonly status: ReplacementSafetyCandidateStatus;
  readonly error_code: ReplacementSafetyErrorCode | null;
  readonly explanation: string;
  /** Complete Task 8.6 value, retaining Task 8.3-8.5 evidence and Pareto status. */
  readonly scored_candidate: ReplacementScoredCandidate;
  readonly before_graph_id: string;
  readonly simulated_graph_id: string | null;
  readonly coverage_effects: ReplacementCoverageEffects;
  readonly safety_checks: readonly ReplacementSafetyCheck[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
  readonly source_tree_unchanged: true;
  readonly scored_candidate_unchanged: true;
  readonly evidence_unchanged: true;
  readonly inputs_unchanged: true;
}

export interface ReplacementSafetySimulationResult extends StrategicFitReplacementVersioned {
  readonly status: ReplacementSafetyResultStatus;
  readonly error_code: ReplacementSafetyErrorCode | null;
  readonly explanation: string;
  readonly request_id: string;
  readonly report_id: string;
  readonly finding_id: string;
  readonly semantic_finding_id: string;
  readonly cohort_id: string;
  readonly pivot_id: string | null;
  readonly repertoire_revision: string;
  readonly repertoire_color: Color;
  readonly request: ReplacementRequest;
  readonly scoring: ReplacementCandidateScoringResult;
  readonly candidates: readonly ReplacementCandidateSafetySimulation[];
  readonly safe_candidate_ids: readonly string[];
  readonly partial_candidate_ids: readonly string[];
  readonly blocked_candidate_ids: readonly string[];
  readonly unavailable_candidate_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
  readonly source_tree_unchanged: true;
  readonly request_unchanged: true;
  readonly scoring_unchanged: true;
  readonly source_context_unchanged: true;
  readonly expansion_unchanged: true;
  readonly evidence_unchanged: true;
  readonly inputs_unchanged: true;
}

interface BoundaryFailure {
  readonly status: Extract<ReplacementSafetyResultStatus, "stale" | "invalid-request">;
  readonly error: ReplacementSafetyErrorCode;
  readonly explanation: string;
}

interface RequiredReply {
  readonly key: string;
  readonly positionId: string;
  readonly decisionId: string | null;
  readonly san: string | null;
  readonly frequencies: readonly number[];
  readonly forcing: boolean;
  readonly sourceSanPaths: readonly (readonly string[])[];
  readonly reasons: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

const SEPARATOR = "\u001f";
const EPSILON = 1e-9;

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:replacement-safety",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  snapshot: null,
  reason: null,
});

function unavailablePopularityProvenance(decisionId: string): StrategicFitSourceProvenance {
  return {
    source_id: `strategic-fit:replacement-safety:popularity:${decisionId}`,
    kind: "opening-explorer",
    state: "unavailable",
    version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
    snapshot: null,
    reason: "No current popularity weight exists for this required semantic opponent reply.",
  };
}

function unavailableMetricInputProvenance(
  kind: "personal-history" | "manual-weight" | "finding-context",
): StrategicFitSourceProvenance {
  return {
    source_id: `strategic-fit:replacement-safety:missing:${kind}`,
    kind: kind === "personal-history" ? "personal-history" : "deterministic-core",
    state: "unavailable",
    version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
    snapshot: null,
    reason:
      kind === "finding-context"
        ? "Task 8.6 does not retain the full finding inputs required to recalculate training-adjusted workload."
        : `Task 8.6 does not retain post-clone ${kind} weighting evidence.`,
  };
}

function versioned(): StrategicFitReplacementVersioned {
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    replacement_schema_version: STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION,
  };
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function sortedPaths(values: readonly (readonly string[])[]): string[][] {
  const paths = new Map<string, string[]>();
  for (const value of values) paths.set(value.join(SEPARATOR), [...value]);
  return [...paths.values()].sort(
    (left, right) =>
      compareStrings(left.join(SEPARATOR), right.join(SEPARATOR)) || left.length - right.length,
  );
}

function mergeProvenance(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const values = new Map<string, StrategicFitSourceProvenance>();
  for (const source of groups.flat()) {
    const key = stableJson(source);
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

function sameVersions(value: StrategicFitReplacementVersioned): boolean {
  // `value` is a caller-supplied/persisted Task 8.6+ result; its version fields are typed as
  // exact literals, but that's a static declaration, not a runtime guarantee — stale or
  // cross-version data must be caught here, so the literal-vs-literal checks stay.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  return (
    value.schema_version === STRATEGIC_FIT_SCHEMA_VERSION &&
    value.analysis_version === STRATEGIC_FIT_ANALYSIS_VERSION &&
    value.replacement_schema_version === STRATEGIC_FIT_REPLACEMENT_SCHEMA_VERSION
  );
  /* eslint-enable @typescript-eslint/no-unnecessary-condition */
}

function sameIdentity(
  value: Pick<
    ReplacementCandidateScoringResult,
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

function canonicalRequest(request: ReplacementRequest): ReplacementRequest {
  const result = cloneJson(request);
  return {
    ...result,
    profile: {
      ...result.profile,
      preferences: {
        ...result.profile.preferences,
        preferred_concept_ids: sortedUnique(result.profile.preferences.preferred_concept_ids),
        avoided_concept_ids: sortedUnique(result.profile.preferences.avoided_concept_ids),
        preferred_tactical_character: sortedUnique(
          result.profile.preferences.preferred_tactical_character,
        ),
      },
    },
    candidate_sources: [...result.candidate_sources].sort(compareStrings),
    user_candidate_san_lines: sortedPaths(result.user_candidate_san_lines),
    provenance: mergeProvenance(result.provenance),
  };
}

function rescore(
  request: ReplacementRequest,
  scoring: ReplacementCandidateScoringResult,
): ReplacementCandidateScoringResult {
  return scoreReplacementCandidates({
    request,
    graph: scoring.context.graph,
    cohort: scoring.context.cohort,
    trajectories: scoring.context.trajectories,
    concepts: scoring.context.concepts,
    metrics: scoring.context.metrics,
    training: scoring.context.training,
    popularity: scoring.context.popularity,
    expansion: scoring.expansion,
  });
}

function boundaryFailure(
  input: SimulateReplacementSafetyInput,
  sourceGraph: RepertoireGraph,
  recomputed: ReplacementCandidateScoringResult,
): BoundaryFailure | null {
  const { request, scoring } = input;
  if (!sameVersions(request) || !sameVersions(scoring) || !sameIdentity(scoring, request)) {
    return {
      status: "stale",
      error: "request-scoring-mismatch",
      explanation:
        "Task 8.6 scoring identities, color, revision, or schema versions do not match the current request.",
    };
  }
  if (
    sourceGraph.repertoire_color !== request.repertoire_color ||
    stableJson(sourceGraph) !== stableJson(scoring.context.graph)
  ) {
    return {
      status: "stale",
      error: "source-graph-mismatch",
      explanation:
        "Source tree does not reproduce the canonical Task 8.6 graph and cannot be simulated safely.",
    };
  }
  if (
    (scoring.status !== "complete" && scoring.status !== "partial") ||
    scoring.error_code !== null ||
    // `scoring` is the caller-supplied prior Task 8.6 result; these fields are typed as literal
    // `true`, but that's only the declared shape — the actual persisted/passed-in value must be
    // revalidated at runtime since it may be stale or hand-edited.
    /* eslint-disable @typescript-eslint/no-unnecessary-condition */
    !scoring.source_graph_unchanged ||
    !scoring.source_context_unchanged ||
    !scoring.expansion_unchanged ||
    !scoring.inputs_unchanged ||
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    (recomputed.status !== "complete" && recomputed.status !== "partial") ||
    recomputed.error_code !== null ||
    stableJson(scoring) !== stableJson(recomputed)
  ) {
    return {
      status: "stale",
      error: "scoring-not-current",
      explanation:
        "Only a current deterministic Task 8.6 result with preserved Task 8.3-8.6 evidence can be simulated.",
    };
  }
  const actions = input.candidate_actions ?? [];
  const ids = new Set<string>();
  const known = new Set(recomputed.candidates.map((candidate) => candidate.candidate_id));
  for (const action of actions) {
    const rawAction = action as unknown as {
      readonly candidate_id?: unknown;
      readonly action?: unknown;
      readonly prune_explicitly_confirmed?: unknown;
    };
    if (
      typeof rawAction.candidate_id !== "string" ||
      (rawAction.action !== "add-alternative" && rawAction.action !== "replace")
    ) {
      return {
        status: "invalid-request",
        error: "invalid-candidate-action",
        explanation: "A candidate safety action has an invalid candidate ID or action.",
      };
    }
    if (rawAction.action === "replace" && rawAction.prune_explicitly_confirmed !== true) {
      return {
        status: "invalid-request",
        error: "prune-not-confirmed",
        explanation: `Candidate ${rawAction.candidate_id} cannot prune without explicit confirmation.`,
      };
    }
    if (ids.has(rawAction.candidate_id)) {
      return {
        status: "invalid-request",
        error: "duplicate-candidate-action",
        explanation: `Candidate ${rawAction.candidate_id} has more than one safety action.`,
      };
    }
    ids.add(rawAction.candidate_id);
    if (!known.has(rawAction.candidate_id)) {
      return {
        status: "invalid-request",
        error: "unknown-candidate",
        explanation: `Candidate ${rawAction.candidate_id} is absent from the current Task 8.6 result.`,
      };
    }
  }
  return null;
}

function candidateProvenance(
  candidate: ReplacementScoredCandidate,
): StrategicFitSourceProvenance[] {
  return mergeProvenance(
    [CORE_PROVENANCE],
    candidate.objective_quality.provenance,
    candidate.strategic_score.provenance,
    ...candidate.strategic_score.contributions.map((item) => item.provenance),
    candidate.trajectory_report?.provenance ?? [],
    candidate.concept_dictionary?.provenance ?? [],
    candidate.route_weighting?.provenance ?? [],
    ...candidate.expansion.seed.provenance.map((item) => item.provenance),
    ...candidate.expansion.source_results.map((item) => item.provenance),
    ...candidate.expansion.evidence_item_results.map((item) => item.provenance),
    ...candidate.expansion.unresolved_risks.map((item) => item.provenance),
  );
}

function actionFor(
  candidateId: string,
  actions: readonly ReplacementSafetyCandidateAction[],
): ReplacementSafetyAction {
  return actions.find((item) => item.candidate_id === candidateId)?.action ?? "add-alternative";
}

function candidateBoundaryError(
  candidate: ReplacementScoredCandidate,
  request: ReplacementRequest,
): { error: ReplacementSafetyErrorCode; explanation: string } | null {
  if (
    !sameVersions(candidate) ||
    !sameIdentity(candidate, request) ||
    candidate.repertoire_color !== candidate.expansion.seed.mover_color
  ) {
    return {
      error: "candidate-identity-mismatch",
      explanation:
        "Candidate identity, version, pivot, or repertoire ownership does not match its Task 8.6 boundary.",
    };
  }
  if (
    candidate.pareto.status === "unscored" ||
    candidate.state === "unavailable" ||
    candidate.trajectory_report === null ||
    candidate.concept_dictionary === null
  ) {
    return {
      error: "candidate-unscored",
      explanation:
        "Unscored Task 8.6 candidates remain inspectable but cannot masquerade as safety simulations.",
    };
  }
  // `candidate` is a caller-supplied/persisted Task 8.5-8.6 result; the discriminated-union
  // and literal types declare that a "complete" expansion always has a "complete" subtree, but
  // that's only the compile-time shape of freshly-built data — retained/passed-in evidence must
  // be revalidated at runtime in case it's stale, truncated, or otherwise doesn't match.
  /* eslint-disable @typescript-eslint/no-unnecessary-condition */
  if (
    candidate.expansion.status !== "complete" ||
    candidate.expansion.subtree?.status !== "complete"
  ) {
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */
    return {
      error: "candidate-expansion-incomplete",
      explanation:
        "Truncated, blocked, stale, cancelled, illegal, or unavailable Task 8.5 work cannot be simulated safely.",
    };
  }
  return null;
}

function routeSans(expansion: ReplacementCompleteCandidateExpansion): string[][] {
  const edges = new Map(expansion.subtree.edges.map((edge) => [edge.edge_id, edge]));
  const routes = new Map<string, string[]>();
  for (const route of expansion.subtree.routes) {
    const sans = route.edge_ids.map((edgeId) => assertDefined(edges.get(edgeId)).san);
    routes.set(sans.join(SEPARATOR), sans);
  }
  return [...routes.values()].sort(
    (left, right) =>
      compareStrings(left.join(SEPARATOR), right.join(SEPARATOR)) || left.length - right.length,
  );
}

function pivotDecisionPaths(
  candidate: ReplacementScoredCandidate,
  sourceGraph: RepertoireGraph,
): string[][] {
  const pivot = candidate.expansion.seed.pivot;
  const decision = sourceGraph.decisions.find((item) => item.decision_id === pivot.decision_id);
  if (!decision) return [];
  const disclosed = new Set(pivot.source_san_paths.map((path) => path.join(SEPARATOR)));
  const matched = decision.source_san_paths.filter((path) => disclosed.has(path.join(SEPARATOR)));
  return sortedPaths(matched.length > 0 ? matched : decision.source_san_paths);
}

function simulateTree(
  source: GameTree,
  sourceGraph: RepertoireGraph,
  candidate: ReplacementScoredCandidate,
  action: ReplacementSafetyAction,
): GameTree | null {
  const expansion = candidate.expansion as ReplacementCompleteCandidateExpansion;
  const decisionPaths = pivotDecisionPaths(candidate, sourceGraph);
  if (decisionPaths.length === 0) return null;
  if (action === "replace" && expansion.seed.san === expansion.seed.pivot.san) return null;
  let clone = source.clone();
  const routes = routeSans(expansion);
  for (const decisionPath of decisionPaths) {
    const parentSanPath = decisionPath.slice(0, -1);
    const parentIndexPath = clone.indexPathOfSan(parentSanPath);
    if (parentIndexPath === null) return null;
    for (const route of routes) {
      let cursor = [...parentIndexPath];
      for (const san of route) cursor = clone.appendSan(cursor, san).path;
    }
  }
  if (action === "replace") {
    for (const decisionPath of [...decisionPaths].sort(
      (left, right) =>
        right.length - left.length || compareStrings(right.join(SEPARATOR), left.join(SEPARATOR)),
    )) {
      const edited = clone.edit("prune", decisionPath);
      if (!edited.tree) return null;
      clone = edited.tree;
    }
  }
  return clone;
}

function replyKey(positionId: string, decisionId: string | null, san: string | null): string {
  return decisionId ?? [positionId, san ?? "unknown"].join(SEPARATOR);
}

function addRequirement(
  requirements: Map<string, RequiredReply>,
  value: Omit<RequiredReply, "key">,
): void {
  const key = replyKey(value.positionId, value.decisionId, value.san);
  const existing = requirements.get(key);
  requirements.set(key, {
    key,
    positionId: value.positionId,
    decisionId: value.decisionId ?? existing?.decisionId ?? null,
    san: value.san ?? existing?.san ?? null,
    frequencies: [...(existing?.frequencies ?? []), ...value.frequencies],
    forcing: value.forcing || (existing?.forcing ?? false),
    sourceSanPaths: sortedPaths([...(existing?.sourceSanPaths ?? []), ...value.sourceSanPaths]),
    reasons: sortedUnique([...(existing?.reasons ?? []), ...value.reasons]),
    provenance: mergeProvenance(existing?.provenance ?? [], value.provenance),
  });
}

function popularityByDecision(
  scoring: ReplacementCandidateScoringResult,
): ReadonlyMap<string, number> {
  const evidence = scoring.context.popularity;
  const evidenceById = new Map(
    (evidence?.decision_weights ?? []).map((item) => [item.decision_id, item.weight]),
  );
  const grouped = new Map<string, (typeof scoring.context.graph.decisions)[number][]>();
  for (const decision of scoring.context.graph.decisions) {
    if (decision.owner !== "opponent") continue;
    const values = grouped.get(decision.from_position_id) ?? [];
    values.push(decision);
    grouped.set(decision.from_position_id, values);
  }
  const normalized = new Map<string, number>();
  for (const values of grouped.values()) {
    if (values.length === 1) {
      normalized.set(assertDefined(values[0]).decision_id, 1);
      continue;
    }
    const weighted = values.map((decision) => ({
      id: decision.decision_id,
      weight: evidenceById.get(decision.decision_id),
    }));
    if (
      weighted.some(
        (item) => item.weight === undefined || !Number.isFinite(item.weight) || item.weight < 0,
      )
    )
      continue;
    const total = weighted.reduce((sum, item) => sum + assertDefined(item.weight), 0);
    if (total <= EPSILON) continue;
    for (const item of weighted) normalized.set(item.id, assertDefined(item.weight) / total);
  }
  return normalized;
}

function requirementsFor(
  before: RepertoireGraph,
  scoring: ReplacementCandidateScoringResult,
  candidate: ReplacementScoredCandidate,
): RequiredReply[] {
  const requirements = new Map<string, RequiredReply>();
  const popularity = popularityByDecision(scoring);
  for (const decision of before.decisions) {
    const frequency = popularity.get(decision.decision_id);
    if (decision.owner !== "opponent") continue;
    addRequirement(requirements, {
      positionId: decision.from_position_id,
      decisionId: decision.decision_id,
      san: decision.san,
      frequencies: frequency === undefined ? [] : [frequency],
      forcing: false,
      sourceSanPaths: decision.source_san_paths,
      reasons: [
        "Current population-weighted opponent reply remains required while its semantic position is reachable.",
      ],
      provenance: mergeProvenance(
        [CORE_PROVENANCE],
        scoring.context.popularity?.provenance ?? [],
        frequency === undefined ? [unavailablePopularityProvenance(decision.decision_id)] : [],
      ),
    });
  }
  const expansion = candidate.expansion as ReplacementCompleteCandidateExpansion;
  const nodes = new Map(expansion.subtree.nodes.map((node) => [node.node_id, node]));
  const edgeByReply = new Map(
    expansion.subtree.edges
      .filter((edge) => edge.owner === "opponent")
      .map((edge) => {
        const from = assertDefined(nodes.get(edge.from_node_id));
        return [`${from.position_id}${SEPARATOR}${edge.san}`, edge] as const;
      }),
  );
  for (const edge of expansion.subtree.edges) {
    if (edge.owner !== "opponent") continue;
    const from = assertDefined(nodes.get(edge.from_node_id));
    addRequirement(requirements, {
      positionId: from.position_id,
      decisionId: edge.decision_id,
      san: edge.san,
      frequencies:
        edge.expected_opponent_frequency === null ? [] : [edge.expected_opponent_frequency],
      forcing: edge.forcing,
      sourceSanPaths: edge.source_san_paths,
      reasons: [
        edge.forcing
          ? "Task 8.5 classified this legal opponent reply as forcing and required its inclusion."
          : "Task 8.5 included this opponent reply in the complete bounded subtree.",
      ],
      provenance: candidateProvenance(candidate),
    });
  }
  for (const item of expansion.evidence_item_results) {
    if (!item.important && !item.forcing) continue;
    const matchedEdge = edgeByReply.get(
      `${item.position.position_id}${SEPARATOR}${item.canonical_san ?? item.input_san}`,
    );
    addRequirement(requirements, {
      positionId: item.position.position_id,
      decisionId: matchedEdge?.decision_id ?? null,
      san: item.canonical_san ?? item.input_san,
      frequencies: item.played_probability === null ? [] : [item.played_probability],
      forcing: item.forcing,
      sourceSanPaths: [],
      reasons: [
        `Task 8.5 ${item.important ? "important" : "forcing"} reply evidence is ${item.status}.`,
      ],
      provenance: item.provenance,
    });
  }
  for (const omission of expansion.omissions) {
    if (!omission.important && !omission.forcing) continue;
    addRequirement(requirements, {
      positionId: omission.position_id,
      decisionId: omission.decision_id,
      san: omission.san,
      frequencies: omission.played_probability === null ? [] : [omission.played_probability],
      forcing: omission.forcing,
      sourceSanPaths: [],
      reasons: [`Task 8.5 required reply omission remains explicit: ${omission.explanation}`],
      provenance: omission.provenance,
    });
  }
  return [...requirements.values()].sort(
    (left, right) =>
      compareStrings(left.positionId, right.positionId) ||
      compareStrings(left.decisionId ?? "", right.decisionId ?? "") ||
      compareStrings(left.san ?? "", right.san ?? ""),
  );
}

function covered(graph: RepertoireGraph, reply: RequiredReply): boolean {
  if (
    reply.decisionId !== null &&
    graph.decisions.some(
      (decision) => decision.decision_id === reply.decisionId && decision.owner === "opponent",
    )
  )
    return true;
  return (
    reply.san !== null &&
    graph.decisions.some(
      (decision) =>
        decision.from_position_id === reply.positionId &&
        decision.owner === "opponent" &&
        decision.san === reply.san,
    )
  );
}

function effect(reply: RequiredReply, reason: string): ReplacementCoverageReplyEffect {
  const known = reply.frequencies.filter(
    (value) => Number.isFinite(value) && value >= 0 && value <= 1,
  );
  const state: ReplacementCoverageEffectState =
    known.length === 0
      ? "unavailable"
      : known.length === reply.frequencies.length
        ? "available"
        : "partial";
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    state,
    position_id: reply.positionId,
    decision_id: reply.decisionId,
    san: reply.san,
    expected_frequency:
      known.length === reply.frequencies.length && known.length > 0
        ? round(known.reduce((sum, value) => sum + value, 0) / known.length)
        : null,
    forcing: reply.forcing,
    source_san_paths: sortedPaths(reply.sourceSanPaths),
    reason: [...reply.reasons, reason].join(" "),
    provenance: mergeProvenance(reply.provenance),
  };
}

function weightedCoverage(
  replies: readonly RequiredReply[],
  graph: RepertoireGraph,
): number | null {
  if (replies.length === 0) return 1;
  const frequencies = replies.map((reply) => {
    const known = reply.frequencies.filter(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    );
    return known.length === reply.frequencies.length && known.length > 0
      ? known.reduce((sum, value) => sum + value, 0) / known.length
      : null;
  });
  if (frequencies.some((value) => value === null)) return null;
  // Safe to treat as number[] from here: the check above already ruled out any null entry, and
  // `numericFrequencies` is `replies.map(...)`, so it is index-parallel with `replies` below.
  const numericFrequencies = frequencies as number[];
  const total = numericFrequencies.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) return null;
  const coveredWeight = replies.reduce(
    (sum, reply, index) =>
      sum + (covered(graph, reply) ? assertDefined(numericFrequencies[index]) : 0),
    0,
  );
  return round(coveredWeight / total);
}

function duplicateBranchIds(
  before: RepertoireGraph,
  after: RepertoireGraph,
  candidate: ReplacementScoredCandidate,
): string[] {
  const beforeRoutes = new Map(
    before.routes.map((route) => [route.route_id, route.source_route_count]),
  );
  const duplicates = after.routes
    .filter(
      (route) =>
        route.source_route_count > Math.max(1, beforeRoutes.get(route.route_id) ?? 1) &&
        route.source_route_count > (beforeRoutes.get(route.route_id) ?? 0),
    )
    .map((route) => route.route_id);
  const pivot = candidate.expansion.seed.pivot;
  const candidateUci = candidate.expansion.seed.uci;
  for (const route of before.routes) {
    const pivotIndex = route.decision_ids.indexOf(pivot.decision_id);
    if (pivotIndex < 0) continue;
    const fromPosition = route.position_ids[pivotIndex];
    if (
      before.decisions.some(
        (decision) => decision.from_position_id === fromPosition && decision.uci === candidateUci,
      )
    )
      duplicates.push(route.route_id);
  }
  return sortedUnique(duplicates);
}

function newTranspositionIds(before: RepertoireGraph, after: RepertoireGraph): string[] {
  const existing = new Set(before.transposition_links.map((link) => link.position_id));
  return sortedUnique(
    after.transposition_links
      .map((link) => link.position_id)
      .filter((positionId) => !existing.has(positionId)),
  );
}

function metricById(
  scoring: ReplacementCandidateScoringResult,
  metricId: StrategicFitMetricId,
): StrategicFitMetric<unknown> {
  const key = metricId.replaceAll("-", "_") as keyof typeof scoring.context.metrics;
  return scoring.context.metrics[key] as StrategicFitMetric<unknown>;
}

function scalarMetric(metric: StrategicFitMetric<unknown>): number | null {
  return typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : null;
}

function affectedMetrics(
  after: RepertoireGraph,
  scoring: ReplacementCandidateScoringResult,
  candidate: ReplacementScoredCandidate,
): ReplacementMetricEffect[] {
  const beforeMetric = metricById(scoring, "familiarity-adjusted-coverage");
  const before = scalarMetric(beforeMetric);
  let afterMetric: StrategicFitMetric<number>;
  try {
    const knownWeights = new Map<
      string,
      { weight: number; provenance: readonly StrategicFitSourceProvenance[] }
    >();
    for (const item of scoring.context.popularity?.decision_weights ?? []) {
      knownWeights.set(item.decision_id, {
        weight: item.weight,
        provenance: item.provenance ?? [],
      });
    }
    const expansion = candidate.expansion as ReplacementCompleteCandidateExpansion;
    for (const edge of expansion.subtree.edges) {
      if (edge.owner === "opponent" && edge.expected_opponent_frequency !== null) {
        knownWeights.set(edge.decision_id, {
          weight: edge.expected_opponent_frequency,
          provenance: candidateProvenance(candidate),
        });
      }
    }
    const opponentByPosition = new Map<string, (typeof after.decisions)[number][]>();
    for (const decision of after.decisions) {
      if (decision.owner !== "opponent") continue;
      const group = opponentByPosition.get(decision.from_position_id) ?? [];
      group.push(decision);
      opponentByPosition.set(decision.from_position_id, group);
    }
    const decisionWeights = [...opponentByPosition.values()].flatMap((group) =>
      group.flatMap((decision) => {
        const known = knownWeights.get(decision.decision_id);
        if (known)
          return [
            {
              decision_id: decision.decision_id,
              weight: known.weight,
              provenance: known.provenance,
            },
          ];
        return group.length === 1
          ? [{ decision_id: decision.decision_id, weight: 1, provenance: [CORE_PROVENANCE] }]
          : [];
      }),
    );
    const preferences = scoring.context.profile.preferences;
    const missingWeightSources: StrategicFitSourceProvenance[] = [];
    if (preferences.personal_game_frequency_importance > 0) {
      missingWeightSources.push(unavailableMetricInputProvenance("personal-history"));
    }
    if (preferences.manual_weight_importance > 0) {
      missingWeightSources.push(unavailableMetricInputProvenance("manual-weight"));
    }
    const popularityState = scoring.context.popularity?.state;
    const marketState =
      popularityState === "complete"
        ? ("available" as const)
        : popularityState === "partial"
          ? ("partial" as const)
          : ("unavailable" as const);
    const weights = calculateStrategicRouteWeights(after, {
      mode: "external",
      source_coefficients: {
        market: preferences.opponent_popularity_importance,
        personal: preferences.personal_game_frequency_importance,
        manual: preferences.manual_weight_importance,
      },
      market: {
        state: marketState,
        decision_weights: decisionWeights,
        provenance: mergeProvenance(
          scoring.context.popularity?.provenance ?? [],
          marketState === "unavailable"
            ? [unavailablePopularityProvenance("metric-weighting")]
            : [],
        ),
      },
      provenance: mergeProvenance(
        [CORE_PROVENANCE],
        candidateProvenance(candidate),
        missingWeightSources,
      ),
    });
    const trajectories = buildStrategicTrajectories(after, {
      configuredPlies: scoring.context.trajectories.configured_plies,
    });
    const concepts = buildStrategicConceptDictionary(trajectories);
    afterMetric = calculateStrategicFamiliarityAdjustedCoverage({
      weights,
      concepts,
      training: scoring.context.training ?? undefined,
    });
    if (
      missingWeightSources.length > 0 ||
      marketState !== "available" ||
      weights.state !== "complete"
    ) {
      afterMetric = {
        ...afterMetric,
        state: afterMetric.state === "unavailable" ? "unavailable" : "partial",
        reason:
          `${afterMetric.reason ?? "Canonical familiarity coverage was calculated."} ` +
          "Missing requested profile weighting sources or conditional-decision fallbacks keep the post-clone metric partial.",
        provenance: mergeProvenance(
          afterMetric.provenance,
          missingWeightSources,
          marketState === "unavailable"
            ? [unavailablePopularityProvenance("metric-weighting")]
            : [],
        ),
      };
    }
  } catch {
    afterMetric = {
      analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
      metric_id: "familiarity-adjusted-coverage",
      state: "unavailable",
      value: null,
      unit: beforeMetric.unit,
      reason:
        "Canonical post-clone familiarity inputs could not be rebuilt from retained Task 8.6 evidence.",
      provenance: mergeProvenance(beforeMetric.provenance, candidateProvenance(candidate)),
    };
  }
  const afterValue = scalarMetric(afterMetric);
  const state: ReplacementCoverageEffectState =
    before === null || afterValue === null
      ? "unavailable"
      : beforeMetric.state === "partial" || afterMetric.state === "partial"
        ? "partial"
        : "available";
  const familiarityEffect: ReplacementMetricEffect = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: "familiarity-adjusted-coverage",
    state,
    before,
    after: afterValue,
    delta: before === null || afterValue === null ? null : round(afterValue - before),
    unit: beforeMetric.unit,
    reason:
      afterMetric.reason ??
      "Canonical post-clone familiarity coverage was rebuilt from semantic graph, weighting, concept, and training evidence.",
    provenance: mergeProvenance(
      beforeMetric.provenance,
      afterMetric.provenance,
      candidateProvenance(candidate),
    ),
  };
  const trainingBefore = metricById(scoring, "training-adjusted-workload");
  const missingFinding = unavailableMetricInputProvenance("finding-context");
  const trainingEffect: ReplacementMetricEffect = {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: "training-adjusted-workload",
    state: "unavailable",
    before: scalarMetric(trainingBefore),
    after: null,
    delta: null,
    unit: trainingBefore.unit,
    reason: missingFinding.reason,
    provenance: mergeProvenance(trainingBefore.provenance, candidateProvenance(candidate), [
      missingFinding,
    ]),
  };
  return [familiarityEffect, trainingEffect];
}

function coverageEffects(
  before: RepertoireGraph,
  after: RepertoireGraph,
  scoring: ReplacementCandidateScoringResult,
  candidate: ReplacementScoredCandidate,
): ReplacementCoverageEffects {
  const replies = requirementsFor(before, scoring, candidate);
  const beforeCoverage = weightedCoverage(replies, before);
  const afterCoverage = weightedCoverage(replies, after);
  const popularityState = scoring.context.popularity?.state;
  const popularityIncomplete =
    popularityState === undefined ||
    popularityState === "partial" ||
    popularityState === "unavailable" ||
    popularityState === "cancelled";
  const missingFrequency = replies.some((reply) => reply.frequencies.length === 0);
  const state: ReplacementCoverageEffectState =
    replies.length === 0 && !popularityIncomplete
      ? "available"
      : beforeCoverage === null || afterCoverage === null
        ? replies.some((reply) => reply.frequencies.length > 0)
          ? "partial"
          : "unavailable"
        : missingFrequency || popularityIncomplete
          ? "partial"
          : "available";
  const newlyUncovered = replies
    .filter((reply) => covered(before, reply) && !covered(after, reply))
    .map((reply) =>
      effect(
        reply,
        reply.forcing
          ? "A required forcing reply was covered before simulation and is uncovered after simulation."
          : "A required opponent reply was covered before simulation and is uncovered after simulation.",
      ),
    );
  const newlyCovered = replies
    .filter((reply) => !covered(before, reply) && covered(after, reply))
    .map((reply) =>
      effect(
        reply,
        reply.forcing
          ? "Simulation newly covers a required forcing reply."
          : "Simulation newly covers a required opponent reply.",
      ),
    );
  const provenance = mergeProvenance(
    [CORE_PROVENANCE],
    scoring.context.popularity?.provenance ?? [],
    candidateProvenance(candidate),
    ...replies.map((reply) => reply.provenance),
  );
  const metrics = affectedMetrics(after, scoring, candidate);
  return {
    ...versioned(),
    state,
    popularity_weighted_before: beforeCoverage,
    popularity_weighted_after: afterCoverage,
    popularity_weighted_delta:
      beforeCoverage === null || afterCoverage === null
        ? null
        : round(afterCoverage - beforeCoverage),
    required_reply_count_before: replies.filter((reply) => covered(before, reply)).length,
    required_reply_count_after: replies.filter((reply) => covered(after, reply)).length,
    newly_uncovered_replies: newlyUncovered,
    newly_covered_replies: newlyCovered,
    duplicate_branch_ids: duplicateBranchIds(before, after, candidate),
    new_transposition_position_ids: newTranspositionIds(before, after),
    affected_metrics: metrics,
    reason:
      state === "available"
        ? "Coverage uses canonical opponent decisions, semantic transposition joins, and expected-frequency evidence without counting navigation aliases."
        : state === "partial"
          ? "Known coverage is retained, but missing or partial popularity/reply evidence is not counted as zero and no coverage check is passed."
          : "Popularity-weighted coverage is unavailable because required reply frequency evidence is missing; counts and reply identities remain explicit.",
    provenance,
  };
}

function safetyCheck(
  kind: ReplacementSafetyCheck["kind"],
  status: ReplacementSafetyCheck["status"],
  explanation: string,
  provenance: readonly StrategicFitSourceProvenance[],
): ReplacementSafetyCheck {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    kind,
    status,
    explanation,
    risk_ids: [],
    provenance: mergeProvenance(provenance),
  };
}

function checksFor(
  candidate: ReplacementScoredCandidate,
  effects: ReplacementCoverageEffects,
): ReplacementSafetyCheck[] {
  const provenance = candidateProvenance(candidate);
  const uncovered = effects.newly_uncovered_replies;
  const metricStates = effects.affected_metrics.map((metric) => metric.state);
  const objective = candidate.objective_quality;
  const engineStatus: ReplacementSafetyCheck["status"] =
    objective.state === "unavailable" || objective.repertoire_pov_verdict === "unverified"
      ? "unavailable"
      : objective.state === "partial"
        ? "warning"
        : objective.repertoire_pov_verdict === "outside-tolerance" ||
            objective.repertoire_pov_verdict === "forced-mate-against-repertoire"
          ? "blocked"
          : "passed";
  const coverageStatus: ReplacementSafetyCheck["status"] =
    uncovered.length > 0
      ? "blocked"
      : effects.state === "available"
        ? "passed"
        : effects.state === "partial"
          ? "warning"
          : "unavailable";
  const metricStatus: ReplacementSafetyCheck["status"] =
    metricStates.length > 0 && metricStates.every((state) => state === "available")
      ? "passed"
      : metricStates.some((state) => state === "partial")
        ? "warning"
        : "unavailable";
  const order: readonly ReplacementSafetyCheck["kind"][] = [
    "legality",
    "engine-sanity",
    "coverage",
    "gap-scan",
    "transpositions",
    "duplicates",
    "stale-revision",
    "affected-cohort-preview",
  ];
  return [
    safetyCheck(
      "legality",
      "passed",
      "Every simulated SAN route rebuilt into a legal canonical graph on a clone.",
      provenance,
    ),
    safetyCheck(
      "engine-sanity",
      engineStatus,
      engineStatus === "passed"
        ? "Repertoire-POV objective evidence passes its configured verdict; White-POV transport remains separately labeled."
        : engineStatus === "blocked"
          ? "Repertoire-POV objective evidence is outside tolerance or forced mate against the repertoire."
          : "Complete repertoire-POV objective evidence is unavailable; engine safety is not passed.",
      objective.provenance,
    ),
    safetyCheck(
      "coverage",
      coverageStatus,
      uncovered.length > 0
        ? `${uncovered.length} required opponent replies become uncovered.`
        : effects.state === "available"
          ? "Popularity-weighted required-reply coverage is complete."
          : "Coverage evidence is missing or partial; known values remain explicit and the check is not passed.",
      effects.provenance,
    ),
    safetyCheck(
      "gap-scan",
      uncovered.length > 0 ? "blocked" : effects.state === "available" ? "passed" : "unavailable",
      uncovered.length > 0
        ? "Clone comparison creates required-reply gaps."
        : effects.state === "available"
          ? "No required-reply gap appears in the cloned semantic graph."
          : "Gap absence cannot be established from incomplete coverage evidence.",
      effects.provenance,
    ),
    safetyCheck(
      "transpositions",
      effects.new_transposition_position_ids.length > 0 ? "warning" : "passed",
      effects.new_transposition_position_ids.length > 0
        ? `${effects.new_transposition_position_ids.length} new canonical transposition positions are disclosed.`
        : "No new canonical transposition position appears.",
      effects.provenance,
    ),
    safetyCheck(
      "duplicates",
      effects.duplicate_branch_ids.length > 0 ? "warning" : "passed",
      effects.duplicate_branch_ids.length > 0
        ? `${effects.duplicate_branch_ids.length} semantic or editorial duplicate branches are disclosed.`
        : "No new semantic or editorial duplicate branch appears.",
      effects.provenance,
    ),
    safetyCheck(
      "stale-revision",
      "passed",
      "Request, source graph, scoring context, and retained Task 8.3-8.6 evidence were revalidated as current.",
      provenance,
    ),
    safetyCheck(
      "affected-cohort-preview",
      metricStatus,
      metricStatus === "passed"
        ? "Affected Strategic Fit metric before/after/delta evidence is complete."
        : "Affected Strategic Fit metric evidence is missing or partial; the preview check is not passed.",
      mergeProvenance(...effects.affected_metrics.map((metric) => metric.provenance)),
    ),
  ].sort((left, right) => order.indexOf(left.kind) - order.indexOf(right.kind));
}

function emptyCoverage(
  candidate: ReplacementScoredCandidate,
  reason: string,
): ReplacementCoverageEffects {
  return {
    ...versioned(),
    state: "unavailable",
    popularity_weighted_before: null,
    popularity_weighted_after: null,
    popularity_weighted_delta: null,
    required_reply_count_before: 0,
    required_reply_count_after: 0,
    newly_uncovered_replies: [],
    newly_covered_replies: [],
    duplicate_branch_ids: [],
    new_transposition_position_ids: [],
    affected_metrics: [],
    reason,
    provenance: candidateProvenance(candidate),
  };
}

function unavailableCandidate(
  request: ReplacementRequest,
  sourceGraph: RepertoireGraph,
  candidate: ReplacementScoredCandidate,
  action: ReplacementSafetyAction,
  error: ReplacementSafetyErrorCode,
  explanation: string,
): ReplacementCandidateSafetySimulation {
  return {
    ...versioned(),
    candidate_id: candidate.candidate_id,
    request_id: request.request_id,
    report_id: request.report_id,
    finding_id: request.finding_id,
    semantic_finding_id: request.semantic_finding_id,
    cohort_id: request.cohort_id,
    pivot_id: candidate.expansion.seed.pivot.pivot_id,
    repertoire_revision: request.repertoire_revision,
    repertoire_color: request.repertoire_color,
    action,
    action_label: REPLACEMENT_SAFETY_ACTION_LABELS[action],
    status: "unavailable",
    error_code: error,
    explanation,
    scored_candidate: cloneJson(candidate),
    before_graph_id: sourceGraph.graph_id,
    simulated_graph_id: null,
    coverage_effects: emptyCoverage(candidate, explanation),
    safety_checks: [],
    provenance: candidateProvenance(candidate),
    source_tree_unchanged: true,
    scored_candidate_unchanged: true,
    evidence_unchanged: true,
    inputs_unchanged: true,
  };
}

function simulateCandidate(
  input: SimulateReplacementSafetyInput,
  sourceGraph: RepertoireGraph,
  scoring: ReplacementCandidateScoringResult,
  candidate: ReplacementScoredCandidate,
): ReplacementCandidateSafetySimulation {
  const action = actionFor(candidate.candidate_id, input.candidate_actions ?? []);
  const boundary = candidateBoundaryError(candidate, input.request);
  if (boundary)
    return unavailableCandidate(
      input.request,
      sourceGraph,
      candidate,
      action,
      boundary.error,
      boundary.explanation,
    );
  const clone = simulateTree(input.source_tree, sourceGraph, candidate, action);
  if (!clone)
    return unavailableCandidate(
      input.request,
      sourceGraph,
      candidate,
      action,
      "simulation-failed",
      "Candidate subtree could not be applied and, when requested, pruned on a legal source clone.",
    );
  let simulatedGraph: RepertoireGraph;
  try {
    simulatedGraph = buildRepertoireGraph(clone, input.request.repertoire_color);
  } catch {
    return unavailableCandidate(
      input.request,
      sourceGraph,
      candidate,
      action,
      "simulation-failed",
      "Cloned candidate application did not produce a legal canonical repertoire graph.",
    );
  }
  const effects = coverageEffects(sourceGraph, simulatedGraph, scoring, candidate);
  const checks = checksFor(candidate, effects);
  const blockingChecks = checks.filter((check) => check.status === "blocked");
  const blocked = blockingChecks.length > 0;
  const incomplete =
    candidate.state !== "available" ||
    effects.state !== "available" ||
    checks.some(
      (check) =>
        check.kind === "engine-sanity" &&
        (check.status === "warning" || check.status === "unavailable"),
    );
  const status: ReplacementSafetyCandidateStatus = blocked
    ? "blocked"
    : incomplete
      ? "partial"
      : "safe";
  const explanation = blocked
    ? blockingChecks.some((check) => check.kind === "coverage" || check.kind === "gap-scan")
      ? "Replacement pruning is blocked because one or more required replies become uncovered."
      : "Candidate safety is blocked because objective evidence is outside tolerance or forced mate against the repertoire."
    : status === "safe"
      ? `${REPLACEMENT_SAFETY_ACTION_LABELS[action]} is safely simulated on a clone; every blocking legality, objective, and coverage check passed, while advisory metric states remain explicit.`
      : `${REPLACEMENT_SAFETY_ACTION_LABELS[action]} is simulated, but missing or partial evidence prevents a fully passed safety result.`;
  return {
    ...versioned(),
    candidate_id: candidate.candidate_id,
    request_id: input.request.request_id,
    report_id: input.request.report_id,
    finding_id: input.request.finding_id,
    semantic_finding_id: input.request.semantic_finding_id,
    cohort_id: input.request.cohort_id,
    pivot_id: candidate.expansion.seed.pivot.pivot_id,
    repertoire_revision: input.request.repertoire_revision,
    repertoire_color: input.request.repertoire_color,
    action,
    action_label: REPLACEMENT_SAFETY_ACTION_LABELS[action],
    status,
    error_code: blocked
      ? blockingChecks.some((check) => check.kind === "coverage" || check.kind === "gap-scan")
        ? "required-reply-uncovered"
        : "objective-safety-blocked"
      : null,
    explanation,
    scored_candidate: cloneJson(candidate),
    before_graph_id: sourceGraph.graph_id,
    simulated_graph_id: simulatedGraph.graph_id,
    coverage_effects: effects,
    safety_checks: checks,
    provenance: mergeProvenance(candidateProvenance(candidate), effects.provenance),
    source_tree_unchanged: true,
    scored_candidate_unchanged: true,
    evidence_unchanged: true,
    inputs_unchanged: true,
  };
}

function baseResult(
  input: SimulateReplacementSafetyInput,
  scoring: ReplacementCandidateScoringResult,
  status: ReplacementSafetyResultStatus,
  error: ReplacementSafetyErrorCode | null,
  explanation: string,
  candidates: readonly ReplacementCandidateSafetySimulation[],
): ReplacementSafetySimulationResult {
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
    pivot_id: scoring.pivot_id,
    repertoire_revision: input.request.repertoire_revision,
    repertoire_color: input.request.repertoire_color,
    request: canonicalRequest(input.request),
    scoring: cloneJson(scoring),
    candidates: ordered,
    safe_candidate_ids: ordered
      .filter((candidate) => candidate.status === "safe")
      .map((candidate) => candidate.candidate_id),
    partial_candidate_ids: ordered
      .filter((candidate) => candidate.status === "partial")
      .map((candidate) => candidate.candidate_id),
    blocked_candidate_ids: ordered
      .filter((candidate) => candidate.status === "blocked")
      .map((candidate) => candidate.candidate_id),
    unavailable_candidate_ids: ordered
      .filter((candidate) => candidate.status === "unavailable")
      .map((candidate) => candidate.candidate_id),
    provenance: mergeProvenance(
      [CORE_PROVENANCE],
      input.request.provenance,
      scoring.provenance,
      ...ordered.map((candidate) => candidate.provenance),
    ),
    source_tree_unchanged: true,
    request_unchanged: true,
    scoring_unchanged: true,
    source_context_unchanged: true,
    expansion_unchanged: true,
    evidence_unchanged: true,
    inputs_unchanged: true,
  };
}

/** Simulate every current scored candidate; pruning occurs only for explicitly confirmed actions. */
export function simulateReplacementSafety(
  input: SimulateReplacementSafetyInput,
): ReplacementSafetySimulationResult {
  let sourceGraph: RepertoireGraph;
  let recomputed: ReplacementCandidateScoringResult;
  try {
    sourceGraph = buildRepertoireGraph(input.source_tree, input.request.repertoire_color);
    recomputed = rescore(input.request, input.scoring);
  } catch {
    return baseResult(
      input,
      cloneJson(input.scoring),
      "stale",
      "scoring-not-current",
      "Task 8.6 context or retained expansion evidence could not be deterministically revalidated.",
      [],
    );
  }
  const failure = boundaryFailure(input, sourceGraph, recomputed);
  if (failure)
    return baseResult(input, recomputed, failure.status, failure.error, failure.explanation, []);
  const candidates = recomputed.candidates.map((candidate) =>
    simulateCandidate(input, sourceGraph, recomputed, candidate),
  );
  const status: ReplacementSafetyResultStatus =
    candidates.length === 0
      ? "unavailable"
      : candidates.some((candidate) => candidate.status === "blocked")
        ? "blocked"
        : candidates.every((candidate) => candidate.status === "safe")
          ? "complete"
          : candidates.every((candidate) => candidate.status === "unavailable")
            ? "unavailable"
            : "partial";
  return baseResult(
    input,
    recomputed,
    status,
    null,
    status === "complete"
      ? "Every current Task 8.6 candidate was safely simulated on an isolated clone."
      : status === "blocked"
        ? "At least one explicitly pruning replacement is blocked by required-reply coverage loss."
        : "Safety simulations retain unavailable, partial, dominated, and blocked evidence without fabricating passed checks.",
    candidates,
  );
}
