/**
 * Deterministic weighted medoids and multimodal Strategic Fit profiles.
 *
 * This module deliberately uses a small, explainable evidence distance for mode discovery. The
 * richer mixed-feature distance and contribution model belongs to the later distance stage. Mode
 * discovery compares only stable/irreversible signals at matched, non-editorial checkpoints,
 * groups close routes with complete-link clustering, and represents every selected mode with a
 * real route. Route weights affect both medoid choice and mode support.
 */
import type { StrategicCohortReport, StrategicComparableCohort } from "./cohorts.js";
import type { JsonValue, StrategicFitSourceProvenance, StrategicMode, StrategicTrajectory } from "./types.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import {
  calculateEffectiveSampleSize,
  type StrategicRouteWeightingReport,
} from "./weights.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const STRATEGIC_MODE_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.modes;

/** A supported secondary mode must account for at least this much expected cohort weight. */
export const STRATEGIC_MODE_MINIMUM_WEIGHT = 0.2;
/** Inferred single-mode dominance below this effective sample remains insufficient evidence. */
export const STRATEGIC_MODE_MINIMUM_EFFECTIVE_SAMPLE_SIZE = 4;
/** Stable-evidence neighborhoods must be close on every pair, not merely connected by a chain. */
export const STRATEGIC_MODE_CLUSTER_DISTANCE = 0.25;

export const STRATEGIC_MODE_SELECTION_STATES = [
  "single-mode",
  "mixed-profile",
  "explicit-target",
  "insufficient-evidence",
  "excluded",
] as const;
export type StrategicModeSelectionState = (typeof STRATEGIC_MODE_SELECTION_STATES)[number];

export const STRATEGIC_MODE_SELECTION_REASONS = [
  "single-supported-mode",
  "multiple-supported-modes",
  "explicit-profile-intent",
  "minimum-effective-sample-not-met",
  "cohort-insufficient-evidence",
  "no-comparable-stable-evidence",
  "no-supported-mode",
] as const;
export type StrategicModeSelectionReason = (typeof STRATEGIC_MODE_SELECTION_REASONS)[number];

export interface StrategicExplicitModeTarget {
  readonly target_id: string;
  readonly cohort_id: string;
  /** The explicit baseline is still represented by a real route in this cohort. */
  readonly representative_route_id: string;
  /** Defaults to the representative route when no broader explicit support is supplied. */
  readonly supporting_route_ids?: readonly string[];
  readonly concept_ids?: readonly string[];
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicModeDetectionOptions {
  /** Confirmed profile/annotation intent. Explicit targets replace inferred medoids per cohort. */
  readonly explicit_targets?: readonly StrategicExplicitModeTarget[];
}

export interface StrategicModeMedoidCandidate {
  readonly representative_route_id: string;
  readonly supporting_route_ids: readonly string[];
  readonly normalized_weight: number;
  readonly effective_sample_size: number;
  /** Mean route-weighted distance to the real representative route. */
  readonly weighted_distance: number;
  readonly supported: boolean;
}

export interface StrategicModeCohortSelection {
  readonly cohort_id: string;
  readonly state: StrategicModeSelectionState;
  readonly selected_mode_ids: readonly string[];
  readonly candidates: readonly StrategicModeMedoidCandidate[];
  readonly unassigned_route_ids: readonly string[];
  readonly effective_sample_size: number;
  readonly reasons: readonly StrategicModeSelectionReason[];
}

export interface StrategicModeReport
  extends Omit<StrategicCohortReport, "cohorts" | "provenance"> {
  readonly mode_version: string;
  readonly cohorts: readonly StrategicComparableCohort[];
  readonly selections: readonly StrategicModeCohortSelection[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface RouteEvidence {
  readonly routeId: string;
  readonly features: ReadonlyMap<string, ReadonlySet<string>>;
}

interface RouteCluster {
  readonly routeIds: readonly string[];
}

interface CandidateContext {
  readonly candidate: StrategicModeMedoidCandidate;
  readonly cluster: RouteCluster;
}

const ID_SEPARATOR = "\u001f";
const EPSILON = 1e-9;

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:modes",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_MODE_VERSION,
  snapshot: null,
  reason: null,
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

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function semanticId(kind: string, parts: readonly string[]): string {
  return `${kind}:${stableHash(parts.join(ID_SEPARATOR))}`;
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

function requireCompatibleInputs(
  cohorts: StrategicCohortReport,
  trajectories: StrategicTrajectoryReport,
  weights: StrategicRouteWeightingReport,
): void {
  if (
    cohorts.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    trajectories.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    weights.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_modes_version_mismatch");
  }
  if (trajectories.graph_id !== cohorts.graph_id || weights.graph_id !== cohorts.graph_id) {
    throw new Error("strategic_fit_modes_graph_mismatch");
  }
  const cohortRouteIds = cohorts.cohorts.flatMap((cohort) => [
    ...cohort.route_ids,
    ...cohort.excluded_route_ids,
  ]);
  const trajectoryRouteIds = trajectories.trajectories.map((trajectory) => trajectory.route_id);
  const weightRouteIds = weights.routes.map((route) => route.route_id);
  if (!sameIds(cohortRouteIds, trajectoryRouteIds) || !sameIds(cohortRouteIds, weightRouteIds)) {
    throw new Error("strategic_fit_modes_route_mismatch");
  }
}

function validateExplicitTargets(
  cohorts: StrategicCohortReport,
  targets: readonly StrategicExplicitModeTarget[],
): Map<string, StrategicExplicitModeTarget[]> {
  const cohortById = new Map(cohorts.cohorts.map((cohort) => [cohort.cohort_id, cohort]));
  const targetIds = new Set<string>();
  const result = new Map<string, StrategicExplicitModeTarget[]>();
  for (const target of targets) {
    if (!target.target_id || targetIds.has(target.target_id)) {
      throw new Error(`strategic_fit_modes_duplicate_target: ${target.target_id}`);
    }
    targetIds.add(target.target_id);
    const cohort = cohortById.get(target.cohort_id);
    if (!cohort) throw new Error(`strategic_fit_modes_unknown_cohort: ${target.cohort_id}`);
    if (!cohort.route_ids.includes(target.representative_route_id)) {
      throw new Error(`strategic_fit_modes_target_route_outside_cohort: ${target.representative_route_id}`);
    }
    const supportingRouteIds = sortedUnique(target.supporting_route_ids ?? [target.representative_route_id]);
    if (!supportingRouteIds.includes(target.representative_route_id)) {
      throw new Error(`strategic_fit_modes_target_missing_representative: ${target.target_id}`);
    }
    if (supportingRouteIds.some((routeId) => !cohort.route_ids.includes(routeId))) {
      throw new Error(`strategic_fit_modes_target_support_outside_cohort: ${target.target_id}`);
    }
    const existing = result.get(target.cohort_id) ?? [];
    if (existing.some((item) => {
      const itemRoutes = new Set(item.supporting_route_ids ?? [item.representative_route_id]);
      return supportingRouteIds.some((routeId) => itemRoutes.has(routeId));
    })) {
      throw new Error(`strategic_fit_modes_overlapping_targets: ${target.cohort_id}`);
    }
    existing.push({ ...target, supporting_route_ids: supportingRouteIds });
    result.set(target.cohort_id, existing);
  }
  for (const values of result.values()) {
    values.sort((left, right) => compareStrings(left.target_id, right.target_id));
  }
  return result;
}

function routeEvidence(trajectory: StrategicTrajectory): RouteEvidence {
  const mutable = new Map<string, Set<string>>();
  for (const snapshot of trajectory.snapshots) {
    if (
      snapshot.checkpoint.comparability !== "comparable" ||
      snapshot.checkpoint.kind === "final-valid-position"
    ) continue;
    const checkpoint = snapshot.checkpoint.kind === "configured-ply"
      ? `${snapshot.checkpoint.kind}:${snapshot.checkpoint.ply}`
      : snapshot.checkpoint.kind;
    for (const signal of snapshot.signals) {
      if (signal.persistence !== "stable" && signal.persistence !== "irreversible") continue;
      const slot = [checkpoint, signal.family, signal.feature_id].join(ID_SEPARATOR);
      const values = mutable.get(slot) ?? new Set<string>();
      values.add(stableSerialize(signal.value));
      mutable.set(slot, values);
    }
  }
  return {
    routeId: trajectory.route_id,
    features: new Map([...mutable.entries()].sort(([left], [right]) => compareStrings(left, right))),
  };
}

function setDistance(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  const shared = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : 1 - shared / union;
}

/** Null means the two routes share no matched feature slot and are not safely comparable. */
function evidenceDistance(left: RouteEvidence, right: RouteEvidence): number | null {
  const sharedSlots = [...left.features.keys()].filter((slot) => right.features.has(slot));
  if (sharedSlots.length === 0) return null;
  return round(sharedSlots.reduce((sum, slot) =>
    sum + setDistance(left.features.get(slot)!, right.features.get(slot)!), 0) / sharedSlots.length);
}

function clusterIdentity(cluster: RouteCluster): string {
  return cluster.routeIds.join(ID_SEPARATOR);
}

function clusterMaximumDistance(
  left: RouteCluster,
  right: RouteCluster,
  evidenceByRoute: ReadonlyMap<string, RouteEvidence>,
): number | null {
  let maximum = 0;
  for (const leftId of left.routeIds) {
    for (const rightId of right.routeIds) {
      const distance = evidenceDistance(evidenceByRoute.get(leftId)!, evidenceByRoute.get(rightId)!);
      if (distance === null) return null;
      maximum = Math.max(maximum, distance);
    }
  }
  return maximum;
}

function clusterRoutes(evidence: readonly RouteEvidence[]): RouteCluster[] {
  const evidenceByRoute = new Map(evidence.map((item) => [item.routeId, item]));
  let clusters: RouteCluster[] = evidence
    .filter((item) => item.features.size > 0)
    .map((item) => ({ routeIds: [item.routeId] }));
  while (true) {
    let best: { left: number; right: number; distance: number; identity: string } | null = null;
    for (let left = 0; left < clusters.length; left++) {
      for (let right = left + 1; right < clusters.length; right++) {
        const distance = clusterMaximumDistance(clusters[left]!, clusters[right]!, evidenceByRoute);
        if (distance === null || distance > STRATEGIC_MODE_CLUSTER_DISTANCE + EPSILON) continue;
        const identity = `${clusterIdentity(clusters[left]!)}${ID_SEPARATOR}${clusterIdentity(clusters[right]!)}`;
        if (
          best === null || distance < best.distance - EPSILON ||
          (Math.abs(distance - best.distance) <= EPSILON && compareStrings(identity, best.identity) < 0)
        ) {
          best = { left, right, distance, identity };
        }
      }
    }
    if (!best) break;
    const merged: RouteCluster = {
      routeIds: sortedUnique([
        ...clusters[best.left]!.routeIds,
        ...clusters[best.right]!.routeIds,
      ]),
    };
    clusters = clusters.filter((_, index) => index !== best.left && index !== best.right);
    clusters.push(merged);
    clusters.sort((left, right) => compareStrings(clusterIdentity(left), clusterIdentity(right)));
  }
  return clusters;
}

function unitEffectiveSampleSize(
  routeIds: readonly string[],
  routeWeightById: ReadonlyMap<string, number>,
  unitIdByRoute: ReadonlyMap<string, string>,
): number {
  const units = new Map<string, number>();
  for (const routeId of routeIds) {
    const unitId = unitIdByRoute.get(routeId)!;
    units.set(unitId, (units.get(unitId) ?? 0) + routeWeightById.get(routeId)!);
  }
  return calculateEffectiveSampleSize([...units.values()]);
}

function medoidCandidate(
  cluster: RouteCluster,
  evidenceByRoute: ReadonlyMap<string, RouteEvidence>,
  routeWeightById: ReadonlyMap<string, number>,
  unitIdByRoute: ReadonlyMap<string, string>,
): StrategicModeMedoidCandidate {
  const clusterWeight = cluster.routeIds.reduce((sum, routeId) => sum + routeWeightById.get(routeId)!, 0);
  let representative = cluster.routeIds[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidateId of cluster.routeIds) {
    const weightedDistance = cluster.routeIds.reduce((sum, routeId) => {
      const distance = evidenceDistance(evidenceByRoute.get(candidateId)!, evidenceByRoute.get(routeId)!);
      if (distance === null) throw new Error("strategic_fit_modes_incomparable_cluster");
      return sum + routeWeightById.get(routeId)! * distance;
    }, 0) / clusterWeight;
    if (
      weightedDistance < bestDistance - EPSILON ||
      (Math.abs(weightedDistance - bestDistance) <= EPSILON && compareStrings(candidateId, representative) < 0)
    ) {
      representative = candidateId;
      bestDistance = weightedDistance;
    }
  }
  return {
    representative_route_id: representative,
    supporting_route_ids: [...cluster.routeIds],
    normalized_weight: round(clusterWeight),
    effective_sample_size: round(unitEffectiveSampleSize(cluster.routeIds, routeWeightById, unitIdByRoute)),
    weighted_distance: round(bestDistance),
    supported: clusterWeight + EPSILON >= STRATEGIC_MODE_MINIMUM_WEIGHT,
  };
}

function makeMode(
  cohort: StrategicComparableCohort,
  candidate: StrategicModeMedoidCandidate,
  source: StrategicMode["source"],
  conceptIds: readonly string[],
  provenance: readonly StrategicFitSourceProvenance[],
  explicitTargetId: string | null = null,
): StrategicMode {
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    mode_id: semanticId("mode", [
      STRATEGIC_MODE_VERSION,
      cohort.cohort_id,
      source,
      explicitTargetId ?? "inferred",
      candidate.representative_route_id,
      ...candidate.supporting_route_ids,
    ]),
    cohort_id: cohort.cohort_id,
    representative_route_id: candidate.representative_route_id,
    supporting_route_ids: candidate.supporting_route_ids,
    concept_ids: sortedUnique(conceptIds),
    normalized_weight: candidate.normalized_weight,
    effective_sample_size: candidate.effective_sample_size,
    source,
    provenance: mergeProvenance([CORE_PROVENANCE], cohort.provenance, provenance),
  };
}

function explicitSelection(
  cohort: StrategicComparableCohort,
  targets: readonly StrategicExplicitModeTarget[],
  routeWeightById: ReadonlyMap<string, number>,
  unitIdByRoute: ReadonlyMap<string, string>,
): { cohort: StrategicComparableCohort; selection: StrategicModeCohortSelection } {
  const modes = targets.map((target) => {
    const routeIds = target.supporting_route_ids ?? [target.representative_route_id];
    const candidate: StrategicModeMedoidCandidate = {
      representative_route_id: target.representative_route_id,
      supporting_route_ids: routeIds,
      normalized_weight: round(routeIds.reduce((sum, routeId) => sum + routeWeightById.get(routeId)!, 0)),
      effective_sample_size: round(unitEffectiveSampleSize(routeIds, routeWeightById, unitIdByRoute)),
      weighted_distance: 0,
      supported: true,
    };
    return makeMode(
      cohort,
      candidate,
      "explicit-target",
      target.concept_ids ?? [],
      target.provenance ?? [],
      target.target_id,
    );
  });
  const assigned = new Set(modes.flatMap((mode) => mode.supporting_route_ids));
  const state = cohort.state === "insufficient-evidence"
    ? "insufficient-evidence" as const
    : targets.length > 1
      ? "mixed-profile" as const
      : "actionable" as const;
  return {
    cohort: {
      ...cohort,
      state,
      modes,
      provenance: mergeProvenance(
        [CORE_PROVENANCE],
        cohort.provenance,
        ...targets.map((target) => target.provenance ?? []),
      ),
    },
    selection: {
      cohort_id: cohort.cohort_id,
      state: "explicit-target",
      selected_mode_ids: modes.map((mode) => mode.mode_id),
      candidates: modes.map((mode) => ({
        representative_route_id: mode.representative_route_id,
        supporting_route_ids: mode.supporting_route_ids,
        normalized_weight: mode.normalized_weight,
        effective_sample_size: mode.effective_sample_size,
        weighted_distance: 0,
        supported: true,
      })),
      unassigned_route_ids: cohort.route_ids.filter((routeId) => !assigned.has(routeId)).sort(compareStrings),
      effective_sample_size: cohort.effective_sample_size,
      reasons: ["explicit-profile-intent"],
    },
  };
}

function inferredSelection(
  cohort: StrategicComparableCohort,
  trajectories: ReadonlyMap<string, StrategicTrajectory>,
  routeWeightById: ReadonlyMap<string, number>,
  unitIdByRoute: ReadonlyMap<string, string>,
): { cohort: StrategicComparableCohort; selection: StrategicModeCohortSelection } {
  if (cohort.state === "excluded") {
    return {
      cohort,
      selection: {
        cohort_id: cohort.cohort_id,
        state: "excluded",
        selected_mode_ids: [],
        candidates: [],
        unassigned_route_ids: [],
        effective_sample_size: 0,
        reasons: [],
      },
    };
  }
  if (cohort.state === "insufficient-evidence") {
    return {
      cohort,
      selection: {
        cohort_id: cohort.cohort_id,
        state: "insufficient-evidence",
        selected_mode_ids: [],
        candidates: [],
        unassigned_route_ids: [...cohort.route_ids],
        effective_sample_size: cohort.effective_sample_size,
        reasons: ["cohort-insufficient-evidence"],
      },
    };
  }

  const evidence = cohort.route_ids.map((routeId) => routeEvidence(trajectories.get(routeId)!));
  const evidenceByRoute = new Map(evidence.map((item) => [item.routeId, item]));
  const clusters = clusterRoutes(evidence);
  const candidates: CandidateContext[] = clusters.map((cluster) => ({
    cluster,
    candidate: medoidCandidate(cluster, evidenceByRoute, routeWeightById, unitIdByRoute),
  })).sort((left, right) =>
    right.candidate.normalized_weight - left.candidate.normalized_weight ||
    compareStrings(left.candidate.representative_route_id, right.candidate.representative_route_id)
  );
  const supported = candidates.filter((item) => item.candidate.supported);
  const evidenceRoutes = new Set(clusters.flatMap((cluster) => cluster.routeIds));
  let state: StrategicModeSelectionState;
  let reasons: StrategicModeSelectionReason[];
  let selected: CandidateContext[];

  if (evidenceRoutes.size === 0) {
    state = "insufficient-evidence";
    reasons = ["no-comparable-stable-evidence"];
    selected = [];
  } else if (supported.length >= 2) {
    state = "mixed-profile";
    reasons = ["multiple-supported-modes"];
    selected = supported;
  } else if (supported.length === 0) {
    state = "insufficient-evidence";
    reasons = ["no-supported-mode"];
    selected = [];
  } else if (cohort.effective_sample_size + EPSILON < STRATEGIC_MODE_MINIMUM_EFFECTIVE_SAMPLE_SIZE) {
    state = "insufficient-evidence";
    reasons = ["minimum-effective-sample-not-met"];
    selected = [];
  } else {
    state = "single-mode";
    reasons = ["single-supported-mode"];
    selected = supported;
  }

  const modes = selected.map(({ candidate }) => makeMode(cohort, candidate, "inferred-medoid", [], []));
  const assigned = new Set(selected.flatMap((item) => item.cluster.routeIds));
  const unassigned = cohort.route_ids.filter((routeId) => !assigned.has(routeId)).sort(compareStrings);
  const cohortState = state === "mixed-profile"
    ? "mixed-profile" as const
    : state === "insufficient-evidence"
      ? "insufficient-evidence" as const
      : "actionable" as const;
  return {
    cohort: {
      ...cohort,
      state: cohortState,
      modes,
      provenance: mergeProvenance([CORE_PROVENANCE], cohort.provenance),
    },
    selection: {
      cohort_id: cohort.cohort_id,
      state,
      selected_mode_ids: modes.map((mode) => mode.mode_id),
      candidates: candidates.map((item) => item.candidate),
      unassigned_route_ids: unassigned,
      effective_sample_size: cohort.effective_sample_size,
      reasons,
    },
  };
}

/** Detect deterministic inferred modes, with confirmed explicit targets taking precedence. */
export function detectStrategicModes(
  cohortReport: StrategicCohortReport,
  trajectoryReport: StrategicTrajectoryReport,
  weightReport: StrategicRouteWeightingReport,
  options: StrategicModeDetectionOptions = {},
): StrategicModeReport {
  requireCompatibleInputs(cohortReport, trajectoryReport, weightReport);
  const explicitByCohort = validateExplicitTargets(cohortReport, options.explicit_targets ?? []);
  const trajectoryByRoute = new Map(
    trajectoryReport.trajectories.map((trajectory) => [trajectory.route_id, trajectory]),
  );
  const unitIdByRoute = new Map(weightReport.routes.map((route) => [route.route_id, route.weighting_unit_id]));
  const cohortResults = cohortReport.cohorts.map((cohort) => {
    const routeWeightById = new Map(cohort.route_weights.map((route) => [route.route_id, route.normalized_weight]));
    const explicitTargets = explicitByCohort.get(cohort.cohort_id);
    return explicitTargets
      ? explicitSelection(cohort, explicitTargets, routeWeightById, unitIdByRoute)
      : inferredSelection(cohort, trajectoryByRoute, routeWeightById, unitIdByRoute);
  }).sort((left, right) => compareStrings(left.cohort.cohort_id, right.cohort.cohort_id));
  const explicitProvenance = (options.explicit_targets ?? []).flatMap((target) => target.provenance ?? []);
  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    mode_version: STRATEGIC_MODE_VERSION,
    graph_id: cohortReport.graph_id,
    taxonomy_version: cohortReport.taxonomy_version,
    weighting_version: cohortReport.weighting_version,
    cohort_version: cohortReport.cohort_version,
    containers: cohortReport.containers,
    cohorts: cohortResults.map((result) => result.cohort),
    data_quality: cohortReport.data_quality,
    applied_override_ids: cohortReport.applied_override_ids,
    selections: cohortResults.map((result) => result.selection),
    provenance: mergeProvenance(
      [CORE_PROVENANCE],
      cohortReport.provenance,
      trajectoryReport.provenance,
      weightReport.provenance,
      explicitProvenance,
    ),
  };
}
