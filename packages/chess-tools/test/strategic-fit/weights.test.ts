import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  calculateEffectiveSampleSize,
  calculateStrategicRouteWeights,
  type RepertoireGraph,
  type StrategicFitSourceProvenance,
} from "../../src/index.ts";
import {
  BLACK_REPERTOIRE_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

const BRANCH_DEPTH_PGN = `[Event "One leaf after 1...e5"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *

[Event "First leaf after 1...c5"]
[Result "*"]

1. e4 c5 2. Nf3 d6 *

[Event "Second leaf after 1...c5"]
[Result "*"]

1. e4 c5 2. Nf3 Nc6 *`;

const EXTERNAL_PROVENANCE: StrategicFitSourceProvenance = {
  source_id: "fixture:opening-explorer",
  kind: "opening-explorer",
  state: "available",
  version: "fixture-1",
  snapshot: "2026-07-16",
  reason: null,
};

function blackGraph(): RepertoireGraph {
  return buildRepertoireGraph(parseStrategicFitFixture(BLACK_REPERTOIRE_FIXTURE), "black");
}

function routeByFirstSan(graph: RepertoireGraph, san: string): RepertoireGraph["routes"][number] {
  const route = graph.routes.find((candidate) => candidate.san_moves[0] === san);
  assert.ok(route, san);
  return route;
}

function close(actual: number, expected: number, epsilon = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test("equal weights normalize at opponent decisions instead of counting annotated leaves", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(BRANCH_DEPTH_PGN), "white");
  const result = calculateStrategicRouteWeights(graph);

  assert.equal(result.requested_mode, "equal");
  assert.equal(result.state, "complete");
  assert.deepEqual(result.fallbacks, []);
  close(result.routes.reduce((sum, route) => sum + route.normalized_weight, 0), 1);

  const e5 = result.routes.find((route) =>
    graph.routes.find((candidate) => candidate.route_id === route.route_id)!.san_moves[1] === "e5"
  )!;
  const c5 = result.routes.filter((route) =>
    graph.routes.find((candidate) => candidate.route_id === route.route_id)!.san_moves[1] === "c5"
  );
  close(e5.normalized_weight, 0.5);
  close(c5.reduce((sum, route) => sum + route.normalized_weight, 0), 0.5);
  assert.deepEqual(c5.map((route) => route.normalized_weight), [0.25, 0.25]);
});

test("a dominant manually supplied route weight remains deterministic and normalized", () => {
  const graph = blackGraph();
  const dominant = routeByFirstSan(graph, "e4");
  const others = graph.routes.filter((route) => route.route_id !== dominant.route_id);
  const result = calculateStrategicRouteWeights(graph, {
    mode: "manual",
    route_weights: [
      { route_id: dominant.route_id, weight: 90 },
      ...others.map((route) => ({ route_id: route.route_id, weight: 5 })),
    ],
  });

  assert.equal(result.state, "complete");
  assert.deepEqual(result.fallbacks, []);
  close(result.routes.find((route) => route.route_id === dominant.route_id)!.normalized_weight, 0.9);
  for (const route of result.routes.filter((route) => route.route_id !== dominant.route_id)) {
    close(route.normalized_weight, 0.05);
  }
});

test("external opponent-decision weights retain provenance and disclose missing siblings", () => {
  const graph = blackGraph();
  const e4 = routeByFirstSan(graph, "e4");
  const rootDecision = graph.decisions.find((decision) =>
    decision.owner === "opponent" &&
    decision.from_position_id === graph.root_position_id &&
    decision.uci === e4.uci_moves[0]
  )!;
  const result = calculateStrategicRouteWeights(graph, {
    mode: "external",
    decision_weights: [{
      decision_id: rootDecision.decision_id,
      weight: 8,
      provenance: [EXTERNAL_PROVENANCE],
    }],
  });

  assert.equal(result.state, "partial");
  assert.deepEqual(result.fallbacks, [{
    scope: "opponent-decision",
    reason: "missing-decision-weight",
    affected_ids: graph.decisions
      .filter((decision) => decision.owner === "opponent" && decision.from_position_id === graph.root_position_id)
      .filter((decision) => decision.decision_id !== rootDecision.decision_id)
      .map((decision) => decision.decision_id)
      .sort(),
    resolution: "equal",
  }]);
  close(result.routes.find((route) => route.route_id === e4.route_id)!.normalized_weight, 0.8);
  assert.ok(result.provenance.some((source) => source.source_id === EXTERNAL_PROVENANCE.source_id));
  assert.ok(
    result.opponent_decisions.find((decision) => decision.decision_id === rootDecision.decision_id)!
      .provenance.some((source) => source.source_id === EXTERNAL_PROVENANCE.source_id),
  );
});

test("missing and all-zero external weights fall back explicitly to equal evidence", () => {
  const graph = blackGraph();
  const missing = calculateStrategicRouteWeights(graph, { mode: "external" });
  const allZero = calculateStrategicRouteWeights(graph, {
    mode: "external",
    route_weights: graph.routes.map((route) => ({ route_id: route.route_id, weight: 0 })),
  });
  const rootOpponentDecisions = graph.decisions.filter((decision) =>
    decision.owner === "opponent" && decision.from_position_id === graph.root_position_id
  );
  const zeroDecisions = calculateStrategicRouteWeights(graph, {
    mode: "external",
    decision_weights: rootOpponentDecisions.map((decision) => ({
      decision_id: decision.decision_id,
      weight: 0,
    })),
  });

  assert.equal(missing.state, "fallback");
  assert.equal(missing.fallbacks[0]?.reason, "no-supplied-weights");
  assert.equal(allZero.state, "fallback");
  assert.equal(allZero.fallbacks.at(-1)?.reason, "all-zero-route-weights");
  assert.equal(zeroDecisions.state, "fallback");
  assert.equal(zeroDecisions.fallbacks[0]?.reason, "all-zero-decision-weights");
  assert.deepEqual(
    allZero.routes.map((route) => route.normalized_weight),
    missing.routes.map((route) => route.normalized_weight),
  );
  close(allZero.routes.reduce((sum, route) => sum + route.normalized_weight, 0), 1);
});

test("transposed and duplicate source routes do not create independent weight", () => {
  const transposedGraph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const transposed = calculateStrategicRouteWeights(transposedGraph);

  assert.equal(transposed.routes.length, 2);
  assert.equal(transposed.weighting_units.length, 1);
  assert.deepEqual(transposed.routes.map((route) => route.normalized_weight), [0.5, 0.5]);
  assert.equal(transposed.effective_sample_size, 1);

  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const duplicate = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  tree.game.moves.children.push(duplicate.game.moves.children[0]!);
  const duplicateGraph = buildRepertoireGraph(tree, "white");
  const duplicateResult = calculateStrategicRouteWeights(duplicateGraph);
  assert.equal(duplicateGraph.source_route_count, 2);
  assert.equal(duplicateResult.routes.length, 1);
  assert.equal(duplicateResult.routes[0]!.normalized_weight, 1);
  assert.equal(duplicateResult.effective_sample_size, 1);
});

test("effective sample size follows the frozen sum-squared formula", () => {
  close(calculateEffectiveSampleSize([1, 2, 3]), 36 / 14);
  assert.equal(calculateEffectiveSampleSize([0, 0, 0]), 0);
  assert.equal(calculateEffectiveSampleSize([0.9, 0.05, 0.05]), 1 / (0.81 + 0.0025 + 0.0025));
  assert.throws(
    () => calculateEffectiveSampleSize([1, -1]),
    /strategic_fit_weights_invalid_weight/,
  );
});
