/**
 * Deterministic hierarchical cohort formation for Strategic Fit.
 *
 * Opening families remain descriptive containers. Actionable comparison neighborhoods require
 * narrower taxonomy (or additional shared strategic/player-decision evidence), while canonical
 * transpositions are always kept together. User overrides operate on semantic route/decision
 * identities and never remove excluded routes from data-quality accounting.
 */
import type {
  RepertoireGraph,
  RepertoireGraphDecision,
  RepertoireGraphRoute,
} from "./graph.js";
import type {
  OpeningTaxonomy,
  RepertoireOpeningTaxonomy,
} from "./taxonomy.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import type {
  StrategicCheckpointKind,
  StrategicCohort,
  StrategicFitSourceProvenance,
  StrategicSignalFamily,
  StrategicTrajectory,
  WeightedRouteReference,
} from "./types.js";
import {
  calculateEffectiveSampleSize,
  type StrategicNormalizedRouteWeight,
  type StrategicRouteWeightingReport,
} from "./weights.js";
import {
  STRATEGIC_FIT_ANALYSIS_MANIFEST,
  STRATEGIC_FIT_ANALYSIS_VERSION,
  STRATEGIC_FIT_SCHEMA_VERSION,
} from "./version.js";

export const STRATEGIC_COHORT_VERSION = STRATEGIC_FIT_ANALYSIS_MANIFEST.components.cohorts;

export const STRATEGIC_COHORT_OVERRIDE_KINDS = ["merge", "split", "exclude"] as const;
export type StrategicCohortOverrideKind = (typeof STRATEGIC_COHORT_OVERRIDE_KINDS)[number];

interface StrategicCohortOverrideBase {
  readonly override_id: string;
  readonly kind: StrategicCohortOverrideKind;
  readonly provenance?: readonly StrategicFitSourceProvenance[];
}

export interface StrategicCohortMergeOverride extends StrategicCohortOverrideBase {
  readonly kind: "merge";
  /** Exact semantic routes to extract from their inferred cohorts and merge. */
  readonly route_ids: readonly string[];
}

export interface StrategicCohortSplitOverride extends StrategicCohortOverrideBase {
  readonly kind: "split";
  /** Exact semantic routes to extract as one separate cohort. */
  readonly route_ids: readonly string[];
}

export interface StrategicCohortExclusionOverride extends StrategicCohortOverrideBase {
  readonly kind: "exclude";
  /** Exact routes and/or every route below a semantic decision may be excluded. */
  readonly route_ids?: readonly string[];
  readonly decision_ids?: readonly string[];
}

export type StrategicCohortOverride =
  | StrategicCohortMergeOverride
  | StrategicCohortSplitOverride
  | StrategicCohortExclusionOverride;

export interface StrategicCohortFormationOptions {
  readonly overrides?: readonly StrategicCohortOverride[];
}

export const STRATEGIC_COHORT_INSUFFICIENCY_REASONS = [
  "fewer-than-two-independent-routes",
  "no-comparable-trajectory-evidence",
  "no-actionable-player-decision-scope",
] as const;
export type StrategicCohortInsufficiencyReason =
  (typeof STRATEGIC_COHORT_INSUFFICIENCY_REASONS)[number];

export interface StrategicOpeningContainer {
  readonly container_id: string;
  readonly taxonomy_id: string | null;
  readonly taxonomy_level: "family" | "unknown";
  /** Display-only label. IDs remain stable and language-neutral. */
  readonly label: string | null;
  readonly route_ids: readonly string[];
  readonly included_route_ids: readonly string[];
  readonly excluded_route_ids: readonly string[];
  readonly cohort_ids: readonly string[];
}

export interface StrategicComparableCohort extends StrategicCohort {
  readonly opening_container_ids: readonly string[];
  readonly shared_strategic_ancestor_position_ids: readonly string[];
  readonly transposition_position_ids: readonly string[];
  readonly comparable_checkpoint_kinds: readonly StrategicCheckpointKind[];
  readonly common_stable_signal_families: readonly StrategicSignalFamily[];
  readonly insufficiency_reasons: readonly StrategicCohortInsufficiencyReason[];
}

export interface StrategicCohortDataQualityCounts {
  readonly total_route_count: number;
  readonly included_route_count: number;
  readonly excluded_route_count: number;
  readonly complete_trajectory_route_count: number;
  readonly incomplete_trajectory_route_count: number;
  readonly insufficient_evidence_route_count: number;
}

export interface StrategicCohortReport {
  readonly schema_version: string;
  readonly analysis_version: string;
  readonly cohort_version: string;
  readonly graph_id: string;
  readonly taxonomy_version: string;
  readonly weighting_version: string;
  readonly containers: readonly StrategicOpeningContainer[];
  readonly cohorts: readonly StrategicComparableCohort[];
  readonly data_quality: StrategicCohortDataQualityCounts;
  readonly applied_override_ids: readonly string[];
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface RouteContext {
  readonly route: RepertoireGraphRoute;
  readonly taxonomy: OpeningTaxonomy;
  readonly trajectory: StrategicTrajectory;
  readonly weight: StrategicNormalizedRouteWeight;
  readonly repertoireDecisionIds: ReadonlySet<string>;
  readonly positionIds: ReadonlySet<string>;
  readonly comparableCheckpointKinds: ReadonlySet<StrategicCheckpointKind>;
  readonly stableSignalFamilies: ReadonlySet<StrategicSignalFamily>;
  readonly actionableDecisionId: string | null;
}

interface MutableRouteGroup {
  readonly routeIds: Set<string>;
  readonly overrideIds: Set<string>;
}

const ID_SEPARATOR = "\u001f";
const MIN_INDEPENDENT_ROUTES = 2;

const CORE_PROVENANCE: StrategicFitSourceProvenance = Object.freeze({
  source_id: "strategic-fit:cohorts",
  kind: "deterministic-core",
  state: "available",
  version: STRATEGIC_COHORT_VERSION,
  snapshot: null,
  reason: null,
});

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

function semanticId(kind: string, parts: readonly string[]): string {
  return `${kind}:${stableHash(parts.join(ID_SEPARATOR))}`;
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
  graph: RepertoireGraph,
  taxonomy: RepertoireOpeningTaxonomy,
  trajectories: StrategicTrajectoryReport,
  weights: StrategicRouteWeightingReport,
): void {
  if (
    graph.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    taxonomy.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    trajectories.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION ||
    weights.analysis_version !== STRATEGIC_FIT_ANALYSIS_VERSION
  ) {
    throw new Error("strategic_fit_cohorts_version_mismatch");
  }
  for (const input of [taxonomy, trajectories, weights]) {
    if (input.graph_id !== graph.graph_id) {
      throw new Error(`strategic_fit_cohorts_graph_mismatch: ${input.graph_id}`);
    }
  }
  const routeIds = graph.routes.map((route) => route.route_id);
  if (!sameIds(taxonomy.routes.map((route) => route.route_id), routeIds)) {
    throw new Error("strategic_fit_cohorts_taxonomy_route_mismatch");
  }
  if (!sameIds(trajectories.trajectories.map((route) => route.route_id), routeIds)) {
    throw new Error("strategic_fit_cohorts_trajectory_route_mismatch");
  }
  if (!sameIds(weights.routes.map((route) => route.route_id), routeIds)) {
    throw new Error("strategic_fit_cohorts_weight_route_mismatch");
  }
}

function repertoireDecisionIds(
  route: RepertoireGraphRoute,
  decisions: ReadonlyMap<string, RepertoireGraphDecision>,
): Set<string> {
  return new Set(route.decision_ids.filter((decisionId) => decisions.get(decisionId)?.owner === "repertoire"));
}

function actionableDecisionId(
  route: RepertoireGraphRoute,
  trajectory: StrategicTrajectory,
  decisions: ReadonlyMap<string, RepertoireGraphDecision>,
): string | null {
  const firstEvidencePly = trajectory.snapshots
    .filter((snapshot) => snapshot.checkpoint.comparability === "comparable")
    .map((snapshot) => snapshot.checkpoint.ply)
    .sort((left, right) => left - right)[0] ?? route.decision_ids.length;
  for (let index = Math.min(firstEvidencePly, route.decision_ids.length) - 1; index >= 0; index--) {
    const decisionId = route.decision_ids[index]!;
    if (decisions.get(decisionId)?.owner === "repertoire") return decisionId;
  }
  return null;
}

function routeContexts(
  graph: RepertoireGraph,
  taxonomy: RepertoireOpeningTaxonomy,
  trajectories: StrategicTrajectoryReport,
  weights: StrategicRouteWeightingReport,
): RouteContext[] {
  const taxonomyByRoute = new Map(taxonomy.routes.map((route) => [route.route_id, route.taxonomy]));
  const trajectoryByRoute = new Map(trajectories.trajectories.map((route) => [route.route_id, route]));
  const weightByRoute = new Map(weights.routes.map((route) => [route.route_id, route]));
  const decisions = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));

  return graph.routes.map((route): RouteContext => {
    const routeTaxonomy = taxonomyByRoute.get(route.route_id)!;
    const trajectory = trajectoryByRoute.get(route.route_id)!;
    const weight = weightByRoute.get(route.route_id)!;
    const comparableSnapshots = trajectory.snapshots.filter(
      (snapshot) => snapshot.checkpoint.comparability === "comparable",
    );
    return {
      route,
      taxonomy: routeTaxonomy,
      trajectory,
      weight,
      repertoireDecisionIds: repertoireDecisionIds(route, decisions),
      positionIds: new Set(route.position_ids),
      comparableCheckpointKinds: new Set(comparableSnapshots.map((snapshot) => snapshot.checkpoint.kind)),
      stableSignalFamilies: new Set(comparableSnapshots.flatMap((snapshot) =>
        snapshot.signals
          .filter((signal) => signal.persistence === "stable" || signal.persistence === "irreversible")
          .map((signal) => signal.family)
      )),
      actionableDecisionId: actionableDecisionId(route, trajectory, decisions),
    };
  }).sort((left, right) => compareStrings(left.route.route_id, right.route.route_id));
}

function intersection<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): T[] {
  return [...left].filter((value) => right.has(value));
}

function transpositionPositions(
  graph: RepertoireGraph,
  routeIds: ReadonlySet<string>,
): string[] {
  return graph.transposition_links
    .filter((link) => link.route_ids.filter((routeId) => routeIds.has(routeId)).length >= 2)
    .map((link) => link.position_id)
    .sort(compareStrings);
}

function routesTranspose(graph: RepertoireGraph, leftId: string, rightId: string): boolean {
  return graph.transposition_links.some((link) =>
    link.route_ids.includes(leftId) && link.route_ids.includes(rightId)
  );
}

function sameNarrowOpeningScope(left: RouteContext, right: RouteContext): boolean {
  const leftSystem = left.taxonomy.system?.taxonomy_id ?? null;
  const rightSystem = right.taxonomy.system?.taxonomy_id ?? null;
  if (leftSystem !== null || rightSystem !== null) return leftSystem !== null && leftSystem === rightSystem;

  const leftFamily = left.taxonomy.family?.taxonomy_id ?? null;
  const rightFamily = right.taxonomy.family?.taxonomy_id ?? null;
  if (leftFamily === null || leftFamily !== rightFamily) return false;

  // A family-only label becomes comparable only with additional shared strategic and player
  // context. This keeps broad labels such as "Sicilian Defense" descriptive by default.
  const sharedRepertoireDecisions = intersection(left.repertoireDecisionIds, right.repertoireDecisionIds);
  const sharedNonRootPositions = intersection(left.positionIds, right.positionIds).filter(
    (positionId) => positionId !== left.route.position_ids[0],
  );
  return sharedRepertoireDecisions.length >= 2 && sharedNonRootPositions.length >= 3;
}

function trajectoriesShareNeighborhood(left: RouteContext, right: RouteContext): boolean {
  if (left.comparableCheckpointKinds.size === 0 || right.comparableCheckpointKinds.size === 0) {
    // Keep incomplete evidence beside its inferred opening cohort so it is counted and labeled,
    // rather than manufacturing a one-route comparison that appears conclusive.
    return true;
  }
  if (intersection(left.comparableCheckpointKinds, right.comparableCheckpointKinds).length === 0) {
    return false;
  }
  if (left.stableSignalFamilies.size === 0 || right.stableSignalFamilies.size === 0) return true;
  return intersection(left.stableSignalFamilies, right.stableSignalFamilies).length > 0;
}

function comparablePair(graph: RepertoireGraph, left: RouteContext, right: RouteContext): boolean {
  if (routesTranspose(graph, left.route.route_id, right.route.route_id)) return true;
  if (!sameNarrowOpeningScope(left, right)) return false;
  const sharedAncestor = intersection(left.positionIds, right.positionIds).some(
    (positionId) => positionId !== graph.root_position_id,
  );
  const sharedPlayerScope = intersection(left.repertoireDecisionIds, right.repertoireDecisionIds).length > 0;
  return sharedAncestor && sharedPlayerScope && trajectoriesShareNeighborhood(left, right);
}

function inferredRouteGroups(graph: RepertoireGraph, contexts: readonly RouteContext[]): MutableRouteGroup[] {
  const parent = contexts.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== index) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot);
  };

  for (let left = 0; left < contexts.length; left++) {
    for (let right = left + 1; right < contexts.length; right++) {
      if (comparablePair(graph, contexts[left]!, contexts[right]!)) union(left, right);
    }
  }

  const groups = new Map<number, Set<string>>();
  for (const [index, context] of contexts.entries()) {
    const root = find(index);
    const routes = groups.get(root) ?? new Set<string>();
    routes.add(context.route.route_id);
    groups.set(root, routes);
  }
  return [...groups.values()]
    .map((routeIds) => ({ routeIds, overrideIds: new Set<string>() }))
    .sort((left, right) => compareStrings([...left.routeIds].sort()[0]!, [...right.routeIds].sort()[0]!));
}

function validateOverrides(
  graph: RepertoireGraph,
  overrides: readonly StrategicCohortOverride[],
): void {
  const routeIds = new Set(graph.routes.map((route) => route.route_id));
  const decisionIds = new Set(graph.decisions.map((decision) => decision.decision_id));
  const overrideIds = new Set<string>();
  const structurallyAssignedRoutes = new Set<string>();
  for (const override of overrides) {
    if (!override.override_id || overrideIds.has(override.override_id)) {
      throw new Error(`strategic_fit_cohorts_duplicate_override: ${override.override_id}`);
    }
    overrideIds.add(override.override_id);
    const selectedRoutes = override.route_ids ?? [];
    if (override.kind !== "exclude" && selectedRoutes.length === 0) {
      throw new Error(`strategic_fit_cohorts_empty_${override.kind}: ${override.override_id}`);
    }
    for (const routeId of selectedRoutes) {
      if (!routeIds.has(routeId)) throw new Error(`strategic_fit_cohorts_unknown_route: ${routeId}`);
      if (override.kind !== "exclude") {
        if (structurallyAssignedRoutes.has(routeId)) {
          throw new Error(`strategic_fit_cohorts_conflicting_override_route: ${routeId}`);
        }
        structurallyAssignedRoutes.add(routeId);
      }
    }
    if (override.kind === "exclude") {
      const selectedDecisions = override.decision_ids ?? [];
      if (selectedRoutes.length === 0 && selectedDecisions.length === 0) {
        throw new Error(`strategic_fit_cohorts_empty_exclude: ${override.override_id}`);
      }
      for (const decisionId of selectedDecisions) {
        if (!decisionIds.has(decisionId)) {
          throw new Error(`strategic_fit_cohorts_unknown_decision: ${decisionId}`);
        }
      }
    }
  }
}

function extractRoutes(group: MutableRouteGroup, selected: ReadonlySet<string>): Set<string> {
  const extracted = new Set<string>();
  for (const routeId of [...group.routeIds]) {
    if (!selected.has(routeId)) continue;
    group.routeIds.delete(routeId);
    extracted.add(routeId);
  }
  return extracted;
}

function applyStructuralOverrides(
  inferred: readonly MutableRouteGroup[],
  overrides: readonly StrategicCohortOverride[],
): MutableRouteGroup[] {
  let groups = inferred.map((group) => ({
    routeIds: new Set(group.routeIds),
    overrideIds: new Set(group.overrideIds),
  }));

  for (const override of overrides.filter((value) => value.kind === "split").sort(
    (left, right) => compareStrings(left.override_id, right.override_id),
  )) {
    const selected = new Set(override.route_ids);
    const touched = groups.filter((group) => [...selected].some((routeId) => group.routeIds.has(routeId)));
    if (touched.length !== 1 || selected.size >= touched[0]!.routeIds.size) {
      throw new Error(`strategic_fit_cohorts_invalid_split: ${override.override_id}`);
    }
    const source = touched[0]!;
    const extracted = extractRoutes(source, selected);
    source.overrideIds.add(override.override_id);
    groups.push({ routeIds: extracted, overrideIds: new Set([override.override_id]) });
  }

  for (const override of overrides.filter((value) => value.kind === "merge").sort(
    (left, right) => compareStrings(left.override_id, right.override_id),
  )) {
    const selected = new Set(override.route_ids);
    const touched = groups.filter((group) => [...selected].some((routeId) => group.routeIds.has(routeId)));
    if (touched.length < 2) throw new Error(`strategic_fit_cohorts_invalid_merge: ${override.override_id}`);
    const extracted = new Set<string>();
    const inheritedOverrideIds = new Set<string>([override.override_id]);
    for (const group of touched) {
      for (const routeId of extractRoutes(group, selected)) extracted.add(routeId);
      for (const overrideId of group.overrideIds) inheritedOverrideIds.add(overrideId);
      group.overrideIds.add(override.override_id);
    }
    groups.push({ routeIds: extracted, overrideIds: inheritedOverrideIds });
  }

  return groups
    .filter((group) => group.routeIds.size > 0)
    .sort((left, right) => compareStrings([...left.routeIds].sort()[0]!, [...right.routeIds].sort()[0]!));
}

function exclusionState(
  graph: RepertoireGraph,
  groups: readonly MutableRouteGroup[],
  overrides: readonly StrategicCohortOverride[],
): Set<string> {
  const excludedRouteIds = new Set<string>();
  for (const override of overrides.filter((value) => value.kind === "exclude")) {
    const selected = new Set(override.route_ids ?? []);
    for (const route of graph.routes) {
      if ((override.decision_ids ?? []).some((decisionId) => route.decision_ids.includes(decisionId))) {
        selected.add(route.route_id);
      }
    }
    for (const routeId of selected) {
      excludedRouteIds.add(routeId);
      const group = groups.find((candidate) => candidate.routeIds.has(routeId));
      group?.overrideIds.add(override.override_id);
    }
  }
  return excludedRouteIds;
}

function commonValues<T>(sets: readonly ReadonlySet<T>[]): T[] {
  if (sets.length === 0) return [];
  return [...sets[0]!].filter((value) => sets.slice(1).every((set) => set.has(value)));
}

function commonOpeningScope(contexts: readonly RouteContext[]): string[] {
  return commonValues(contexts.map((context) => new Set(context.taxonomy.path.map((node) => node.taxonomy_id))))
    .sort(compareStrings);
}

function normalizedCohortWeights(contexts: readonly RouteContext[]): {
  routeWeights: WeightedRouteReference[];
  effectiveSampleSize: number;
  independentRouteCount: number;
} {
  if (contexts.length === 0) return { routeWeights: [], effectiveSampleSize: 0, independentRouteCount: 0 };
  const total = contexts.reduce((sum, context) => sum + context.weight.normalized_weight, 0);
  const denominator = total > 0 ? total : contexts.length;
  const routeWeights = contexts.map((context) => ({
    route_id: context.route.route_id,
    normalized_weight: (total > 0 ? context.weight.normalized_weight : 1) / denominator,
  })).sort((left, right) => compareStrings(left.route_id, right.route_id));
  const routeWeightById = new Map(routeWeights.map((weight) => [weight.route_id, weight.normalized_weight]));
  const unitWeights = new Map<string, number>();
  for (const context of contexts) {
    unitWeights.set(
      context.weight.weighting_unit_id,
      (unitWeights.get(context.weight.weighting_unit_id) ?? 0) + routeWeightById.get(context.route.route_id)!,
    );
  }
  return {
    routeWeights,
    effectiveSampleSize: calculateEffectiveSampleSize([...unitWeights.values()]),
    independentRouteCount: unitWeights.size,
  };
}

function cohortProvenance(
  contexts: readonly RouteContext[],
  weights: StrategicRouteWeightingReport,
  overrides: readonly StrategicCohortOverride[],
  overrideIds: ReadonlySet<string>,
): StrategicFitSourceProvenance[] {
  const overrideById = new Map(overrides.map((override) => [override.override_id, override]));
  return mergeProvenance(
    [CORE_PROVENANCE],
    weights.provenance,
    ...contexts.map((context) => context.trajectory.provenance),
    ...[...overrideIds].map((overrideId) => overrideById.get(overrideId)?.provenance ?? []),
  );
}

function makeCohort(
  graph: RepertoireGraph,
  group: MutableRouteGroup,
  contextByRoute: ReadonlyMap<string, RouteContext>,
  excludedRouteIds: ReadonlySet<string>,
  containerIdByRoute: ReadonlyMap<string, string>,
  weights: StrategicRouteWeightingReport,
  overrides: readonly StrategicCohortOverride[],
): StrategicComparableCohort {
  const allContexts = [...group.routeIds].map((routeId) => contextByRoute.get(routeId)!).sort(
    (left, right) => compareStrings(left.route.route_id, right.route.route_id),
  );
  const includedContexts = allContexts.filter((context) => !excludedRouteIds.has(context.route.route_id));
  const baselineContexts = includedContexts.length > 0 ? includedContexts : allContexts;
  const routeIds = includedContexts.map((context) => context.route.route_id);
  const excludedIds = allContexts
    .filter((context) => excludedRouteIds.has(context.route.route_id))
    .map((context) => context.route.route_id);
  const cohortWeights = normalizedCohortWeights(includedContexts);
  const sharedAncestors = commonValues(baselineContexts.map((context) => context.positionIds))
    .filter((positionId) => positionId !== graph.root_position_id)
    .sort(compareStrings);
  const allRouteIds = new Set(allContexts.map((context) => context.route.route_id));
  const transpositions = transpositionPositions(graph, allRouteIds);
  const decisionScopeIds = sortedUnique(
    baselineContexts.flatMap((context) => context.actionableDecisionId ? [context.actionableDecisionId] : []),
  );
  const comparableEvidenceContexts = includedContexts.filter((context) =>
    context.comparableCheckpointKinds.size > 0 && context.stableSignalFamilies.size > 0
  );
  const commonCheckpointKinds = commonValues(
    comparableEvidenceContexts.map((context) => context.comparableCheckpointKinds),
  ).sort(compareStrings);
  const commonStableSignalFamilies = commonValues(
    comparableEvidenceContexts.map((context) => context.stableSignalFamilies),
  ).sort(compareStrings);
  const insufficiencyReasons: StrategicCohortInsufficiencyReason[] = [];
  if (cohortWeights.independentRouteCount < MIN_INDEPENDENT_ROUTES) {
    insufficiencyReasons.push("fewer-than-two-independent-routes");
  }
  if (
    includedContexts.length > 0 &&
    (
      comparableEvidenceContexts.length < 2 ||
      commonCheckpointKinds.length === 0 ||
      commonStableSignalFamilies.length === 0
    )
  ) {
    insufficiencyReasons.push("no-comparable-trajectory-evidence");
  }
  if (decisionScopeIds.length === 0 && includedContexts.length > 0) {
    insufficiencyReasons.push("no-actionable-player-decision-scope");
  }
  const state = includedContexts.length === 0
    ? "excluded" as const
    : insufficiencyReasons.length > 0
      ? "insufficient-evidence" as const
      : "actionable" as const;
  const openingScopeIds = commonOpeningScope(baselineContexts);
  const containerIds = sortedUnique(allContexts.map((context) => containerIdByRoute.get(context.route.route_id)!));
  const cohortId = semanticId("cohort", [
    STRATEGIC_COHORT_VERSION,
    ...allContexts.map((context) => context.route.route_id),
    ...openingScopeIds,
    ...decisionScopeIds,
  ]);
  return {
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_id: cohortId,
    state,
    opening_scope_ids: openingScopeIds,
    decision_scope_ids: decisionScopeIds,
    route_ids: routeIds,
    excluded_route_ids: excludedIds,
    route_weights: cohortWeights.routeWeights,
    effective_sample_size: cohortWeights.effectiveSampleSize,
    modes: [],
    override_ids: [...group.overrideIds].sort(compareStrings),
    provenance: cohortProvenance(allContexts, weights, overrides, group.overrideIds),
    opening_container_ids: containerIds,
    shared_strategic_ancestor_position_ids: sharedAncestors,
    transposition_position_ids: transpositions,
    comparable_checkpoint_kinds: commonCheckpointKinds,
    common_stable_signal_families: commonStableSignalFamilies,
    insufficiency_reasons: insufficiencyReasons,
  };
}

function containerIdentity(taxonomy: OpeningTaxonomy): {
  id: string;
  taxonomyId: string | null;
  level: "family" | "unknown";
  label: string | null;
} {
  if (taxonomy.family) {
    return {
      id: `opening-container:${taxonomy.family.taxonomy_id}`,
      taxonomyId: taxonomy.family.taxonomy_id,
      level: "family",
      label: taxonomy.family.label,
    };
  }
  return { id: "opening-container:unknown", taxonomyId: null, level: "unknown", label: null };
}

function makeContainers(
  contexts: readonly RouteContext[],
  cohorts: readonly StrategicComparableCohort[],
  excludedRouteIds: ReadonlySet<string>,
): { containers: StrategicOpeningContainer[]; containerIdByRoute: Map<string, string> } {
  const identities = new Map<string, ReturnType<typeof containerIdentity>>();
  const routeIdsByContainer = new Map<string, string[]>();
  const containerIdByRoute = new Map<string, string>();
  for (const context of contexts) {
    const identity = containerIdentity(context.taxonomy);
    identities.set(identity.id, identity);
    containerIdByRoute.set(context.route.route_id, identity.id);
    const routeIds = routeIdsByContainer.get(identity.id) ?? [];
    routeIds.push(context.route.route_id);
    routeIdsByContainer.set(identity.id, routeIds);
  }
  const containers = [...identities.values()].map((identity): StrategicOpeningContainer => {
    const routeIds = (routeIdsByContainer.get(identity.id) ?? []).sort(compareStrings);
    return {
      container_id: identity.id,
      taxonomy_id: identity.taxonomyId,
      taxonomy_level: identity.level,
      label: identity.label,
      route_ids: routeIds,
      included_route_ids: routeIds.filter((routeId) => !excludedRouteIds.has(routeId)),
      excluded_route_ids: routeIds.filter((routeId) => excludedRouteIds.has(routeId)),
      cohort_ids: cohorts
        .filter((cohort) => cohort.opening_container_ids.includes(identity.id))
        .map((cohort) => cohort.cohort_id)
        .sort(compareStrings),
    };
  }).sort((left, right) => compareStrings(left.container_id, right.container_id));
  return { containers, containerIdByRoute };
}

function taxonomyProvenance(taxonomy: RepertoireOpeningTaxonomy): StrategicFitSourceProvenance {
  const unknownCount = taxonomy.routes.filter((route) => route.taxonomy.state === "unknown").length;
  return {
    source_id: "strategic-fit:opening-taxonomy",
    kind: "opening-taxonomy",
    state: unknownCount === 0 ? "available" : unknownCount === taxonomy.routes.length ? "unavailable" : "partial",
    version: taxonomy.taxonomy_version,
    snapshot: null,
    reason: unknownCount === 0 ? null : `${unknownCount} route(s) lack deterministic opening taxonomy.`,
  };
}

/** Form descriptive opening containers and narrower deterministic comparison cohorts. */
export function formStrategicCohorts(
  graph: RepertoireGraph,
  taxonomy: RepertoireOpeningTaxonomy,
  trajectories: StrategicTrajectoryReport,
  weights: StrategicRouteWeightingReport,
  options: StrategicCohortFormationOptions = {},
): StrategicCohortReport {
  requireCompatibleInputs(graph, taxonomy, trajectories, weights);
  const overrides = [...(options.overrides ?? [])];
  validateOverrides(graph, overrides);
  const contexts = routeContexts(graph, taxonomy, trajectories, weights);
  const contextByRoute = new Map(contexts.map((context) => [context.route.route_id, context]));
  const groups = applyStructuralOverrides(inferredRouteGroups(graph, contexts), overrides);
  const excludedRouteIds = exclusionState(graph, groups, overrides);

  // Build container identities before cohorts, then fill their cohort references afterward.
  const emptyContainers = makeContainers(contexts, [], excludedRouteIds);
  const cohorts = groups.map((group) => makeCohort(
    graph,
    group,
    contextByRoute,
    excludedRouteIds,
    emptyContainers.containerIdByRoute,
    weights,
    overrides,
  )).sort((left, right) => compareStrings(left.cohort_id, right.cohort_id));
  const { containers } = makeContainers(contexts, cohorts, excludedRouteIds);
  const insufficientEvidenceRouteCount = contexts.filter((context) =>
    context.comparableCheckpointKinds.size === 0 || context.stableSignalFamilies.size === 0
  ).length;
  const overrideProvenance = overrides.flatMap((override) => override.provenance ?? []);

  return {
    schema_version: STRATEGIC_FIT_SCHEMA_VERSION,
    analysis_version: STRATEGIC_FIT_ANALYSIS_VERSION,
    cohort_version: STRATEGIC_COHORT_VERSION,
    graph_id: graph.graph_id,
    taxonomy_version: taxonomy.taxonomy_version,
    weighting_version: weights.weighting_version,
    containers,
    cohorts,
    data_quality: {
      total_route_count: contexts.length,
      included_route_count: contexts.length - excludedRouteIds.size,
      excluded_route_count: excludedRouteIds.size,
      complete_trajectory_route_count: contexts.filter((context) => context.trajectory.state === "complete").length,
      incomplete_trajectory_route_count: contexts.filter((context) => context.trajectory.state !== "complete").length,
      insufficient_evidence_route_count: insufficientEvidenceRouteCount,
    },
    applied_override_ids: overrides.map((override) => override.override_id).sort(compareStrings),
    provenance: mergeProvenance(
      [CORE_PROVENANCE, taxonomyProvenance(taxonomy)],
      trajectories.provenance,
      weights.provenance,
      overrideProvenance,
    ),
  };
}
