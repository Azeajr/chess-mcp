import assert from "node:assert/strict";
import test from "node:test";

import { makeFen } from "chessops/fen";

import {
  GameTree,
  preflightStrategicFit,
  positionKey,
  type OpeningTable,
  type PreflightIssueCode,
} from "../../src/index.ts";
import {
  SHALLOW_LINES_FIXTURE,
  WHITE_TRANSPOSITION_FIXTURE,
  parseStrategicFitFixture,
} from "./fixtures.ts";

const DEEP_SINGLE_ROUTE_PGN = `[Event "Strategic Fit preflight: deep single route"]
[Result "*"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Nf3 Be7 5. Bf4 O-O 6. e3 c5 7. Bd3 *`;

const VALID_MULTI_ROUTE_PGN = `${DEEP_SINGLE_ROUTE_PGN}

[Event "Strategic Fit preflight: second deep route"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 *`;

function openingTableFor(tree: GameTree): OpeningTable {
  const table: OpeningTable = new Map();
  tree.leaves().forEach(({ pos }, index) => {
    table.set(positionKey(makeFen(pos.toSetup())), {
      eco: index === 0 ? "D30" : "C70",
      name: index === 0 ? "Queen's Gambit Declined" : "Ruy Lopez",
    });
  });
  // An empty repertoire still needs a nonempty injected table to isolate its empty-tree result.
  if (table.size === 0) table.set("opening-table-present", { eco: "A00", name: "Uncommon Opening" });
  return table;
}

function codes(report: ReturnType<typeof preflightStrategicFit>): PreflightIssueCode[] {
  return report.issues.map((issue) => issue.code);
}

test("empty tree is a structured blocking preflight result", () => {
  const tree = new GameTree();
  const report = preflightStrategicFit(tree, {
    repertoireColor: "white",
    openingTable: openingTableFor(tree),
  });

  assert.equal(report.state, "blocked");
  assert.equal(report.route_count, 0);
  assert.equal(report.comparable_route_count, 0);
  assert.equal(report.incomplete_route_count, 0);
  assert.deepEqual(codes(report), ["empty-repertoire"]);
  assert.equal(report.issues[0]!.kind, "error");
  assert.equal(report.issues[0]!.severity, "blocking");
});

test("one mature route is degraded because it cannot establish a baseline", () => {
  const tree = GameTree.fromPgn(DEEP_SINGLE_ROUTE_PGN);
  const report = preflightStrategicFit(tree, {
    repertoireColor: "white",
    openingTable: openingTableFor(tree),
  });

  assert.equal(report.state, "degraded");
  assert.equal(report.route_count, 1);
  assert.equal(report.comparable_route_count, 1);
  assert.equal(report.incomplete_route_count, 0);
  assert.deepEqual(codes(report), ["single-route", "insufficient-comparable-positions"]);
  assert.ok(report.issues.every((issue) => issue.severity === "degraded"));
});

test("routes before the first frozen checkpoint remain incomplete evidence", () => {
  const tree = parseStrategicFitFixture(SHALLOW_LINES_FIXTURE);
  const report = preflightStrategicFit(tree, {
    repertoireColor: SHALLOW_LINES_FIXTURE.repertoireColor,
    openingTable: openingTableFor(tree),
  });

  assert.equal(report.state, "degraded");
  assert.equal(report.route_count, 3);
  assert.equal(report.comparable_route_count, 0);
  assert.equal(report.incomplete_route_count, 3);
  assert.deepEqual(codes(report), ["shallow-route", "incomplete-route", "insufficient-comparable-positions"]);
  assert.deepEqual(report.issues[0]!.details, {
    first_comparable_ply: 12,
    shallow_route_count: 3,
  });
});

test("custom starting FEN is blocked without replaying from the standard position", () => {
  const tree = GameTree.fromPgn(DEEP_SINGLE_ROUTE_PGN);
  tree.game.headers.set("SetUp", "1");
  tree.game.headers.set("FEN", "8/8/8/8/8/8/4K3/7k w - - 0 1");
  // This SAN is illegal from the standard start. Preflight must not inspect it once the custom
  // start is detected, because doing so would recreate the legacy silent-standard-replay bug.
  tree.game.moves.children[0]!.data.san = "e5";

  const report = preflightStrategicFit(tree, {
    repertoireColor: "white",
    openingTable: openingTableFor(new GameTree()),
  });

  assert.equal(report.state, "blocked");
  assert.equal(report.route_count, 0);
  assert.equal(report.comparable_route_count, 0);
  assert.ok(codes(report).includes("unsupported-custom-start"));
  assert.ok(!codes(report).includes("illegal-line"));
  const issue = report.issues.find((candidate) => candidate.code === "unsupported-custom-start")!;
  assert.equal(issue.severity, "blocking");
  assert.equal(issue.details.supported_start, "standard-initial-position");
});

test("transpositions remain informational while source paths are preserved", () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const report = preflightStrategicFit(tree, {
    repertoireColor: WHITE_TRANSPOSITION_FIXTURE.repertoireColor,
    openingTable: openingTableFor(tree),
  });
  const issue = report.issues.find((candidate) => candidate.code === "transposition-detected")!;

  assert.equal(issue.kind, "warning");
  assert.equal(issue.severity, "informational");
  assert.equal(issue.details.transposition_group_count, 2);
  assert.ok(issue.affected_source_paths.length >= 4);
});

test("missing opening table is an explicit degraded evidence source", () => {
  const tree = GameTree.fromPgn(VALID_MULTI_ROUTE_PGN);
  const report = preflightStrategicFit(tree, {
    repertoireColor: "white",
    openingTable: null,
  });

  assert.equal(report.state, "degraded");
  assert.equal(report.comparable_route_count, 2);
  assert.deepEqual(codes(report), ["missing-opening-classification"]);
  assert.equal(report.issues[0]!.details.opening_table_available, false);
  assert.equal(report.issues[0]!.provenance.at(-1)!.state, "unavailable");
});

test("checkmate route is terminal evidence, not a strategic verdict", () => {
  const tree = GameTree.fromPgn("1. f3 e5 2. g4 Qh4# *");
  const report = preflightStrategicFit(tree, {
    repertoireColor: "white",
    openingTable: openingTableFor(tree),
  });

  assert.equal(report.state, "degraded");
  assert.ok(codes(report).includes("terminal-tactical-route"));
  assert.equal(report.comparable_route_count, 0);
  assert.doesNotMatch(JSON.stringify(report), /consistent/i);
});

test("malformed and illegal tree data return blocking issues instead of throwing", () => {
  const malformed = GameTree.fromPgn("1. e4 e5 *");
  (malformed.game.moves.children[0]!.data as { san: unknown }).san = 42;
  const malformedReport = preflightStrategicFit(malformed, {
    repertoireColor: "white",
    openingTable: openingTableFor(new GameTree()),
  });
  assert.equal(malformedReport.state, "blocked");
  assert.ok(codes(malformedReport).includes("malformed-data"));

  const illegal = GameTree.fromPgn("1. e4 e5 *");
  illegal.game.moves.children[0]!.data.san = "e5";
  const illegalReport = preflightStrategicFit(illegal, {
    repertoireColor: "white",
    openingTable: openingTableFor(new GameTree()),
  });
  assert.equal(illegalReport.state, "blocked");
  assert.ok(codes(illegalReport).includes("illegal-line"));
});

test("valid multi-line repertoire is ready and deterministic", () => {
  const tree = GameTree.fromPgn(VALID_MULTI_ROUTE_PGN);
  const options = { repertoireColor: "white" as const, openingTable: openingTableFor(tree) };
  const first = preflightStrategicFit(tree, options);
  const second = preflightStrategicFit(tree, options);

  assert.deepEqual(first, second);
  assert.deepEqual(first, {
    analysis_version: "2.0.0",
    state: "ready",
    issues: [],
    route_count: 2,
    comparable_route_count: 2,
    incomplete_route_count: 0,
  });
  assert.doesNotMatch(JSON.stringify(first), /consistent/i);
});
