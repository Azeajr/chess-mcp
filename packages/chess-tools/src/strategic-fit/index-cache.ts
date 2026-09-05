import type { Color } from "../congruence.js";
import type { OpeningEntry, OpeningTable } from "../openings.js";
import type { RepertoireGraph } from "./graph.js";
import type { PawnSignalReport } from "./pawn-signals.js";
import type { StrategicRoutePositionSignals } from "./position-signals.js";
import type { StrategicTrajectoryReport } from "./trajectory.js";
import type {
  StrategicCohort,
  StrategicFitAnalysisManifest,
  StrategicFitProgressPhase,
} from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_MANIFEST } from "./version.js";

export const STRATEGIC_FIT_DEFAULT_INDEX_ENTRIES = 512;

export const STRATEGIC_FIT_INDEX_NAMESPACES = [
  "graph",
  "position-signals",
  "route-signals",
  "trajectories",
] as const;
export type StrategicFitIndexNamespace = (typeof STRATEGIC_FIT_INDEX_NAMESPACES)[number];

export interface StrategicFitIndexSettings {
  readonly repertoire_color: Color | null;
  readonly trajectory: unknown;
  readonly opening_table: unknown;
}

export interface StrategicFitIndexSettingsInput {
  readonly repertoireColor: Color | null;
  readonly trajectory?: unknown;
  readonly openingTable?: OpeningTable | null;
}

export interface StrategicFitRecomputationScope {
  readonly kind: "affected-cohorts" | "full-scan";
  readonly cohort_ids: readonly string[];
  readonly reason: string;
}

export const STRATEGIC_FIT_UNSCOPED_RECOMPUTATION: StrategicFitRecomputationScope = Object.freeze({
  kind: "full-scan" as const,
  cohort_ids: Object.freeze([]),
  reason: "No affected-cohort scope was supplied, so every cohort is recomputed.",
});

export interface StrategicFitIndexedCohort {
  readonly cohort_id: string;
  readonly route_ids: readonly string[];
}

export interface StrategicFitIndexSnapshot {
  readonly generation: string;
  readonly graph_id: string;
  readonly route_ids: readonly string[];
  readonly cohorts: readonly StrategicFitIndexedCohort[];
}

export interface StrategicFitRecomputationPlan {
  readonly mode: "incremental" | "full-scan";
  readonly reason: string;
  readonly generation: string;
  readonly changed_route_ids: readonly string[];
  readonly reused_route_ids: readonly string[];
  readonly recomputed_cohort_ids: readonly string[];
  readonly reused_cohort_ids: readonly string[];
  readonly invalidated_entry_count: number;
}

export interface StrategicFitIndexStats {
  readonly generation: string | null;
  readonly size: number;
  readonly maximum_entries: number;
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
  readonly invalidations: number;
  readonly restorations: number;
}

export interface StrategicFitIndexRestoration {
  readonly generation: string;
  readonly graph_content_key: string;
  readonly graph: RepertoireGraph;
  readonly trajectories: StrategicTrajectoryReport | null;
}

export interface StrategicFitJobCheckpointStage extends StrategicFitIndexRestoration {
  readonly completed_phase: StrategicFitProgressPhase;
  readonly completed_phase_index: number;
}

export interface StrategicFitSignalIndex {
  pawnSignals(
    fen: string,
    repertoireColor: Color,
    compute: () => PawnSignalReport,
  ): PawnSignalReport;
  routePositionSignals(
    routeId: string,
    compute: () => StrategicRoutePositionSignals,
  ): StrategicRoutePositionSignals;
}

const ID_SEPARATOR = "";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values: Iterable<string>): string[] {
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

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (value instanceof Map) {
    return stableSerialize(
      [...value.entries()].sort(([left], [right]) => compareStrings(String(left), String(right))),
    );
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => typeof item !== "function")
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

export function strategicFitIndexSettings(
  options: StrategicFitIndexSettingsInput,
): StrategicFitIndexSettings {
  return {
    repertoire_color: options.repertoireColor,
    trajectory: options.trajectory ?? null,
    opening_table: [...(options.openingTable ?? new Map<string, OpeningEntry>()).entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([positionKey, entry]) => [positionKey, entry.eco, entry.name]),
  };
}

export function strategicFitIndexGeneration(
  settings: StrategicFitIndexSettings,
  manifest: StrategicFitAnalysisManifest = STRATEGIC_FIT_ANALYSIS_MANIFEST,
): string {
  return `strategic-fit-index:${stableHash(stableSerialize({ manifest, settings }))}`;
}

function pawnSignalKey(fen: string, repertoireColor: Color): string {
  return `${repertoireColor}${ID_SEPARATOR}${fen.split(" ")[0] ?? fen}`;
}

function graphKey(contentKey: string): string {
  return `graph${ID_SEPARATOR}${stableHash(contentKey)}`;
}

export class StrategicFitIndexCache {
  readonly maximumEntries: number;
  private readonly entries = new Map<string, unknown>();
  private generation: string | null = null;
  private snapshot: StrategicFitIndexSnapshot | null = null;
  private plan: StrategicFitRecomputationPlan | null = null;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private invalidations = 0;
  private restorations = 0;

  constructor(options: { readonly maximumEntries?: number } = {}) {
    const maximum = options.maximumEntries ?? STRATEGIC_FIT_DEFAULT_INDEX_ENTRIES;
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new Error("strategic_fit_invalid_index_cache_size");
    }
    this.maximumEntries = maximum;
  }

  get size(): number {
    return this.entries.size;
  }

  get stats(): StrategicFitIndexStats {
    return {
      generation: this.generation,
      size: this.entries.size,
      maximum_entries: this.maximumEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations,
      restorations: this.restorations,
    };
  }

  get lastPlan(): StrategicFitRecomputationPlan | null {
    return this.plan;
  }

  get lastSnapshot(): StrategicFitIndexSnapshot | null {
    return this.snapshot;
  }

  clear(): void {
    this.invalidations += this.entries.size;
    this.entries.clear();
    this.generation = null;
    this.snapshot = null;
    this.plan = null;
  }

  private useGeneration(generation: string): void {
    if (this.generation === generation) return;
    this.invalidations += this.entries.size;
    this.entries.clear();
    this.snapshot = null;
    this.plan = null;
    this.generation = generation;
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }

  value<T>(
    generation: string,
    namespace: StrategicFitIndexNamespace,
    key: string,
    compute: () => T,
  ): T {
    this.useGeneration(generation);
    const cacheKey = `${namespace}${ID_SEPARATOR}${key}`;
    if (this.entries.has(cacheKey)) {
      const existing = this.entries.get(cacheKey) as T;
      this.entries.delete(cacheKey);
      this.entries.set(cacheKey, existing);
      this.hits++;
      return existing;
    }
    this.misses++;
    const value = compute();
    this.entries.set(cacheKey, value);
    this.evictOverflow();
    return value;
  }

  invalidateRoutes(routeIds: readonly string[]): number {
    let dropped = 0;
    for (const routeId of new Set(routeIds)) {
      if (this.entries.delete(`route-signals${ID_SEPARATOR}${routeId}`)) dropped++;
    }
    this.invalidations += dropped;
    return dropped;
  }

  restoreStages(restoration: StrategicFitIndexRestoration): readonly StrategicFitIndexNamespace[] {
    this.useGeneration(restoration.generation);
    const restored: StrategicFitIndexNamespace[] = ["graph"];
    this.entries.set(graphKey(restoration.graph_content_key), restoration.graph);
    const { trajectories } = restoration;
    if (trajectories !== null && trajectories.graph_id === restoration.graph.graph_id) {
      this.entries.set(`trajectories${ID_SEPARATOR}${trajectories.graph_id}`, trajectories);
      restored.push("trajectories");
    }
    this.restorations += restored.length;
    this.evictOverflow();
    return restored;
  }

  signalIndex(generation: string): StrategicFitSignalIndex {
    return {
      pawnSignals: (fen, repertoireColor, compute) =>
        this.value(generation, "position-signals", pawnSignalKey(fen, repertoireColor), compute),
      routePositionSignals: (routeId, compute) =>
        this.value(generation, "route-signals", routeId, compute),
    };
  }

  rememberAnalysis(
    generation: string,
    graph: RepertoireGraph,
    cohorts: readonly StrategicCohort[],
  ): void {
    this.useGeneration(generation);
    this.snapshot = {
      generation,
      graph_id: graph.graph_id,
      route_ids: sortedUnique(graph.routes.map((route) => route.route_id)),
      cohorts: cohorts
        .map(
          (cohort): StrategicFitIndexedCohort => ({
            cohort_id: cohort.cohort_id,
            route_ids: sortedUnique(cohort.route_ids),
          }),
        )
        .sort((left, right) => compareStrings(left.cohort_id, right.cohort_id)),
    };
  }

  private recordPlan(plan: StrategicFitRecomputationPlan): StrategicFitRecomputationPlan {
    this.plan = plan;
    return plan;
  }

  planRecomputation(
    generation: string,
    currentRouteIds: readonly string[],
    scope: StrategicFitRecomputationScope = STRATEGIC_FIT_UNSCOPED_RECOMPUTATION,
  ): StrategicFitRecomputationPlan {
    this.useGeneration(generation);
    const current = sortedUnique(currentRouteIds);
    const previous = this.snapshot;
    if (previous === null) {
      return this.recordPlan({
        mode: "full-scan",
        reason:
          "No prior index snapshot exists for this generation, so every cohort is recomputed.",
        generation,
        changed_route_ids: current,
        reused_route_ids: [],
        recomputed_cohort_ids: [],
        reused_cohort_ids: [],
        invalidated_entry_count: 0,
      });
    }

    const previousRoutes = new Set(previous.route_ids);
    const currentRoutes = new Set(current);
    const changed = sortedUnique([
      ...current.filter((routeId) => !previousRoutes.has(routeId)),
      ...previous.route_ids.filter((routeId) => !currentRoutes.has(routeId)),
    ]);
    const reusedRoutes = current.filter((routeId) => previousRoutes.has(routeId));
    const invalidated = this.invalidateRoutes(changed);
    const previousCohortIds = previous.cohorts.map((cohort) => cohort.cohort_id);

    if (scope.kind === "full-scan") {
      return this.recordPlan({
        mode: "full-scan",
        reason: scope.reason,
        generation,
        changed_route_ids: changed,
        reused_route_ids: reusedRoutes,
        recomputed_cohort_ids: sortedUnique(previousCohortIds),
        reused_cohort_ids: [],
        invalidated_entry_count: invalidated,
      });
    }

    const changedRoutes = new Set(changed);
    const scoped = new Set(scope.cohort_ids);
    const recomputed: string[] = [];
    const reusedCohorts: string[] = [];
    for (const cohort of previous.cohorts) {
      const affected =
        scoped.has(cohort.cohort_id) ||
        cohort.route_ids.some((routeId) => changedRoutes.has(routeId));
      (affected ? recomputed : reusedCohorts).push(cohort.cohort_id);
    }
    return this.recordPlan({
      mode: "incremental",
      reason: scope.reason,
      generation,
      changed_route_ids: changed,
      reused_route_ids: reusedRoutes,
      recomputed_cohort_ids: sortedUnique(recomputed),
      reused_cohort_ids: sortedUnique(reusedCohorts),
      invalidated_entry_count: invalidated,
    });
  }
}

export function indexedRepertoireGraph(
  index: StrategicFitIndexCache | undefined,
  generation: string | null,
  contentKey: string,
  build: () => RepertoireGraph,
): RepertoireGraph {
  if (index === undefined || generation === null) return build();
  return index.value(generation, "graph", stableHash(contentKey), build);
}

export function indexedStrategicTrajectories(
  index: StrategicFitIndexCache | undefined,
  generation: string | null,
  graph: RepertoireGraph,
  build: () => StrategicTrajectoryReport,
): StrategicTrajectoryReport {
  if (index === undefined || generation === null) return build();
  return index.value(generation, "trajectories", graph.graph_id, build);
}
