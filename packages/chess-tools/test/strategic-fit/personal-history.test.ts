import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES,
  buildRepertoireGraph,
  calculateStrategicRouteWeights,
  collectStrategicPersonalHistoryWeights,
  strategicFitReportCacheKey,
  type GameMeta,
  type RepertoireGraph,
  type StrategicRouteWeightingOptions,
} from "../../src/index.ts";

const ROOT_BRANCHES = `
[Event "King pawn"]
[Result "*"]

1. e4 e5 2. Nf3 *

[Event "Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 *`;

const TRANSPOSED_DECISION = `
[Event "Knight first"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 (2... e6) *

[Event "Pawn first"]
[Result "*"]

1. d4 d5 2. Nf3 Nf6 (2... e6) *`;

function game(pgn: string | undefined, userColor: "white" | "black" | null = "white"): GameMeta {
  return {
    white: userColor === "white" ? "SampleUser" : "Opponent",
    black: userColor === "black" ? "SampleUser" : "Opponent",
    result: "*",
    white_elo: 1800,
    black_elo: 1800,
    eco: null,
    opening: null,
    date: "2026.07.22",
    time_control: "600+0",
    user_color: userColor,
    user_result: null,
    ...(pgn === undefined ? {} : { pgn }),
  };
}

function decisionBySan(graph: RepertoireGraph, san: string) {
  return graph.decisions.find((decision) => decision.owner === "opponent" && decision.san === san)!;
}

function population(graph: RepertoireGraph): StrategicRouteWeightingOptions {
  return {
    mode: "external",
    decision_weights: [
      { decision_id: decisionBySan(graph, "e5").decision_id, weight: 90 },
      { decision_id: decisionBySan(graph, "c5").decision_id, weight: 10 },
    ],
    provenance: [{
      source_id: "test:population",
      kind: "opening-explorer",
      state: "available",
      version: "test",
      snapshot: "population:90-10",
      reason: null,
    }],
  };
}

function routeWeight(graph: RepertoireGraph, weighting: StrategicRouteWeightingOptions, reply: string) {
  const report = calculateStrategicRouteWeights(graph, weighting);
  return report.routes.find((weighted) =>
    graph.routes.find((route) => route.route_id === weighted.route_id)?.san_moves[1] === reply
  )!.normalized_weight;
}

test("five personal games are shrunk toward population frequency", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(ROOT_BRANCHES), "white");
  const games = Array.from({ length: 5 }, () => game("1. e4 c5 2. Nf3 *"));
  const collection = collectStrategicPersonalHistoryWeights(graph, games, {
    source: { platform: "lichess", username: "SampleUser", max_games: 30 },
    population: population(graph),
  });

  assert.equal(STRATEGIC_PERSONAL_HISTORY_PRIOR_GAMES, 20);
  assert.equal(collection.state, "complete");
  assert.equal(collection.games_mapped, 5);
  assert.equal(routeWeight(graph, collection.weighting, "e5"), 0.72);
  assert.equal(routeWeight(graph, collection.weighting, "c5"), 0.28);
  assert.equal(collection.provenance.some((source) => source.kind === "personal-history"), true);
  assert.equal(collection.provenance.some((source) => source.kind === "opening-explorer"), true);
});

test("a large personal sample can outweigh the population prior", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(ROOT_BRANCHES), "white");
  const games = Array.from({ length: 100 }, () => game("1. e4 c5 2. Nf3 *"));
  const collection = collectStrategicPersonalHistoryWeights(graph, games, {
    source: { platform: "lichess", username: "SampleUser", max_games: 100 },
    population: population(graph),
  });

  assert.equal(routeWeight(graph, collection.weighting, "e5"), 0.15);
  assert.equal(routeWeight(graph, collection.weighting, "c5"), 0.85);
});

test("wrong-color games are excluded rather than counted as repertoire frequency", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(ROOT_BRANCHES), "white");
  const collection = collectStrategicPersonalHistoryWeights(
    graph,
    [game("1. e4 c5 2. Nf3 *", "black")],
    {
      source: { platform: "chesscom", username: "SampleUser", year: 2026, month: 7 },
      population: population(graph),
    },
  );

  assert.equal(collection.state, "insufficient");
  assert.equal(collection.games_matching_color, 0);
  assert.equal(collection.games_wrong_color, 1);
  assert.equal(collection.decisions_mapped, 0);
  assert.equal(routeWeight(graph, collection.weighting, "e5"), 0.9);
  assert.equal(routeWeight(graph, collection.weighting, "c5"), 0.1);
  assert.match(collection.provenance.find((source) => source.kind === "personal-history")?.reason ?? "", /wrong-color games are excluded/);
});

test("transposed move orders aggregate at one canonical semantic decision", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(TRANSPOSED_DECISION), "white");
  const target = graph.positions.find((position) =>
    position.outgoing_decision_ids.length === 2 && position.incoming_move_order_ids.length === 2
  )!;
  const collection = collectStrategicPersonalHistoryWeights(
    graph,
    [
      game("1. Nf3 d5 2. d4 Nf6 *"),
      game("1. d4 d5 2. Nf3 e6 *"),
    ],
    { source: { platform: "lichess", username: "SampleUser", max_games: 30 } },
  );

  assert.equal(collection.position_frequencies.find((item) => item.position_id === target.position_id)?.visits, 2);
  const frequencies = collection.decision_frequencies.filter((item) => item.from_position_id === target.position_id);
  assert.deepEqual(frequencies.map((item) => item.count).sort(), [1, 1]);
  assert.equal(collection.decision_weights.filter((item) => target.outgoing_decision_ids.includes(item.decision_id)).length, 2);
});

test("player departures map to their canonical repertoire decision position", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *"), "white");
  const collection = collectStrategicPersonalHistoryWeights(
    graph,
    [game("1. e4 e5 2. Bc4 Nc6 *")],
    { source: { platform: "lichess", username: "SampleUser", max_games: 30 } },
  );

  assert.equal(collection.player_deviations.length, 1);
  assert.equal(collection.player_deviations[0]?.played_san, "Bc4");
  assert.equal(collection.player_deviations[0]?.owner, "repertoire");
  assert.equal(collection.player_deviations[0]?.expected_decision_ids.length, 1);
  assert.equal(collection.opponent_departures.length, 0);
});

test("metadata without PGN is explicitly insufficient and preserves equal fallback", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(ROOT_BRANCHES), "white");
  const collection = collectStrategicPersonalHistoryWeights(
    graph,
    [game(undefined), game(undefined)],
    { source: { platform: "lichess", username: "SampleUser", max_games: 30 } },
  );

  assert.equal(collection.state, "insufficient");
  assert.equal(collection.games_with_pgn, 0);
  assert.equal(collection.provenance[0]?.state, "unavailable");
  assert.match(collection.provenance[0]?.reason ?? "", /metadata records contain no PGN/);
  assert.deepEqual(
    calculateStrategicRouteWeights(graph, collection.weighting).routes.map((route) => route.normalized_weight),
    [0.5, 0.5],
  );
});

test("Lichess and Chess.com PGN fixtures map through the same deterministic boundary", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(ROOT_BRANCHES), "white");
  const lichess = game(`[Event "rated rapid game"]\n[Site "https://lichess.org/example"]\n[White "SampleUser"]\n[Black "Opponent"]\n\n1. e4 e5 2. Nf3 *`);
  const chesscom = game(`[Event "Live Chess"]\n[Site "Chess.com"]\n[White "SampleUser"]\n[Black "Opponent"]\n\n1. e4 c5 2. Nf3 *`);
  const collection = collectStrategicPersonalHistoryWeights(
    graph,
    [lichess, chesscom],
    { source: { platform: "chesscom", username: "SampleUser", year: 2026, month: 7 } },
  );

  assert.equal(collection.games_mapped, 2);
  assert.deepEqual(
    collection.decision_frequencies
      .filter((item) => item.owner === "opponent")
      .map((item) => item.count)
      .sort(),
    [1, 1],
  );
  const lichessCollection = collectStrategicPersonalHistoryWeights(
    graph,
    [lichess, chesscom],
    { source: { platform: "lichess", username: "SampleUser", max_games: 30 } },
  );
  const baseOptions = { repertoireColor: "white" as const, repertoireRevision: "revision:personal" };
  assert.notEqual(
    strategicFitReportCacheKey(ROOT_BRANCHES, { ...baseOptions, weighting: collection.weighting }),
    strategicFitReportCacheKey(ROOT_BRANCHES, { ...baseOptions, weighting: lichessCollection.weighting }),
    "identical frequencies from different platform snapshots cannot share a report cache entry",
  );
});
