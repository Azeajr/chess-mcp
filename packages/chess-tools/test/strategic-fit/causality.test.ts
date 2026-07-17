import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  attributeStrategicCausalOwnership,
  buildRepertoireGraph,
  buildStrategicConceptDictionary,
  buildStrategicTrajectories,
  computeStrategicTrajectoryDistance,
  type Color,
  type RepertoireGraph,
  type StrategicTrajectory,
  type StrategicTrajectoryDistance,
} from "../../src/index.ts";

interface PairResult {
  readonly graph: RepertoireGraph;
  readonly affected: StrategicTrajectory;
  readonly baseline: StrategicTrajectory;
  readonly distance: StrategicTrajectoryDistance;
  readonly attribution: ReturnType<typeof attributeStrategicCausalOwnership>;
}

function analyzePair(
  pgn: string,
  repertoireColor: Color,
  configuredPlies: readonly number[],
  affectedPrefix: string,
  baselinePrefix: string,
): PairResult {
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), repertoireColor);
  const trajectories = buildStrategicTrajectories(graph, { configuredPlies });
  const concepts = buildStrategicConceptDictionary(trajectories);
  const routeById = new Map(graph.routes.map((route) => [route.route_id, route]));
  const affected = trajectories.trajectories.find((trajectory) =>
    routeById.get(trajectory.route_id)!.san_moves.join(" ").startsWith(affectedPrefix)
  );
  const baseline = trajectories.trajectories.find((trajectory) =>
    routeById.get(trajectory.route_id)!.san_moves.join(" ").startsWith(baselinePrefix)
  );
  assert.ok(affected, `affected route beginning ${affectedPrefix}`);
  assert.ok(baseline, `baseline route beginning ${baselinePrefix}`);
  assert.notEqual(affected.route_id, baseline.route_id);
  const affectedConcepts = concepts.routes.find((route) => route.route_id === affected.route_id)!;
  const baselineConcepts = concepts.routes.find((route) => route.route_id === baseline.route_id)!;
  const distance = computeStrategicTrajectoryDistance(
    affected,
    baseline,
    affectedConcepts,
    baselineConcepts,
  );
  const attribution = attributeStrategicCausalOwnership(graph, affected, baseline, distance);
  return { graph, affected, baseline, distance, attribution };
}

test("an opponent-created structure is not blamed on the player's following quiet choice", () => {
  const result = analyzePair(
    `[Event "Opponent-forced"]
[Result "*"]

1. d4 Nf6 2. c4 c5 3. Nf3 e6 4. g3 d5 5. Bg2 Be7 6. O-O O-O *

[Event "Baseline"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. g3 Be7 5. Bg2 O-O 6. O-O *`,
    "white",
    [5, 7, 9, 11],
    "d4 Nf6 c4 c5",
    "d4 Nf6 c4 e6",
  );

  assert.equal(result.distance.state, "available");
  assert.ok((result.distance.distance ?? 0) > 0);
  assert.equal(result.attribution.label, "mostly-opponent-forced");
  assert.ok((result.attribution.controllability ?? 1) <= 0.34);
  assert.deepEqual(result.attribution.likely_causal_decision_ids, []);
  const firstDifference = result.attribution.timeline.find((event) =>
    event.kind === "first-strategic-difference"
  );
  assert.ok(firstDifference?.decision_id);
  assert.equal(
    result.graph.decisions.find((decision) => decision.decision_id === firstDifference.decision_id)!.owner,
    "opponent",
  );
});

test("a repertoire pawn decision receives player-controlled causal ownership", () => {
  const result = analyzePair(
    `[Event "Player pivot"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. f3 Be7 5. e4 O-O 6. e5 Nfd7
7. Be3 c5 8. Qd2 Nc6 9. O-O-O *

[Event "Baseline"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. e3 O-O 6. Bd3 Nbd7
7. O-O c5 8. Qe2 b6 9. Rd1 *`,
    "white",
    [7, 9, 11, 13, 15, 17],
    "d4 d5 c4 e6 Nc3 Nf6 f3",
    "d4 d5 c4 e6 Nc3 Nf6 Nf3",
  );

  assert.equal(result.distance.state, "available");
  assert.equal(result.attribution.label, "mostly-player-controlled");
  assert.ok((result.attribution.controllability ?? 0) >= 0.65);
  assert.ok(result.attribution.likely_causal_decision_ids.length > 0);
  assert.ok(result.attribution.likely_causal_decision_ids.every((decisionId) =>
    result.graph.decisions.find((decision) => decision.decision_id === decisionId)!.owner === "repertoire"
  ));
  assert.ok(result.attribution.timeline.some((event) => event.kind === "irreversible-event"));
});

test("opponent and repertoire structural choices produce explicit shared causality", () => {
  const result = analyzePair(
    `[Event "Shared pivot"]
[Result "*"]

1. d4 Nf6 2. c4 c5 3. d5 e6 4. Nc3 exd5 5. cxd5 d6 6. e4 g6
7. Nf3 Bg7 8. Be2 O-O *

[Event "Baseline"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. e3 Be7 5. Bd3 O-O 6. O-O dxc4
7. Bxc4 c5 8. Qe2 *`,
    "white",
    [5, 7, 9, 11, 13, 15],
    "d4 Nf6 c4 c5",
    "d4 Nf6 c4 e6",
  );

  assert.equal(result.distance.state, "available");
  assert.equal(result.attribution.label, "shared-or-uncertain");
  assert.ok((result.attribution.controllability ?? 0) >= 0.35);
  assert.ok((result.attribution.controllability ?? 1) <= 0.64);
  assert.ok(result.attribution.timeline.some((event) => event.kind === "opponent-divergence"));
  assert.ok(result.attribution.timeline.some((event) => event.kind === "player-decision"));
  assert.match(result.attribution.explanation, /Several decisions interact/);
});

test("move-order transposition suppresses false causal ownership", () => {
  const result = analyzePair(
    `[Event "Move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *

[Event "Move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 5. e3 O-O 6. Bd3 c6
7. O-O b6 8. b3 a6 9. a3 *`,
    "white",
    [7, 9, 11, 13, 15, 17],
    "d4 Nf6 c4 e6",
    "Nf3 d5 d4 Nf6",
  );

  assert.equal(result.distance.distance, 0);
  assert.equal(result.attribution.controllability, null);
  assert.equal(result.attribution.label, "unknown");
  assert.deepEqual(result.attribution.likely_causal_decision_ids, []);
  assert.ok(result.attribution.timeline.some((event) => event.kind === "transposition"));
  assert.match(result.attribution.explanation, /Transpositional equivalence/);
});

test("a route pair with no stable pivot remains explicitly unknown", () => {
  const result = analyzePair(
    `[Event "Short A"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *

[Event "Short B"]
[Result "*"]

1. e4 e5 2. Nc3 Nf6 *`,
    "white",
    [3],
    "e4 e5 Nf3",
    "e4 e5 Nc3",
  );

  assert.equal(result.attribution.controllability, null);
  assert.equal(result.attribution.label, "unknown");
  assert.deepEqual(result.attribution.likely_causal_decision_ids, []);
  assert.match(result.attribution.explanation, /No stable strategic pivot|no stable position-level feature pivot/i);
});

test("standard castling is an irreversible castling event, not a friendly-rook capture", () => {
  const result = analyzePair(
    `[Event "Castling pivot"]
[Result "*"]

1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 4. O-O Be7 5. d3 O-O 6. Nbd2 c5 *

[Event "Uncastled baseline"]
[Result "*"]

1. Nf3 d5 2. g3 Nf6 3. Bg2 e6 4. d3 Be7 5. Nbd2 O-O 6. e4 c5 *`,
    "white",
    [7, 9, 11],
    "Nf3 d5 g3 Nf6 Bg2 e6 O-O",
    "Nf3 d5 g3 Nf6 Bg2 e6 d3",
  );

  const castling = result.attribution.timeline.find((event) =>
    event.kind === "irreversible-event" && event.san === "O-O"
  );
  assert.ok(castling);
  assert.match(castling.explanation, /castling/);
  assert.doesNotMatch(castling.explanation, /capture/);
});

test("Black repertoire decisions use graph ownership rather than White move parity", () => {
  const result = analyzePair(
    `[Event "Black pivot"]
[Result "*"]

1. d4 Nf6 2. c4 c5 3. Nf3 e6 4. g3 d5 5. Bg2 Be7 6. O-O O-O
7. Nc3 Nc6 8. cxd5 exd5 *

[Event "Black baseline"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. g3 Be7 5. Bg2 O-O 6. O-O Nbd7
7. Nc3 c6 8. Qc2 *`,
    "black",
    [4, 6, 8, 10, 12, 14, 16],
    "d4 Nf6 c4 c5",
    "d4 Nf6 c4 e6",
  );

  assert.equal(result.distance.state, "available");
  assert.equal(result.attribution.label, "mostly-player-controlled");
  assert.ok((result.attribution.controllability ?? 0) >= 0.65);
  assert.ok(result.attribution.likely_causal_decision_ids.length > 0);
  for (const decisionId of result.attribution.likely_causal_decision_ids) {
    const decision = result.graph.decisions.find((candidate) => candidate.decision_id === decisionId)!;
    assert.equal(decision.owner, "repertoire");
    assert.equal(decision.mover_color, "black");
  }
});
