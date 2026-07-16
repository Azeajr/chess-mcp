import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildRepertoireGraph,
  type RepertoireGraph,
} from "../../src/index.ts";
import {
  BLACK_REPERTOIRE_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

function ids(graph: RepertoireGraph): {
  positions: string[];
  decisions: string[];
  moveOrders: string[];
  routes: string[];
  transpositions: string[];
} {
  return {
    positions: graph.positions.map((position) => position.position_id),
    decisions: graph.decisions.map((decision) => decision.decision_id),
    moveOrders: graph.move_orders.map((order) => order.move_order_id),
    routes: graph.routes.map((route) => route.route_id),
    transpositions: graph.transposition_links.map((link) => link.transposition_id),
  };
}

test("cross-branch move orders share canonical positions and retain navigation paths", () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const graph = buildRepertoireGraph(tree, "white");

  assert.equal(graph.positions.length, 15);
  assert.equal(graph.decisions.length, 15);
  assert.equal(graph.move_orders.length, 16);
  assert.equal(graph.routes.length, 2);
  assert.equal(graph.transposition_links.length, 2);

  for (const link of graph.transposition_links) {
    assert.equal(link.incoming_move_order_ids.length, 2);
    const position = graph.positions.find((candidate) => candidate.position_id === link.position_id)!;
    assert.equal(position.incoming_move_order_ids.length, 2);
    assert.equal(position.source_san_paths.length, 2);
  }

  for (const route of graph.routes) {
    assert.equal(route.source_san_paths.length, 1);
    for (const path of route.source_san_paths) assert.ok(tree.indexPathOfSan(path), path.join(" "));
  }
  assert.notEqual(graph.routes[0]!.route_id, graph.routes[1]!.route_id);
  assert.equal(
    graph.routes[0]!.terminal_position_id,
    graph.routes[1]!.terminal_position_id,
    "the two distinct routes converge on one semantic terminal position",
  );
});

test("duplicate editorial routes collapse to one semantic route without losing source counts", () => {
  const tree = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  const duplicate = GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *");
  tree.game.moves.children.push(duplicate.game.moves.children[0]!);

  const graph = buildRepertoireGraph(tree, "white");

  assert.equal(graph.source_route_count, 2);
  assert.equal(graph.routes.length, 1);
  assert.equal(graph.routes[0]!.source_route_count, 2);
  assert.deepEqual(graph.routes[0]!.source_san_paths, [
    ["e4", "e5", "Nf3", "Nc6"],
    ["e4", "e5", "Nf3", "Nc6"],
  ]);
  assert.equal(graph.positions.length, 5);
  assert.equal(graph.decisions.length, 4);
  assert.equal(graph.move_orders.length, 4);
});

test("semantic graph and IDs do not depend on PGN game or variation order", () => {
  const moveOrderA = `[Event "Move order A"]
[Result "*"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Nf3 Be7 *`;
  const moveOrderB = `[Event "Move order B"]
[Result "*"]

1. Nf3 d5 2. d4 Nf6 3. c4 e6 4. Nc3 Be7 *`;
  const first = buildRepertoireGraph(GameTree.fromPgn(`${moveOrderA}\n\n${moveOrderB}`), "white");
  const reordered = buildRepertoireGraph(GameTree.fromPgn(`${moveOrderB}\n\n${moveOrderA}`), "white");

  assert.deepEqual(ids(reordered), ids(first));
  assert.deepEqual(reordered, first);
  assert.equal(reordered.graph_id, first.graph_id);
});

test("Black repertoire ownership follows the side making each decision", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(BLACK_REPERTOIRE_FIXTURE), "black");

  assert.equal(graph.positions.length, 29);
  assert.equal(graph.decisions.length, 28);
  assert.equal(graph.routes.length, 3);
  assert.equal(graph.transposition_links.length, 0);
  for (const decision of graph.decisions) {
    assert.equal(decision.owner, decision.mover_color === "black" ? "repertoire" : "opponent");
    assert.equal(decision.plies.every((ply) => ply % 2 === (decision.owner === "repertoire" ? 0 : 1)), true);
  }
});

test("graph construction is deterministic and does not mutate GameTree", () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const before = tree.toPgn();

  const first = buildRepertoireGraph(tree, "white");
  const second = buildRepertoireGraph(tree, "white");

  assert.deepEqual(second, first);
  assert.deepEqual(ids(second), ids(first));
  assert.equal(tree.toPgn(), before);
});
