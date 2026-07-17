import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildOpeningTaxonomy,
  buildRepertoireGraph,
  buildStrategicTrajectories,
  calculateStrategicRouteWeights,
  formStrategicCohorts,
  type OpeningTable,
  type RepertoireGraph,
  type RepertoireGraphRoute,
  type StrategicCohortOverride,
} from "../../src/index.ts";
import {
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

interface RouteOpening {
  readonly route: RepertoireGraphRoute;
  readonly eco: string;
  readonly name: string;
}

function openingTable(graph: RepertoireGraph, openings: readonly RouteOpening[]): OpeningTable {
  const positions = new Map(graph.positions.map((position) => [position.position_id, position]));
  const table: OpeningTable = new Map();
  for (const opening of openings) {
    const terminal = positions.get(opening.route.terminal_position_id);
    assert.ok(terminal);
    table.set(terminal.position_key, { eco: opening.eco, name: opening.name });
  }
  return table;
}

function analyze(
  graph: RepertoireGraph,
  openings: readonly RouteOpening[],
  overrides: readonly StrategicCohortOverride[] = [],
) {
  const taxonomy = buildOpeningTaxonomy(graph, openingTable(graph, openings));
  const trajectories = buildStrategicTrajectories(graph);
  const weights = calculateStrategicRouteWeights(graph);
  return formStrategicCohorts(graph, taxonomy, trajectories, weights, { overrides });
}

const SICILIAN_PGN = `[Event "Open Sicilian: Najdorf"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e6 *

[Event "Open Sicilian: Classical"]
[Result "*"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 6. Be3 e6 *

[Event "Closed Sicilian"]
[Result "*"]

1. e4 c5 2. Nc3 Nc6 3. g3 g6 4. Bg2 Bg7 5. d3 d6 6. f4 e6 *

[Event "Alapin"]
[Result "*"]

1. e4 c5 2. c3 Nf6 3. e5 Nd5 4. d4 cxd4 5. Nf3 Nc6 6. cxd4 d6 *

[Event "Wing Gambit"]
[Result "*"]

1. e4 c5 2. b4 cxb4 3. a3 d5 4. exd5 Qxd5 5. Nf3 e5 6. axb4 Bxb4 *`;

function sicilianInputs() {
  const graph = buildRepertoireGraph(GameTree.fromPgn(SICILIAN_PGN), "white");
  const openings: RouteOpening[] = graph.routes.map((route) => {
    if (route.san_moves[2] === "Nf3") {
      return { route, eco: "B32", name: "Sicilian Defense: Open" };
    }
    if (route.san_moves[2] === "Nc3") {
      return { route, eco: "B23", name: "Sicilian Defense: Closed" };
    }
    if (route.san_moves[2] === "c3") {
      return { route, eco: "B22", name: "Sicilian Defense: Alapin Variation" };
    }
    return { route, eco: "B20", name: "Sicilian Defense: Wing Gambit" };
  });
  return { graph, openings };
}

test("Sicilian sub-systems share a descriptive family container but not an automatic broad cohort", () => {
  const { graph, openings } = sicilianInputs();
  const report = analyze(graph, openings);

  assert.equal(report.containers.length, 1);
  assert.equal(report.containers[0]!.label, "Sicilian Defense");
  assert.equal(report.containers[0]!.route_ids.length, 5);
  assert.equal(report.cohorts.length, 4);
  const openRoutes = openings.filter((opening) => opening.name.endsWith(": Open")).map(
    (opening) => opening.route.route_id,
  ).sort();
  const openCohort = report.cohorts.find((cohort) =>
    cohort.route_ids.length === 2 && openRoutes.every((routeId) => cohort.route_ids.includes(routeId))
  );
  assert.ok(openCohort);
  assert.equal(openCohort.opening_scope_ids.length, 2);
  assert.equal(openCohort.opening_container_ids[0], report.containers[0]!.container_id);
});

test("canonical transposed systems form one semantic cohort without double-counting evidence", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const transposedOpenings = (target: RepertoireGraph): RouteOpening[] => target.routes.map((route) => ({
    route,
    eco: "D37",
    name: "Queen's Gambit Declined: Three Knights Variation",
  }));
  const first = analyze(graph, transposedOpenings(graph));
  const reversedPgn = WHITE_TRANSPOSITION_FIXTURE.pgn
    .split(/(?=^\[Event)/mu)
    .map((game) => game.trim())
    .filter(Boolean)
    .reverse()
    .join("\n\n");
  const reorderedGraph = buildRepertoireGraph(GameTree.fromPgn(reversedPgn), "white");
  const reordered = analyze(reorderedGraph, transposedOpenings(reorderedGraph));

  assert.equal(first.cohorts.length, 1);
  assert.equal(first.cohorts[0]!.route_ids.length, 2);
  assert.equal(first.cohorts[0]!.transposition_position_ids.length > 0, true);
  assert.equal(first.cohorts[0]!.effective_sample_size, 1);
  assert.equal(first.cohorts[0]!.state, "insufficient-evidence");
  assert.equal(first.cohorts[0]!.insufficiency_reasons.includes("fewer-than-two-independent-routes"), true);
  assert.equal(new Set(first.cohorts[0]!.route_ids).size, 2);
  assert.equal(reordered.cohorts[0]!.cohort_id, first.cohorts[0]!.cohort_id);
});

test("manual split and merge overrides deterministically reclassify inferred cohorts", () => {
  const { graph, openings } = sicilianInputs();
  const openRoutes = openings.filter((opening) => opening.name.endsWith(": Open")).map(
    (opening) => opening.route.route_id,
  );
  const closedRoute = openings.find((opening) => opening.name.endsWith(": Closed"))!.route.route_id;

  const split = analyze(graph, openings, [{
    override_id: "override:split-open",
    kind: "split",
    route_ids: [openRoutes[0]!],
  }]);
  assert.equal(split.cohorts.length, 5);
  assert.equal(
    split.cohorts.filter((cohort) => cohort.override_ids.includes("override:split-open")).length,
    2,
  );

  const merge = analyze(graph, openings, [{
    override_id: "override:merge-systems",
    kind: "merge",
    route_ids: [...openRoutes, closedRoute],
  }]);
  assert.equal(merge.cohorts.length, 3);
  const merged = merge.cohorts.find((cohort) => cohort.override_ids.includes("override:merge-systems"));
  assert.ok(merged);
  assert.deepEqual(merged.route_ids, [...openRoutes, closedRoute].sort());
  assert.equal(merged.opening_container_ids.length, 1);
});

test("an excluded decision subtree stays in data-quality and container counts but not the baseline", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(`[Event "Najdorf"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e6 *

[Event "Classical"]
[Result "*"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 6. Be3 e6 *`), "white");
  const openings = graph.routes.map((route): RouteOpening => ({
    route,
    eco: "B32",
    name: "Sicilian Defense: Open",
  }));
  const excludedDecision = graph.decisions.find((decision) =>
    decision.owner === "opponent" && decision.san === "d6" && decision.plies.includes(4)
  );
  assert.ok(excludedDecision);
  const report = analyze(graph, openings, [{
    override_id: "override:exclude-d6",
    kind: "exclude",
    decision_ids: [excludedDecision.decision_id],
  }]);

  assert.equal(report.data_quality.total_route_count, 2);
  assert.equal(report.data_quality.included_route_count, 1);
  assert.equal(report.data_quality.excluded_route_count, 1);
  assert.equal(report.containers[0]!.route_ids.length, 2);
  assert.equal(report.containers[0]!.excluded_route_ids.length, 1);
  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0]!.route_ids.length, 1);
  assert.equal(report.cohorts[0]!.excluded_route_ids.length, 1);
  assert.deepEqual(report.cohorts[0]!.route_weights.map((weight) => weight.normalized_weight), [1]);
});

test("a small one-route cohort is explicitly insufficient rather than actionable", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 h6 *",
  ), "white");
  const route = graph.routes[0]!;
  const report = analyze(graph, [{
    route,
    eco: "D63",
    name: "Queen's Gambit Declined: Orthodox Defense",
  }]);

  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0]!.state, "insufficient-evidence");
  assert.equal(
    report.cohorts[0]!.insufficiency_reasons.includes("fewer-than-two-independent-routes"),
    true,
  );
});

test("opponent branch boundaries never enter actionable player-decision scope", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn(`[Event "Najdorf"]
[Result "*"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e6 *

[Event "Classical"]
[Result "*"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 d6 6. Be3 e6 *`), "white");
  const report = analyze(graph, graph.routes.map((route): RouteOpening => ({
    route,
    eco: "B32",
    name: "Sicilian Defense: Open",
  })));
  const decisionById = new Map(graph.decisions.map((decision) => [decision.decision_id, decision]));

  assert.equal(report.cohorts.length, 1);
  assert.equal(report.cohorts[0]!.decision_scope_ids.length > 0, true);
  assert.equal(
    report.cohorts[0]!.decision_scope_ids.every((decisionId) => decisionById.get(decisionId)?.owner === "repertoire"),
    true,
  );
  assert.equal(
    report.cohorts[0]!.decision_scope_ids.some((decisionId) => decisionById.get(decisionId)?.san === "d6"),
    false,
  );
});
