import assert from "node:assert/strict";
import test from "node:test";

import {
  GameTree,
  buildOpeningTaxonomy,
  buildRepertoireGraph,
  classifyOpeningName,
  type OpeningTable,
  type OpeningTaxonomy,
  type RepertoireGraph,
} from "../../src/index.ts";
import {
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((san, index) => san === right[index]);
}

function positionKeyAt(graph: RepertoireGraph, path: readonly string[]): string {
  const position = graph.positions.find((candidate) =>
    candidate.source_san_paths.some((sourcePath) => samePath(sourcePath, path)),
  );
  assert.ok(position, `missing graph position for ${path.join(" ")}`);
  return position.position_key;
}

function addHit(
  table: OpeningTable,
  graph: RepertoireGraph,
  path: readonly string[],
  eco: string,
  name: string,
): void {
  table.set(positionKeyAt(graph, path), { eco, name });
}

function exactByName(
  report: ReturnType<typeof buildOpeningTaxonomy>,
  name: string,
): OpeningTaxonomy {
  const match = report.positions.find((position) =>
    position.taxonomy.provenance.exact_source_names.includes(name),
  );
  assert.ok(match, `missing taxonomy for ${name}`);
  return match.taxonomy;
}

test("Sicilian family retains distinct Open, Closed, Alapin, and gambit systems", () => {
  const graph = buildRepertoireGraph(
    GameTree.fromPgn(`[Event "Open Sicilian"]
[Result "*"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 *

[Event "Closed Sicilian"]
[Result "*"]

1. e4 c5 2. Nc3 Nc6 3. g3 *

[Event "Alapin"]
[Result "*"]

1. e4 c5 2. c3 Nf6 *

[Event "Wing Gambit"]
[Result "*"]

1. e4 c5 2. b4 cxb4 *`),
    "white",
  );
  const table: OpeningTable = new Map();
  addHit(table, graph, ["e4", "c5", "Nf3", "Nc6", "d4", "cxd4", "Nxd4"], "B32", "Sicilian Defense: Open");
  addHit(table, graph, ["e4", "c5", "Nc3", "Nc6", "g3"], "B23", "Sicilian Defense: Closed");
  addHit(table, graph, ["e4", "c5", "c3", "Nf6"], "B22", "Sicilian Defense: Alapin Variation");
  addHit(table, graph, ["e4", "c5", "b4", "cxb4"], "B20", "Sicilian Defense: Wing Gambit");

  const report = buildOpeningTaxonomy(graph, table);
  const labels = [
    "Sicilian Defense: Open",
    "Sicilian Defense: Closed",
    "Sicilian Defense: Alapin Variation",
    "Sicilian Defense: Wing Gambit",
  ];
  const taxonomies = labels.map((label) => exactByName(report, label));

  assert.deepEqual(
    taxonomies.map((taxonomy) => taxonomy.family?.label),
    ["Sicilian Defense", "Sicilian Defense", "Sicilian Defense", "Sicilian Defense"],
  );
  assert.equal(new Set(taxonomies.map((taxonomy) => taxonomy.family?.taxonomy_id)).size, 1);
  assert.equal(new Set(taxonomies.map((taxonomy) => taxonomy.system?.taxonomy_id)).size, 4);
  assert.deepEqual(
    taxonomies.map((taxonomy) => taxonomy.system?.label),
    ["Open", "Closed", "Alapin Variation", "Wing Gambit"],
  );
  assert.deepEqual(taxonomies[0]!.family?.eco_range, { from: "B20", to: "B32" });
  assert.equal(taxonomies[3]!.provenance.exact_source_names[0], "Sicilian Defense: Wing Gambit");
});

test("Queen's Gambit hierarchy promotes Accepted and Declined to systems and preserves variations", () => {
  const graph = buildRepertoireGraph(
    GameTree.fromPgn(`[Event "QGD"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 *

[Event "QGA"]
[Result "*"]

1. d4 d5 2. c4 dxc4 3. Nf3 Nf6 *`),
    "white",
  );
  const table: OpeningTable = new Map();
  const declinedName = "Queen's Gambit Declined: Orthodox Defense, Rubinstein Attack";
  const acceptedName = "Queen's Gambit Accepted: Classical Defense, Main Line";
  addHit(table, graph, ["d4", "d5", "c4", "e6", "Nc3", "Nf6", "Bg5", "Be7"], "D63", declinedName);
  addHit(table, graph, ["d4", "d5", "c4", "dxc4", "Nf3", "Nf6"], "D20", acceptedName);

  assert.deepEqual(classifyOpeningName(declinedName), {
    family: "Queen's Gambit",
    system: "Declined",
    variations: ["Orthodox Defense", "Rubinstein Attack"],
  });

  const report = buildOpeningTaxonomy(graph, table);
  const declined = exactByName(report, declinedName);
  const accepted = exactByName(report, acceptedName);

  assert.equal(declined.family?.taxonomy_id, accepted.family?.taxonomy_id);
  assert.deepEqual(declined.family?.eco_range, { from: "D20", to: "D63" });
  assert.notEqual(declined.system?.taxonomy_id, accepted.system?.taxonomy_id);
  assert.deepEqual(declined.path.map((node) => node.label), [
    "Queen's Gambit",
    "Declined",
    "Orthodox Defense",
    "Rubinstein Attack",
  ]);
  assert.deepEqual(declined.variation_path.map((node) => node.label), [
    "Orthodox Defense",
    "Rubinstein Attack",
  ]);
  assert.equal(declined.variation?.label, "Rubinstein Attack");
  assert.equal(declined.provenance.exact_source_names[0], declinedName);
});

test("an exact ECO hit classifies a transposed canonical position consistently", () => {
  const graph = buildRepertoireGraph(parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE), "white");
  const terminal = graph.positions.find(
    (position) => position.position_id === graph.routes[0]!.terminal_position_id,
  )!;
  assert.equal(graph.routes.every((route) => route.terminal_position_id === terminal.position_id), true);

  const table: OpeningTable = new Map([
    [terminal.position_key, { eco: "D37", name: "Queen's Gambit Declined: Three Knights Variation" }],
  ]);
  const report = buildOpeningTaxonomy(graph, table);
  const positionTaxonomy = report.positions.find(
    (position) => position.position_id === terminal.position_id,
  )!.taxonomy;

  assert.equal(positionTaxonomy.provenance.kind, "exact-position");
  assert.equal(positionTaxonomy.system?.label, "Declined");
  assert.equal(report.routes.length, 2);
  assert.equal(
    new Set(report.routes.map((route) => route.taxonomy.path.at(-1)?.taxonomy_id)).size,
    1,
  );
  assert.deepEqual(report.routes.map((route) => route.taxonomy), [positionTaxonomy, positionTaxonomy]);
});

test("a missing opening table produces an explicit unknown taxonomy", () => {
  const graph = buildRepertoireGraph(GameTree.fromPgn("1. e4 e5 2. Nf3 Nc6 *"), "white");
  const report = buildOpeningTaxonomy(graph, null);

  assert.equal(report.positions.length, graph.positions.length);
  assert.equal(report.positions.every((position) => position.taxonomy.state === "unknown"), true);
  assert.equal(
    report.positions.every((position) => position.taxonomy.provenance.kind === "missing-table"),
    true,
  );
  assert.equal(report.positions.every((position) => position.taxonomy.path.length === 0), true);
  assert.equal(report.routes[0]!.taxonomy.family, null);
});

test("fallback labels disclose inheritance and incompatible move orders stay unknown", () => {
  const simpleGraph = buildRepertoireGraph(GameTree.fromPgn("1. e4 c5 2. Nf3 d6 *"), "white");
  const simpleTable: OpeningTable = new Map();
  addHit(simpleTable, simpleGraph, ["e4", "c5"], "B20", "Sicilian Defense");
  const inherited = buildOpeningTaxonomy(simpleGraph, simpleTable).routes[0]!.taxonomy;

  assert.equal(inherited.state, "classified");
  assert.equal(inherited.family?.label, "Sicilian Defense");
  assert.equal(inherited.provenance.kind, "inherited-position");
  assert.deepEqual(inherited.provenance.exact_source_names, ["Sicilian Defense"]);

  const transpositionGraph = buildRepertoireGraph(
    parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE),
    "white",
  );
  const ambiguousTable: OpeningTable = new Map();
  addHit(ambiguousTable, transpositionGraph, ["d4"], "A40", "Queen's Pawn Game");
  addHit(ambiguousTable, transpositionGraph, ["Nf3"], "A04", "Zukertort Opening");
  const ambiguousReport = buildOpeningTaxonomy(transpositionGraph, ambiguousTable);

  for (const link of transpositionGraph.transposition_links) {
    const taxonomy = ambiguousReport.positions.find(
      (position) => position.position_id === link.position_id,
    )!.taxonomy;
    assert.equal(taxonomy.state, "unknown");
    assert.equal(taxonomy.provenance.kind, "ambiguous-inheritance");
    assert.deepEqual(taxonomy.provenance.exact_source_names, ["Queen's Pawn Game", "Zukertort Opening"]);
  }
});
