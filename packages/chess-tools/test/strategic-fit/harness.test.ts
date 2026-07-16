import assert from "node:assert/strict";
import test from "node:test";

import { GameTree } from "../../src/index.ts";
import { WHITE_TRANSPOSITION_FIXTURE, parseStrategicFitFixture } from "./fixtures.ts";

test("Strategic Fit harness executes TypeScript tests against chess-tools", () => {
  const tree = parseStrategicFitFixture(WHITE_TRANSPOSITION_FIXTURE);
  const { transpositionGroups, ...expectedStats } = WHITE_TRANSPOSITION_FIXTURE.expected;

  assert.ok(tree instanceof GameTree);
  assert.deepEqual(tree.stats(), expectedStats);
  assert.equal(tree.transpositions().length, transpositionGroups);
});
