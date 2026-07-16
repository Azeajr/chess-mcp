import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_POSITION_SIGNAL_FEATURES,
  buildRepertoireGraph,
  extractRoutePositionSignals,
  type StrategicPositionSignalFeature,
  type StrategicRoutePositionSignals,
} from "../../src/index.ts";

type SignalObject = Readonly<Record<string, unknown>>;

function extract(pgn: string, repertoireColor: "white" | "black" = "white") {
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), repertoireColor);
  assert.equal(graph.routes.length, 1);
  return { graph, result: extractRoutePositionSignals(graph, graph.routes[0]!) };
}

function valueAt(
  result: StrategicRoutePositionSignals,
  feature: StrategicPositionSignalFeature,
  ply = result.observations.length - 1,
): SignalObject {
  const observation = result.observations[ply];
  assert.ok(observation, `observation at ply ${ply}`);
  const signal = observation.signals.find((candidate) => candidate.feature_id === feature);
  assert.ok(signal, feature);
  assert.ok(typeof signal.confidence === "number" && signal.confidence >= 0 && signal.confidence <= 1);
  assert.equal(signal.kind, "observation");
  assert.equal(typeof signal.value, "object");
  assert.ok(signal.value !== null && !Array.isArray(signal.value));
  return signal.value as SignalObject;
}

test("a traded fianchetto bishop remains in route history", () => {
  const { result } = extract(
    "1. g3 d5 2. Bg2 e5 3. d3 Nc6 4. Nf3 Be6 5. O-O Qd7 6. Nbd2 O-O-O 7. e4 Bh3 8. Bxh3 Qxh3 *",
  );

  const beforeTrade = valueAt(result, "piece.fianchetto-history", 14);
  const afterTrade = valueAt(result, "piece.fianchetto-history");
  assert.deepEqual(beforeTrade.repertoire, {
    wings: ["kingside"],
    first_observed_ply: { queenside: null, kingside: 3 },
  });
  assert.deepEqual(afterTrade.repertoire, beforeTrade.repertoire);

  const bishopPair = valueAt(result, "piece.bishop-pair");
  assert.deepEqual(bishopPair.repertoire, {
    bishop_count: 1,
    has_pair: false,
    first_lost_ply: 16,
  });
  const fianchettoSignal = result.observations.at(-1)!.signals.find(
    (signal) => signal.feature_id === "piece.fianchetto-history",
  )!;
  assert.equal(fianchettoSignal.persistence, "unknown");
});

test("opposite-side castling is retained as relative, confidence-bearing history", () => {
  const { result } = extract("1. d4 d5 2. Nc3 Nf6 3. Bf4 e6 4. Qd2 Be7 5. O-O-O O-O *");
  const castling = valueAt(result, "king.castling-history");

  assert.deepEqual(castling, {
    repertoire: { castled: true, side: "queenside", at_ply: 9 },
    opponent: { castled: true, side: "kingside", at_ply: 10 },
  });
  const castlingSignal = result.observations.at(-1)!.signals.find(
    (signal) => signal.feature_id === "king.castling-history",
  )!;
  assert.equal(castlingSignal.confidence, 1);
  assert.equal(castlingSignal.persistence, "unknown");
});

test("bishop-pair transitions and the causing exchange are explicit", () => {
  const { result } = extract("1. e4 d5 2. exd5 Qxd5 3. Nc3 Qd8 4. Bb5+ c6 5. Bxc6+ Nxc6 *");

  assert.deepEqual(valueAt(result, "piece.bishop-pair", 9).repertoire, {
    bishop_count: 2,
    has_pair: true,
    first_lost_ply: null,
  });
  assert.deepEqual(valueAt(result, "piece.bishop-pair").repertoire, {
    bishop_count: 1,
    has_pair: false,
    first_lost_ply: 10,
  });

  const exchanges = valueAt(result, "piece.exchange-history").exchanges as readonly SignalObject[];
  assert.ok(exchanges.some((exchange) =>
    exchange.capturing_side === "opponent" &&
    exchange.capturing_role === "knight" &&
    exchange.captured_side === "repertoire" &&
    exchange.captured_role === "bishop" &&
    exchange.first_ply === 10
  ));
});

test("a queen exchange remains visible after both queens leave the board", () => {
  const { result } = extract("1. d4 d5 2. c4 dxc4 3. e4 e5 4. dxe5 Qxd1+ 5. Kxd1 *");

  assert.deepEqual(valueAt(result, "piece.queen-retention"), {
    repertoire: { status: "exchanged", first_lost_ply: 8 },
    opponent: { status: "exchanged", first_lost_ply: 9 },
    mutual_exchange: true,
  });
  const exchangeSignal = result.observations.at(-1)!.signals.find(
    (signal) => signal.feature_id === "piece.queen-retention",
  )!;
  assert.equal(exchangeSignal.persistence, "unknown");
});

test("space imbalance, files, wing expansion, and color-complex tendencies are descriptive", () => {
  const { result } = extract("1. e4 d6 2. d4 Nf6 3. f3 g6 4. c4 Bg7 5. Nc3 O-O *");

  assert.deepEqual(valueAt(result, "space.pawn-advancement"), {
    repertoire: { advanced_pawns: ["c4", "d4", "e4"], score: 0.375 },
    opponent: { advanced_pawns: [], score: 0 },
    balance: 0.375,
  });
  assert.deepEqual(valueAt(result, "files.open-and-half-open"), {
    open: [],
    half_open: { repertoire: [], opponent: [] },
  });
  assert.deepEqual(valueAt(result, "space.wing-expansion").repertoire, {
    queenside: ["c4"],
    kingside: [],
    queenside_score: 0.333333,
    kingside_score: 0,
  });
  assert.deepEqual(valueAt(result, "space.color-complex-tendency").repertoire, {
    light_square_pawns: 5,
    dark_square_pawns: 3,
    sparser_complex: "dark",
    imbalance: 2,
  });

  for (const signal of result.observations.at(-1)!.signals) {
    assert.ok(!("verdict" in (signal.value as SignalObject)));
    assert.notEqual(signal.family, "dynamic-character");
  }
});

test("mirrored Black setup facts are expressed from the repertoire side", () => {
  const { result } = extract(
    "1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O *",
    "black",
  );

  assert.deepEqual(valueAt(result, "piece.fianchetto-history").repertoire, {
    wings: ["kingside"],
    first_observed_ply: { queenside: null, kingside: 6 },
  });
  assert.deepEqual(valueAt(result, "king.castling-history").repertoire, {
    castled: true,
    side: "kingside",
    at_ply: 10,
  });
  assert.equal((valueAt(result, "space.pawn-advancement").repertoire as SignalObject).score, 0);
  assert.equal((valueAt(result, "space.pawn-advancement").opponent as SignalObject).score, 0.375);
});

test("recurring placements, feature coverage, IDs, and ordering are deterministic", () => {
  const { graph, result } = extract("1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 4. O-O Be7 *");
  const byId = extractRoutePositionSignals(graph, graph.routes[0]!.route_id);

  assert.deepEqual(byId, result);
  assert.equal(result.observations.length, graph.routes[0]!.position_ids.length);
  for (const observation of result.observations) {
    assert.deepEqual(observation.signals.map((signal) => signal.feature_id), STRATEGIC_POSITION_SIGNAL_FEATURES);
    assert.equal(new Set(observation.signals.map((signal) => signal.signal_id)).size, observation.signals.length);
    assert.ok(observation.signals.every((signal) => signal.analysis_version === result.analysis_version));
    assert.ok(observation.signals.every((signal) => signal.provenance[0]?.source_id === "strategic-fit:position-signals"));
  }

  const placements = valueAt(result, "piece.recurring-placements").placements as readonly SignalObject[];
  assert.ok(placements.some((placement) =>
    placement.side === "repertoire" &&
    placement.role === "knight" &&
    placement.square === "f3" &&
    Number(placement.observation_count) >= 2
  ));
});
