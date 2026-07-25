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

export const STRATEGIC_WEIGHT_EVIDENCE_KINDS = ["market", "personal", "manual"] as const;
export type StrategicWeightEvidenceKind = (typeof STRATEGIC_WEIGHT_EVIDENCE_KINDS)[number];

export type StrategicWeightEvidenceState = "available" | "partial" | "unavailable";

/** One independently normalized route-frequency estimate supplied outside the analyzer. */
export interface StrategicWeightEvidenceInput {
  readonly state: StrategicWeightEvidenceState;
  readonly route_weights?: readonly StrategicRouteWeightInput[];
  readonly decision_weights?: readonly StrategicDecisionWeightInput[];
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicWeightSourceCoefficients {
  readonly market: number;
  readonly personal: number;
  readonly manual: number;
}

export interface StrategicRouteWeightingOptions {
  /** Equal weighting is the deterministic engine-free default. */
  readonly mode?: StrategicRouteWeightingMode;
  /** Multiplicative adjustments after conditional opponent-decision weighting. */
  readonly route_weights?: readonly StrategicRouteWeightInput[];
  /** Raw sibling weights, normalized at each opponent-owned source position. */
  readonly decision_weights?: readonly StrategicDecisionWeightInput[];
  /** Source-level evidence retained even when no usable per-route weight was available. */
  readonly provenance?: readonly StrategicFitSourceProvenance[];
  /** Population estimate collected by a host. It remains separate until profile composition. */
  readonly market?: StrategicWeightEvidenceInput;
  /** Empirically shrunk personal estimate collected by a host. */
  readonly personal?: StrategicWeightEvidenceInput;
  /** Profile preferences applied by the analyzer; usable coefficients are normalized to one. */
  readonly source_coefficients?: StrategicWeightSourceCoefficients;
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

export type StrategicWeightEvidenceResolution =
  | "used"
  | "ignored-equal"
  | "unavailable"
  | "zero-coefficient";

export interface StrategicWeightEvidenceCoverage {
  readonly kind: StrategicWeightEvidenceKind;
  readonly state: StrategicWeightEvidenceState;
  readonly resolution: StrategicWeightEvidenceResolution;
  readonly requested_coefficient: number;
  readonly normalized_coefficient: number;
  readonly route_weight_count: number;
  readonly decision_weight_count: number;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

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
  /** Deterministic source coverage and the effective normalized profile mix. */
  readonly evidence_sources: readonly StrategicWeightEvidenceCoverage[];
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

const DEFAULT_SOURCE_COEFFICIENTS: StrategicWeightSourceCoefficients = Object.freeze({
  market: 0,
  personal: 0,
  manual: 0,
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

function validateWeight(weight: number, identity: string): void {
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error(`strategic_fit_weights_invalid_weight: ${identity}`);
  }
}

function validateCoefficient(value: number, kind: StrategicWeightEvidenceKind): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`strategic_fit_weights_invalid_coefficient: ${kind}`);
  }
  return value;
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
function calculateBaseStrategicRouteWeights(
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
    ...(options.provenance ?? []),
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
    evidence_sources: [],
    provenance: mergeProvenance([CORE_PROVENANCE], inputProvenance),
  };
}

interface PreparedEvidence {
  readonly kind: StrategicWeightEvidenceKind;
  readonly input: StrategicWeightEvidenceInput;
  readonly requestedCoefficient: number;
  readonly usable: boolean;
}

function hasPositiveEvidence(input: StrategicWeightEvidenceInput): boolean {
  return [...(input.route_weights ?? []), ...(input.decision_weights ?? [])]
    .some((weight) => weight.weight > 0);
}

function manualEvidence(options: StrategicRouteWeightingOptions): StrategicWeightEvidenceInput {
  const routeWeights = options.route_weights ?? [];
  const decisionWeights = options.decision_weights ?? [];
  return {
    state: routeWeights.length > 0 || decisionWeights.length > 0 ? "available" : "unavailable",
    route_weights: routeWeights,
    decision_weights: decisionWeights,
    provenance: mergeProvenance(
      options.provenance ?? [],
      ...routeWeights.map((weight) => weight.provenance ?? []),
      ...decisionWeights.map((weight) => weight.provenance ?? []),
    ),
  };
}

function preparedEvidence(options: StrategicRouteWeightingOptions): PreparedEvidence[] {
  const coefficients = options.source_coefficients ?? DEFAULT_SOURCE_COEFFICIENTS;
  const inputs: Readonly<Record<StrategicWeightEvidenceKind, StrategicWeightEvidenceInput>> = {
    market: options.market ?? { state: "unavailable" },
    personal: options.personal ?? { state: "unavailable" },
    manual: manualEvidence(options),
  };
  return STRATEGIC_WEIGHT_EVIDENCE_KINDS.map((kind) => {
    const input = inputs[kind];
    return {
      kind,
      input,
      requestedCoefficient: validateCoefficient(coefficients[kind], kind),
      usable: input.state !== "unavailable" && hasPositiveEvidence(input),
    };
  });
}

function normalizedCoefficients(
  prepared: readonly PreparedEvidence[],
): ReadonlyMap<StrategicWeightEvidenceKind, number> {
  const usable = prepared.filter((source) => source.usable);
  const requestedTotal = total(usable.map((source) => source.requestedCoefficient));
  return new Map(prepared.map((source) => [
    source.kind,
    !source.usable
      ? 0
      : requestedTotal > 0
        ? source.requestedCoefficient / requestedTotal
        : 1 / usable.length,
  ]));
}

function evidenceCoverage(
  prepared: readonly PreparedEvidence[],
  coefficients: ReadonlyMap<StrategicWeightEvidenceKind, number>,
  equal: boolean,
): StrategicWeightEvidenceCoverage[] {
  return prepared.map((source) => {
    const normalized = equal ? 0 : coefficients.get(source.kind) ?? 0;
    return {
      kind: source.kind,
      state: source.input.state,
      resolution: equal
        ? "ignored-equal"
        : !source.usable
          ? "unavailable"
          : normalized <= 0
            ? "zero-coefficient"
            : "used",
      requested_coefficient: source.requestedCoefficient,
      normalized_coefficient: normalized,
      route_weight_count: source.input.route_weights?.length ?? 0,
      decision_weight_count: source.input.decision_weights?.length ?? 0,
      provenance: mergeProvenance(source.input.provenance ?? []),
    };
  });
}

function compositionProvenance(
  coverage: readonly StrategicWeightEvidenceCoverage[],
): StrategicFitSourceProvenance {
  const snapshot = coverage.map((source) =>
    `${source.kind}=${source.normalized_coefficient}:${source.resolution}`
  ).join(",");
  return {
    source_id: "strategic-fit:weight-composition",
    kind: "user-profile",
    state: "available",
    version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.weights,
    snapshot,
    reason: "Usable profile coefficients are normalized to one; unavailable sources contribute zero weight.",
  };
}

function uniqueFallbacks(
  reports: readonly StrategicRouteWeightingReport[],
): StrategicWeightFallback[] {
  const seen = new Set<string>();
  return reports.flatMap((report) => report.fallbacks).filter((fallback) => {
    const identity = JSON.stringify(fallback);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function calculateComposedStrategicRouteWeights(
  graph: RepertoireGraph,
  options: StrategicRouteWeightingOptions,
): StrategicRouteWeightingReport {
  const mode = options.mode ?? "equal";
  const prepared = preparedEvidence(options);
  const coefficients = normalizedCoefficients(prepared);
  const coverage = evidenceCoverage(prepared, coefficients, mode === "equal");
  const sourceProvenance = prepared.flatMap((source) => source.input.provenance ?? []);
  const composition = compositionProvenance(coverage);

  if (mode === "equal") {
    const report = calculateBaseStrategicRouteWeights(graph, {
      mode: "equal",
      provenance: mergeProvenance(options.provenance ?? [], sourceProvenance, [composition]),
    });
    return { ...report, evidence_sources: coverage };
  }

  const used = prepared.filter((source) => (coefficients.get(source.kind) ?? 0) > 0);
  if (used.length === 0) {
    const report = calculateBaseStrategicRouteWeights(graph, {
      mode,
      provenance: mergeProvenance(options.provenance ?? [], sourceProvenance, [composition]),
    });
    return { ...report, evidence_sources: coverage };
  }

  const reports = used.map((source) => ({
    source,
    coefficient: coefficients.get(source.kind)!,
    report: calculateBaseStrategicRouteWeights(graph, {
      mode: source.kind === "manual" ? "manual" : "external",
      route_weights: source.input.route_weights,
      decision_weights: source.input.decision_weights,
      provenance: source.input.provenance,
    }),
  }));
  const routeBySource = reports.map(({ report }) =>
    new Map(report.routes.map((route) => [route.route_id, route]))
  );
  const decisionBySource = reports.map(({ report }) =>
    new Map(report.opponent_decisions.map((decision) => [decision.decision_id, decision]))
  );

  const opponentDecisions = graphOpponentDecisionResults(graph, reports, decisionBySource, composition);
  const opponentById = new Map(opponentDecisions.map((decision) => [decision.decision_id, decision]));
  const routes: StrategicNormalizedRouteWeight[] = graph.routes.map((route): StrategicNormalizedRouteWeight => {
    const normalizedWeight = reports.reduce((sum, entry, index) =>
      sum + entry.coefficient * routeBySource[index]!.get(route.route_id)!.normalized_weight, 0
    );
    const opponentProbability = route.decision_ids.reduce((probability, decisionId) =>
      probability * (opponentById.get(decisionId)?.normalized_weight ?? 1), 1
    );
    return {
      route_id: route.route_id,
      terminal_position_id: route.terminal_position_id,
      weighting_unit_id: route.terminal_position_id,
      opponent_probability: round(opponentProbability),
      route_factor: round(opponentProbability > 0 ? normalizedWeight / opponentProbability : normalizedWeight),
      normalized_weight: normalizedWeight,
      resolution: "supplied",
      provenance: mergeProvenance(
        [CORE_PROVENANCE, composition],
        ...reports.map((entry, index) =>
          routeBySource[index]!.get(route.route_id)!.provenance
        ),
      ),
    };
  }).sort((left, right) => compareStrings(left.route_id, right.route_id));
  const unitMembers = new Map<string, StrategicNormalizedRouteWeight[]>();
  for (const route of routes) {
    const members = unitMembers.get(route.weighting_unit_id) ?? [];
    members.push(route);
    unitMembers.set(route.weighting_unit_id, members);
  }
  const weightingUnits = [...unitMembers.entries()].map(([unitId, members]) => ({
    weighting_unit_id: unitId,
    terminal_position_id: unitId,
    route_ids: members.map((route) => route.route_id).sort(compareStrings),
    normalized_weight: total(members.map((route) => route.normalized_weight)),
  })).sort((left, right) => compareStrings(left.weighting_unit_id, right.weighting_unit_id));
  const fallbacks = uniqueFallbacks(reports.map((entry) => entry.report));
  const partial = reports.some((entry) =>
    entry.source.input.state === "partial" || entry.report.state !== "complete"
  );
  const provenance = mergeProvenance(
    [CORE_PROVENANCE, composition],
    options.provenance ?? [],
    sourceProvenance,
    ...reports.map((entry) => entry.report.provenance),
  );
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    weighting_version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.weights,
    graph_id: graph.graph_id,
    requested_mode: mode,
    state: partial ? "partial" : "complete",
    routes,
    opponent_decisions: opponentDecisions,
    weighting_units: weightingUnits,
    effective_sample_size: calculateEffectiveSampleSize(
      weightingUnits.map((unit) => unit.normalized_weight),
    ),
    fallbacks,
    evidence_sources: coverage,
    provenance,
  };
}

function graphOpponentDecisionResults(
  graph: RepertoireGraph,
  reports: readonly {
    readonly coefficient: number;
    readonly report: StrategicRouteWeightingReport;
  }[],
  decisionBySource: readonly ReadonlyMap<string, StrategicNormalizedDecisionWeight>[],
  composition: StrategicFitSourceProvenance,
): StrategicNormalizedDecisionWeight[] {
  return groupOpponentDecisions(graph.decisions).flatMap(([positionId, siblings]) =>
    siblings.map((decision): StrategicNormalizedDecisionWeight => {
      const normalizedWeight = reports.reduce((sum, entry, index) =>
        sum + entry.coefficient * decisionBySource[index]!.get(decision.decision_id)!.normalized_weight, 0
      );
      return {
        decision_id: decision.decision_id,
        from_position_id: positionId,
        raw_weight: round(normalizedWeight),
        normalized_weight: normalizedWeight,
        resolution: "supplied",
        provenance: mergeProvenance(
          [CORE_PROVENANCE, composition],
          ...reports.map((entry, index) =>
            decisionBySource[index]!.get(decision.decision_id)!.provenance
          ),
        ),
      };
    })
  ).sort((left, right) => compareStrings(left.decision_id, right.decision_id));
}

/**
 * Calculate route weights, optionally composing independently normalized market, personal, and
 * manual estimates under the current profile. Equal mode deliberately ignores every enrichment.
 */
export function calculateStrategicRouteWeights(
  graph: RepertoireGraph,
  options: StrategicRouteWeightingOptions = {},
): StrategicRouteWeightingReport {
  if (options.market || options.personal || options.source_coefficients) {
    return calculateComposedStrategicRouteWeights(graph, options);
  }
  return calculateBaseStrategicRouteWeights(graph, options);
}
