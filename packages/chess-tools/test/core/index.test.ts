import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../../src/index.ts";

/**
 * `index.ts` is the package's only entry point (`exports` maps "." to it) and both apps import
 * through it. A re-export naming a symbol its module no longer provides is not a type error at the
 * boundary — it lands as an `undefined` at runtime in whichever app touched it first.
 */
test("every value the package re-exports is actually defined", () => {
  const undefinedExports = Object.entries(api)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  assert.deepEqual(undefinedExports, [], "these names resolve to undefined at runtime");
});

test("the public surface is not accidentally empty", () => {
  assert.ok(Object.keys(api).length > 50, `only ${String(Object.keys(api).length)} exports`);
});

/**
 * The names both apps and the MCP server actually call. A rename that misses a caller shows up
 * here rather than as a runtime failure in whichever host loaded first.
 */
test("the load-bearing entry points are exported under their published names", () => {
  for (const name of [
    // tree and PGN
    "GameTree",
    "buildKeyIndex",
    "isPrefix",
    // validation
    "validateLine",
    "validateFen",
    "validatePgn",
    "legalMoves",
    "isPromotion",
    // position identity and congruence
    "positionKey",
    "classifyUciMove",
    "weightFor",
    // openings
    "parseOpeningsTsv",
    "identifyAt",
    "identifyDeepest",
    // gaps
    "decisionNodes",
    "turnNodes",
    "gapSeverity",
    "medianLineLength",
    // game review
    "mainline",
    "classifyCpLoss",
    "moveAccuracy",
    "walkGameVsRepertoire",
    "aggregateGames",
    // structure
    "themes",
    "centerState",
    "classifyStructure",
    "classifyStructureFromFen",
    // network
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

/** Every default must be a member of the set it defaults within, or the first request 400s. */
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
