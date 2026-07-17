/**
 * Explainable mixed-feature Strategic Fit distance.
 *
 * Only stable or irreversible evidence at matched, comparable milestones participates. Missing
 * checkpoints, missing feature slots, and arbitrary final PGN endpoints never create distance.
 * Each supported feature is normalized to 0-1, averaged inside its feature family, and then
 * combined with the configured family weights. The exported contribution fields use the same
 * arithmetic as the final score so explanations can always reconcile with it.
 */
import type { StrategicConceptDictionary, StrategicRouteConcepts } from "./concepts.js";
import type { StrategicModeReport } from "./modes.js";
import type {
  JsonValue,
  StrategicCheckpointKind,
  StrategicFitSourceProvenance,
  StrategicSignal,
  StrategicSignalFamily,
  StrategicSnapshot,
  StrategicTrajectory,
} from "./types.js";
import { STRATEGIC_SIGNAL_FAMILIES } from "./types.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const STRATEGIC_DISTANCE_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.distance;

export const STRATEGIC_DISTANCE_STATES = ["available", "incomparable"] as const;
export type StrategicDistanceState = (typeof STRATEGIC_DISTANCE_STATES)[number];

export type StrategicDistanceFeatureFamilyWeights = Readonly<Record<StrategicSignalFamily, number>>;

export const DEFAULT_STRATEGIC_DISTANCE_FEATURE_FAMILY_WEIGHTS: StrategicDistanceFeatureFamilyWeights =
  Object.freeze({
    "pawn-topology": 1,
    "center-dynamics": 1,
    "king-and-piece-setup": 1,
    "space-and-files": 1,
    "dynamic-character": 1,
    "learning-concepts": 1,
  });

export interface StrategicDistanceOptions {
  /** Partial overrides are merged with the deterministic equal-family defaults. */
  readonly feature_family_weights?: Partial<StrategicDistanceFeatureFamilyWeights>;
}

export interface StrategicDistanceFeatureContribution {
  readonly family: StrategicSignalFamily;
  /** Stable signal feature ID, or the language-neutral supported-concepts feature. */
  readonly feature_id: string;
  readonly distance: number;
  readonly matched_evidence_count: number;
  readonly matched_checkpoint_keys: readonly string[];
  /** Share of the final mixed-feature calculation after family and feature normalization. */
  readonly normalized_weight: number;
  readonly contribution: number;
}

export interface StrategicDistanceFamilyContribution {
  readonly family: StrategicSignalFamily;
  readonly distance: number;
  readonly feature_count: number;
  readonly configured_weight: number;
  /** Configured weight normalized over families with comparable evidence. */
  readonly normalized_weight: number;
  readonly contribution: number;
}

export interface StrategicTrajectoryDistance {
  readonly analysis_version: string;
  readonly distance_version: string;
  readonly state: StrategicDistanceState;
  readonly left_route_id: string;
  readonly right_route_id: string;
  /** Null means the routes share no supported evidence and are not safely comparable. */
  readonly distance: number | null;
  readonly matched_checkpoint_keys: readonly string[];
  readonly left_only_checkpoint_keys: readonly string[];
  readonly right_only_checkpoint_keys: readonly string[];
  readonly family_contributions: readonly StrategicDistanceFamilyContribution[];
  readonly feature_contributions: readonly StrategicDistanceFeatureContribution[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

export interface StrategicRouteModeDistance extends StrategicTrajectoryDistance {
  readonly cohort_id: string;
  readonly mode_id: string;
  readonly representative_route_id: string;
}

export interface StrategicDistanceReport {
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly distance_version: string;
  readonly graph_id: string;
  readonly mode_version: string;
  readonly concept_classifier_version: string;
  readonly feature_family_weights: StrategicDistanceFeatureFamilyWeights;
  readonly comparisons: readonly StrategicRouteModeDistance[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface FeatureObservation {
  readonly family: StrategicSignalFamily;
  readonly featureId: string;
  readonly checkpointKey: string;
  readonly distance: number;
}

interface FeatureAggregate {
  readonly family: StrategicSignalFamily;
  readonly featureId: string;
  readonly distance: number;
  readonly matchedEvidenceCount: number;
  readonly matchedCheckpointKeys: readonly string[];
}

const ID_SEPARATOR = "\u001f";
const EPSILON = 1e-12;
const CHECKPOINT_ORDER: Readonly<Record<Exclude<StrategicCheckpointKind, "final-valid-position">, number>> =
  Object.freeze({
    "opening-exit": 0,
    "central-resolution": 1,
    "irreversible-transformation": 2,
    "configured-ply": 3,
  });
const TIMING_AND_TRANSPORT_KEYS = new Set([
  "analysis_version",
  "at_ply",
  "color",
  "confidence",
  "first_lost_ply",
  "first_observed_ply",
  "first_ply",
  "last_ply",
  "observation_count",
]);

const ORDINAL_VALUES: Readonly<Record<string, Readonly<Record<string, number>>>> = Object.freeze({
  "center-dynamics.openness": Object.freeze({ closed: 0, "semi-open": 0.5, open: 1 }),
  "center-dynamics.fixity": Object.freeze({ fixed: 0, "partially-fixed": 0.5, unfixed: 1 }),
  "center-dynamics.fluidity": Object.freeze({ fixed: 0, limited: 1 / 3, fluid: 2 / 3, resolved: 1 }),
});

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:distance",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_DISTANCE_VERSION,
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

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareCheckpointKeys(left: string, right: string): number {
  const leftKind = left.split(":", 1)[0] as Exclude<StrategicCheckpointKind, "final-valid-position">;
  const rightKind = right.split(":", 1)[0] as Exclude<StrategicCheckpointKind, "final-valid-position">;
  const kindOrder = CHECKPOINT_ORDER[leftKind] - CHECKPOINT_ORDER[rightKind];
  if (kindOrder !== 0) return kindOrder;
  if (leftKind === "configured-ply" && rightKind === "configured-ply") {
    const plyOrder = Number(left.slice(left.indexOf(":") + 1)) - Number(right.slice(right.indexOf(":") + 1));
    if (plyOrder !== 0) return plyOrder;
  }
  return compareStrings(left, right);
}

function isObject(value: JsonValue): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(compareStrings).map((key) =>
      `${JSON.stringify(key)}:${stableSerialize(value[key]!)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => !TIMING_AND_TRANSPORT_KEYS.has(key))
      .sort(compareStrings)
      .map((key) => [key, canonicalValue(value[key]!)]),
  );
}

function setDistance(left: readonly JsonValue[], right: readonly JsonValue[]): number {
  const leftSet = new Set(left.map((value) => stableSerialize(canonicalValue(value))));
  const rightSet = new Set(right.map((value) => stableSerialize(canonicalValue(value))));
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) return 0;
  let shared = 0;
  for (const value of leftSet) if (rightSet.has(value)) shared++;
  return 1 - shared / union.size;
}

function ordinalDistance(featureId: string, left: string, right: string): number | null {
  const values = ORDINAL_VALUES[featureId];
  const leftValue = values?.[left];
  const rightValue = values?.[right];
  return leftValue === undefined || rightValue === undefined ? null : Math.abs(leftValue - rightValue);
}

/** A bounded symmetric JSON distance. Object keys absent on either side are missing evidence. */
function mixedValueDistance(left: JsonValue, right: JsonValue, featureId: string): number {
  const normalizedLeft = canonicalValue(left);
  const normalizedRight = canonicalValue(right);
  if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
    const scale = Math.max(Math.abs(normalizedLeft), Math.abs(normalizedRight), 1);
    return clamp(Math.abs(normalizedLeft - normalizedRight) / scale);
  }
  if (typeof normalizedLeft === "string" && typeof normalizedRight === "string") {
    const ordinal = ordinalDistance(featureId, normalizedLeft, normalizedRight);
    return ordinal ?? (normalizedLeft === normalizedRight ? 0 : 1);
  }
  if (
    (typeof normalizedLeft === "boolean" || normalizedLeft === null) &&
    (typeof normalizedRight === "boolean" || normalizedRight === null)
  ) {
    return normalizedLeft === normalizedRight ? 0 : 1;
  }
  if (Array.isArray(normalizedLeft) && Array.isArray(normalizedRight)) {
    return setDistance(normalizedLeft, normalizedRight);
  }
  if (isObject(normalizedLeft) && isObject(normalizedRight)) {
    const sharedKeys = Object.keys(normalizedLeft)
      .filter((key) => Object.hasOwn(normalizedRight, key))
      .sort(compareStrings);
    if (sharedKeys.length === 0) return 0;
    return sharedKeys.reduce((sum, key) =>
      sum + mixedValueDistance(normalizedLeft[key]!, normalizedRight[key]!, featureId), 0
    ) / sharedKeys.length;
  }
  return stableSerialize(normalizedLeft) === stableSerialize(normalizedRight) ? 0 : 1;
}

function checkpointKey(snapshot: StrategicSnapshot): string {
  const checkpoint = snapshot.checkpoint;
  return checkpoint.kind === "configured-ply"
    ? `${checkpoint.kind}:${checkpoint.ply}`
    : checkpoint.kind;
}

function comparableSnapshots(trajectory: StrategicTrajectory): Map<string, StrategicSnapshot> {
  const result = new Map<string, StrategicSnapshot>();
  for (const snapshot of trajectory.snapshots) {
    if (
      snapshot.checkpoint.comparability !== "comparable" ||
      snapshot.checkpoint.kind === "final-valid-position"
    ) continue;
    const key = checkpointKey(snapshot);
    if (result.has(key)) throw new Error(`strategic_fit_distance_duplicate_checkpoint: ${trajectory.route_id} ${key}`);
    result.set(key, snapshot);
  }
  return result;
}

function signalSlot(signal: StrategicSignal): string {
  const subject = isObject(signal.value) && typeof signal.value.subject === "string"
    ? signal.value.subject
    : null;
  return subject === null ? signal.feature_id : `${signal.feature_id}:${subject}`;
}

function stableSignals(snapshot: StrategicSnapshot): Map<string, StrategicSignal> {
  const result = new Map<string, StrategicSignal>();
  for (const signal of snapshot.signals) {
    if (signal.persistence !== "stable" && signal.persistence !== "irreversible") continue;
    const slot = signalSlot(signal);
    if (result.has(slot)) throw new Error(`strategic_fit_distance_duplicate_signal_slot: ${snapshot.snapshot_id} ${slot}`);
    result.set(slot, signal);
  }
  return result;
}

function conceptObservation(
  left: StrategicRouteConcepts,
  right: StrategicRouteConcepts,
): FeatureObservation | null {
  // An empty dictionary side means the deterministic classifier found no supported concept. It
  // does not prove the concept is absent, so it cannot by itself count as a difference.
  if (left.concepts.length === 0 || right.concepts.length === 0) return null;
  const leftIds = left.concepts.map((concept) => concept.concept_id);
  const rightIds = right.concepts.map((concept) => concept.concept_id);
  return {
    family: "learning-concepts",
    featureId: "learning-concepts.supported-concepts",
    checkpointKey: "trajectory:stable-concepts",
    distance: setDistance(leftIds, rightIds),
  };
}

function observations(
  left: StrategicTrajectory,
  right: StrategicTrajectory,
  leftConcepts: StrategicRouteConcepts,
  rightConcepts: StrategicRouteConcepts,
): {
  readonly values: FeatureObservation[];
  readonly matched: string[];
  readonly leftOnly: string[];
  readonly rightOnly: string[];
} {
  const leftSnapshots = comparableSnapshots(left);
  const rightSnapshots = comparableSnapshots(right);
  const matched = [...leftSnapshots.keys()].filter((key) => rightSnapshots.has(key)).sort(compareCheckpointKeys);
  const values: FeatureObservation[] = [];
  for (const key of matched) {
    const leftSignals = stableSignals(leftSnapshots.get(key)!);
    const rightSignals = stableSignals(rightSnapshots.get(key)!);
    const slots = [...leftSignals.keys()].filter((slot) => rightSignals.has(slot)).sort(compareStrings);
    for (const slot of slots) {
      const leftSignal = leftSignals.get(slot)!;
      const rightSignal = rightSignals.get(slot)!;
      if (leftSignal.family !== rightSignal.family || leftSignal.feature_id !== rightSignal.feature_id) {
        throw new Error(`strategic_fit_distance_signal_slot_collision: ${slot}`);
      }
      values.push({
        family: leftSignal.family,
        featureId: leftSignal.feature_id,
        checkpointKey: key,
        distance: mixedValueDistance(leftSignal.value, rightSignal.value, leftSignal.feature_id),
      });
    }
  }
  const concept = conceptObservation(leftConcepts, rightConcepts);
  if (concept) values.push(concept);
  return {
    values,
    matched,
    leftOnly: [...leftSnapshots.keys()].filter((key) => !rightSnapshots.has(key)).sort(compareCheckpointKeys),
    rightOnly: [...rightSnapshots.keys()].filter((key) => !leftSnapshots.has(key)).sort(compareCheckpointKeys),
  };
}

function aggregateFeatures(values: readonly FeatureObservation[]): FeatureAggregate[] {
  const groups = new Map<string, FeatureObservation[]>();
  for (const value of values) {
    const key = [value.family, value.featureId].join(ID_SEPARATOR);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    family: group[0]!.family,
    featureId: group[0]!.featureId,
    distance: clamp(group.reduce((sum, item) => sum + item.distance, 0) / group.length),
    matchedEvidenceCount: group.length,
    matchedCheckpointKeys: sortedUnique(group.map((item) => item.checkpointKey)),
  })).sort((left, right) =>
    STRATEGIC_SIGNAL_FAMILIES.indexOf(left.family) - STRATEGIC_SIGNAL_FAMILIES.indexOf(right.family) ||
    compareStrings(left.featureId, right.featureId)
  );
}

function resolvedWeights(options: StrategicDistanceOptions): StrategicDistanceFeatureFamilyWeights {
  const overrides = options.feature_family_weights ?? {};
  for (const family of Object.keys(overrides)) {
    if (!(STRATEGIC_SIGNAL_FAMILIES as readonly string[]).includes(family)) {
      throw new Error(`strategic_fit_distance_unknown_family: ${family}`);
    }
  }
  const weights = Object.fromEntries(STRATEGIC_SIGNAL_FAMILIES.map((family) => {
    const value = overrides[family] ?? DEFAULT_STRATEGIC_DISTANCE_FEATURE_FAMILY_WEIGHTS[family];
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`strategic_fit_distance_invalid_weight: ${family} ${String(value)}`);
    }
    return [family, value];
  })) as unknown as StrategicDistanceFeatureFamilyWeights;
  if (STRATEGIC_SIGNAL_FAMILIES.every((family) => weights[family] === 0)) {
    throw new Error("strategic_fit_distance_all_weights_zero");
  }
  return weights;
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

function emptyDistance(
  left: StrategicTrajectory,
  right: StrategicTrajectory,
  matched: readonly string[],
  leftOnly: readonly string[],
  rightOnly: readonly string[],
  provenance: readonly StrategicFitSourceProvenance[],
): StrategicTrajectoryDistance {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    distance_version: STRATEGIC_DISTANCE_VERSION,
    state: "incomparable",
    left_route_id: left.route_id,
    right_route_id: right.route_id,
    distance: null,
    matched_checkpoint_keys: matched,
    left_only_checkpoint_keys: leftOnly,
    right_only_checkpoint_keys: rightOnly,
    family_contributions: [],
    feature_contributions: [],
    provenance,
  };
}

function reconcileContributions<T extends { readonly contribution: number }>(
  values: readonly T[],
  target: number,
): T[] {
  if (values.length === 0) return [];
  const actual = round(values.reduce((sum, value) => sum + value.contribution, 0));
  const adjustment = round(target - actual);
  if (Math.abs(adjustment) <= EPSILON) return [...values];
  let adjustedIndex = values.length - 1;
  if (adjustment < 0) {
    while (adjustedIndex >= 0 && values[adjustedIndex]!.contribution + adjustment < -EPSILON) {
      adjustedIndex--;
    }
  }
  if (adjustedIndex < 0) throw new Error("strategic_fit_distance_contribution_reconciliation_failed");
  return values.map((value, index) => index === adjustedIndex
    ? { ...value, contribution: round(value.contribution + adjustment) }
    : value
  );
}

/** Compare two trajectories symmetrically using only their shared supported evidence. */
export function computeStrategicTrajectoryDistance(
  left: StrategicTrajectory,
  right: StrategicTrajectory,
  leftConcepts: StrategicRouteConcepts,
  rightConcepts: StrategicRouteConcepts,
  options: StrategicDistanceOptions = {},
): StrategicTrajectoryDistance {
  if (
    left.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    right.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    leftConcepts.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    rightConcepts.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_distance_version_mismatch");
  }
  if (left.route_id !== leftConcepts.route_id || right.route_id !== rightConcepts.route_id) {
    throw new Error("strategic_fit_distance_concept_route_mismatch");
  }
  if (left.trajectory_id !== leftConcepts.trajectory_id || right.trajectory_id !== rightConcepts.trajectory_id) {
    throw new Error("strategic_fit_distance_concept_trajectory_mismatch");
  }
  const weights = resolvedWeights(options);
  const evidence = observations(left, right, leftConcepts, rightConcepts);
  const aggregates = aggregateFeatures(evidence.values);
  const provenance = mergeProvenance(
    [CORE_PROVENANCE],
    left.provenance,
    right.provenance,
    leftConcepts.provenance,
    rightConcepts.provenance,
  );
  const weightedAggregates = aggregates.filter((aggregate) => weights[aggregate.family] > 0);
  if (weightedAggregates.length === 0) {
    return emptyDistance(
      left,
      right,
      evidence.matched,
      evidence.leftOnly,
      evidence.rightOnly,
      provenance,
    );
  }
  const availableFamilies = STRATEGIC_SIGNAL_FAMILIES.filter((family) =>
    weightedAggregates.some((aggregate) => aggregate.family === family)
  );
  const availableWeight = availableFamilies.reduce((sum, family) => sum + weights[family], 0);
  const rawFamilyContributions: StrategicDistanceFamilyContribution[] = [];
  const rawFeatureContributions: StrategicDistanceFeatureContribution[] = [];
  let rawDistance = 0;
  for (const family of availableFamilies) {
    const features = weightedAggregates.filter((aggregate) => aggregate.family === family);
    const normalizedFamilyWeight = weights[family] / availableWeight;
    const familyDistance = features.reduce((sum, feature) => sum + feature.distance, 0) / features.length;
    rawDistance += normalizedFamilyWeight * familyDistance;
    rawFamilyContributions.push({
      family,
      distance: round(familyDistance),
      feature_count: features.length,
      configured_weight: round(weights[family]),
      normalized_weight: round(normalizedFamilyWeight),
      contribution: round(normalizedFamilyWeight * familyDistance),
    });
    for (const feature of features) {
      const normalizedWeight = normalizedFamilyWeight / features.length;
      rawFeatureContributions.push({
        family,
        feature_id: feature.featureId,
        distance: round(feature.distance),
        matched_evidence_count: feature.matchedEvidenceCount,
        matched_checkpoint_keys: feature.matchedCheckpointKeys,
        normalized_weight: round(normalizedWeight),
        contribution: round(normalizedWeight * feature.distance),
      });
    }
  }
  const distance = round(clamp(rawDistance));
  const familyContributions = reconcileContributions(rawFamilyContributions, distance);
  const featureContributions = reconcileContributions(rawFeatureContributions, distance);
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    distance_version: STRATEGIC_DISTANCE_VERSION,
    state: "available",
    left_route_id: left.route_id,
    right_route_id: right.route_id,
    distance,
    matched_checkpoint_keys: evidence.matched,
    left_only_checkpoint_keys: evidence.leftOnly,
    right_only_checkpoint_keys: evidence.rightOnly,
    family_contributions: familyContributions,
    feature_contributions: featureContributions,
    provenance,
  };
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  const left = sortedUnique(actual);
  const right = sortedUnique(expected);
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireCompatibleReports(
  modes: StrategicModeReport,
  trajectories: StrategicTrajectoryReport,
  concepts: StrategicConceptDictionary,
): void {
  if (
    modes.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    trajectories.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    concepts.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_distance_report_version_mismatch");
  }
  if (modes.graph_id !== trajectories.graph_id || modes.graph_id !== concepts.graph_id) {
    throw new Error("strategic_fit_distance_report_graph_mismatch");
  }
  const modeRouteIds = modes.cohorts.flatMap((cohort) => [...cohort.route_ids, ...cohort.excluded_route_ids]);
  const trajectoryRouteIds = trajectories.trajectories.map((trajectory) => trajectory.route_id);
  const conceptRouteIds = concepts.routes.map((route) => route.route_id);
  if (!sameIds(modeRouteIds, trajectoryRouteIds) || !sameIds(modeRouteIds, conceptRouteIds)) {
    throw new Error("strategic_fit_distance_report_route_mismatch");
  }
}

/** Calculate every included route's explainable distance from each supported real-route mode. */
export function calculateStrategicDistances(
  modeReport: StrategicModeReport,
  trajectoryReport: StrategicTrajectoryReport,
  conceptDictionary: StrategicConceptDictionary,
  options: StrategicDistanceOptions = {},
): StrategicDistanceReport {
  requireCompatibleReports(modeReport, trajectoryReport, conceptDictionary);
  const weights = resolvedWeights(options);
  const trajectoryByRoute = new Map(
    trajectoryReport.trajectories.map((trajectory) => [trajectory.route_id, trajectory]),
  );
  const conceptsByRoute = new Map(conceptDictionary.routes.map((route) => [route.route_id, route]));
  const comparisons: StrategicRouteModeDistance[] = [];
  for (const cohort of [...modeReport.cohorts].sort((left, right) => compareStrings(left.cohort_id, right.cohort_id))) {
    for (const routeId of [...cohort.route_ids].sort(compareStrings)) {
      for (const mode of [...cohort.modes].sort((left, right) => compareStrings(left.mode_id, right.mode_id))) {
        const pair = computeStrategicTrajectoryDistance(
          trajectoryByRoute.get(routeId)!,
          trajectoryByRoute.get(mode.representative_route_id)!,
          conceptsByRoute.get(routeId)!,
          conceptsByRoute.get(mode.representative_route_id)!,
          { feature_family_weights: weights },
        );
        comparisons.push({
          ...pair,
          cohort_id: cohort.cohort_id,
          mode_id: mode.mode_id,
          representative_route_id: mode.representative_route_id,
        });
      }
    }
  }
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    distance_version: STRATEGIC_DISTANCE_VERSION,
    graph_id: modeReport.graph_id,
    mode_version: modeReport.mode_version,
    concept_classifier_version: conceptDictionary.classifier_version,
    feature_family_weights: weights,
    comparisons,
    provenance: mergeProvenance(
      [CORE_PROVENANCE],
      modeReport.provenance,
      trajectoryReport.provenance,
      conceptDictionary.provenance,
      ...comparisons.map((comparison) => comparison.provenance),
    ),
  };
}
