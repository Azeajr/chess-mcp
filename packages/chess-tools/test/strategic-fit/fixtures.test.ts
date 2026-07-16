import assert from "node:assert/strict";
import test from "node:test";

import { GameTree } from "../../src/index.ts";
import {
  INTENTIONAL_ANNOTATIONS_FIXTURE,
  STRATEGIC_FIT_FIXTURES,
  STRATEGIC_FIT_FIXTURE_TAGS,
  parseStrategicFitFixture,
} from "./fixtures.ts";

test("every Strategic Fit fixture is legal and parses through GameTree", () => {
  for (const value of STRATEGIC_FIT_FIXTURES) {
    assert.doesNotThrow(() => parseStrategicFitFixture(value), value.id);
    assert.ok(parseStrategicFitFixture(value) instanceof GameTree, value.id);
  }
});

test("fixture statistics and transposition counts are deterministic", () => {
  for (const value of STRATEGIC_FIT_FIXTURES) {
    const first = parseStrategicFitFixture(value);
    const second = parseStrategicFitFixture(value);
    const expectedStats = {
      nodes: value.expected.nodes,
      leaves: value.expected.leaves,
      maxDepth: value.expected.maxDepth,
    };

    assert.deepEqual(first.stats(), expectedStats, value.id);
    assert.deepEqual(second.stats(), expectedStats, `${value.id} repeated parse`);
    assert.equal(first.transpositions().length, value.expected.transpositionGroups, value.id);
    assert.deepEqual(second.transpositions(), first.transpositions(), `${value.id} repeated transpositions`);
  }
});

test("fixture library covers both repertoire colors and every required scenario", () => {
  assert.deepEqual(new Set(STRATEGIC_FIT_FIXTURES.map((value) => value.repertoireColor)), new Set(["white", "black"]));

  const coveredTags = new Set(STRATEGIC_FIT_FIXTURES.flatMap((value) => value.tags));
  for (const tag of STRATEGIC_FIT_FIXTURE_TAGS) assert.ok(coveredTags.has(tag), tag);

  for (const value of STRATEGIC_FIT_FIXTURES) {
    assert.equal(GameTree.detectColorFromPgn(value.pgn), value.repertoireColor, value.id);
  }
});

test("intentional annotations survive fixture parsing", () => {
  const tree = parseStrategicFitFixture(INTENTIONAL_ANNOTATIONS_FIXTURE);
  const path = tree.indexPathOfSan(["d4", "Nf6", "c4", "e6", "g3"]);

  assert.ok(path);
  const comments = tree.nodeAt(path).data.comments ?? [];
  assert.ok(comments.some((comment) => comment.includes("Keep intentionally")));
  assert.match(tree.toPgn(), /Must keep: core tournament repertoire\./);
});
