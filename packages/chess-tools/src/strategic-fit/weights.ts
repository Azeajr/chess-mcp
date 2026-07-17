/**
 * Deterministic route weighting for Strategic Fit.
 *
 * Opponent choices are normalized conditionally at their source position. A route therefore
 * carries the product of the opponent-choice probabilities on its path, rather than one unit per
 * editorial leaf. Routes that finish at the same canonical position form one independent
 * weighting unit: their aggregate evidence receives one unit of weight and is then divided among
 * the source routes. This keeps deeper annotation, duplicate leaves, and transposed move orders
 * from manufacturing additional strategic evidence.
 */
import type { RepertoireGraph, RepertoireGraphDecision } from "./graph.js";
import type { StrategicFitSourceProvenance } from "./types.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const STRATEGIC_ROUTE_WEIGHTING_MODES = ["equal", "manual", "external"] as const;
export type StrategicRouteWeightingMode = (typeof STRATEGIC_ROUTE_WEIGHTING_MODES)[number];

export interface StrategicRouteWeightInput {
  readonly route_id: string;
  readonly weight: number;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicDecisionWeightInput {
  readonly decision_id: string;
  readonly weight: number;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicRouteWeightingOptions {
  /** Equal weighting is the deterministic engine-free default. */
  readonly mode?: StrategicRouteWeightingMode;
  /** Multiplicative adjustments after conditional opponent-decision weighting. */
  readonly route_weights?: readonly StrategicRouteWeightInput[];
  /** Raw sibling weights, normalized at each opponent-owned source position. */
  readonly decision_weights?: readonly StrategicDecisionWeightInput[];
}

export type StrategicWeightResolution = "equal" | "supplied" | "equal-fallback";

export interface StrategicNormalizedDecisionWeight {
  readonly decision_id: string;
  readonly from_position_id: string;
  readonly raw_weight: number;
  readonly normalized_weight: number;
  readonly resolution: StrategicWeightResolution;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicNormalizedRouteWeight {
  readonly route_id: string;
  readonly terminal_position_id: string;
  /** Terminal canonical position; used as the independent evidence identity. */
  readonly weighting_unit_id: string;
  readonly opponent_probability: number;
  readonly route_factor: number;
  readonly normalized_weight: number;
  readonly resolution: StrategicWeightResolution;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicRouteWeightingUnit {
  readonly weighting_unit_id: string;
  readonly terminal_position_id: string;
  readonly route_ids: readonly string[];
  readonly normalized_weight: number;
}

export const STRATEGIC_WEIGHT_FALLBACK_REASONS = [
  "no-supplied-weights",
  "missing-route-weight",
  "missing-decision-weight",
  "all-zero-route-weights",
  "all-zero-decision-weights",
] as const;
export type StrategicWeightFallbackReason = (typeof STRATEGIC_WEIGHT_FALLBACK_REASONS)[number];

export interface StrategicWeightFallback {
  readonly scope: "weighting" | "route" | "opponent-decision";
  readonly reason: StrategicWeightFallbackReason;
  readonly affected_ids: readonly string[];
  readonly resolution: "equal";
}

export type StrategicRouteWeightingState = "complete" | "partial" | "fallback";

export interface StrategicRouteWeightingReport {
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly weighting_version: string;
  readonly graph_id: string;
  readonly requested_mode: StrategicRouteWeightingMode;
  readonly state: StrategicRouteWeightingState;
  readonly routes: readonly StrategicNormalizedRouteWeight[];
  readonly opponent_decisions: readonly StrategicNormalizedDecisionWeight[];
  readonly weighting_units: readonly StrategicRouteWeightingUnit[];
  readonly effective_sample_size: number;
  readonly fallbacks: readonly StrategicWeightFallback[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface SuppliedWeight {
  readonly weight: number;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface MutableRouteWeight {
  readonly routeId: string;
  readonly terminalPositionId: string;
  readonly opponentProbability: number;
  readonly routeFactor: number;
  readonly resolution: StrategicWeightResolution;
  readonly score: number;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

const ID_SEPARATOR = "\u001f";

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:weights",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.weights,
  snapshot: null,
  reason: null,
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function validateWeight(weight: number, identity: string): void {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error(`strategic_fit_weights_invalid_weight: ${identity}`);
  }
}

function suppliedWeights<T extends { readonly weight: number }>(
  values: readonly T[],
  identity: (value: T) => string,
  knownIds: ReadonlySet<string>,
  kind: "route" | "decision",
): Map<string, SuppliedWeight> {
  const result = new Map<string, SuppliedWeight>();
  for (const value of values) {
    const id = identity(value);
    if (!knownIds.has(id)) throw new Error(`strategic_fit_weights_unknown_${kind}: ${id}`);
    if (result.has(id)) throw new Error(`strategic_fit_weights_duplicate_${kind}: ${id}`);
    validateWeight(value.weight, `${kind}:${id}`);
    const provenance = "provenance" in value && Array.isArray(value.provenance)
      ? value.provenance as readonly StrategicFitSourceProvenance[]
      : [];
    result.set(id, { weight: value.weight, provenance });
  }
  return result;
}

function mergeProvenance(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const result: StrategicFitSourceProvenance[] = [];
  const seen = new Set<string>();
  for (const source of groups.flat()) {
    const identity = [source.source_id, source.version, source.snapshot].join(ID_SEPARATOR);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(source);
  }
  return result;
}

/** Frozen effective-sample formula. Zero total weight has no effective observations. */
export function calculateEffectiveSampleSize(weights: readonly number[]): number {
  for (const [index, weight] of weights.entries()) validateWeight(weight, `sample:${index}`);
  const weightSum = total(weights);
  if (weightSum === 0) return 0;
  const squaredSum = total(weights.map((weight) => weight * weight));
  return (weightSum * weightSum) / squaredSum;
}

function groupOpponentDecisions(
  decisions: readonly RepertoireGraphDecision[],
): Array<[string, RepertoireGraphDecision[]]> {
  const groups = new Map<string, RepertoireGraphDecision[]>();
  for (const decision of decisions) {
    if (decision.owner !== "opponent") continue;
    const group = groups.get(decision.from_position_id) ?? [];
    group.push(decision);
    groups.set(decision.from_position_id, group);
  }
  return [...groups.entries()]
    .map(([positionId, siblings]): [string, RepertoireGraphDecision[]] => [
      positionId,
      siblings.sort((left, right) => compareStrings(left.decision_id, right.decision_id)),
    ])
    .sort(([left], [right]) => compareStrings(left, right));
}

function conditionalDecisionWeights(
  graph: RepertoireGraph,
  mode: StrategicRouteWeightingMode,
  supplied: ReadonlyMap<string, SuppliedWeight>,
  inputConfigured: boolean,
  fallbacks: StrategicWeightFallback[],
): StrategicNormalizedDecisionWeight[] {
  const result: StrategicNormalizedDecisionWeight[] = [];
  for (const [positionId, siblings] of groupOpponentDecisions(graph.decisions)) {
    let values = siblings.map((decision) => {
      const input = mode === "equal" ? undefined : supplied.get(decision.decision_id);
      return {
        decision,
        input,
        raw: input?.weight ?? 1,
        resolution: input
          ? "supplied" as const
          : inputConfigured && mode !== "equal" && siblings.length > 1
            ? "equal-fallback" as const
            : "equal" as const,
      };
    });

    const missing = values
      .filter((value) => value.resolution === "equal-fallback")
      .map((value) => value.decision.decision_id);
    if (missing.length > 0) {
      fallbacks.push({
        scope: "opponent-decision",
        reason: "missing-decision-weight",
        affected_ids: missing,
        resolution: "equal",
      });
    }

    if (total(values.map((value) => value.raw)) === 0) {
      const affectedIds = values.map((value) => value.decision.decision_id);
      fallbacks.push({
        scope: "opponent-decision",
        reason: "all-zero-decision-weights",
        affected_ids: affectedIds,
        resolution: "equal",
      });
      values = values.map((value) => ({ ...value, raw: 1, resolution: "equal-fallback" as const }));
    }

    const siblingTotal = total(values.map((value) => value.raw));
    result.push(...values.map((value) => ({
      decision_id: value.decision.decision_id,
      from_position_id: positionId,
      raw_weight: value.raw,
      normalized_weight: value.raw / siblingTotal,
      resolution: value.resolution,
      provenance: mergeProvenance([CORE_PROVENANCE], value.input?.provenance ?? []),
    })));
  }
  return result.sort((left, right) => compareStrings(left.decision_id, right.decision_id));
}

function routeFactors(
  graph: RepertoireGraph,
  mode: StrategicRouteWeightingMode,
  supplied: ReadonlyMap<string, SuppliedWeight>,
  inputConfigured: boolean,
  fallbacks: StrategicWeightFallback[],
): Map<string, { factor: number; resolution: StrategicWeightResolution; provenance: readonly StrategicFitSourceProvenance[] }> {
  const factors = new Map<string, {
    factor: number;
    resolution: StrategicWeightResolution;
    provenance: readonly StrategicFitSourceProvenance[];
  }>();
  for (const route of graph.routes) {
    const input = mode === "equal" ? undefined : supplied.get(route.route_id);
    const resolution = input
      ? "supplied"
      : inputConfigured && mode !== "equal"
        ? "equal-fallback"
        : "equal";
    factors.set(route.route_id, {
      factor: input?.weight ?? 1,
      resolution,
      provenance: input?.provenance ?? [],
    });
  }

  const missing = graph.routes
    .filter((route) => factors.get(route.route_id)!.resolution === "equal-fallback")
    .map((route) => route.route_id);
  if (missing.length > 0) {
    fallbacks.push({
      scope: "route",
      reason: "missing-route-weight",
      affected_ids: missing,
      resolution: "equal",
    });
  }

  if (graph.routes.length > 0 && total([...factors.values()].map((value) => value.factor)) === 0) {
    const affectedIds = graph.routes.map((route) => route.route_id);
    fallbacks.push({
      scope: "weighting",
      reason: "all-zero-route-weights",
      affected_ids: affectedIds,
      resolution: "equal",
    });
    for (const route of graph.routes) {
      const existing = factors.get(route.route_id)!;
      factors.set(route.route_id, { ...existing, factor: 1, resolution: "equal-fallback" });
    }
  }
  return factors;
}

function reportState(
  mode: StrategicRouteWeightingMode,
  hasAnyInput: boolean,
  hasPositiveInput: boolean,
  fallbacks: readonly StrategicWeightFallback[],
): StrategicRouteWeightingState {
  if (mode === "equal" || fallbacks.length === 0) return "complete";
  if (!hasAnyInput || !hasPositiveInput) return "fallback";
  return "partial";
}

/**
 * Calculate normalized route weights without engine, network, host, or mutable global state.
 *
 * Supplied route weights multiply the conditional opponent-path probability. Supplied decision
 * weights apply only to opponent-owned sibling decisions. Missing or unusable supplied evidence
 * resolves to equal weighting and is always disclosed in `fallbacks`.
 */
export function calculateStrategicRouteWeights(
  graph: RepertoireGraph,
  options: StrategicRouteWeightingOptions = {},
): StrategicRouteWeightingReport {
  if (graph.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION) {
    throw new Error(`strategic_fit_weights_version_mismatch: ${graph.analysis_version}`);
  }

  const mode = options.mode ?? "equal";
  const routeInputs = options.route_weights ?? [];
  const decisionInputs = options.decision_weights ?? [];
  const routeIds = new Set(graph.routes.map((route) => route.route_id));
  const decisions = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));
  const opponentDecisionIds = new Set(
    graph.decisions.filter((decision) => decision.owner === "opponent").map((decision) => decision.decision_id),
  );
  const suppliedRoutes = suppliedWeights(routeInputs, (value) => value.route_id, routeIds, "route");
  const suppliedDecisions = suppliedWeights(
    decisionInputs,
    (value) => value.decision_id,
    new Set(decisions.keys()),
    "decision",
  );
  for (const decisionId of suppliedDecisions.keys()) {
    if (!opponentDecisionIds.has(decisionId)) {
      throw new Error(`strategic_fit_weights_repertoire_decision: ${decisionId}`);
    }
  }

  const hasAnyInput = routeInputs.length > 0 || decisionInputs.length > 0;
  const hasPositiveInput = [...routeInputs, ...decisionInputs].some((input) => input.weight > 0);
  const fallbacks: StrategicWeightFallback[] = [];
  if (mode !== "equal" && !hasAnyInput) {
    fallbacks.push({
      scope: "weighting",
      reason: "no-supplied-weights",
      affected_ids: graph.routes.map((route) => route.route_id),
      resolution: "equal",
    });
  }

  const normalizedDecisions = conditionalDecisionWeights(
    graph,
    mode,
    suppliedDecisions,
    decisionInputs.length > 0,
    fallbacks,
  );
  const decisionById = new Map(normalizedDecisions.map((decision) => [decision.decision_id, decision]));
  const factors = routeFactors(graph, mode, suppliedRoutes, routeInputs.length > 0, fallbacks);

  const routeScores: MutableRouteWeight[] = graph.routes.map((route) => {
    const opponentDecisions = route.decision_ids
      .map((decisionId) => decisionById.get(decisionId))
      .filter((decision): decision is StrategicNormalizedDecisionWeight => decision !== undefined);
    const opponentProbability = opponentDecisions.reduce(
      (probability, decision) => probability * decision.normalized_weight,
      1,
    );
    const factor = factors.get(route.route_id)!;
    return {
      routeId: route.route_id,
      terminalPositionId: route.terminal_position_id,
      opponentProbability,
      routeFactor: factor.factor,
      resolution: factor.resolution === "equal-fallback" || opponentDecisions.some((decision) =>
        decision.resolution === "equal-fallback"
      )
        ? "equal-fallback"
        : factor.resolution === "supplied" || opponentDecisions.some((decision) =>
          decision.resolution === "supplied"
        )
          ? "supplied"
          : "equal",
      score: opponentProbability * factor.factor,
      provenance: mergeProvenance(
        [CORE_PROVENANCE],
        factor.provenance,
        ...opponentDecisions.map((decision) => decision.provenance),
      ),
    };
  });

  const unitMembers = new Map<string, MutableRouteWeight[]>();
  for (const route of routeScores) {
    const group = unitMembers.get(route.terminalPositionId) ?? [];
    group.push(route);
    unitMembers.set(route.terminalPositionId, group);
  }
  const rawUnits = [...unitMembers.entries()]
    .map(([terminalPositionId, members]) => ({
      terminalPositionId,
      members: members.sort((left, right) => compareStrings(left.routeId, right.routeId)),
      // An equivalent move order may redistribute weight, but cannot create another observation.
      score: total(members.map((member) => member.score)) / members.length,
    }))
    .sort((left, right) => compareStrings(left.terminalPositionId, right.terminalPositionId));
  const rawUnitTotal = total(rawUnits.map((unit) => unit.score));
  const unitDenominator = rawUnitTotal > 0 ? rawUnitTotal : rawUnits.length;

  const routeResults: StrategicNormalizedRouteWeight[] = [];
  const weightingUnits: StrategicRouteWeightingUnit[] = [];
  for (const unit of rawUnits) {
    const unitWeight = (rawUnitTotal > 0 ? unit.score : 1) / unitDenominator;
    const memberTotal = total(unit.members.map((member) => member.score));
    const memberDenominator = memberTotal > 0 ? memberTotal : unit.members.length;
    weightingUnits.push({
      weighting_unit_id: unit.terminalPositionId,
      terminal_position_id: unit.terminalPositionId,
      route_ids: unit.members.map((member) => member.routeId),
      normalized_weight: unitWeight,
    });
    routeResults.push(...unit.members.map((member) => ({
      route_id: member.routeId,
      terminal_position_id: member.terminalPositionId,
      weighting_unit_id: unit.terminalPositionId,
      opponent_probability: member.opponentProbability,
      route_factor: member.routeFactor,
      normalized_weight: unitWeight * ((memberTotal > 0 ? member.score : 1) / memberDenominator),
      resolution: member.resolution,
      provenance: member.provenance,
    })));
  }

  const inputProvenance = [
    ...routeInputs.flatMap((input) => input.provenance ?? []),
    ...decisionInputs.flatMap((input) => input.provenance ?? []),
  ];
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    weighting_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.weights,
    graph_id: graph.graph_id,
    requested_mode: mode,
    state: reportState(mode, hasAnyInput, hasPositiveInput, fallbacks),
    routes: routeResults.sort((left, right) => compareStrings(left.route_id, right.route_id)),
    opponent_decisions: normalizedDecisions,
    weighting_units: weightingUnits,
    effective_sample_size: calculateEffectiveSampleSize(
      weightingUnits.map((unit) => unit.normalized_weight),
    ),
    fallbacks,
    provenance: mergeProvenance([CORE_PROVENANCE], inputProvenance),
  };
}
