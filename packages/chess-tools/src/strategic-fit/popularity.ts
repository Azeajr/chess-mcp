/**
 * Optional population-popularity collection for Strategic Fit.
 *
 * The deterministic analyzer never performs network work. Hosts build the canonical graph, inject
 * an authenticated explorer lookup here, and pass the returned external weights into the analyzer.
 * Only opponent positions with multiple prepared replies are relevant: a singleton choice always
 * normalizes to one. Canonical graph positions make the walk transposition-safe by construction.
 */
import {
  explorerFilterKey,
  normalizeExplorerFilters,
  type ExplorerFilters,
  type ExplorerLookup,
  type NormalizedExplorerFilters,
} from "../explorer.js";
import type { RepertoireGraph, RepertoireGraphDecision, RepertoireGraphPosition } from "./graph.js";
import type { StrategicFitSourceProvenance } from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_MANIFEST } from "./version.js";
import type { StrategicDecisionWeightInput, StrategicRouteWeightingOptions } from "./weights.js";

export const STRATEGIC_POPULARITY_DEFAULT_QUERY_BUDGET = 60;
export const STRATEGIC_POPULARITY_MAX_QUERY_BUDGET = 120;
export const STRATEGIC_POPULARITY_MOVE_LIMIT = 30;

export const STRATEGIC_POPULARITY_COLLECTION_STATES = [
  "complete",
  "partial",
  "unavailable",
  "cancelled",
] as const;
export type StrategicPopularityCollectionState =
  (typeof STRATEGIC_POPULARITY_COLLECTION_STATES)[number];

export type StrategicPopularityAvailability = "available" | "authentication-required";

export interface StrategicPopularityCollectionOptions {
  readonly filters?: Omit<ExplorerFilters, "movesLimit">;
  readonly maxPositions?: number;
  readonly availability?: StrategicPopularityAvailability;
  readonly shouldCancel?: () => boolean;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface StrategicPopularityCollection {
  readonly state: StrategicPopularityCollectionState;
  readonly filters: NormalizedExplorerFilters;
  readonly relevant_positions: number;
  readonly positions_queried: number;
  readonly positions_weighted: number;
  readonly positions_skipped: number;
  readonly budget_exhausted: boolean;
  readonly decision_weights: readonly StrategicDecisionWeightInput[];
  readonly weighting: StrategicRouteWeightingOptions;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface OpponentDecisionGroup {
  readonly position: RepertoireGraphPosition;
  readonly decisions: readonly RepertoireGraphDecision[];
  readonly firstPly: number;
}

interface CollectedDecisionWeight {
  readonly decision_id: string;
  readonly weight: number;
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

function queryBudget(value: number | undefined): number {
  const budget = value ?? STRATEGIC_POPULARITY_DEFAULT_QUERY_BUDGET;
  if (!Number.isSafeInteger(budget) || budget < 1 || budget > STRATEGIC_POPULARITY_MAX_QUERY_BUDGET) {
    throw new Error(`strategic_popularity_invalid_query_budget: ${String(budget)}`);
  }
  return budget;
}

function relevantOpponentDecisions(graph: RepertoireGraph): OpponentDecisionGroup[] {
  const positionById = new Map(graph.positions.map((position) => [position.position_id, position]));
  const byPosition = new Map<string, RepertoireGraphDecision[]>();
  for (const decision of graph.decisions) {
    if (decision.owner !== "opponent") continue;
    const siblings = byPosition.get(decision.from_position_id) ?? [];
    siblings.push(decision);
    byPosition.set(decision.from_position_id, siblings);
  }
  return [...byPosition.entries()]
    .filter(([, decisions]) => decisions.length > 1)
    .map(([positionId, decisions]) => ({
      position: positionById.get(positionId)!,
      decisions: decisions.sort((left, right) => compareStrings(left.decision_id, right.decision_id)),
      firstPly: Math.min(...decisions.flatMap((decision) => decision.plies)) - 1,
    }))
    .sort((left, right) => left.firstPly - right.firstPly ||
      compareStrings(left.position.position_id, right.position.position_id));
}

function collectionSource(
  state: StrategicPopularityCollectionState,
  filters: NormalizedExplorerFilters,
  relevant: number,
  queried: number,
  weighted: number,
  budgetExhausted: boolean,
  failure: "authentication-required" | "offline" | null,
): StrategicFitSourceProvenance {
  const sourceState = state === "complete"
    ? "available"
    : state === "unavailable"
      ? "unavailable"
      : "partial";
  const population = explorerFilterKey({
    db: filters.db,
    speeds: filters.db === "lichess" ? filters.speeds : undefined,
    ratings: filters.db === "lichess" ? filters.ratings : undefined,
    since: filters.since ?? undefined,
    until: filters.until ?? undefined,
    movesLimit: filters.movesLimit,
  });
  let reason = `Opening popularity is population-dependent; ${weighted}/${relevant} canonical opponent-decision positions were weighted from ${population}.`;
  if (failure === "authentication-required") {
    reason = `Opening popularity is unavailable because the configured Lichess explorer requires authentication. Population: ${population}.`;
  } else if (failure === "offline") {
    reason = weighted === 0
      ? `Opening popularity is unavailable because the authenticated explorer was offline or returned no response. Population: ${population}.`
      : `${reason} The authenticated explorer became unavailable after ${queried} queries, so remaining positions use explicit equal fallbacks.`;
  } else if (budgetExhausted) {
    reason = `${reason} The bounded query budget was exhausted, so remaining positions use explicit equal fallbacks.`;
  } else if (state === "cancelled") {
    reason = `${reason} Collection was cancelled; the partial result must not be published as a completed report.`;
  }
  return {
    source_id: "strategic-fit:opening-popularity",
    kind: "opening-explorer",
    state: sourceState,
    version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components.popularity,
    snapshot: population,
    reason,
  };
}

function result(
  state: StrategicPopularityCollectionState,
  filters: NormalizedExplorerFilters,
  relevant: number,
  queried: number,
  weighted: number,
  budgetExhausted: boolean,
  collected: readonly CollectedDecisionWeight[],
  failure: "authentication-required" | "offline" | null,
): StrategicPopularityCollection {
  const provenance = [collectionSource(
    state,
    filters,
    relevant,
    queried,
    weighted,
    budgetExhausted,
    failure,
  )];
  const decisionWeights = collected
    .map((weight): StrategicDecisionWeightInput => ({ ...weight, provenance }))
    .sort((left, right) => compareStrings(left.decision_id, right.decision_id));
  return {
    state,
    filters,
    relevant_positions: relevant,
    positions_queried: queried,
    positions_weighted: weighted,
    positions_skipped: relevant - weighted,
    budget_exhausted: budgetExhausted,
    decision_weights: decisionWeights,
    weighting: {
      mode: "external",
      decision_weights: decisionWeights,
      provenance,
    },
    provenance,
  };
}

/**
 * Collect population weights for every relevant canonical opponent decision, in shallowest-first
 * deterministic order. A failed lookup stops immediately so an outage cannot consume the entire
 * budget; already collected evidence is retained and labeled partial.
 */
export async function collectStrategicPopularityWeights(
  graph: RepertoireGraph,
  options: StrategicPopularityCollectionOptions,
  lookup?: ExplorerLookup,
): Promise<StrategicPopularityCollection> {
  const filters = normalizeExplorerFilters({
    ...(options.filters ?? {}),
    movesLimit: STRATEGIC_POPULARITY_MOVE_LIMIT,
  });
  const budget = queryBudget(options.maxPositions);
  const groups = relevantOpponentDecisions(graph);
  const planned = Math.min(groups.length, budget);

  if ((options.availability ?? "available") === "authentication-required" || lookup === undefined) {
    options.onProgress?.(0, 0);
    return result("unavailable", filters, groups.length, 0, 0, false, [], "authentication-required");
  }
  options.onProgress?.(0, planned);

  const collected: CollectedDecisionWeight[] = [];
  let queried = 0;
  let weighted = 0;
  for (const group of groups.slice(0, budget)) {
    if (options.shouldCancel?.()) {
      return result("cancelled", filters, groups.length, queried, weighted, false, collected, null);
    }
    const position = await lookup(group.position.fen);
    queried++;
    options.onProgress?.(queried, planned);
    if (options.shouldCancel?.()) {
      return result("cancelled", filters, groups.length, queried, weighted, false, collected, null);
    }
    if (position === null) {
      return result(
        weighted === 0 ? "unavailable" : "partial",
        filters,
        groups.length,
        queried,
        weighted,
        false,
        collected,
        "offline",
      );
    }

    const gamesByUci = new Map(position.moves.map((move) => [move.uci, move.games]));
    for (const decision of group.decisions) {
      collected.push({ decision_id: decision.decision_id, weight: gamesByUci.get(decision.uci) ?? 0 });
    }
    weighted++;
  }

  const budgetExhausted = groups.length > budget;
  return result(
    budgetExhausted ? "partial" : "complete",
    filters,
    groups.length,
    queried,
    weighted,
    budgetExhausted,
    collected,
    null,
  );
}
