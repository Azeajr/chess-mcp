/**
 * Bounded incremental analysis index for Strategic Fit.
 *
 * The index memoizes the deterministic stages that dominate a large scan: the canonical
 * transposition-aware graph, per-canonical-position pawn signals, per-route position signals, and
 * the trajectory report. One generation identity covers the complete analysis manifest and the
 * analysis settings those stages read, so a classifier, taxonomy, or settings change retires every
 * entry it could have produced instead of a hand-picked subset of them.
 *
 * The correctness invariant is deliberately narrow. A recomputation plan decides how much work is
 * attempted and which entries are dropped; it never decides which value is returned. Every reused
 * value is fetched by a content identity that fully determines it, so an incremental run and a full
 * scan are byte-identical even when a supplied scope is absent, stale, or wrong. Affected-cohort
 * scope therefore arrives from the host's existing semantic comparison (Task 6.4); this module
 * consumes that scope and never re-derives a second diffing rule.
 */
import type { Color } from "../congruence.js";
import type { OpeningTable } from "../openings.js";
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

/** Analysis settings the indexed stages actually read; every field participates in the generation. */
export interface StrategicFitIndexSettings {
  readonly repertoire_color: Color | null;
  readonly trajectory: unknown;
  readonly opening_table: unknown;
}

/** The analyzer options the indexed stages read; hosts derive the generation from the same view. */
export interface StrategicFitIndexSettingsInput {
  readonly repertoireColor: Color | null;
  readonly trajectory?: unknown;
  readonly openingTable?: OpeningTable | null;
}

/**
 * Structurally identical to the host reanalysis scope produced by Task 6.4. An affected-cohort
 * scope limits claimed reuse; a full scan claims none.
 */
export interface StrategicFitRecomputationScope {
  readonly kind: "affected-cohorts" | "full-scan";
  readonly cohort_ids: readonly string[];
  readonly reason: string;
}

export const STRATEGIC_FIT_UNSCOPED_RECOMPUTATION: StrategicFitRecomputationScope = Object.freeze({
  kind: "full-scan" as const,
  cohort_ids: Object.freeze([]) as readonly string[],
  reason: "No affected-cohort scope was supplied, so every cohort is recomputed.",
});

export interface StrategicFitIndexedCohort {
  readonly cohort_id: string;
  readonly route_ids: readonly string[];
}

/** What the previous completed analysis established for this generation. */
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

/**
 * Whole-stage values an interrupted job already produced. They are restored by the same content
 * identity a cold run would compute, so restoring one changes cost only. Per-position and per-route
 * entries are deliberately absent: the trajectory report subsumes them, so a restored job carries
 * two entries rather than one entry per position.
 */
export interface StrategicFitIndexRestoration {
  readonly generation: string;
  /** The analyzer's own graph content key (normalized PGN), not a host-supplied cache key. */
  readonly graph_content_key: string;
  readonly graph: RepertoireGraph;
  readonly trajectories: StrategicTrajectoryReport | null;
}

/** What a completed analysis phase established, emitted to hosts that checkpoint their jobs. */
export interface StrategicFitJobCheckpointStage extends StrategicFitIndexRestoration {
  readonly completed_phase: StrategicFitProgressPhase;
  readonly completed_phase_index: number;
}

/** The narrow view the trajectory builder needs; it never sees cache bounds or plans. */
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
    return stableSerialize([...value.entries()].sort(([left], [right]) =>
      compareStrings(String(left), String(right))
    ));
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  return `{${Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, item]) => typeof item !== "function")
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
    .join(",")}}`;
}

/**
 * The single definition of the settings view behind a generation. The analyzer and every host that
 * validates a checkpoint call it, so a resumed job cannot be gated by a differently derived identity.
 */
export function strategicFitIndexSettings(
  options: StrategicFitIndexSettingsInput,
): StrategicFitIndexSettings {
  return {
    repertoire_color: options.repertoireColor,
    trajectory: options.trajectory ?? null,
    opening_table: [...(options.openingTable ?? new Map()).entries()]
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([positionKey, entry]) => [positionKey, entry.eco, entry.name]),
  };
}

/**
 * Generation identity for every indexed value. The complete manifest participates, so advancing any
 * component version — classifier, taxonomy, or otherwise — retires the whole generation.
 */
export function strategicFitIndexGeneration(
  settings: StrategicFitIndexSettings,
  manifest: StrategicFitAnalysisManifest = STRATEGIC_FIT_ANALYSIS_MANIFEST,
): string {
  return `strategic-fit-index:${stableHash(stableSerialize({ manifest, settings }))}`;
}

/**
 * Pawn signals read only the board, so the FEN placement field is their canonical position key and
 * transposed routes reaching one position share a single entry.
 */
function pawnSignalKey(fen: string, repertoireColor: Color): string {
  return `${repertoireColor}${ID_SEPARATOR}${fen.split(" ")[0] ?? fen}`;
}

/** One definition of the graph entry key, so a restored graph lands where a cold run looks. */
function graphKey(contentKey: string): string {
  return `graph${ID_SEPARATOR}${stableHash(contentKey)}`;
}

/** Bounded LRU index over the deterministic Strategic Fit stages, keyed by content identity. */
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

  /** The plan the most recent analysis ran under; evidence of reuse, never an input to a value. */
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

  /** A manifest or settings change is a generation change, which retires every prior entry. */
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
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
      this.evictions++;
    }
  }

  /**
   * Resolve one indexed value. The key must fully determine the value; a miss computes it, and a
   * hit returns the identical value the same inputs produced earlier in this generation.
   */
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

  /** Drop per-route entries whose route changed; position entries stay valid by content. */
  invalidateRoutes(routeIds: readonly string[]): number {
    let dropped = 0;
    for (const routeId of new Set(routeIds)) {
      if (this.entries.delete(`route-signals${ID_SEPARATOR}${routeId}`)) dropped++;
    }
    this.invalidations += dropped;
    return dropped;
  }

  /**
   * Seed whole-stage values an interrupted job already produced.
   *
   * Restoration installs entries under the same keys a cold run computes them under, so a restored
   * value can only be served to a request whose content identity already determines it. A stage that
   * does not belong to the restored graph is dropped rather than installed, and nothing about the
   * recomputation plan or the returned report changes: only the work still to do changes.
   */
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

  /** Record what a completed analysis established so the next run can scope its recomputation. */
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
        .map((cohort): StrategicFitIndexedCohort => ({
          cohort_id: cohort.cohort_id,
          route_ids: sortedUnique(cohort.route_ids),
        }))
        .sort((left, right) => compareStrings(left.cohort_id, right.cohort_id)),
    };
  }

  private recordPlan(plan: StrategicFitRecomputationPlan): StrategicFitRecomputationPlan {
    this.plan = plan;
    return plan;
  }

  /**
   * Plan the current run against the previous snapshot for this generation. Full scan is the
   * explicit fallback whenever no prior snapshot exists or the host could not establish affected
   * cohort identities.
   */
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
        reason: "No prior index snapshot exists for this generation, so every cohort is recomputed.",
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
      const affected = scoped.has(cohort.cohort_id) ||
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

/** Resolve the canonical graph for this content, computing it once per generation. */
export function indexedRepertoireGraph(
  index: StrategicFitIndexCache | undefined,
  generation: string | null,
  contentKey: string,
  build: () => RepertoireGraph,
): RepertoireGraph {
  if (index === undefined || generation === null) return build();
  return index.value(generation, "graph", stableHash(contentKey), build);
}

/** Resolve the trajectory report for this exact graph, computing it once per generation. */
export function indexedStrategicTrajectories(
  index: StrategicFitIndexCache | undefined,
  generation: string | null,
  graph: RepertoireGraph,
  build: () => StrategicTrajectoryReport,
): StrategicTrajectoryReport {
  if (index === undefined || generation === null) return build();
  return index.value(generation, "trajectories", graph.graph_id, build);
}
