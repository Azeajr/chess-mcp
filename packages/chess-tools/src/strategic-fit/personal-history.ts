/**
 * Optional personal-game frequency collection for Strategic Fit.
 *
 * Hosts fetch full PGNs through their existing platform adapters. This framework-free layer maps
 * each game onto the canonical repertoire graph, records departures without changing the graph,
 * and shrinks personal opponent-choice counts toward population probabilities. Network access and
 * credentials remain outside the deterministic analyzer.
 */
import { positionKey } from "../congruence.js";
import { mainline } from "../game.js";
import type { GameMeta } from "../games.js";
import type {
  RepertoireGraph,
  RepertoireGraphDecision,
  RepertoireMoveOwner,
} from "./graph.js";
import type { StrategicFitSourceProvenance } from "./types.js";
import { STRATEGIC_FIT_ANALYSIS_MANIFEST } from "./version.js";
import type {
  StrategicDecisionWeightInput,
  StrategicRouteWeightingOptions,
} from "./weights.js";

/** Population-equivalent observations in the empirical-Bayes prior at each opponent decision. */
export const STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES = 20;
export const STRATEGIC_PERSONAL_HISTORY_DEFAULT_MAX_GAMES = 30;

export const STRATEGIC_PERSONAL_HISTORY_COLLECTION_STATES = [
  "complete",
  "partial",
  "insufficient",
  "unavailable",
  "cancelled",
] as const;
export type StrategicPersonalHistoryCollectionState =
  (typeof STRATEGIC_PERSONAL_HISTORY_COLLECTION_STATES)[number];

export const STRATEGIC_PERSONAL_HISTORY_PLATFORMS = ["lichess", "chesscom"] as const;
export type StrategicPersonalHistoryPlatform =
  (typeof STRATEGIC_PERSONAL_HISTORY_PLATFORMS)[number];

export interface StrategicPersonalHistorySource {
  readonly platform: StrategicPersonalHistoryPlatform;
  readonly username: string;
  readonly max_games?: number;
  readonly year?: number;
  readonly month?: number;
}

export interface StrategicPersonalHistoryCollectionOptions {
  readonly source: StrategicPersonalHistorySource;
  /** Optional market weights collected by the host before personal-history mapping. */
  readonly population?: StrategicRouteWeightingOptions;
  readonly shouldCancel?: () => boolean;
}

export interface StrategicPersonalPositionFrequency {
  readonly position_id: string;
  readonly visits: number;
}

export interface StrategicPersonalDecisionFrequency {
  readonly decision_id: string;
  readonly from_position_id: string;
  readonly owner: RepertoireMoveOwner;
  readonly count: number;
}

export interface StrategicPersonalDeparture {
  readonly from_position_id: string;
  readonly owner: RepertoireMoveOwner;
  readonly played_san: string;
  readonly played_uci: string;
  readonly count: number;
  readonly plies: readonly number[];
  readonly expected_decision_ids: readonly string[];
}

export interface StrategicPersonalHistoryCollection {
  readonly state: StrategicPersonalHistoryCollectionState;
  readonly source: StrategicPersonalHistorySource;
  readonly games_total: number;
  readonly games_with_pgn: number;
  readonly games_matching_color: number;
  readonly games_wrong_color: number;
  readonly games_invalid_pgn: number;
  readonly games_reached_repertoire: number;
  readonly games_mapped: number;
  readonly positions_mapped: number;
  readonly decisions_mapped: number;
  readonly prior_games: number;
  readonly position_frequencies: readonly StrategicPersonalPositionFrequency[];
  readonly decision_frequencies: readonly StrategicPersonalDecisionFrequency[];
  readonly player_deviations: readonly StrategicPersonalDeparture[];
  readonly opponent_departures: readonly StrategicPersonalDeparture[];
  readonly decision_weights: readonly StrategicDecisionWeightInput[];
  readonly weighting: StrategicRouteWeightingOptions;
  readonly provenance: readonly StrategicFitSourceProvenance[];
}

interface MutableDeparture {
  readonly fromPositionId: string;
  readonly owner: RepertoireMoveOwner;
  readonly playedSan: string;
  readonly playedUci: string;
  readonly expectedDecisionIds: readonly string[];
  count: number;
  readonly plies: Set<number>;
}

const ID_SEPARATOR = "\u001f";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function mergeProvenance(
  ...groups: readonly (readonly StrategicFitSourceProvenance[])[]
): StrategicFitSourceProvenance[] {
  const result: StrategicFitSourceProvenance[] = [];
  const seen = new Set<string>();
  for (const source of groups.flat()) {
    const identity = [source.source_id, source.version, source.snapshot, source.state].join(ID_SEPARATOR);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(source);
  }
  return result.sort((left, right) =>
    compareStrings(left.source_id, right.source_id) ||
    compareStrings(left.snapshot ?? "", right.snapshot ?? "")
  );
}

function sourceSnapshot(source: StrategicPersonalHistorySource): string {
  const parts = [
    `platform=${source.platform}`,
    `username=${encodeURIComponent(source.username.trim().toLowerCase())}`,
  ];
  if (source.max_games !== undefined) parts.push(`max_games=${source.max_games}`);
  if (source.year !== undefined) parts.push(`year=${source.year}`);
  if (source.month !== undefined) parts.push(`month=${source.month}`);
  return parts.join("&");
}

function sourceReason(
  state: StrategicPersonalHistoryCollectionState,
  totals: {
    readonly games: number;
    readonly withPgn: number;
    readonly matchingColor: number;
    readonly invalidPgn: number;
    readonly mapped: number;
    readonly deviations: number;
  },
): string {
  if (state === "unavailable") {
    return "Personal game history is unavailable because the selected platform was offline or returned no user data; the base report remains usable.";
  }
  if (state === "cancelled") {
    return "Personal game history mapping was cancelled; the partial result must not be published as a completed report.";
  }
  if (totals.games > 0 && totals.withPgn === 0) {
    return `Personal game history is insufficient: ${totals.games} fetched game metadata records contain no PGN, so no semantic decisions can be mapped.`;
  }
  if (totals.matchingColor === 0) {
    return `Personal game history is insufficient: none of ${totals.games} fetched games match the repertoire color; wrong-color games are excluded.`;
  }
  if (totals.mapped === 0) {
    return `Personal game history is insufficient: no valid matching-color PGN reached a canonical repertoire decision (${totals.invalidPgn} invalid PGN).`;
  }
  const qualifier = state === "partial"
    ? ` Mapping is partial because ${totals.invalidPgn} matching-color PGN could not be parsed or some fetched metadata omitted PGN.`
    : "";
  return `${totals.mapped}/${totals.matchingColor} matching-color games mapped to canonical repertoire decisions with ${totals.deviations} player departures. Personal opponent-choice counts are shrunk toward the population baseline using a ${STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES}-game prior.${qualifier}`;
}

function provenanceFor(
  state: StrategicPersonalHistoryCollectionState,
  source: StrategicPersonalHistorySource,
  totals: Parameters<typeof sourceReason>[1],
): StrategicFitSourceProvenance {
  return {
    source_id: `strategic-fit:personal-history:${source.platform}`,
    kind: "personal-history",
    state: state === "complete" ? "available" : state === "partial" || state === "cancelled"
      ? "partial"
      : "unavailable",
    version: STRATEGIC_FIT_ANALYSIS_MANIFEST.components["personal-history"],
    snapshot: sourceSnapshot(source),
    reason: sourceReason(state, totals),
  };
}

function opponentGroups(graph: RepertoireGraph): RepertoireGraphDecision[][] {
  const groups = new Map<string, RepertoireGraphDecision[]>();
  for (const decision of graph.decisions) {
    if (decision.owner !== "opponent") continue;
    const siblings = groups.get(decision.from_position_id) ?? [];
    siblings.push(decision);
    groups.set(decision.from_position_id, siblings);
  }
  return [...groups.values()]
    .filter((siblings) => siblings.length > 1)
    .map((siblings) => siblings.sort((left, right) => compareStrings(left.decision_id, right.decision_id)))
    .sort((left, right) => compareStrings(left[0]!.from_position_id, right[0]!.from_position_id));
}

function blendedDecisionWeights(
  graph: RepertoireGraph,
  counts: ReadonlyMap<string, number>,
  population: StrategicRouteWeightingOptions | undefined,
  personalSource: StrategicFitSourceProvenance,
): StrategicDecisionWeightInput[] {
  const populationById = new Map(
    (population?.decision_weights ?? []).map((weight) => [weight.decision_id, weight]),
  );
  const result: StrategicDecisionWeightInput[] = [];

  for (const siblings of opponentGroups(graph)) {
    const personalTotal = siblings.reduce(
      (sum, decision) => sum + (counts.get(decision.decision_id) ?? 0),
      0,
    );
    const supplied = siblings.map((decision) => populationById.get(decision.decision_id));
    const hasPopulation = supplied.some((weight) => weight !== undefined);
    if (personalTotal === 0 && !hasPopulation) continue;

    if (personalTotal === 0) {
      for (const [index, decision] of siblings.entries()) {
        const populationWeight = supplied[index];
        if (!populationWeight) continue;
        result.push({
          decision_id: decision.decision_id,
          weight: populationWeight.weight,
          provenance: mergeProvenance(populationWeight.provenance ?? [], [personalSource]),
        });
      }
      continue;
    }

    const populationValues = siblings.map((decision) => populationById.get(decision.decision_id)?.weight ?? 0);
    const populationTotal = populationValues.reduce((sum, weight) => sum + weight, 0);
    const priorProbabilities = populationTotal > 0
      ? populationValues.map((weight) => weight / populationTotal)
      : siblings.map(() => 1 / siblings.length);
    for (const [index, decision] of siblings.entries()) {
      const populationWeight = supplied[index];
      result.push({
        decision_id: decision.decision_id,
        weight: priorProbabilities[index]! * STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES +
          (counts.get(decision.decision_id) ?? 0),
        provenance: mergeProvenance(populationWeight?.provenance ?? [], [personalSource]),
      });
    }
  }
  return result.sort((left, right) => compareStrings(left.decision_id, right.decision_id));
}

function emptyResult(
  graph: RepertoireGraph,
  games: readonly GameMeta[] | null,
  options: StrategicPersonalHistoryCollectionOptions,
  state: "unavailable" | "cancelled",
): StrategicPersonalHistoryCollection {
  const totals = {
    games: games?.length ?? 0,
    withPgn: games?.filter((game) => game.pgn).length ?? 0,
    matchingColor: games?.filter((game) => game.user_color === graph.repertoire_color).length ?? 0,
    invalidPgn: 0,
    mapped: 0,
    deviations: 0,
  };
  const personalSource = provenanceFor(state, options.source, totals);
  const decisionWeights = blendedDecisionWeights(graph, new Map(), options.population, personalSource);
  const provenance = mergeProvenance(options.population?.provenance ?? [], [personalSource]);
  return {
    state,
    source: { ...options.source },
    games_total: totals.games,
    games_with_pgn: totals.withPgn,
    games_matching_color: totals.matchingColor,
    games_wrong_color: totals.games - totals.matchingColor,
    games_invalid_pgn: 0,
    games_reached_repertoire: 0,
    games_mapped: 0,
    positions_mapped: 0,
    decisions_mapped: 0,
    prior_games: STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES,
    position_frequencies: [],
    decision_frequencies: [],
    player_deviations: [],
    opponent_departures: [],
    decision_weights: decisionWeights,
    weighting: {
      mode: "external",
      route_weights: options.population?.route_weights,
      decision_weights: decisionWeights,
      provenance,
    },
    provenance,
  };
}

/**
 * Map fetched PGNs to canonical decisions and create empirically shrunk opponent-choice weights.
 * A position contributes at most once per game, so repetitions cannot manufacture observations;
 * distinct move orders that transpose to the same canonical position aggregate naturally.
 */
export function collectStrategicPersonalHistoryWeights(
  graph: RepertoireGraph,
  games: readonly GameMeta[] | null,
  options: StrategicPersonalHistoryCollectionOptions,
): StrategicPersonalHistoryCollection {
  if (games === null) return emptyResult(graph, games, options, "unavailable");
  if (options.shouldCancel?.()) return emptyResult(graph, games, options, "cancelled");

  const positionByKey = new Map(graph.positions.map((position) => [position.position_key, position]));
  const decisionsByPosition = new Map<string, Map<string, RepertoireGraphDecision>>();
  for (const decision of graph.decisions) {
    const byUci = decisionsByPosition.get(decision.from_position_id) ?? new Map();
    byUci.set(decision.uci, decision);
    decisionsByPosition.set(decision.from_position_id, byUci);
  }

  const positionCounts = new Map<string, number>();
  const decisionCounts = new Map<string, number>();
  const departures = new Map<string, MutableDeparture>();
  let invalidPgn = 0;
  let reached = 0;
  let mapped = 0;

  for (const game of games) {
    if (options.shouldCancel?.()) return emptyResult(graph, games, options, "cancelled");
    if (game.user_color !== graph.repertoire_color || !game.pgn) continue;

    let moves;
    try {
      moves = mainline(game.pgn);
    } catch {
      invalidPgn++;
      continue;
    }

    const seenPositions = new Set<string>();
    let gameReached = false;
    let gameMapped = false;
    for (const move of moves) {
      const position = positionByKey.get(positionKey(move.fenBefore));
      if (!position || seenPositions.has(position.position_id)) continue;
      seenPositions.add(position.position_id);
      gameReached = true;
      positionCounts.set(position.position_id, (positionCounts.get(position.position_id) ?? 0) + 1);

      const decisions = decisionsByPosition.get(position.position_id);
      const matchedDecision = decisions?.get(move.uci);
      if (matchedDecision) {
        decisionCounts.set(
          matchedDecision.decision_id,
          (decisionCounts.get(matchedDecision.decision_id) ?? 0) + 1,
        );
        gameMapped = true;
        continue;
      }
      if (!decisions || decisions.size === 0) continue;

      const owner: RepertoireMoveOwner = move.color === graph.repertoire_color
        ? "repertoire"
        : "opponent";
      const expectedDecisionIds = [...decisions.values()]
        .map((decision) => decision.decision_id)
        .sort(compareStrings);
      const key = [position.position_id, owner, move.uci].join(ID_SEPARATOR);
      const departure = departures.get(key) ?? {
        fromPositionId: position.position_id,
        owner,
        playedSan: move.san,
        playedUci: move.uci,
        expectedDecisionIds,
        count: 0,
        plies: new Set<number>(),
      };
      departure.count++;
      departure.plies.add(move.ply);
      departures.set(key, departure);
      gameMapped = true;
    }
    if (gameReached) reached++;
    if (gameMapped) mapped++;
  }

  const withPgn = games.filter((game) => game.pgn).length;
  const matchingColor = games.filter((game) => game.user_color === graph.repertoire_color).length;
  const missingMatchingPgn = games.some(
    (game) => game.user_color === graph.repertoire_color && !game.pgn,
  );
  const state: StrategicPersonalHistoryCollectionState = mapped === 0
    ? "insufficient"
    : invalidPgn > 0 || missingMatchingPgn
      ? "partial"
      : "complete";
  const playerDeviationCount = [...departures.values()]
    .filter((departure) => departure.owner === "repertoire")
    .reduce((sum, departure) => sum + departure.count, 0);
  const totals = {
    games: games.length,
    withPgn,
    matchingColor,
    invalidPgn,
    mapped,
    deviations: playerDeviationCount,
  };
  const personalSource = provenanceFor(state, options.source, totals);
  const decisionWeights = blendedDecisionWeights(graph, decisionCounts, options.population, personalSource);
  const provenance = mergeProvenance(options.population?.provenance ?? [], [personalSource]);
  const frequencyByDecision = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));
  const formattedDepartures = [...departures.values()]
    .map((departure): StrategicPersonalDeparture => ({
      from_position_id: departure.fromPositionId,
      owner: departure.owner,
      played_san: departure.playedSan,
      played_uci: departure.playedUci,
      count: departure.count,
      plies: [...departure.plies].sort((left, right) => left - right),
      expected_decision_ids: [...departure.expectedDecisionIds],
    }))
    .sort((left, right) => right.count - left.count ||
      compareStrings(left.from_position_id, right.from_position_id) ||
      compareStrings(left.played_uci, right.played_uci));

  return {
    state,
    source: { ...options.source },
    games_total: games.length,
    games_with_pgn: withPgn,
    games_matching_color: matchingColor,
    games_wrong_color: games.length - matchingColor,
    games_invalid_pgn: invalidPgn,
    games_reached_repertoire: reached,
    games_mapped: mapped,
    positions_mapped: [...positionCounts.values()].reduce((sum, count) => sum + count, 0),
    decisions_mapped: [...decisionCounts.values()].reduce((sum, count) => sum + count, 0),
    prior_games: STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES,
    position_frequencies: [...positionCounts.entries()]
      .map(([position_id, visits]) => ({ position_id, visits }))
      .sort((left, right) => compareStrings(left.position_id, right.position_id)),
    decision_frequencies: [...decisionCounts.entries()]
      .map(([decisionId, count]): StrategicPersonalDecisionFrequency => {
        const decision = frequencyByDecision.get(decisionId)!;
        return {
          decision_id: decisionId,
          from_position_id: decision.from_position_id,
          owner: decision.owner,
          count,
        };
      })
      .sort((left, right) => compareStrings(left.decision_id, right.decision_id)),
    player_deviations: formattedDepartures.filter((departure) => departure.owner === "repertoire"),
    opponent_departures: formattedDepartures.filter((departure) => departure.owner === "opponent"),
    decision_weights: decisionWeights,
    weighting: {
      mode: "external",
      route_weights: options.population?.route_weights,
      decision_weights: decisionWeights,
      provenance,
    },
    provenance,
  };
}
