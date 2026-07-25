/**
 * Deterministic engine-free overview metrics for Strategic Fit.
 *
 * Every aggregate uses normalized expected route weight. Editorial leaf counts are never used as
 * frequencies, and canonical weighting units prevent transposed move orders from manufacturing
 * extra observations. Metrics that require training, engine, popularity-loss, or replacement
 * evidence remain explicitly unavailable (or partial) until that evidence is injected.
 */
import type { StrategicConceptDictionary } from "./concepts.js";
import type { StrategicModeReport } from "./modes.js";
import type { RepertoireGraph } from "./graph.js";
import type {
  ConceptCentralityMetricValue,
  ExceptionBurdenMetricValue,
  FindingResolutionState,
  HomogenizationCostMetricValue,
  StrategicFitClassification,
  StrategicFitMetric,
  StrategicFitMetricId,
  StrategicFitMetrics,
  StrategicFitOverview,
  StrategicFitProfile,
  StrategicFitProvenance,
  StrategicFitSourceProvenance,
} from "./types.js";
import type { StrategicRouteWeightingReport } from "./weights.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
} from "./version.js";

export const STRATEGIC_METRICS_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.metrics;

/** The later training domain can supply calibrated concept mastery without changing base metrics. */
export interface StrategicConceptMasteryInput {
  readonly concept_id: string;
  /** Calibrated mastery in the range 0–1. */
  readonly mastery: number;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicTrainingMetricEvidence {
  readonly concept_mastery: readonly StrategicConceptMasteryInput[];
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

/** The full StrategicFinding contract is structurally compatible with this bounded metric input. */
export interface StrategicFitMetricFinding {
  readonly finding_id: string;
  readonly classification: StrategicFitClassification;
  readonly references: {
    readonly route_ids: readonly string[];
  };
  readonly learning_burden: number;
  /** Positive only when upstream evidence found a viable, player-controllable replacement. */
  readonly replacement_priority?: {
    readonly actionability: number;
  };
  readonly resolution_state: FindingResolutionState;
  readonly provenance: StrategicFitProvenance;
}

export interface StrategicFitMetricsInput {
  readonly graph: RepertoireGraph;
  readonly weights: StrategicRouteWeightingReport;
  readonly modes: StrategicModeReport;
  readonly concepts: StrategicConceptDictionary;
  readonly findings: readonly StrategicFitMetricFinding[];
  readonly training?: StrategicTrainingMetricEvidence;
  readonly profile?: StrategicFitProfile;
}

interface MetricContext {
  readonly input: StrategicFitMetricsInput;
  readonly routeWeight: ReadonlyMap<string, number>;
  readonly routeUnit: ReadonlyMap<string, string>;
  readonly routeConceptIds: ReadonlyMap<string, readonly string[]>;
  readonly routeCohortId: ReadonlyMap<string, string>;
  readonly selectedModeIdsByRoute: ReadonlyMap<string, ReadonlySet<string>>;
  readonly comparableRouteIds: ReadonlySet<string>;
  readonly exceptionRouteIds: ReadonlySet<string>;
  readonly familyBucketByRoute: ReadonlyMap<string, string>;
  readonly totalWeight: number;
}

const ID_SEPARATOR = "\u001f";
const EPSILON = 1e-9;
const MASTERY_THRESHOLD = 0.7;

/** Deterministic presentation boundaries for the engine-free workload summary. */
export const STRATEGIC_WORKLOAD_THRESHOLDS = Object.freeze({
  moderate: 1 / 3,
  high: 2 / 3,
});

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:metrics",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_METRICS_VERSION,
  snapshot: null,
  reason: null,
});

const TRAINING_UNAVAILABLE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:training-metadata",
  kind: "training-metadata",
  state: "unavailable",
  version: null,
  snapshot: null,
  reason: "No calibrated concept-mastery evidence was supplied.",
});

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function requireUnitInterval(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`strategic_fit_metrics_invalid_unit_value: ${name} ${String(value)}`);
  }
  return value;
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
  return result.sort((left, right) => compareStrings(left.source_id, right.source_id));
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const left = sortedUnique(actual);
  const right = sortedUnique(expected);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function metric<T>(
  metricId: StrategicFitMetricId,
  unit: StrategicFitMetric<T>["unit"],
  state: StrategicFitMetric<T>["state"],
  value: T | null,
  reason: string | null,
  provenance: readonly StrategicFitSourceProvenance[],
): StrategicFitMetric<T> {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    metric_id: metricId,
    state,
    value,
    unit,
    reason,
    provenance: mergeProvenance([CORE_PROVENANCE], provenance),
  };
}

function unavailable<T>(
  metricId: StrategicFitMetricId,
  unit: StrategicFitMetric<T>["unit"],
  reason: string,
  provenance: readonly StrategicFitSourceProvenance[],
): StrategicFitMetric<T> {
  return metric<T>(metricId, unit, "unavailable", null, reason, provenance);
}

function requireCompatibleInputs(input: StrategicFitMetricsInput): void {
  if (
    input.graph.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    input.weights.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    input.modes.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    input.concepts.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_metrics_version_mismatch");
  }
  if (
    input.weights.graph_id !== input.graph.graph_id ||
    input.modes.graph_id !== input.graph.graph_id ||
    input.concepts.graph_id !== input.graph.graph_id
  ) {
    throw new Error("strategic_fit_metrics_graph_mismatch");
  }
  const routeIds = input.graph.routes.map((route) => route.route_id);
  if (!sameIds(input.weights.routes.map((route) => route.route_id), routeIds)) {
    throw new Error("strategic_fit_metrics_weight_route_mismatch");
  }
  if (!sameIds(input.concepts.routes.map((route) => route.route_id), routeIds)) {
    throw new Error("strategic_fit_metrics_concept_route_mismatch");
  }
  const cohortRouteIds = input.modes.cohorts.flatMap((cohort) => [
    ...cohort.route_ids,
    ...cohort.excluded_route_ids,
  ]);
  if (!sameIds(cohortRouteIds, routeIds)) {
    throw new Error("strategic_fit_metrics_cohort_route_mismatch");
  }
  const knownRouteIds = new Set(routeIds);
  for (const finding of input.findings) {
    requireUnitInterval(`finding:${finding.finding_id}:learning-burden`, finding.learning_burden);
    if (finding.provenance.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION) {
      throw new Error(`strategic_fit_metrics_finding_version_mismatch: ${finding.finding_id}`);
    }
    for (const routeId of finding.references.route_ids) {
      if (!knownRouteIds.has(routeId)) {
        throw new Error(`strategic_fit_metrics_unknown_finding_route: ${routeId}`);
      }
    }
  }
}

function selectedModesByRoute(input: StrategicFitMetricsInput): Map<string, ReadonlySet<string>> {
  const mutable = new Map<string, Set<string>>();
  for (const cohort of input.modes.cohorts) {
    for (const mode of cohort.modes) {
      for (const routeId of mode.supporting_route_ids) {
        const ids = mutable.get(routeId) ?? new Set<string>();
        ids.add(mode.mode_id);
        mutable.set(routeId, ids);
      }
    }
  }
  return new Map([...mutable.entries()].map(([routeId, modeIds]) => [routeId, modeIds]));
}

/**
 * Build neutral entropy families. Inferred candidate clusters are retained even when they are
 * exceptions; remaining routes share a bucket only when they are one canonical weighting unit.
 */
function familyBuckets(
  input: StrategicFitMetricsInput,
  routeUnit: ReadonlyMap<string, string>,
): { buckets: Map<string, string>; comparable: Set<string> } {
  const buckets = new Map<string, string>();
  const comparable = new Set<string>();
  const cohortById = new Map(input.modes.cohorts.map((cohort) => [cohort.cohort_id, cohort]));
  for (const selection of input.modes.selections) {
    if (selection.state === "excluded" || selection.state === "insufficient-evidence") continue;
    const cohort = cohortById.get(selection.cohort_id);
    if (!cohort) throw new Error(`strategic_fit_metrics_unknown_selection_cohort: ${selection.cohort_id}`);
    for (const routeId of cohort.route_ids) comparable.add(routeId);
    for (const candidate of selection.candidates) {
      const bucketId = [selection.cohort_id, "candidate", candidate.representative_route_id].join(ID_SEPARATOR);
      for (const routeId of candidate.supporting_route_ids) {
        if (buckets.has(routeId)) {
          throw new Error(`strategic_fit_metrics_overlapping_mode_candidates: ${routeId}`);
        }
        buckets.set(routeId, bucketId);
      }
    }
    for (const routeId of cohort.route_ids) {
      if (!buckets.has(routeId)) {
        buckets.set(routeId, [selection.cohort_id, "unit", routeUnit.get(routeId)!].join(ID_SEPARATOR));
      }
    }
  }
  return { buckets, comparable };
}

function makeContext(input: StrategicFitMetricsInput): MetricContext {
  requireCompatibleInputs(input);
  const routeWeight = new Map(input.weights.routes.map((route) => {
    requireUnitInterval(`route:${route.route_id}:weight`, route.normalized_weight);
    return [route.route_id, route.normalized_weight] as const;
  }));
  const routeUnit = new Map(input.weights.routes.map((route) => [route.route_id, route.weighting_unit_id]));
  const routeConceptIds = new Map(input.concepts.routes.map((route) => [
    route.route_id,
    sortedUnique(route.concepts.map((concept) => concept.concept_id)),
  ]));
  const routeCohortId = new Map<string, string>();
  for (const cohort of input.modes.cohorts) {
    for (const routeId of [...cohort.route_ids, ...cohort.excluded_route_ids]) {
      if (routeCohortId.has(routeId)) {
        throw new Error(`strategic_fit_metrics_route_in_multiple_cohorts: ${routeId}`);
      }
      routeCohortId.set(routeId, cohort.cohort_id);
    }
  }
  const selectedModeIdsByRoute = selectedModesByRoute(input);
  const family = familyBuckets(input, routeUnit);
  const exceptionRouteIds = new Set(
    [...family.comparable].filter((routeId) => !selectedModeIdsByRoute.has(routeId)),
  );
  return {
    input,
    routeWeight,
    routeUnit,
    routeConceptIds,
    routeCohortId,
    selectedModeIdsByRoute,
    comparableRouteIds: family.comparable,
    exceptionRouteIds,
    familyBucketByRoute: family.buckets,
    totalWeight: [...routeWeight.values()].reduce((sum, weight) => sum + weight, 0),
  };
}

function evidenceCoverageReason(label: string, coveredWeight: number, totalWeight: number): string {
  const coverage = totalWeight > 0 ? coveredWeight / totalWeight : 0;
  return `${label} uses ${Math.round(coverage * 100)}% of expected route weight; missing evidence is not counted as zero.`;
}

function exactEvidenceCoverageReason(
  label: string,
  coveredWeight: number,
  totalWeight: number,
): string {
  const coverage = totalWeight > EPSILON ? coveredWeight / totalWeight : 1;
  return `${label} uses ${Math.round(coverage * 100)}% of relevant expected route weight (${round(coveredWeight)}/${round(totalWeight)}); missing evidence is not counted as zero.`;
}

function memorizationSensitivity(context: MetricContext): {
  readonly value: number;
  readonly provenance: readonly StrategicFitSourceProvenance[];
} {
  const tolerance = requireUnitInterval(
    "profile:additional-memorization-tolerance",
    context.input.profile?.preferences.additional_memorization_tolerance ?? 0,
  );
  const value = 1 - tolerance;
  if (!context.input.profile) return { value, provenance: [] };
  return {
    value,
    provenance: [{
      source_id: "strategic-fit:memorization-sensitivity",
      kind: "user-profile",
      state: "available",
      version: context.input.profile.schema_version,
      snapshot: `sensitivity=${round(value)}`,
      reason: "Remaining training burden is multiplied by one minus the profile's additional-memorization tolerance.",
    }],
  };
}

function strategicEntropy(context: MetricContext): StrategicFitMetric<number> {
  const bucketWeights = new Map<string, number>();
  for (const [routeId, bucketId] of context.familyBucketByRoute) {
    bucketWeights.set(bucketId, (bucketWeights.get(bucketId) ?? 0) + context.routeWeight.get(routeId)!);
  }
  const coveredWeight = [...bucketWeights.values()].reduce((sum, weight) => sum + weight, 0);
  if (coveredWeight <= EPSILON) {
    return unavailable(
      "strategic-entropy",
      "entropy",
      "No comparable strategic families have sufficient evidence for entropy.",
      context.input.modes.provenance,
    );
  }
  const entropy = [...bucketWeights.values()].reduce((sum, weight) => {
    const probability = weight / coveredWeight;
    return probability > 0 ? sum - probability * Math.log2(probability) : sum;
  }, 0);
  const partial = coveredWeight + EPSILON < context.totalWeight;
  return metric(
    "strategic-entropy",
    "entropy",
    partial ? "partial" : "available",
    round(entropy),
    partial
      ? evidenceCoverageReason("Strategic entropy", coveredWeight, context.totalWeight)
      : null,
    mergeProvenance(context.input.weights.provenance, context.input.modes.provenance),
  );
}

interface ConceptAggregate {
  weight: number;
  readonly unitIds: Set<string>;
  readonly cohortIds: Set<string>;
}

function conceptAggregates(context: MetricContext): Map<string, ConceptAggregate> {
  const aggregates = new Map<string, ConceptAggregate>();
  for (const [routeId, conceptIds] of context.routeConceptIds) {
    for (const conceptId of conceptIds) {
      const aggregate = aggregates.get(conceptId) ?? {
        weight: 0,
        unitIds: new Set<string>(),
        cohortIds: new Set<string>(),
      };
      aggregate.weight += context.routeWeight.get(routeId)!;
      aggregate.unitIds.add(context.routeUnit.get(routeId)!);
      aggregate.cohortIds.add(context.routeCohortId.get(routeId)!);
      aggregates.set(conceptId, aggregate);
    }
  }
  return aggregates;
}

function conceptReuse(
  context: MetricContext,
  aggregates: ReadonlyMap<string, ConceptAggregate>,
): StrategicFitMetric<number> {
  let totalExposure = 0;
  let reusedExposure = 0;
  let coveredWeight = 0;
  for (const [routeId, conceptIds] of context.routeConceptIds) {
    if (conceptIds.length === 0) continue;
    const weight = context.routeWeight.get(routeId)!;
    coveredWeight += weight;
    totalExposure += weight * conceptIds.length;
    reusedExposure += weight * conceptIds.filter((conceptId) =>
      (aggregates.get(conceptId)?.unitIds.size ?? 0) >= 2
    ).length;
  }
  if (totalExposure <= EPSILON) {
    return unavailable(
      "concept-reuse",
      "fraction",
      "No supported deterministic concepts are available for reuse measurement.",
      context.input.concepts.provenance,
    );
  }
  const partial = coveredWeight + EPSILON < context.totalWeight;
  return metric(
    "concept-reuse",
    "fraction",
    partial ? "partial" : "available",
    round(reusedExposure / totalExposure),
    partial ? evidenceCoverageReason("Concept reuse", coveredWeight, context.totalWeight) : null,
    mergeProvenance(context.input.weights.provenance, context.input.concepts.provenance),
  );
}

function masteryByConcept(
  context: MetricContext,
): { mastery: Map<string, number>; provenance: StrategicFitSourceProvenance[] } | null {
  const evidence = context.input.training;
  if (!evidence || evidence.concept_mastery.length === 0) return null;
  const mastery = new Map<string, number>();
  for (const concept of evidence.concept_mastery) {
    if (mastery.has(concept.concept_id)) {
      throw new Error(`strategic_fit_metrics_duplicate_concept_mastery: ${concept.concept_id}`);
    }
    mastery.set(
      concept.concept_id,
      requireUnitInterval(`concept:${concept.concept_id}:mastery`, concept.mastery),
    );
  }
  return {
    mastery,
    provenance: mergeProvenance(
      evidence.provenance ?? [],
      ...evidence.concept_mastery.map((concept) => concept.provenance ?? []),
    ),
  };
}

function routeMastery(
  context: MetricContext,
  mastery: ReadonlyMap<string, number>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [routeId, conceptIds] of context.routeConceptIds) {
    const values = conceptIds
      .map((conceptId) => mastery.get(conceptId))
      .filter((value): value is number => value !== undefined);
    if (values.length > 0) {
      result.set(routeId, values.reduce((sum, value) => sum + value, 0) / values.length);
    }
  }
  return result;
}

function burdenByRoute(context: MetricContext): Map<string, number> {
  const burden = new Map<string, number>();
  for (const finding of context.input.findings) {
    for (const routeId of finding.references.route_ids) {
      burden.set(routeId, Math.max(burden.get(routeId) ?? 0, finding.learning_burden));
    }
  }
  return burden;
}

function exceptionBurden(
  context: MetricContext,
  training: ReturnType<typeof masteryByConcept>,
): StrategicFitMetric<ExceptionBurdenMetricValue> {
  const expectedFrequency = [...context.exceptionRouteIds].reduce(
    (sum, routeId) => sum + context.routeWeight.get(routeId)!,
    0,
  );
  if (!training) {
    return metric(
      "exception-burden",
      "composite",
      "partial",
      { expected_frequency: round(expectedFrequency), training_cost: null },
      "Expected exception frequency is available, but training cost requires calibrated training metadata.",
      mergeProvenance(context.input.weights.provenance, context.input.modes.provenance, [TRAINING_UNAVAILABLE]),
    );
  }
  const mastery = routeMastery(context, training.mastery);
  const burden = burdenByRoute(context);
  const sensitivity = memorizationSensitivity(context);
  let trainingCost = 0;
  let coveredExceptionWeight = 0;
  for (const routeId of context.exceptionRouteIds) {
    const routeMasteryValue = mastery.get(routeId);
    if (routeMasteryValue === undefined) continue;
    const weight = context.routeWeight.get(routeId)!;
    coveredExceptionWeight += weight;
    trainingCost += weight * (burden.get(routeId) ?? 0) *
      (1 - routeMasteryValue) * sensitivity.value;
  }
  const complete = expectedFrequency <= EPSILON || coveredExceptionWeight + EPSILON >= expectedFrequency;
  return metric(
    "exception-burden",
    "composite",
    complete ? "available" : "partial",
    { expected_frequency: round(expectedFrequency), training_cost: round(trainingCost) },
    `${exactEvidenceCoverageReason("Exception training cost", coveredExceptionWeight, expectedFrequency)} Applied ${Math.round(sensitivity.value * 100)}% memorization sensitivity.`,
    mergeProvenance(
      context.input.weights.provenance,
      context.input.modes.provenance,
      context.input.concepts.provenance,
      training.provenance,
      sensitivity.provenance,
    ),
  );
}

function forcedDiversityFloor(context: MetricContext): StrategicFitMetric<number> {
  const forcedRouteIds = new Set(
    context.input.findings
      .filter((finding) => finding.classification === "forced-diversity")
      .flatMap((finding) => finding.references.route_ids),
  );
  const value = [...forcedRouteIds].reduce((sum, routeId) => sum + context.routeWeight.get(routeId)!, 0);
  return metric(
    "forced-diversity-floor",
    "fraction",
    "partial",
    round(value),
    "This is a provisional engine-free floor; replacement soundness and coverage constraints have not been searched yet.",
    mergeProvenance(
      context.input.weights.provenance,
      ...context.input.findings.map((finding) => finding.provenance.sources),
    ),
  );
}

function familiarityAdjustedCoverage(
  context: MetricContext,
  training: ReturnType<typeof masteryByConcept>,
): StrategicFitMetric<number> {
  if (!training) {
    return unavailable(
      "familiarity-adjusted-coverage",
      "fraction",
      "Familiarity-adjusted coverage requires calibrated concept-mastery evidence.",
      [TRAINING_UNAVAILABLE],
    );
  }
  const mastery = routeMastery(context, training.mastery);
  let coveredWeight = 0;
  let familiarWeight = 0;
  for (const [routeId, value] of mastery) {
    const weight = context.routeWeight.get(routeId)!;
    coveredWeight += weight;
    // A calibrated mastery threshold keeps this a coverage measure rather than a mean score.
    if (value + EPSILON >= MASTERY_THRESHOLD) familiarWeight += weight;
  }
  if (coveredWeight <= EPSILON) {
    return unavailable(
      "familiarity-adjusted-coverage",
      "fraction",
      "Supplied training metadata does not match a supported concept in the current repertoire.",
      training.provenance,
    );
  }
  const partial = coveredWeight + EPSILON < context.totalWeight;
  return metric(
    "familiarity-adjusted-coverage",
    "fraction",
    partial ? "partial" : "available",
    round(familiarWeight / coveredWeight),
    exactEvidenceCoverageReason("Familiarity-adjusted coverage", coveredWeight, context.totalWeight),
    mergeProvenance(context.input.weights.provenance, context.input.concepts.provenance, training.provenance),
  );
}

function trainingAdjustedWorkload(
  context: MetricContext,
  training: ReturnType<typeof masteryByConcept>,
): StrategicFitMetric<number> {
  if (!training) {
    return unavailable(
      "training-adjusted-workload",
      "score",
      "Training-adjusted workload requires calibrated concept-mastery evidence.",
      [TRAINING_UNAVAILABLE],
    );
  }
  const mastery = routeMastery(context, training.mastery);
  const burden = burdenByRoute(context);
  const sensitivity = memorizationSensitivity(context);
  const relevantRoutes = new Set(context.input.findings.flatMap((finding) => finding.references.route_ids));
  let workload = 0;
  let relevantWeight = 0;
  let coveredWeight = 0;
  for (const routeId of relevantRoutes) {
    const weight = context.routeWeight.get(routeId)!;
    relevantWeight += weight;
    const routeMasteryValue = mastery.get(routeId);
    if (routeMasteryValue === undefined) continue;
    coveredWeight += weight;
    workload += weight * (burden.get(routeId) ?? 0) *
      (1 - routeMasteryValue) * sensitivity.value;
  }
  const complete = relevantWeight <= EPSILON || coveredWeight + EPSILON >= relevantWeight;
  return metric(
    "training-adjusted-workload",
    "score",
    complete ? "available" : "partial",
    round(workload),
    `${exactEvidenceCoverageReason("Training-adjusted workload", coveredWeight, relevantWeight)} Applied ${Math.round(sensitivity.value * 100)}% memorization sensitivity.`,
    mergeProvenance(
      context.input.weights.provenance,
      context.input.concepts.provenance,
      training.provenance,
      sensitivity.provenance,
      ...context.input.findings.map((finding) => finding.provenance.sources),
    ),
  );
}

function repertoireRegret(
  context: MetricContext,
  training: ReturnType<typeof masteryByConcept>,
): StrategicFitMetric<number> {
  const marketCoverage = context.input.weights.evidence_sources.find((source) =>
    source.kind === "market" && source.resolution === "used"
  );
  const legacyMarketAvailable = context.input.weights.requested_mode !== "equal" &&
    context.input.weights.provenance.some((source) =>
      source.kind === "opening-explorer" && (source.state === "available" || source.state === "partial")
    );
  const marketAvailable = marketCoverage !== undefined || legacyMarketAvailable;
  const marketProvenance = context.input.weights.provenance.filter((source) =>
    source.kind === "opening-explorer"
  );
  if (!marketAvailable) {
    return unavailable(
      "repertoire-regret",
      "score",
      "Repertoire regret has 0% market-weight coverage; equal, personal-only, or manual-only weights cannot establish that theory is rarely encountered.",
      context.input.weights.provenance,
    );
  }
  if (!training) {
    return unavailable(
      "repertoire-regret",
      "score",
      "Repertoire regret has 0% training coverage; calibrated concept mastery is required and missing evidence is not counted as failure.",
      mergeProvenance(context.input.weights.provenance, marketProvenance, [TRAINING_UNAVAILABLE]),
    );
  }

  const relevantRouteIds = new Set(
    context.input.findings.flatMap((finding) => finding.references.route_ids),
  );
  const relevantWeight = [...relevantRouteIds].reduce(
    (sum, routeId) => sum + context.routeWeight.get(routeId)!,
    0,
  );
  if (relevantWeight <= EPSILON) {
    return unavailable(
      "repertoire-regret",
      "score",
      "Repertoire regret has no finding routes on which to measure training and replacement coverage.",
      mergeProvenance(context.input.weights.provenance, training.provenance),
    );
  }

  const mastery = routeMastery(context, training.mastery);
  const sensitivity = memorizationSensitivity(context);
  const replacementByRoute = new Map<string, { burden: number; actionability: number }>();
  for (const finding of context.input.findings) {
    const actionability = requireUnitInterval(
      `finding:${finding.finding_id}:replacement-actionability`,
      finding.replacement_priority?.actionability ?? 0,
    );
    if (actionability <= EPSILON) continue;
    for (const routeId of finding.references.route_ids) {
      const existing = replacementByRoute.get(routeId);
      const candidate = finding.learning_burden * actionability;
      if (!existing || candidate > existing.burden * existing.actionability) {
        replacementByRoute.set(routeId, { burden: finding.learning_burden, actionability });
      }
    }
  }
  const trainingCoveredWeight = [...relevantRouteIds].reduce((sum, routeId) =>
    sum + (mastery.has(routeId) ? context.routeWeight.get(routeId)! : 0), 0
  );
  const replacementCoveredWeight = [...relevantRouteIds].reduce((sum, routeId) =>
    sum + (replacementByRoute.has(routeId) ? context.routeWeight.get(routeId)! : 0), 0
  );
  if (replacementCoveredWeight <= EPSILON) {
    return unavailable(
      "repertoire-regret",
      "score",
      `Repertoire regret has ${Math.round(trainingCoveredWeight / relevantWeight * 100)}% training coverage but 0% viable-replacement coverage; unassessed alternatives are not treated as replaceable.`,
      mergeProvenance(
        context.input.weights.provenance,
        training.provenance,
        ...context.input.findings.map((finding) => finding.provenance.sources),
      ),
    );
  }
  if (trainingCoveredWeight <= EPSILON) {
    return unavailable(
      "repertoire-regret",
      "score",
      `Repertoire regret has 0% training coverage and ${Math.round(replacementCoveredWeight / relevantWeight * 100)}% viable-replacement coverage; missing mastery is not counted as zero.`,
      mergeProvenance(context.input.weights.provenance, training.provenance),
    );
  }

  const regretScoreByUnit = new Map<string, number>();
  const regretCoveredWeightByUnit = new Map<string, number>();
  let jointlyCoveredWeight = 0;
  for (const routeId of relevantRouteIds) {
    const routeMasteryValue = mastery.get(routeId);
    const replacement = replacementByRoute.get(routeId);
    if (routeMasteryValue === undefined || replacement === undefined) continue;
    const weight = context.routeWeight.get(routeId)!;
    jointlyCoveredWeight += weight;
    const unitId = context.routeUnit.get(routeId)!;
    regretScoreByUnit.set(
      unitId,
      (regretScoreByUnit.get(unitId) ?? 0) + weight * replacement.burden *
        (1 - routeMasteryValue) * replacement.actionability,
    );
    regretCoveredWeightByUnit.set(
      unitId,
      (regretCoveredWeightByUnit.get(unitId) ?? 0) + weight,
    );
  }
  let regret = 0;
  const unitWeight = new Map(context.input.weights.weighting_units.map((unit) => [
    unit.weighting_unit_id,
    unit.normalized_weight,
  ]));
  for (const [unitId, score] of regretScoreByUnit) {
    const coveredWeight = regretCoveredWeightByUnit.get(unitId)!;
    const frequency = unitWeight.get(unitId)!;
    // Canonically equivalent route spellings form one theory unit. Its expected burden is
    // discounted by familiarity and by how common that unit already is.
    regret += frequency * (1 - frequency) * (score / coveredWeight) * sensitivity.value;
  }
  const legacyMarketPartial = marketCoverage === undefined && marketProvenance.some((source) =>
    source.state === "partial"
  );
  const complete = jointlyCoveredWeight + EPSILON >= relevantWeight &&
    marketCoverage?.state !== "partial" && !legacyMarketPartial;
  const marketState = marketCoverage?.state ?? (legacyMarketPartial ? "partial" : "available");
  const reason = `Repertoire regret uses ${Math.round(trainingCoveredWeight / relevantWeight * 100)}% training coverage, ${Math.round(replacementCoveredWeight / relevantWeight * 100)}% viable-replacement coverage, and ${marketState} market weighting; ${Math.round(jointlyCoveredWeight / relevantWeight * 100)}% is jointly calculable. Applied ${Math.round(sensitivity.value * 100)}% memorization sensitivity. Missing evidence is not counted as zero.`;
  return metric(
    "repertoire-regret",
    "score",
    complete ? "available" : "partial",
    round(regret),
    reason,
    mergeProvenance(
      context.input.weights.provenance,
      training.provenance,
      sensitivity.provenance,
      ...context.input.findings.map((finding) => finding.provenance.sources),
    ),
  );
}

function moveOrderResilience(context: MetricContext): StrategicFitMetric<number> {
  const eligibleRoutes = new Set(context.selectedModeIdsByRoute.keys());
  const eligibleWeight = [...eligibleRoutes].reduce((sum, routeId) => sum + context.routeWeight.get(routeId)!, 0);
  if (eligibleWeight <= EPSILON) {
    return unavailable(
      "move-order-resilience",
      "fraction",
      "No supported strategic mode is available for move-order comparison.",
      context.input.modes.provenance,
    );
  }
  const resilientRoutes = new Set<string>();
  for (const link of context.input.graph.transposition_links) {
    const routeIds = link.route_ids.filter((routeId) => eligibleRoutes.has(routeId));
    for (const routeId of routeIds) {
      const modes = context.selectedModeIdsByRoute.get(routeId)!;
      const survives = routeIds.some((otherRouteId) =>
        otherRouteId !== routeId &&
        [...modes].some((modeId) => context.selectedModeIdsByRoute.get(otherRouteId)!.has(modeId))
      );
      if (survives) resilientRoutes.add(routeId);
    }
  }
  const resilientWeight = [...resilientRoutes].reduce(
    (sum, routeId) => sum + context.routeWeight.get(routeId)!,
    0,
  );
  const partial = eligibleWeight + EPSILON < context.totalWeight;
  return metric(
    "move-order-resilience",
    "fraction",
    partial ? "partial" : "available",
    round(resilientWeight / eligibleWeight),
    partial ? evidenceCoverageReason("Move-order resilience", eligibleWeight, context.totalWeight) : null,
    mergeProvenance(context.input.weights.provenance, context.input.modes.provenance),
  );
}

function conceptCentrality(
  context: MetricContext,
  aggregates: ReadonlyMap<string, ConceptAggregate>,
): StrategicFitMetric<readonly ConceptCentralityMetricValue[]> {
  if (aggregates.size === 0) {
    return unavailable(
      "concept-centrality",
      "composite",
      "No supported deterministic concepts are available for centrality measurement.",
      context.input.concepts.provenance,
    );
  }
  const values = [...aggregates.entries()].map(([conceptId, aggregate]) => ({
    concept_id: conceptId,
    expected_frequency: round(aggregate.weight),
    cohort_ids: [...aggregate.cohortIds].sort(compareStrings),
  })).sort((left, right) =>
    right.expected_frequency - left.expected_frequency || compareStrings(left.concept_id, right.concept_id)
  );
  const coveredWeight = [...context.routeConceptIds.entries()]
    .filter(([, conceptIds]) => conceptIds.length > 0)
    .reduce((sum, [routeId]) => sum + context.routeWeight.get(routeId)!, 0);
  const partial = coveredWeight + EPSILON < context.totalWeight;
  return metric(
    "concept-centrality",
    "composite",
    partial ? "partial" : "available",
    values,
    partial ? evidenceCoverageReason("Concept centrality", coveredWeight, context.totalWeight) : null,
    mergeProvenance(context.input.weights.provenance, context.input.concepts.provenance),
  );
}

/** Calculate all frozen overview metrics without engine or network access. */
export function calculateStrategicFitMetrics(input: StrategicFitMetricsInput): StrategicFitMetrics {
  const context = makeContext(input);
  const aggregates = conceptAggregates(context);
  const training = masteryByConcept(context);
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    strategic_entropy: strategicEntropy(context),
    concept_reuse: conceptReuse(context, aggregates),
    exception_burden: exceptionBurden(context, training),
    forced_diversity_floor: forcedDiversityFloor(context),
    homogenization_cost: unavailable<HomogenizationCostMetricValue>(
      "homogenization-cost",
      "composite",
      "Homogenization cost requires evaluated replacement and coverage evidence.",
      [],
    ),
    familiarity_adjusted_coverage: familiarityAdjustedCoverage(context, training),
    training_adjusted_workload: trainingAdjustedWorkload(context, training),
    repertoire_regret: repertoireRegret(context, training),
    move_order_resilience: moveOrderResilience(context),
    concept_centrality: conceptCentrality(context, aggregates),
  };
}

function unadjustedWorkload(context: MetricContext): number {
  const burden = burdenByRoute(context);
  return [...burden.entries()].reduce(
    (sum, [routeId, value]) => sum + context.routeWeight.get(routeId)! * value,
    0,
  );
}

/** Compose the deterministic overview counts and workload label around the metric bundle. */
export function calculateStrategicFitOverview(input: StrategicFitMetricsInput): StrategicFitOverview {
  const context = makeContext(input);
  const metrics = calculateStrategicFitMetrics(input);
  const expectedConceptBurden = [...context.routeConceptIds.entries()].reduce(
    (sum, [routeId, conceptIds]) => sum + context.routeWeight.get(routeId)! * conceptIds.length,
    0,
  );
  const hasConceptEvidence = [...context.routeConceptIds.values()].some((conceptIds) => conceptIds.length > 0);
  const workloadScore = unadjustedWorkload(context);
  const workload = workloadScore >= STRATEGIC_WORKLOAD_THRESHOLDS.high
    ? "high" as const
    : workloadScore >= STRATEGIC_WORKLOAD_THRESHOLDS.moderate
      ? "moderate" as const
      : "low" as const;
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    workload,
    strategic_family_count: new Set(context.familyBucketByRoute.values()).size,
    expected_concept_burden: hasConceptEvidence ? round(expectedConceptBurden) : null,
    intentional_exception_count: input.findings.filter((finding) =>
      finding.classification === "intentional-diversity"
    ).length,
    unresolved_finding_count: input.findings.filter((finding) =>
      finding.resolution_state === "unresolved"
    ).length,
    insufficient_evidence_branch_count: input.modes.data_quality.insufficient_evidence_route_count,
    metrics,
  };
}
