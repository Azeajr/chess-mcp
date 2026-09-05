import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../../src/index.ts";

test("every value the package re-exports is actually defined", () => {
  const undefinedExports = Object.entries(api)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  assert.deepEqual(undefinedExports, [], "these names resolve to undefined at runtime");
});

test("the public surface is not accidentally empty", () => {
  assert.ok(Object.keys(api).length > 50, `only ${String(Object.keys(api).length)} exports`);
});

test("the load-bearing entry points are exported under their published names", () => {
  for (const name of [
    "GameTree",
    "buildKeyIndex",
    "isPrefix",
    "validateLine",
    "validateFen",
    "validatePgn",
    "legalMoves",
    "isPromotion",
    "positionKey",
    "classifyUciMove",
    "weightFor",
    "parseOpeningsTsv",
    "identifyAt",
    "identifyDeepest",
    "decisionNodes",
    "turnNodes",
    "gapSeverity",
    "medianLineLength",
    "mainline",
    "classifyCpLoss",
    "moveAccuracy",
    "walkGameVsRepertoire",
    "aggregateGames",
    "themes",
    "centerState",
    "classifyStructure",
    "classifyStructureFromFen",
    "fetchJson",
    "fetchText",
    "lichessGames",
    "chesscomGames",
    "cloudEval",
    "tablebaseLookup",
    "explorerRequest",
    "normalizeExplorerFilters",
  ]) {
    assert.ok(name in api, `${name} is no longer exported from the package index`);
    assert.notEqual(
      (api as Record<string, unknown>)[name],
      undefined,
      `${name} is exported but undefined`,
    );
  }
});

test("exported constant collections are non-empty", () => {
  assert.ok(api.STRUCTURE_NAMES.length > 0);
  assert.ok(api.THEME_NAMES.length > 0);
  assert.ok(api.EXPLORER_SPEEDS.length > 0);
  assert.ok(api.EXPLORER_RATING_BUCKETS.length > 0);
  assert.ok(api.DEFAULT_EXPLORER_SPEEDS.length > 0);
  assert.ok(api.DEFAULT_EXPLORER_RATINGS.length > 0);
});

test("the explorer defaults are drawn from the allowed values", () => {
  for (const speed of api.DEFAULT_EXPLORER_SPEEDS) {
    assert.ok(api.EXPLORER_SPEEDS.includes(speed), `${speed} is not an allowed speed`);
  }
  for (const rating of api.DEFAULT_EXPLORER_RATINGS) {
    assert.ok(
      (api.EXPLORER_RATING_BUCKETS as readonly number[]).includes(rating),
      `${String(rating)} is not an allowed rating bucket`,
    );
  }
});

test("STRUCTURE_NAMES and THEME_NAMES contain no duplicates", () => {
  assert.equal(
    new Set(api.STRUCTURE_NAMES).size,
    api.STRUCTURE_NAMES.length,
    "a duplicated structure name would make its share double-counted",
  );
  assert.equal(new Set(api.THEME_NAMES).size, api.THEME_NAMES.length);
});
