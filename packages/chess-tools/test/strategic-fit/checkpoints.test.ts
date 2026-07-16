import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  STRATEGIC_FIT_MAX_CONFIGURED_CHECKPOINTS,
  buildRepertoireGraph,
  selectStrategicCheckpoints,
  type OpeningTable,
  type StrategicCheckpointKind,
  type StrategicCheckpointMilestone,
  type StrategicRouteCheckpointSelection,
} from "../../src/index.ts";
import {
  BLACK_REPERTOIRE_FIXTURE,
  UNEQUAL_DEPTH_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

function milestone(
  selection: StrategicRouteCheckpointSelection,
  kind: StrategicCheckpointKind,
  requestedPly: number | null = null,
): StrategicCheckpointMilestone {
  const found = selection.milestones.find((candidate) => {
    const candidateKind = candidate.state === "selected" ? candidate.checkpoint.kind : candidate.kind;
    return candidateKind === kind && candidate.requested_ply === requestedPly;
  });
  assert.ok(found, `${kind} ${requestedPly ?? ""}`);
  return found;
}

function onlyRoute(pgn: string, color: "white" | "black" = "white") {
  const graph = buildRepertoireGraph(GameTree.fromPgn(pgn), color);
  assert.equal(graph.routes.length, 1);
  return { graph, route: graph.routes[0]! };
}

test("unequal route depths do not turn arbitrary leaf endpoints into matched checkpoints", () => {
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(UNEQUAL_DEPTH_FIXTURE),
    UNEQUAL_DEPTH_FIXTURE.repertoireColor,
  );
  const result = selectStrategicCheckpoints(graph, { configuredPlies: [12] });
  const byLength = [...result.routes].sort((left, right) => {
    const leftRoute = graph.routes.find((route) => route.route_id === left.route_id)!;
    const rightRoute = graph.routes.find((route) => route.route_id === right.route_id)!;
    return leftRoute.san_moves.length - rightRoute.san_moves.length;
  });

  assert.deepEqual(
    byLength.map((selection) => {
      const configured = milestone(selection, "configured-ply", 12);
      return configured.state === "selected" ? configured.checkpoint.ply : configured.comparability;
    }),
    ["incomplete", "incomplete", 11],
  );
  assert.deepEqual(
    byLength.map((selection) => {
      const final = milestone(selection, "final-valid-position");
      assert.equal(final.state, "selected");
      assert.equal(final.checkpoint.comparability, "not-comparable");
      return final.checkpoint.ply;
    }),
    [6, 8, 14],
  );
});

test("an early central pawn capture marks both resolution and irreversible transformation", () => {
  const { graph } = onlyRoute("1. e4 d5 2. exd5 Qxd5 3. Nc3 *");
  const route = selectStrategicCheckpoints(graph, { configuredPlies: [] }).routes[0]!;
  const central = milestone(route, "central-resolution");
  const irreversible = milestone(route, "irreversible-transformation");

  assert.equal(central.state, "selected");
  assert.equal(central.event_ply, 3);
  assert.equal(central.checkpoint.ply, 3);
  assert.match(central.checkpoint.reason, /exd5.*central pawn capture/);
  assert.equal(irreversible.state, "selected");
  assert.equal(irreversible.event_ply, 3);
  assert.equal(irreversible.checkpoint.ply, 3);
});

test("central resolution waits for a delayed pawn exchange", () => {
  const { graph } = onlyRoute("1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. cxd5 exd5 5. Bg5 *");
  const route = selectStrategicCheckpoints(graph, { configuredPlies: [] }).routes[0]!;
  const central = milestone(route, "central-resolution");

  assert.equal(central.state, "selected");
  assert.equal(central.event_ply, 7);
  assert.equal(central.checkpoint.ply, 7);
  assert.match(central.checkpoint.reason, /cxd5/);
});

test("a center lock after live tension is an engine-free irreversible milestone", () => {
  const { graph } = onlyRoute("1. e4 e6 2. d4 d5 3. e5 c5 4. c3 *");
  const route = selectStrategicCheckpoints(graph, { configuredPlies: [] }).routes[0]!;
  const central = milestone(route, "central-resolution");
  const irreversible = milestone(route, "irreversible-transformation");

  assert.equal(central.state, "selected");
  assert.equal(central.event_ply, 5);
  assert.match(central.checkpoint.reason, /e5.*center became locked/);
  assert.equal(irreversible.state, "selected");
  assert.equal(irreversible.event_ply, 5);
});

test("opening exit uses the deepest table hit and missing hits stay not comparable", () => {
  const { graph, route } = onlyRoute("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 *");
  const positions = new Map(graph.positions.map((position) => [position.position_id, position]));
  const openingTable: OpeningTable = new Map();
  for (let ply = 1; ply <= 4; ply++) {
    openingTable.set(positions.get(route.position_ids[ply]!)!.position_key, {
      eco: "C60",
      name: "Ruy Lopez",
    });
  }

  const classified = selectStrategicCheckpoints(graph, {
    openingTable,
    configuredPlies: [],
  }).routes[0]!;
  const openingExit = milestone(classified, "opening-exit");
  assert.equal(openingExit.state, "selected");
  assert.equal(openingExit.event_ply, 5);
  assert.equal(openingExit.checkpoint.ply, 5);
  assert.match(openingExit.checkpoint.reason, /deepest opening-table hit at ply 4/);

  const noHitTable: OpeningTable = new Map([
    ["unrelated-position", { eco: "A00", name: "Uncommon Opening" }],
  ]);
  const unclassified = selectStrategicCheckpoints(graph, {
    openingTable: noHitTable,
    configuredPlies: [],
  }).routes[0]!;
  const missingExit = milestone(unclassified, "opening-exit");
  assert.equal(missingExit.state, "missing");
  assert.equal(missingExit.comparability, "not-comparable");
  assert.match(missingExit.reason, /no opening-table hit/);
});

test("Black checkpoints are selected after Black moves", () => {
  const graph = buildRepertoireGraph(
    parseStrategicFitFixture(BLACK_REPERTOIRE_FIXTURE),
    BLACK_REPERTOIRE_FIXTURE.repertoireColor,
  );
  const result = selectStrategicCheckpoints(graph, { configuredPlies: [8] });

  for (const route of result.routes) {
    const comparable = route.milestones.filter(
      (candidate) => candidate.state === "selected" && candidate.checkpoint.comparability === "comparable",
    );
    assert.ok(comparable.length > 0);
    for (const candidate of comparable) {
      assert.equal(candidate.state, "selected");
      assert.equal(candidate.checkpoint.ply % 2, 0, candidate.checkpoint.reason);
    }
  }
});

test("terminal lines retain their final legal position without treating it as matched", () => {
  const { graph } = onlyRoute("1. f3 e5 2. g4 Qh4# *");
  const route = selectStrategicCheckpoints(graph, { configuredPlies: [12] }).routes[0]!;
  const final = milestone(route, "final-valid-position");
  const configured = milestone(route, "configured-ply", 12);

  assert.equal(final.state, "selected");
  assert.equal(final.checkpoint.ply, 4);
  assert.equal(final.checkpoint.comparability, "not-comparable");
  assert.match(final.checkpoint.reason, /game is terminal/);
  assert.equal(configured.state, "missing");
  assert.equal(configured.comparability, "incomplete");
});

test("selection is deterministic, deduplicates horizons, and bounds configured checkpoints", () => {
  const { graph } = onlyRoute("1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *");
  const first = selectStrategicCheckpoints(graph, { configuredPlies: [24, 12, 12] });
  const second = selectStrategicCheckpoints(graph, { configuredPlies: [12, 24] });

  assert.deepEqual(first, second);
  assert.deepEqual(first.configured_plies, [12, 24]);
  assert.throws(
    () =>
      selectStrategicCheckpoints(graph, {
        configuredPlies: Array.from(
          { length: STRATEGIC_FIT_MAX_CONFIGURED_CHECKPOINTS + 1 },
          (_, index) => index + 1,
        ),
      }),
    /too_many_configured_plies/,
  );
});
